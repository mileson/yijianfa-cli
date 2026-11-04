// Shared by the standalone CLI and extension before a task is dispatched.
(function (root) {
  const support = {
    creationSource: ['weixin'],
    collection: ['weixin','xiaohongshu', 'douyin', 'shipinhao'],
    group: ['xiaohongshu'],
    location: ['weixin','xiaohongshu', 'douyin', 'shipinhao', 'kuaishou'],
    contentDeclaration: ['xiaohongshu'],
  };
  function selection(kind, raw) {
    if (typeof raw === 'string') raw = kind === 'location'
      ? {mode:'keyword', keyword:raw} : {mode:'select', name:raw};
    if (raw?.mode === 'keep') return {mode:'keep'};
    const keyword = raw?.mode === 'keyword' && kind === 'location';
    const field = keyword ? 'keyword' : 'name';
    if ((!keyword && raw?.mode !== 'select') || typeof raw[field] !== 'string' ||
        !raw[field].trim() || raw[field].length > 200) throw Error('请填写有效的 ' + kind + ' 名称或关键词');
    if (kind === 'creationSource' && raw.name.trim().startsWith('素材来源官方媒体/网络新闻')) {
      throw Error('素材来源官方媒体/网络新闻请在公众号编辑页手动设置');
    }
    return {...raw, [field]:raw[field].trim()};
  }
  function forPlatform(data, platform) {
    const result = {};
    for (const [kind, allowed] of Object.entries(support)) {
      if (!allowed.includes(platform)) continue;
      const raw = data.extra?.[platform]?.[kind] ?? data.extra?.publishDestinations?.[kind];
      if (raw !== undefined) result[kind] = selection(kind, raw);
    }
    return result;
  }
  function validate(type, platforms, data) {
    const extra = data.extra || {};
    const common = extra.publishDestinations;
    if (common !== undefined && (!common || typeof common !== 'object' || Array.isArray(common))) throw Error('publishDestinations 必须是对象');
    for (const [kind, raw] of Object.entries(common || {})) {
      if (!Object.hasOwn(support, kind) || (platforms.length && !platforms.some(p => support[kind].includes(p) && (p !== "weixin" || type === "imageText")))) throw Error('发布平台不支持 ' + kind);
      if (!['imageText','shortVideo'].includes(type)) throw Error('合集、地点和群聊仅支持图文或短视频');
      selection(kind, raw);
    }
    for (const [kind, allowed] of Object.entries(support)) {
      for (const p of ['weixin','xiaohongshu','douyin','kuaishou','shipinhao']) {
        if (extra[p]?.[kind] === undefined) continue;
        if ((p === "weixin" && type !== "imageText") || !allowed.includes(p) || (platforms.length && !platforms.includes(p)) || !['imageText','shortVideo'].includes(type)) throw Error('当前任务不支持 ' + p + '.' + kind);
        selection(kind, extra[p][kind]);
      }
    }
    if ((!platforms.length || platforms.includes('xiaohongshu')) &&
        (extra.xiaohongshu?.personalDeclaration ?? data.personalDeclaration) === true &&
        forPlatform(data,'xiaohongshu').contentDeclaration?.name === '内容来源声明 / 来源转载') throw Error('来源转载不能与小红书原创声明同时使用，请关闭原创声明');
  }
  const policy = {forPlatform, validate};
  if (typeof module !== 'undefined') module.exports = policy;
  root.MultiSyncDestinationPolicy = policy;
})(globalThis);
