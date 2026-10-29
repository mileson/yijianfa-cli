import test from "node:test";
import assert from "node:assert/strict";
import { browserSocketNamespace, nativeHostBrowserNamespace } from "../src/browser-owner.js";
import { getSocketPath, getSocketCandidates } from "../src/socket-path.js";

test("Chrome retains the CLI bridge while ego lite cannot capture it", () => {
  const chrome = browserSocketNamespace("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n");
  const ego = browserSocketNamespace("/Applications/ego lite.app/Contents/MacOS/ego lite\n");
  assert.equal(chrome, "");
  const options = { env: {}, uid: 42, platform: "darwin" };
  const chromePath = getSocketPath({ ...options, browserNamespace: chrome });
  const egoPath = getSocketPath({ ...options, browserNamespace: ego });
  assert.notEqual(chromePath, egoPath);
  assert.ok(getSocketCandidates(options).includes(chromePath));
  assert.ok(!getSocketCandidates(options).includes(egoPath));
  assert.notEqual(egoPath, getSocketPath({ ...options, browserNamespace: ego, browserContext: "incognito" }));
});

test("macOS owner detection fails closed instead of sharing Chrome's bridge", () => {
  assert.throws(() => nativeHostBrowserNamespace({ platform: "darwin", readExecutable: () => "" }));
  assert.throws(() => nativeHostBrowserNamespace({ platform: "darwin", readExecutable: () => { throw new Error("ps failed"); } }));
  assert.equal(nativeHostBrowserNamespace({ platform: "linux", readExecutable: () => { throw new Error("unused"); } }), "");
  assert.throws(() => getSocketPath({ env: {}, browserNamespace: "../../escape" }));
});
