import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { membershipSharing } from '../src/membership-sharing.js';
test('trusted channels share only one unambiguous regular account within a browser', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'membership-test-'));
  t.after(()=>fs.rm(dir,{force:true,recursive:true}));
  const local = {browserNamespace:'ego', browserContext:'regular', extensionId:'noadennjakpikgpkkaknllgcemlgokcg'};
  const store = {...local,extensionId:'dmcejnbkknlkpcbaggoeiminccbpliaj'};
  const invoke = (id, op, extra = {}) => membershipSharing(dir,id,op,{origin:'https://yijianfa.ainativehub.com', ...extra});
  const token = 'x'.repeat(43), other = 'y'.repeat(43);
  await invoke(local,'offer',{token, accountId:'A'});
  assert.equal((await invoke(store,'restore')).token,token);
  assert.equal((await invoke({...store,browserNamespace:'chrome'},'restore')).token,null);
  await assert.rejects(invoke({...store,browserContext:'incognito'},'restore'));
  await assert.rejects(invoke({...store,extensionId:'unknown'},'restore'));
  await invoke(store,'offer',{token:other,accountId:'B'});
  assert.equal((await invoke(local,'restore')).token,null);
  await invoke(store,'forget',{token:other});
  assert.equal((await invoke(local,'restore')).token,token);
});
test('new and legacy domains share existing sessions while untrusted origins are rejected', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'membership-domain-test-'));
  t.after(() => fs.rm(dir, {force:true, recursive:true}));
  const identity = {browserNamespace:'chrome', browserContext:'regular', extensionId:'dmcejnbkknlkpcbaggoeiminccbpliaj'};
  const legacy = 'https://yijianfa.ainativehub.com';
  const current = 'https://yijianfa.moticlaw.com';
  const invoke = (origin, operation, extra = {}) => membershipSharing(dir, identity, operation, {origin, ...extra});
  const token = 'z'.repeat(43);
  await invoke(legacy, 'offer', {token, accountId:'existing-account'});
  assert.equal((await invoke(current, 'restore')).token, token);
  await invoke(current, 'offer', {token, accountId:'existing-account'});
  assert.equal((await invoke(legacy, 'restore')).token, token);
  for (const origin of ['http://yijianfa.moticlaw.com', 'https://yijianfa.moticlaw.com.evil.test', 'https://moticlaw.com', current + '/']) {
    await assert.rejects(invoke(origin, 'restore'));
  }
  await invoke(current, 'forget', {token});
  assert.equal((await invoke(legacy, 'restore')).token, null);
});
