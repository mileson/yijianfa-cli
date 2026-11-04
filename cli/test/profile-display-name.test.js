import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { resolveProfileDisplayName } from "../src/profile-display-name.js";

test("maps the connected Chrome profile by fresh proof and rejects ambiguous or private matches", async t => {
  const support = await fs.mkdtemp(path.join(os.tmpdir(), "yijf-profile-"));
  t.after(() => fs.rm(support, {recursive:true, force:true}));
  const identity = {browserNamespace:"", extensionId:"a".repeat(32), browserContext:"regular"};
  const proof = "yijf-profile:" + randomUUID();
  const root = path.join(support, "Google/Chrome");
  const file = async dir => {
    const db = path.join(root, dir, "Local Extension Settings", identity.extensionId);
    await fs.mkdir(db, {recursive:true});
    await fs.writeFile(path.join(db,"000123.log"), proof);
  };
  await file("Profile 4");
  await fs.writeFile(path.join(root,"Local State"), JSON.stringify({profile:{info_cache:{Default:{name:"Other"}, "Profile 4":{name:"工作"}}}}));
  const resolve = (id=identity) => resolveProfileDisplayName(id,proof,{platform:"darwin", support});
  assert.equal(await resolve(), "工作");
  assert.equal(await resolve({...identity,browserContext:"incognito"}), "");
  await file("Default");
  assert.equal(await resolve(), "");
});
