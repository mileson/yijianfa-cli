import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import {
  NativeMessageParser,
  NdjsonParser,
  encodeNativeMessage,
  encodeNdjson,
  requestBridge,
  startNativeHost,
  defaultRuntimeDirectory,
  defaultWindowsPipeName,
  getSocketPath,
  getSocketCandidates,
  extensionIdFromOrigin,
  OFFICIAL_EXTENSION_ID,
} from "../src/index.js";

async function temporarySocket(t, name = "bridge.sock") {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yijianfa-bridge-test-"));
  await fs.promises.chmod(directory, 0o700);
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return path.join(directory, name);
}

test("bridge client uses the v1 NDJSON envelope and accepts fragmented response", async (t) => {
  const socketPath = await temporarySocket(t);
  const server = net.createServer((socket) => {
    const parser = new NdjsonParser();
    socket.on("data", (chunk) => {
      for (const request of parser.push(chunk)) {
        assert.equal(request.protocolVersion, 1);
        assert.equal(request.kind, "request");
        assert.equal(request.browserContext, "regular");
        assert.equal(request.action, "status");
        assert.deepEqual(request.payload, { requestId: "11111111-2222-4333-8444-555555555555" });
        const response = encodeNdjson({
          protocolVersion: 1,
          kind: "response",
          id: request.id,
          ok: true,
          result: { status: "completed", value: "中文 ✅" },
        });
        socket.write(response.subarray(0, 3));
        socket.write(response.subarray(3));
      }
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await requestBridge(
    "status",
    { requestId: "11111111-2222-4333-8444-555555555555" },
    { socketPath, timeoutMs: 2_000 },
  );
  assert.deepEqual(result, { status: "completed", value: "中文 ✅" });
});

test("default socket path is deterministic and rooted in /tmp for the current uid", () => {
  assert.equal(defaultRuntimeDirectory({ uid: 42 }), "/tmp/yijianfa-42");
  assert.equal(
    getSocketPath({ env: {}, uid: 42 }),
    "/tmp/yijianfa-42/bridge-v1.sock",
  );
});

test("official store extension uses a dedicated preferred socket", () => {
  assert.equal(
    extensionIdFromOrigin(`chrome-extension://${OFFICIAL_EXTENSION_ID}/`),
    OFFICIAL_EXTENSION_ID,
  );
  assert.equal(extensionIdFromOrigin("chrome-extension://invalid/"), null);
  assert.equal(
    getSocketPath({ env: {}, uid: 42, extensionId: OFFICIAL_EXTENSION_ID }),
    "/tmp/yijianfa-42/bridge-v1-store.sock",
  );
  assert.deepEqual(getSocketCandidates({ env: {}, uid: 42 }), [
    "/tmp/yijianfa-42/bridge-v1-store.sock",
    "/tmp/yijianfa-42/bridge-v1.sock",
  ]);
  assert.deepEqual(getSocketCandidates({ env: {}, uid: 42, browserContext: "incognito" }), [
    "/tmp/yijianfa-42/bridge-v1-store-incognito.sock",
    "/tmp/yijianfa-42/bridge-v1-incognito.sock",
  ]);
});

test("native host registration isolates incognito and rejects a regular envelope", async (t) => {
  const socketPath = await temporarySocket(t, "incognito-native.sock");
  const nativeInput = new PassThrough();
  const nativeOutput = new PassThrough();
  const hostPromise = startNativeHost({
    stdin: nativeInput,
    stdout: nativeOutput,
    stderr: new PassThrough(),
    socketPath,
    browserContext: null,
    registrationTimeoutMs: 2_000,
  });
  nativeInput.write(encodeNativeMessage({
    protocolVersion: 1,
    kind: "bridge_registration",
    browserContext: "incognito",
  }));
  const host = await hostPromise;
  t.after(() => host.close());
  assert.equal(host.browserContext, "incognito");

  const parser = new NativeMessageParser();
  nativeOutput.on("data", (chunk) => {
    for (const request of parser.push(chunk)) {
      nativeInput.write(encodeNativeMessage({
        protocolVersion: 1,
        kind: "response",
        id: request.id,
        ok: true,
        result: { browserContext: "incognito" },
      }));
    }
  });
  const result = await requestBridge("doctor", {}, {
    socketPath,
    browserContext: "incognito",
    timeoutMs: 2_000,
  });
  assert.equal(result.browserContext, "incognito");
  await assert.rejects(
    requestBridge("doctor", {}, { socketPath, browserContext: "regular", timeoutMs: 2_000 }),
    (error) => error.code === "INVALID_REQUEST",
  );
});

test("native host keeps the legacy regular socket behavior when no registration arrives", async (t) => {
  const socketPath = await temporarySocket(t, "legacy-regular.sock");
  const host = await startNativeHost({
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    socketPath,
    browserContext: null,
    registrationTimeoutMs: 5,
  });
  t.after(() => host.close());
  assert.equal(host.browserContext, "regular");
  assert.equal(host.socketPath, socketPath);
});

test("Windows bridge uses a deterministic per-user named pipe", () => {
  assert.equal(defaultRuntimeDirectory({ uid: 42, platform: "win32" }), null);
  assert.equal(
    defaultWindowsPipeName({ env: { USERNAME: "Test User" } }),
    "\\\\.\\pipe\\yijianfa-test-user-bridge-v1",
  );
  assert.equal(
    getSocketPath({ env: { USERNAME: "Test User" }, platform: "win32" }),
    "\\\\.\\pipe\\yijianfa-test-user-bridge-v1",
  );
  assert.throws(
    () => getSocketPath({ env: { YIJIANFA_SOCKET_PATH: "relative-pipe" }, platform: "win32" }),
    /must be absolute/,
  );
});

test("native host proxies multiple pending CLI requests and keeps socket private", async (t) => {
  const socketPath = await temporarySocket(t, "native.sock");
  const nativeInput = new PassThrough();
  const nativeOutput = new PassThrough();
  const logs = new PassThrough();
  const host = await startNativeHost({
    stdin: nativeInput,
    stdout: nativeOutput,
    stderr: logs,
    socketPath,
  });
  t.after(() => host.close());
  assert.equal((await fs.promises.stat(path.dirname(socketPath))).mode & 0o777, 0o700);
  assert.equal((await fs.promises.stat(socketPath)).mode & 0o777, 0o600);

  const parser = new NativeMessageParser();
  const outgoing = [];
  nativeOutput.on("data", (chunk) => {
    outgoing.push(...parser.push(chunk));
    if (outgoing.length === 2) {
      for (const request of [...outgoing].reverse()) {
        nativeInput.write(
          encodeNativeMessage({
            protocolVersion: 1,
            kind: "response",
            id: request.id,
            ok: true,
            result: { echo: request.payload.sequence },
          }),
        );
      }
    }
  });

  const [first, second] = await Promise.all([
    requestBridge("doctor", { sequence: 1 }, { socketPath, timeoutMs: 2_000 }),
    requestBridge("capabilities", { sequence: 2 }, { socketPath, timeoutMs: 2_000 }),
  ]);
  assert.deepEqual([first.echo, second.echo], [1, 2]);
  assert.equal(host.pending.size, 0);
  assert.equal(logs.read()?.toString("utf8") || "", "");
  await host.close();
  await assert.rejects(fs.promises.access(socketPath));
});

test("bridge client prefers the store socket without sending to the local fallback", async (t) => {
  const storeSocket = await temporarySocket(t, "store.sock");
  const localSocket = await temporarySocket(t, "local.sock");
  let localRequests = 0;
  const createServer = (socketPath, source) => {
    const server = net.createServer((socket) => {
      const parser = new NdjsonParser();
      socket.on("data", (chunk) => {
        for (const request of parser.push(chunk)) {
          if (source === "local") localRequests += 1;
          socket.write(encodeNdjson({
            protocolVersion: 1,
            kind: "response",
            id: request.id,
            ok: true,
            result: { source },
          }));
        }
      });
    });
    server.listen(socketPath);
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return once(server, "listening");
  };
  await Promise.all([
    createServer(storeSocket, "store"),
    createServer(localSocket, "local"),
  ]);
  const result = await requestBridge("doctor", {}, {
    socketPaths: [storeSocket, localSocket],
    timeoutMs: 2_000,
  });
  assert.equal(result.source, "store");
  assert.equal(localRequests, 0);
});
