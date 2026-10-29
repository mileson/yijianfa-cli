import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startNativeHost, NativeMessageParser, encodeNativeMessage, requestBridge,
  discoverBridges, resolveBridgeSelection, waitForBridgeSelection, createPayloadDigest, rememberRequestRoute, readRequestRoute } from "../src/index.js";

const extensionId = "dmcejnbkknlkpcbaggoeiminccbpliaj";
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const cliPath = process.env.YIJIANFA_TEST_CLI || fileURLToPath(new URL("../bin/yijianfa.js", import.meta.url));

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yj-profile-"));
  await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function profile(t, directory, { installationId = firstId, profileName = "creator_photo", browserContext = "regular", id = extensionId, holdExecute = false } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const parser = new NativeMessageParser();
  const requests = [];
  let identity;
  stdout.on("data", (chunk) => {
    for (const frame of parser.push(chunk)) {
      if (frame.kind === "bridge_ready") { identity = frame.bridgeTarget; continue; }
      requests.push(frame);
      if (holdExecute && frame.action === "execute") continue;
      const result = frame.action === "doctor" ? { runtime: { id, browserContext }, protocolVersion: 1 }
        : frame.action === "capabilities" ? { profileName }
          : { requestId: frame.payload.task?.requestId || frame.payload.requestId, bridgeId: identity.bridgeId, status: "filled" };
      stdin.write(encodeNativeMessage({ protocolVersion: 1, kind: "response", id: frame.id, ok: true, result }));
      if (holdExecute && frame.action === "cancel") {
        const original = requests.find((item) => item.action === "execute");
        stdin.write(encodeNativeMessage({ protocolVersion: 1, kind: "response", id: original.id, ok: true,
          result: { requestId: original.payload.task.requestId, bridgeId: identity.bridgeId, status: "cancelled" } }));
      }
    }
  });
  const starting = startNativeHost({ stdin, stdout, stderr: new PassThrough(), browserContext: null,
    callerOrigin: `chrome-extension://${id}/`, registryPath: directory, browserNamespace: "browser-example" });
  stdin.write(encodeNativeMessage({ protocolVersion: 1, kind: "bridge_registration", browserContext, installationId, profileName }));
  const host = await starting;
  t.after(() => host.close());
  return { host, requests, identity };
}

function cli(directory, args, input, onChild = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, YIJIANFA_RUNTIME_DIR: directory, YIJIANFA_SOCKET_PATH: "" }, stdio: ["pipe", "pipe", "pipe"] });
    onChild(child);
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ? JSON.stringify(input) : "");
  });
}

test("two ego profiles coexist, all bridge actions stay bound, and ambiguous selection fails closed", async (t) => {
  const directory = await fixture(t);
  const cheese = await profile(t, directory);
  const gif = await profile(t, directory, { installationId: secondId, profileName: "creator_video" });
  assert.notEqual(cheese.host.socketPath, gif.host.socketPath);
  const online = await discoverBridges({ directory, env: {} });
  assert.equal(online.length, 2);
  await assert.rejects(resolveBridgeSelection({ directory, env: {} }), { code: "BRIDGE_AMBIGUOUS" });
  const route = await resolveBridgeSelection({ profile: "creator_photo", directory, env: {} });
  for (const action of ["doctor", "capabilities", "execute", "status", "cancel"]) {
    await requestBridge(action, { task: { requestId: "profile-job-1" }, requestId: "profile-job-1" }, route);
  }
  assert.deepEqual(cheese.requests.map((item) => item.action), ["doctor", "capabilities", "execute", "status", "cancel"]);
  assert.equal(gif.requests.length, 0);
  await assert.rejects(requestBridge("execute", {}, { ...route, socketPath: gif.host.socketPath }), { code: "BRIDGE_IDENTITY_MISMATCH" });
  await assert.rejects(requestBridge("execute", {}, { socketPath: cheese.host.socketPath }), { code: "BRIDGE_IDENTITY_REQUIRED" });
  assert.equal(gif.requests.length, 0);
});

test("source CLI fill binds once, remembers status route, and never contacts another profile", async (t) => {
  const directory = await fixture(t);
  const cheese = await profile(t, directory);
  const gif = await profile(t, directory, { installationId: secondId });
  const input = { requestId: "profile-cli-job-1", type: "imageText", platforms: ["xiaohongshu"], data: { content: "offline fixture" } };
  const filled = await cli(directory, ["fill", "--bridge-id", cheese.identity.bridgeId], input);
  assert.equal(filled.code, 0, filled.stderr);
  const task = cheese.requests.find((frame) => frame.action === "execute").payload.task;
  assert.equal(task.bridgeId, cheese.identity.bridgeId);
  assert.match(task.payloadDigest, /^[a-f0-9]{64}$/);
  const status = await cli(directory, ["status", input.requestId]);
  assert.equal(status.code, 0, status.stderr);
  const wrong = await cli(directory, ["cancel", input.requestId, "--bridge-id", gif.identity.bridgeId]);
  assert.equal(wrong.code, 2);
  assert.equal(gif.requests.length, 0);
});

test("reconnect keeps stable identity; stale epoch is rejected; duplicate copied identities are ambiguous", async (t) => {
  const directory = await fixture(t);
  const first = await profile(t, directory);
  const oldRoute = await resolveBridgeSelection({ bridgeId: first.identity.bridgeId, directory, env: {} });
  await first.host.close();
  const next = await profile(t, directory);
  assert.equal(next.identity.bridgeId, first.identity.bridgeId);
  assert.notEqual(next.identity.instanceId, first.identity.instanceId);
  await assert.rejects(requestBridge("cancel", { requestId: "profile-job-1" }, { ...oldRoute, socketPath: next.host.socketPath }), { code: "BRIDGE_IDENTITY_MISMATCH" });
  const duplicate = await profile(t, directory);
  await assert.rejects(resolveBridgeSelection({ bridgeId: next.identity.bridgeId, directory, env: {} }), { code: "BRIDGE_AMBIGUOUS" });
  await next.host.close();
  assert.equal((await discoverBridges({ directory, env: {} }))[0].instanceId, duplicate.identity.instanceId);
});

test("channel, extension id and incognito are separate targets; route digest and request ownership are stable", async (t) => {
  const directory = await fixture(t);
  const store = await profile(t, directory);
  const local = await profile(t, directory, { id: "abcdefghijklmnopabcdefghijklmnop" });
  const incognito = await profile(t, directory, { browserContext: "incognito" });
  assert.equal(new Set([store, local, incognito].map((entry) => entry.identity.bridgeId)).size, 3);
  const input = { bridgeId: store.identity.bridgeId, browserContext: "regular", type: "imageText", mode: "fill", platforms: ["xiaohongshu"], data: {}, assets: [] };
  assert.notEqual(createPayloadDigest(input), createPayloadDigest({ ...input, browserContext: "incognito" }));
  assert.notEqual(createPayloadDigest(input), createPayloadDigest({ ...input, bridgeId: local.identity.bridgeId }));
  await rememberRequestRoute("profile-route-job", store.identity, { directory });
  assert.equal((await readRequestRoute("profile-route-job", { directory })).bridgeId, store.identity.bridgeId);
  await assert.rejects(rememberRequestRoute("profile-route-job", local.identity, { directory }), /different bridge/);
});

test("SIGINT cancellation uses the original bound profile and retains the execute until terminal response", async (t) => {
  const directory = await fixture(t);
  const cheese = await profile(t, directory, { holdExecute: true });
  const other = await profile(t, directory, { installationId: secondId });
  let child;
  const outcome = cli(directory, ["fill", "--bridge-id", cheese.identity.bridgeId],
    { requestId: "profile-signal-job", type: "imageText", platforms: ["xiaohongshu"], data: {} }, (value) => { child = value; });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  const deadline = Date.now() + 2000;
  while (!cheese.requests.some((item) => item.action === "execute") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(cheese.requests.some((item) => item.action === "execute"));
  child.kill("SIGINT");
  const finished = await outcome;
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(JSON.parse(finished.stdout).result.status, "cancelled");
  assert.equal(other.requests.length, 0);
  assert.equal(cheese.requests.find((item) => item.action === "cancel").bridgeTarget.instanceId, cheese.identity.instanceId);
});

test("waiting for a chosen bridge tolerates wakeup and never falls back to another profile", async (t) => {
  const directory = await fixture(t);
  const other = await profile(t, directory, { installationId: secondId, profileName: "other" });
  const waiting = waitForBridgeSelection({ profile: "creator_photo", directory, env: {} }, { waitMs: 1000, retryMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const cheese = await profile(t, directory);
  const route = await waiting;
  assert.equal(route.bridgeTarget.bridgeId, cheese.identity.bridgeId);
  assert.equal(other.requests.length, 0);
});
