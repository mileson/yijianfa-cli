// Associate a live regular extension connection with its own browser profile.
// Use the connection nonce first, then the regular installation record;
// never use directory order, account names, or persisted CLI routing aliases.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { browserSocketNamespace } from "./browser-owner.js";

const egoNamespace = browserSocketNamespace("/Applications/ego lite.app/Contents/MacOS/ego lite");

export async function resolveProfileDisplayName(identity, proof, {
  platform = process.platform, support = path.join(os.homedir(), "Library/Application Support"),
} = {}) {
  const browser = identity?.browserNamespace === "" ? "Google/Chrome"
    : identity?.browserNamespace === egoNamespace ? "Citro Labs/ego lite" : null;
  const nonce = typeof proof === "string" && /^yijf-profile:[a-f0-9-]{36}$/.test(proof) ? proof : null;
  // LevelDB WriteBatch stores a length-prefixed key and JSON string value.
  const id = identity?.installationId;
  const installationRecord = typeof id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
    ? Buffer.concat([Buffer.from([26]), Buffer.from("cliBridgeIdentityRegularV1"), Buffer.from([38]), Buffer.from(JSON.stringify(id))])
    : null;
  if (platform !== "darwin" || !browser || identity.browserContext !== "regular" ||
      !/^[a-p]{32}$/.test(identity.extensionId) || (!nonce && !installationRecord)) return "";
  try {
    const root = path.join(support, browser);
    const state = JSON.parse(await fs.readFile(path.join(root, "Local State"), "utf8"));
    const nonceMatches = new Map();
    const installationMatches = new Map();
    for (const [dir, info] of Object.entries(state.profile.info_cache)) {
      if (!/^(Default|Profile \d+)$/.test(dir)) continue;
      const db = path.join(root, dir, "Local Extension Settings", identity.extensionId);
      let logs;
      try { logs = await fs.readdir(db); }
      catch (err) { if (err.code === "ENOENT") continue; throw err; }
      for (const name of logs.filter(n => /^\d+\.log$/.test(n)).sort().reverse().slice(0, 2)) {
        const handle = await fs.open(path.join(db, name), "r");
        try {
          const {size} = await handle.stat();
          const buf = Buffer.alloc(Math.min(size, 128 * 1024));
          const {bytesRead} = await handle.read(buf, 0, buf.length, size - buf.length);
          const tail = buf.subarray(0, bytesRead);
          const displayName = typeof info.name === "string" ? info.name.trim().slice(0, 80) : "";
          if (nonce && tail.includes(nonce)) nonceMatches.set(dir, displayName);
          if (installationRecord && tail.includes(installationRecord)) installationMatches.set(dir, displayName);
        } finally { await handle.close(); }
      }
    }
    const matches = nonceMatches.size ? nonceMatches : installationMatches;
    return matches.size === 1 ? matches.values().next().value : "";
  } catch { return ""; }
}
