// Only invoked through native messaging from the regular, trusted workbench.
// Keep short-lived offers separate from bridge discovery and public CLI actions.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ensureSecureSocketDirectory } from './socket-path.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);
export async function membershipSharing(root, identity, operation, payload = {}) {
  if (identity.browserContext !== 'regular' || !['dmcejnbkknlkpcbaggoeiminccbpliaj','noadennjakpikgpkkaknllgcemlgokcg'].includes(identity.extensionId) ||
      payload.origin !== 'https://yijianfa.ainativehub.com') throw Error('Unavailable');
  const dir = path.join(root, 'membership-' + hash(identity.browserNamespace || 'default'));
  await ensureSecureSocketDirectory(path.join(root, 'registry.sock'));
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
  await ensureSecureSocketDirectory(path.join(dir, 'offer'));
  const file = value => path.join(dir, hash(value));
  if (operation === 'offer') {
    if (!validToken(payload.token) || !payload.accountId || typeof payload.accountId !== 'string') throw Error('Invalid session');
    const tmp = path.join(dir, randomUUID());
    try {
      await fs.writeFile(tmp, JSON.stringify({ token: payload.token, account: hash(payload.accountId), expires: Date.now() + 86400000 }), {flag:'wx', mode:0o600});
      await fs.rename(tmp, file(payload.token));
    } finally { await fs.rm(tmp, {force:true}); }
    return {};
  }
  if (operation === 'forget' && validToken(payload.token)) {
    await fs.rm(file(payload.token), {force:true});
    return {};
  }
  if (operation !== 'restore') throw Error('Unavailable');
  const offers = [];
  for (const name of await fs.readdir(dir)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const record = await fs.readFile(path.join(dir, name), 'utf8').then(JSON.parse).catch(() => null);
    if (!validToken(record?.token) || hash(record.token) !== name) continue;
    if (record.expires <= Date.now()) { await fs.rm(path.join(dir,name), {force:true}); continue; }
    offers.push(record);
  }
  offers.sort((a,b) => b.expires-a.expires);
  return {token: new Set(offers.map(o=>o.account)).size === 1 ? offers[0].token : null};
}
