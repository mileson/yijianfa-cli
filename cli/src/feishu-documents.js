// 飞书文档本机连接：固定 CLI 命令与用户身份，分块上传临时图片，创建前落盘防重放。
// 不读凭证文件，不执行 shell，不接受任意本地路径或文档覆盖命令。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
const safeProfile = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const error = (code, message) => Object.assign(new Error(message), { code });
const mimeTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const normalize = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, '');

export async function resolveLarkExecutable({ env = process.env, home = os.homedir(), check = candidate => fs.access(candidate, 1) } = {}) {
  const binary = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';
  const candidates = [...new Set([
    ...String(env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, binary)),
    ...[env.npm_config_prefix, env.NPM_CONFIG_PREFIX, path.join(home, '.npm-global'), path.join(home, '.local'), path.join(home, '.volta'), '/opt/homebrew', '/usr/local'].filter(Boolean).map(prefix => path.join(prefix, 'bin', binary)),
  ])];
  for (const candidate of candidates) { try { await check(candidate); return candidate; } catch {} }
  throw error('feishu_not_installed', '未找到本机飞书连接，请确认飞书已安装或更新一键发本机连接');
}

export async function runLark(args, { input = '', cwd, timeout = 120000 } = {}) {
  const executable = await resolveLarkExecutable();
  const childPath = [...new Set([path.dirname(process.execPath), path.dirname(executable), ...String(process.env.PATH || '').split(path.delimiter), '/usr/bin', '/bin'])].filter(Boolean).join(path.delimiter);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, PATH: childPath, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', bytes = 0, settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { child.kill(); finish(reject, error('feishu_timeout', '飞书处理超时，请先检查任务结果，勿重复创建')); }, timeout);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { child.kill(); finish(reject, error('feishu_response_large', '文档结果过大，请检查飞书中的实际文档')); } else stdout += chunk.toString('utf8'); });
    // 丢弃 stderr：其中可能含文档内容、路径或临时授权信息。
    child.stderr.resume();
    child.on('error', () => finish(reject, error('feishu_unavailable', '无法启动飞书文档连接')));
    child.on('close', code => {
      if (code !== 0) return finish(reject, error('feishu_authorization', '飞书操作未完成，请检查所选应用的用户授权与文档权限'));
      try { const value = JSON.parse(stdout); if (value.ok === false) throw new Error(); finish(resolve, value); }
      catch { finish(reject, error('feishu_invalid_response', '未能确认飞书返回结果，请先检查文档，勿重复创建')); }
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

export function validateDocumentXml(xml, mediaCount) {
  if (typeof xml !== 'string' || !xml.trim() || Buffer.byteLength(xml) > 500000 || /<!|<\?/.test(xml)) throw error('invalid_document', '文章内容无法转换为飞书文档');
  const tags = new Set('p h1 h2 h3 h4 h5 h6 blockquote hr img b em u del br span a ol ul li pre code table thead tbody tr th td'.split(' '));
  const images = new Set();
  for (const match of xml.matchAll(/<([^>]+)>/g)) {
    const parsed = /^\/?([a-z][a-z0-9]*)([\s\S]*?)\/?$/.exec(match[1]);
    if (!parsed || !tags.has(parsed[1])) throw error('invalid_document', '正文含有不支持的文档元素');
    const [, tag, attrs] = parsed;
    const tokens = [...attrs.matchAll(/\s+([a-z-]+)="([^"]*)"/g)];
    if (attrs.replace(/\s+([a-z-]+)="([^"]*)"/g, '').trim()) throw error('invalid_document', '正文属性无法识别');
    for (const [, name, value] of tokens) {
      if (tag === 'img' && name === 'path') {
        const image = /^@\.\/image-(\d+)\.(png|jpg|gif|webp)$/.exec(value);
        if (!image || Number(image[1]) >= mediaCount) throw error('invalid_document', '图片引用无效');
        images.add(Number(image[1]));
      } else if (tag === 'img' && ['width', 'height'].includes(name) && /^[1-9]\d{0,3}$/.test(value)) continue;
      else if (tag === 'span' && name === 'text-color' && value === 'blue') continue;
      else if (tag === 'a' && name === 'href' && /^https?:\/\//.test(value)) continue;
      else if (['td', 'th'].includes(tag) && ['rowspan', 'colspan'].includes(name) && /^[1-9]\d?$/.test(value)) continue;
      else throw error('invalid_document', '正文含有不支持的资源引用');
    }
    if (tag === 'img' && !match[1].startsWith('/') && !tokens.some(t => t[1] === 'path')) throw error('invalid_document', '正文图片缺少引用');
  }
  if (images.size !== mediaCount) throw error('invalid_document', '文章图片与上传清单不一致');
}

export function createFeishuDocumentService({ directory, run = runLark, preferenceFile = path.join(os.homedir(), '.yijianfa', 'feishu-document-connection.json') } = {}) {
  const sessions = new Map(), committing = new Set(), preparing = new Set();
  let closed = false;
  const root = path.join(directory, 'feishu-documents');
  const ensure = () => fs.mkdir(root, { recursive: true, mode: 0o700 });
  const journalPath = id => path.join(root, `${id}.json`);
  const persist = async (id, data) => {
    await ensure();
    const file = await fs.open(journalPath(id), 'w', 0o600);
    try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
  };
  async function status(id) {
    if (!uuid(id)) throw error('invalid_request', '任务标识无效');
    if (preparing.has(id)) return { status: 'preparing', requestId: id };
    if (sessions.has(id) && !committing.has(id)) return { status: 'prepared', requestId: id };
    try { const record = JSON.parse(await fs.readFile(journalPath(id), 'utf8')); return { requestId: id, ...record }; }
    catch (e) { if (e.code === 'ENOENT') return { status: committing.has(id) ? 'running' : 'not_found', requestId: id }; throw e; }
  }
  async function connections() {
    const result = await run(['profile', 'list'], { timeout: 15000 });
    if (!Array.isArray(result)) throw error('feishu_invalid_response', '无法读取飞书文档连接');
    return { connections: result.filter(p => safeProfile(p.name)).map(p => ({ profile: p.name, appId: p.appId || '', user: p.user || '', status: p.tokenStatus || 'not_connected' })) };
  }
  async function verifyConnection(payload) {
    if (!safeProfile(payload.profile)) throw error('invalid_request', '连接参数无效');
    const profile = (await connections()).connections.find(p => p.profile === payload.profile && p.user);
    if (!profile) throw error('feishu_authorization', '所选文档应用尚未取得用户授权，请先连接');
    if (profile.appId !== payload.appId) throw error('feishu_identity_changed', '所选应用已变化，请重新选择飞书文档连接');
    const who = await run(['--profile', profile.profile, 'whoami'], { timeout: 15000 });
    const userId = who.onBehalfOf?.openId;
    if (who.profile !== profile.profile || who.appId !== profile.appId || who.identity !== 'user' || typeof userId !== 'string' || !userId) throw error('feishu_identity_changed', '飞书应用或用户身份与所选连接不一致');
    return { ...profile, userId };
  }
  async function handle(operation, payload = {}) {
    if (closed) throw error('connection_closed', '本机连接已结束，请先检查任务结果');
    if (operation === 'connections') {
      const found = await connections();
      if (payload.detect) {
        let preferred; try { preferred = JSON.parse(await fs.readFile(preferenceFile, 'utf8')); } catch {}
        for (const connection of found.connections.filter(c => c.user)) {
          try {
            const auth = await run(['--profile', connection.profile, 'auth', 'status', '--json'], { timeout: 5000 });
            const user = auth.identities?.user || {}, scopes = new Set(String(user.scope || '').split(/\s+/));
            connection.documentAccess = auth.appId === connection.appId && auth.identity === 'user' && ['valid','needs_refresh'].includes(user.tokenStatus || user.status) && (scopes.has('docx:document') || (scopes.has('docx:document:create') && scopes.has('docx:document:write_only')));
            if (connection.documentAccess && preferred?.profile === connection.profile && preferred?.appId === connection.appId && typeof preferred.userId === 'string' && preferred.userId) { connection.preferred = true; connection.userId = preferred.userId; }
          } catch { connection.documentAccess = false; }
        }
      }
      return found;
    }
    if (operation === 'connection') return verifyConnection(payload);
    const id = payload.requestId;
    if (!uuid(id)) throw error('invalid_request', '任务标识无效');
    if (operation === 'status') return status(id);
    if (operation === 'begin') {
      const previous = await status(id);
      if (previous.status !== 'not_found') return previous;
      if (sessions.size || committing.size || preparing.size) throw error('busy', '另一篇飞书文章正在处理中');
      if (!safeProfile(payload.profile) || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 300 || !Number.isInteger(payload.mediaCount) || payload.mediaCount < 0 || payload.mediaCount > 200) throw error('invalid_request', '文章或连接参数无效');
      if (payload.coverIndex != null && (!Number.isInteger(payload.coverIndex) || payload.coverIndex < 0 || payload.coverIndex >= payload.mediaCount)) throw error('invalid_request', '封面图片无效');
      validateDocumentXml(payload.xml, payload.mediaCount);
      preparing.add(id);
      try {
      const profile = await verifyConnection(payload);
      if (profile.userId !== payload.userId) throw error('feishu_identity_changed', '飞书登录用户已变化，请重新选择文档连接');
      if (closed) throw error('connection_closed', '本机连接已结束');
      await ensure(); const cwd = await fs.mkdtemp(path.join(root, 'upload-')); await fs.chmod(cwd, 0o700);
      const session = { cwd, profile: profile.profile, appId: profile.appId, userId: profile.userId, title: payload.title, xml: payload.xml, expectedText: normalize(payload.xml), count: payload.mediaCount, coverIndex: payload.coverIndex, images: new Map(), bytes: 0, touched: Date.now() };
      sessions.set(id, session);
      return { requestId: id, status: 'prepared', supportsCover: true };
      } finally { preparing.delete(id); }
    }
    const session = sessions.get(id);
    if (!session) throw error('session_missing', '上传会话已结束，请先检查任务状态');
    if (Date.now() - session.touched > 5 * 60000) { sessions.delete(id); await fs.rm(session.cwd, { recursive: true, force: true }); throw error('session_expired', '图片上传超时，请重新开始'); }
    session.touched = Date.now();
    if (operation === 'media') {
      const { index, chunk, data, mime } = payload;
      if (!Number.isInteger(index) || index < 0 || index >= session.count || !Number.isInteger(chunk) || chunk < 0 || !mimeTypes[mime] || typeof data !== 'string' || data.length > 180000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw error('invalid_media', '图片上传数据无效');
      const image = session.images.get(index) || { next: 0, bytes: 0, mime };
      if (image.next !== chunk || image.mime !== mime) throw error('invalid_media', '图片上传顺序不一致，请勿重复提交');
      const bytes = Buffer.from(data, 'base64');
      if (image.bytes + bytes.length > 20 * 1024 * 1024 || session.bytes + bytes.length > 48 * 1024 * 1024) throw error('media_large', '图片过大，请在预览中减少或压缩图片');
      await fs.appendFile(path.join(session.cwd, `image-${index}.${mimeTypes[mime]}`), bytes, { mode: 0o600 });
      image.next++; image.bytes += bytes.length; image.complete = payload.last === true;
      session.images.set(index, image); session.bytes += bytes.length;
      return { status: 'uploaded', index, chunk };
    }
    if (operation === 'cancel') { sessions.delete(id); await fs.rm(session.cwd, { recursive: true, force: true }); return { status: 'cancelled' }; }
    if (operation !== 'commit') throw error('invalid_request', '不支持此文档操作');
    if (committing.has(id)) return status(id);
    for (let i = 0; i < session.count; i++) {
      const img = session.images.get(i);
      if (!img?.complete || !session.xml.includes(`@./image-${i}.${mimeTypes[img.mime]}`)) throw error('incomplete_media', '正文图片尚未上传完整');
    }
    committing.add(id);
    // 在任何远程写入前持久化。未知结果必须人工检查，不能重放 commit。
    let outcome;
    try {
      const who = await run(['--profile', session.profile, 'whoami'], { timeout: 15000 });
      if (who.profile !== session.profile || who.appId !== session.appId || who.identity !== 'user' || who.onBehalfOf?.openId !== session.userId) throw error('feishu_identity_changed', '飞书身份已变化，本次创建已停止');
      if (closed) throw error('connection_closed', '本机连接已结束');
      await persist(id, { status: 'needs_check', message: '文档创建已开始，请先检查飞书，勿重复创建', startedAt: Date.now() });
      const created = await run(['--profile', session.profile, 'docs', '+create', '--as', 'user', '--doc-format', 'xml', '--title', session.title, '--content', '-'], { cwd: session.cwd, input: session.xml });
      const doc = created.data?.document;
      const url = doc?.url;
      if (!url || !/^https:\/\/(?:[\w-]+\.)*(feishu\.cn|larksuite\.com)\/docx\/[\w-]+/.test(url)) throw error('feishu_unknown', '文档创建结果无法确认，请先到飞书检查');
      outcome = { status: 'needs_check', url, message: '文档已创建，正在核对正文与图片' };
      await persist(id, outcome);
      let coverFailed = false;
      if (session.coverIndex != null) {
        const cover = session.images.get(session.coverIndex);
        try {
          const updated = await run(['--profile', session.profile, 'docs', '+resource-update', '--as', 'user', '--doc', url, '--type', 'cover', '--file', path.join(session.cwd, `image-${session.coverIndex}.${mimeTypes[cover.mime]}`)], { timeout: 120000 });
          if (!updated.data?.cover?.token) coverFailed = true;
        } catch { coverFailed = true; }
      }
      const fetched = await run(['--profile', session.profile, 'docs', '+fetch', '--as', 'user', '--doc', url, '--detail', 'full'], { timeout: 60000 });
      const document = fetched.data?.document;
      const body = document?.content || document?.xml || document?.body || '';
      const verified = normalize(typeof body === 'string' ? body : '').includes(normalize(session.expectedText)) && (String(body).match(/<img\b/g) || []).length >= session.count;
      const warnings = [...(created.data?.warnings || []), ...(fetched.data?.warnings || [])];
      const expectedColors = (session.xml.match(/<span text-color="blue">/g) || []).length;
      const actualColors = (String(body).match(/text-color="(?:blue|rgb\(36,\s*91,\s*219\))"/gi) || []).length;
      const colorMissing = expectedColors > 0 && actualColors < expectedColors;
      outcome = { status: verified && !warnings.length && !coverFailed && !colorMissing ? 'completed' : 'needs_check', url, message: coverFailed ? '云文档已创建，封面未设置成功，请在飞书中检查并手动添加' : colorMissing ? '云文档已创建，但未能确认蓝色加粗，请在飞书中检查' : verified && !warnings.length ? '云文档已创建，正文与图片已核对' : '云文档已创建，部分内容需要检查', documentId: doc.document_id };
      await persist(id, outcome);
      return { requestId: id, ...outcome };
    } catch (caught) {
      if (outcome?.url) { outcome = { ...outcome, status: 'needs_check', message: '文档已创建，回读未完成，请打开检查' }; await persist(id, outcome); return { requestId: id, ...outcome }; }
      throw caught;
    } finally { sessions.delete(id); committing.delete(id); await fs.rm(session.cwd, { recursive: true, force: true }); }
  }
  return { handle, close: async () => { closed = true; for (const [id, session] of sessions) if (!committing.has(id)) { await fs.rm(session.cwd, { recursive: true, force: true }); sessions.delete(id); } } };
}
