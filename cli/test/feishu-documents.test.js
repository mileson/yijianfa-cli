import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFeishuDocumentService, validateDocumentXml, resolveLarkExecutable } from '../src/feishu-documents.js';
import { VERSION } from '../src/constants.js';

test('配套连接显示的版本与安装包版本一致',async()=>{
  const metadata=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));assert.equal(VERSION,metadata.version);
});

async function setup(t, options={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yijianfa-feishu-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const calls=[];
  const run=async(args,opts)=>{
    calls.push({args,opts});
    if(args[0]==='profile')return[{name:'docs-app',appId:'cli_docs',user:'文档用户',tokenStatus:'valid'}];
    if(args.includes('whoami'))return{profile:'docs-app',appId:options.changed?'cli_changed':'cli_docs',identity:'user',onBehalfOf:{openId:'ou_docs'}};
    if(args.includes('+create')){if(options.fail)throw Object.assign(Error('连接中断'),{code:'feishu_timeout'});return{ok:true,data:{document:{url:'https://team.feishu.cn/docx/NEW',document_id:'NEW'},warnings:[]}};}
    if(args.includes('+fetch'))return{ok:true,data:{document:{content:options.mismatch?'<p>缺少正文</p>':'<p>正文内容</p><img src="token"/>'}}};
  };
  const service=createFeishuDocumentService({directory,run});t.after(()=>service.close());
  const payload={requestId:randomUUID(),profile:'docs-app',appId:'cli_docs',userId:'ou_docs',title:'跨平台文章',xml:'<p>正文内容</p><img path="@./image-0.png"/>',expectedText:'正文内容',mediaCount:1};
  return{directory,run,service,calls,payload};
}
test('拒绝任意路径、资源 token、外部实体与未声明图片',()=>{
  for(const xml of ['<img path="@/etc/passwd"/>','<source path="@./secret"/>','<!DOCTYPE x><p>正文</p>','<img src="token"/>','<img path="@./image-2.png"/>','<p onclick="x">正文</p>'])assert.throws(()=>validateDocumentXml(xml,1));
  validateDocumentXml('<p>正文</p><img path="@./image-0.png"/>',1);
});
test('完整上传、固定用户身份创建、读回图片与正文、临时文件收尾',async t=>{
  const s=await setup(t);await s.service.handle('begin',s.payload);
  await s.service.handle('media',{requestId:s.payload.requestId,index:0,chunk:0,mime:'image/png',data:'aGVsbG8=',last:true});
  const result=await s.service.handle('commit',{requestId:s.payload.requestId});assert.equal(result.status,'completed');
  const write=s.calls.find(c=>c.args.includes('+create'));assert.deepEqual(write.args.slice(0,6),['--profile','docs-app','docs','+create','--as','user']);assert.equal(write.opts.input,s.payload.xml);
  await assert.rejects(fs.access(write.opts.cwd));
  const restored=createFeishuDocumentService({directory:s.directory,run:s.run});t.after(()=>restored.close());
  assert.equal((await restored.handle('status',{requestId:s.payload.requestId})).url,result.url);
  assert.equal((await restored.handle('begin',s.payload)).status,'completed');assert.equal(s.calls.filter(c=>c.args.includes('+create')).length,1);
});
test('图片未齐、重发分块、应用映射变化都不触发创建',async t=>{
  const s=await setup(t);await s.service.handle('begin',s.payload);await assert.rejects(s.service.handle('commit',{requestId:s.payload.requestId}),/图片尚未上传完整/);
  const chunk={requestId:s.payload.requestId,index:0,chunk:0,mime:'image/png',data:'aGVsbG8=',last:true};await s.service.handle('media',chunk);await assert.rejects(s.service.handle('media',chunk),/顺序/);
  assert.equal(s.calls.filter(c=>c.args.includes('+create')).length,0);
  const other=await setup(t,{changed:true});await assert.rejects(other.service.handle('begin',other.payload),/身份/);assert.equal(other.calls.filter(c=>c.args.includes('+create')).length,0);
  const mismatch=await setup(t);await assert.rejects(mismatch.service.handle('begin',{...mismatch.payload,appId:'wrong-app'}),/应用已变化/);
});
test('远程写入后断线保留不确定状态，重启也不能重复创建',async t=>{
  const s=await setup(t,{fail:true});await s.service.handle('begin',s.payload);await s.service.handle('media',{requestId:s.payload.requestId,index:0,chunk:0,mime:'image/png',data:'aGVsbG8=',last:true});
  await assert.rejects(s.service.handle('commit',{requestId:s.payload.requestId}),/连接中断/);
  const next=createFeishuDocumentService({directory:s.directory,run:s.run});t.after(()=>next.close());assert.equal((await next.handle('begin',s.payload)).status,'needs_check');assert.equal(s.calls.filter(c=>c.args.includes('+create')).length,1);
});
test('回读正文或图片不完整时返回待检查，不伪报成功',async t=>{
  const s=await setup(t,{mismatch:true});await s.service.handle('begin',s.payload);await s.service.handle('media',{requestId:s.payload.requestId,index:0,chunk:0,mime:'image/png',data:'aGVsbG8=',last:true});const result=await s.service.handle('commit',{requestId:s.payload.requestId});assert.equal(result.status,'needs_check');assert.equal(result.url,'https://team.feishu.cn/docx/NEW');
});
test('并发 commit 在身份核对等待期间也只能创建一次',async t=>{
  const s=await setup(t);let blocked=false,release,entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const service=createFeishuDocumentService({directory:s.directory,run:async(args,opts)=>{
    if(blocked&&args.includes('whoami')){entered();await new Promise(resolve=>{release=resolve;});}
    return s.run(args,opts);
  }});t.after(()=>service.close());
  await service.handle('begin',s.payload);await service.handle('media',{requestId:s.payload.requestId,index:0,chunk:0,mime:'image/png',data:'aGVsbG8=',last:true});
  blocked=true;const first=service.handle('commit',{requestId:s.payload.requestId});await ready;
  assert.equal((await service.handle('commit',{requestId:s.payload.requestId})).status,'running');release();
  assert.equal((await first).status,'completed');assert.equal(s.calls.filter(c=>c.args.includes('+create')).length,1);
});

test('Chrome 精简 PATH 下仍能发现 npm 用户目录安装的飞书 CLI',async()=>{
  const seen=[];const executable=await resolveLarkExecutable({env:{PATH:'/usr/bin:/bin'},home:'/users/docs',check:async candidate=>{seen.push(candidate);if(candidate!=='/users/docs/.npm-global/bin/lark-cli')throw Error('missing');}});
  assert.equal(executable,'/users/docs/.npm-global/bin/lark-cli');assert.ok(seen.includes('/usr/bin/lark-cli'));
});
test('主动检测按文档权限筛选用户连接，不使用当前默认通知应用',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yijianfa-detect-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const calls=[];const service=createFeishuDocumentService({directory,run:async args=>{
    calls.push(args);if(args[0]==='profile')return[{name:'notify',appId:'cli_notify',user:'通知用户',active:true},{name:'docs',appId:'cli_docs',user:'文档用户',tokenStatus:'needs_refresh'},{name:'bot',appId:'cli_bot'}];
    const docs=args[1]==='docs';return{appId:docs?'cli_docs':'cli_notify',identity:'user',identities:{user:{tokenStatus:docs?'needs_refresh':'valid',scope:docs?'docx:document:create docx:document:write_only':'im:message:send_as_bot'}}};
  }});t.after(()=>service.close());
  const result=await service.handle('connections',{detect:true});assert.equal(result.connections.find(c=>c.profile==='docs').documentAccess,true);assert.equal(result.connections.find(c=>c.profile==='notify').documentAccess,false);assert.equal(calls.length,3);
});

test('多个文档应用时只优先使用已明确绑定的文档连接',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yijianfa-preferred-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const preferenceFile=path.join(directory,'connection.json');
  await fs.writeFile(preferenceFile,JSON.stringify({profile:'docs',appId:'cli_docs',userId:'ou_docs'}));
  const service=createFeishuDocumentService({directory,preferenceFile,run:async args=>args[0]==='profile'?[{name:'notification',appId:'cli_notify',user:'用户'},{name:'docs',appId:'cli_docs',user:'用户'}]:{appId:args[1]==='docs'?'cli_docs':'cli_notify',identity:'user',identities:{user:{tokenStatus:'valid',scope:'docx:document'}}}});t.after(()=>service.close());
  const result=await service.handle('connections',{detect:true});assert.equal(result.connections.find(c=>c.profile==='docs').preferred,true);assert.equal(result.connections.find(c=>c.profile==='docs').userId,'ou_docs');assert.equal(result.connections.find(c=>c.profile==='notification').preferred,undefined);
});

test('图片尺寸允许安全的正整数，不允许无效或额外属性', () => {
  assert.doesNotThrow(() => validateDocumentXml('<img path="@./image-0.png" width="240" height="480"/>',1));
  for (const attr of ['width="0"','height="-1"','width="10000"','width="2.5"','onerror="x"']) {
    assert.throws(() => validateDocumentXml(`<img path="@./image-0.png" ${attr}/>`,1));
  }
});

test('文档创建后使用已上传图片设置封面，失败时保留文档并提醒检查', async t => {
  for (const fail of [false, true]) {
    const s = await setup(t); const calls = [];
    const service = createFeishuDocumentService({ directory: s.directory, run: async (args, opts) => {
      calls.push(args);
      if (args.includes('+resource-update')) { if (fail) throw Error('failed'); return { data: { cover: { token: 'cover-token' } } }; }
      return s.run(args, opts);
    }}); t.after(() => service.close());
    const payload = { ...s.payload, coverIndex: 0 };
    assert.equal((await service.handle('begin', payload)).supportsCover, true);
    await service.handle('media', {requestId:payload.requestId,index:0,chunk:0,mime:'image/png',data:'aGVsbG8=',last:true});
    const result = await service.handle('commit', {requestId:payload.requestId});
    assert.equal(result.status, fail ? 'needs_check' : 'completed');
    if (fail) assert.match(result.message, /封面未设置成功/);
    const coverCall = calls.find(args => args.includes('+resource-update'));
    assert.ok(coverCall.includes('--file')); assert.ok(coverCall.includes('cover'));
  }
});

test('仅允许飞书正文强调使用约定的蓝色，不放开其他属性', () => {
  assert.doesNotThrow(() => validateDocumentXml('<p>普通<span text-color="blue"><b>重点</b></span></p>',0));
  for (const xml of ['<span text-color="red">文字</span>','<span text-color="blue" onclick="x">文字</span>','<p text-color="blue">文字</p>']) assert.throws(() => validateDocumentXml(xml,0));
});

test('回读缺少蓝色样式时保留文档并提示检查', async t => {
  const s=await setup(t);
  const payload={...s.payload,xml:'<p><span text-color="blue"><b>正文内容</b></span></p><img path="@./image-0.png"/>'};
  await s.service.handle('begin',payload);
  await s.service.handle('media',{requestId:payload.requestId,index:0,chunk:0,mime:'image/png',data:'aGVsbG8=',last:true});
  const result=await s.service.handle('commit',{requestId:payload.requestId});
  assert.equal(result.status,'needs_check'); assert.match(result.message,/蓝色加粗/);
});
