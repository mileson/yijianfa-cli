import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { once } from "node:events";
import { createBridgeIdentity, instanceSocketPath, registerBridge } from '../src/bridge-registry.js';
import {
  NdjsonParser,
  encodeNdjson,
  installNativeHost,
  parseArgv,
} from "../src/index.js";

const cliPath = fileURLToPath(new URL("../bin/yijianfa.js", import.meta.url));
const cliDirectory = fileURLToPath(new URL("..", import.meta.url));

test('transfer 支持来源、目标、链接和明确的操作', () => {
  const args=parseArgv(['transfer','--from','x','--to','feishu','--url','https://x.com/a/status/123','--mode','发布','--yes']);
  assert.equal(args.command,'transfer'); assert.equal(args.options.from,'x'); assert.equal(args.options.mode,'发布'); assert.equal(args.options.yes,true);
});

test('transfer 未明确授权发布或目标不符时在连接之前拒绝', async () => {
  const args=['transfer','--from','x','--to','feishu','--url','https://x.com/a/status/123','--mode','publish'];
  const denied=await run(args); assert.equal(denied.code,10); assert.equal(JSON.parse(denied.stderr).error.code,'CONFIRMATION_REQUIRED');
  const invalid=await run(['transfer','--from','feishu','--to','x','--url','https://team.feishu.cn/docx/ABC','--mode','创建文档','--yes']);
  assert.equal(invalid.code,2); assert.match(JSON.parse(invalid.stderr).error.message,/仅适用于飞书/);
});

test('transfer 命令在指定连接上发现路线并发送一次任务', async t => {
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'yijianfa-transfer-cli-')); await fs.promises.chmod(root,0o700);
  t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));
  const identity=createBridgeIdentity({installationId:'11111111-1111-4111-8111-111111111111',instanceId:'22222222-2222-4222-8222-222222222222',extensionId:'abcdefghijklmnopabcdefghijklmnop',browserContext:'regular'});
  const socketPath=instanceSocketPath(identity,{directory:root}); let transferCalls=0;
  const server=net.createServer(socket=>{ const parser=new NdjsonParser(); socket.on('data',chunk=>{for(const req of parser.push(chunk)) {
    let result;
    if(req.action==='describe') result={...identity,socketPath,routingVersion:2};
    else if(req.action==='capabilities') result={transfer:{routes:[{from:'x',to:'feishu',modes:['publish']}]}};
    else if(req.action==='transfer') { transferCalls++; assert.equal(req.payload.requestId,'transfer-cli-001'); assert.equal(req.payload.mode,'publish'); assert.equal(req.payload.confirmed,true); result={requestId:req.payload.requestId,status:'completed'}; }
    else result={};
    socket.write(encodeNdjson({protocolVersion:1,kind:'response',id:req.id,ok:true,result,bridgeTarget:identity}));
  }});});
  server.listen(socketPath); await once(server,'listening'); await fs.promises.chmod(socketPath,0o600);
  const unregister=await registerBridge(identity,socketPath,{directory:root}); t.after(async()=>{await unregister();await new Promise(resolve=>server.close(resolve));});
  const result=await run(['transfer','--bridge-id',identity.bridgeId,'--from','x','--to','feishu','--url','https://x.com/a/status/123','--mode','发布','--yes','--request-id','transfer-cli-001'],{env:{YIJIANFA_RUNTIME_DIR:root}});
  assert.equal(result.code,0,result.stderr); assert.equal(JSON.parse(result.stdout).result.status,'completed'); assert.equal(transferCalls,1);
});

test("personal declaration flag accepts strict booleans only on task commands", () => {
  for (const command of ["prepare", "fill", "publish"]) {
    assert.equal(parseArgv([command, "--personal-declaration", "true"]).options.personalDeclaration, true);
    assert.equal(parseArgv([command, "--personal-declaration=false"]).options.personalDeclaration, false);
  }
  for (const args of [["fill", "--personal-declaration"], ["fill", "--personal-declaration", "1"], ["fill", "--personal-declaration", "False"], ["status", "--personal-declaration", "true"]]) {
    assert.throws(() => parseArgv(args));
  }
});

test("one-off CLI declarations survive preparation, flags override JSON and omission stays absent", async () => {
  const base = { requestId: "declaration-0001", type: "dynamic", comboName: "图文组合", data: { content: "正文" } };
  const defaults = await run(["fill", "--dry-run"], { input: JSON.stringify(base) });
  assert.equal(defaults.code, 0);
  const inherited = JSON.parse(defaults.stdout).result;
  assert.equal(Object.hasOwn(inherited.data, "personalDeclaration"), false);
  for (const command of ["prepare", "fill", "publish"]) {
    for (const selected of [true, false]) {
      const args = [command, "--personal-declaration", String(selected)];
      if (command !== "prepare") args.push("--dry-run");
      if (command === "publish") args.push("--yes");
      const result = await run(args, { input: JSON.stringify({ ...base, data: { ...base.data, personalDeclaration: !selected } }) });
      assert.equal(result.code, 0, result.stderr);
      const prepared = JSON.parse(result.stdout).result;
      assert.equal(prepared.data.personalDeclaration, selected);
      assert.notEqual(prepared.payloadDigest, inherited.payloadDigest);
    }
  }
  const result = await run(["fill", "--dry-run"], { input: JSON.stringify({ ...base, data: { personalDeclaration: false } }) });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).result.data.personalDeclaration, false);
});

function run(args, { input = "", env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: cliDirectory,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("help and version write one JSON value to stdout only", async () => {
  for (const args of [["help"], ["--version"]]) {
    const result = await run(args);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim().split("\n").length, 1);
    assert.equal(JSON.parse(result.stdout).ok, true);
  }
});

test("invalid command and missing publish confirmation use stderr and stable exit codes", async () => {
  const invalid = await run(["not-a-command"]);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.stdout, "");
  assert.equal(JSON.parse(invalid.stderr).error.code, "INVALID_ARGUMENT");

  const confirmation = await run(["publish", "--dry-run"]);
  assert.equal(confirmation.code, 10);
  assert.equal(confirmation.stdout, "");
  assert.equal(JSON.parse(confirmation.stderr).error.code, "CONFIRMATION_REQUIRED");
});

test("publish dry-run rejects a missing account guard fail-closed", async () => {
  const result = await run(["publish", "--yes", "--dry-run"], {
    input: JSON.stringify({
      type: "dynamic",
      platforms: ["jike"],
      data: { content: "must not publish" },
    }),
  });
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).error.code, "PUBLISH_GUARD_REQUIRED");
});

test("fill dry-run reads stdin and never needs the bridge", async () => {
  const input = JSON.stringify({
    requestId: "11111111-2222-4333-8444-555555555555",
    type: "dynamic",
    platforms: ["jike"],
    data: { content: "命令行中文" },
  });
  const result = await run(["fill", "--dry-run"], { input });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const body = JSON.parse(result.stdout);
  assert.equal(body.result.status, "prepared_local");
  assert.equal(body.result.mode, "fill");
  assert.equal(body.result.browserContext, "regular");
  assert.match(body.result.payloadDigest, /^[a-f0-9]{64}$/);
});

test("combo-only dry-run omits platforms and keeps the saved combo selector", async () => {
  const input = JSON.stringify({
    requestId: "combo-only-0001",
    comboName: "AI赛道图文",
    type: "imageText",
    data: { title: "组合标题", content: "组合正文" },
  });
  const result = await run(["fill", "--dry-run"], { input });
  assert.equal(result.code, 0);
  const prepared = JSON.parse(result.stdout).result;
  assert.equal(prepared.comboName, "AI赛道图文");
  assert.deepEqual(prepared.platforms, []);
  assert.match(prepared.payloadDigest, /^[a-f0-9]{64}$/);

  const publish = await run(["publish", "--yes", "--dry-run"], { input });
  assert.equal(publish.code, 0, "组合发布由扩展读取组合目标后生成发布验真配置");
  assert.equal(JSON.parse(publish.stdout).result.mode, "publish");
});

test("fill dry-run applies an explicit browser context and rejects input/flag conflicts", async () => {
  const base = {
    type: "dynamic",
    platforms: ["jike"],
    data: { content: "context test" },
  };
  const selected = await run(["fill", "--dry-run", "--browser-context", "incognito"], {
    input: JSON.stringify(base),
  });
  assert.equal(selected.code, 0);
  assert.equal(JSON.parse(selected.stdout).result.browserContext, "incognito");

  const conflict = await run(["fill", "--dry-run", "--browser-context", "regular"], {
    input: JSON.stringify({ ...base, browserContext: "incognito" }),
  });
  assert.equal(conflict.code, 2);
  assert.match(JSON.parse(conflict.stderr).error.message, /不一致/);
});

test("input errors produce no stdout", async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yijianfa-command-test-"));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "bad.json");
  await fs.promises.writeFile(inputPath, "{not json", "utf8");
  const result = await run(["prepare", "--input", inputPath]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).ok, false);
});

test("prepare rejects invalid Shipinhao titles and preserves a valid title verbatim", async () => {
  for (const invalidTitle of [
    "报价越低，企业越不敢用你",
    "报价越低,企业越不敢用你",
    "报价越低😀企业越不敢用你",
  ]) {
    const result = await run(["prepare"], {
      input: JSON.stringify({
        type: "shortVideo",
        platforms: ["shipinhao"],
        data: { title: invalidTitle },
      }),
    });
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error.message, /只允许文字、字母、数字和普通空格/);
  }
  const validTitle = "报价越低企业ABC 123";
  const valid = await run(["prepare"], {
    input: JSON.stringify({
      type: "shortVideo",
      platforms: ["shipinhao"],
      data: { title: validTitle },
    }),
  });
  assert.equal(valid.code, 0);
  assert.equal(JSON.parse(valid.stdout).result.data.title, validTitle);
});

test("fill rejects --timeout so its asset server cannot expire before terminal state", async () => {
  const result = await run(["fill", "--timeout", "10"], {
    input: JSON.stringify({ type: "dynamic", platforms: ["jike"], data: { content: "hello" } }),
  });
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(JSON.parse(result.stderr).error.message, /不支持 --timeout/);
});

test("doctor accepts the settings-page form --wait 30 as seconds", () => {
  const parsed = parseArgv(["doctor", "--wait", "30"]);
  assert.equal(parsed.options.wait, 30_000);
  assert.deepEqual(parsed.positionals, []);
});

test("browser context flag is explicit and validated for bridge commands", () => {
  assert.equal(parseArgv(["capabilities", "--browser-context", "incognito"]).options.browserContext, "incognito");
  assert.equal(parseArgv(["status", "job-0001"]).options.browserContext, undefined);
  assert.throws(
    () => parseArgv(["doctor", "--browser-context", "profile-2"]),
    /regular 或 incognito/,
  );
});

test("doctor only reports healthy when live bridge, exact origin, manifest, and wrapper pass", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yijianfa-doctor-test-"));
  const home = path.join(root, "home");
  const socketPath = path.join(root, "doctor.sock");
  await fs.promises.mkdir(home, { mode: 0o700 });
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  await installNativeHost({ extensionId, platform: "darwin", home });

  const server = net.createServer((socket) => {
    const parser = new NdjsonParser();
    socket.on("data", (chunk) => {
      for (const request of parser.push(chunk)) {
        socket.write(encodeNdjson({
          protocolVersion: 1,
          kind: "response",
          id: request.id,
          ok: true,
          result: {
            protocolVersion: 1,
            runtime: { id: extensionId, manifestVersion: "0.1.2", browserContext: "regular" },
            bridge: { state: "connected" },
            options: { state: "ready" },
          },
        }));
      }
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  const result = await run(["doctor"], {
    env: { HOME: home, YIJIANFA_SOCKET_PATH: socketPath },
  });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const doctor = JSON.parse(result.stdout).result;
  assert.equal(doctor.healthy, true);
  assert.equal(doctor.checks.allowedOrigin.ok, true);
  assert.equal(doctor.checks.wrapper.ok, true);
});

test("SIGINT requests cancel and keeps the asset server alive until execute is terminal", { timeout: 5_000 }, async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yijianfa-signal-test-"));
  const socketPath = path.join(root, "signal.sock");
  const assetPath = path.join(root, "signal.txt");
  await fs.promises.writeFile(assetPath, "asset-stays-readable", "utf8");
  let child;
  let executeRequest;
  let executeSocket;
  let blobUrl;
  let handlerError;

  const server = net.createServer((socket) => {
    const parser = new NdjsonParser();
    socket.on("data", (chunk) => {
      for (const request of parser.push(chunk)) {
        if (request.action === "doctor") {
          socket.write(encodeNdjson({
            protocolVersion: 1,
            kind: "response",
            id: request.id,
            ok: true,
            result: { protocolVersion: 1, bridge: { state: "connected" } },
          }));
          continue;
        }
        if (request.action === "execute") {
          executeRequest = request;
          executeSocket = socket;
          const task = request.payload.task;
          assert.equal(request.protocolVersion, 1);
          assert.equal(request.kind, "request");
          assert.equal(task.requestId, "signal-job-0001");
          assert.equal(task.mode, "fill");
          assert.equal(task.confirmed, false);
          assert.match(task.payloadDigest, /^[a-f0-9]{64}$/);
          assert.deepEqual(Object.keys(task.assets[0]), [
            "role", "name", "type", "size", "sha256", "blobUrl",
          ]);
          assert.equal("path" in task.assets[0], false);
          blobUrl = task.assets[0].blobUrl;
          setImmediate(() => child.kill("SIGINT"));
          continue;
        }
        if (request.action === "cancel") {
          void (async () => {
            try {
              assert.equal(request.payload.requestId, "signal-job-0001");
              assert.equal(await (await fetch(blobUrl)).text(), "asset-stays-readable");
              socket.write(encodeNdjson({
                protocolVersion: 1,
                kind: "response",
                id: request.id,
                ok: true,
                result: { requestId: request.payload.requestId, status: "cancel_requested" },
              }));
              executeSocket.write(encodeNdjson({
                protocolVersion: 1,
                kind: "response",
                id: executeRequest.id,
                ok: true,
                result: {
                  requestId: request.payload.requestId,
                  status: "cancelled",
                  result: { status: "cancelled" },
                },
              }));
            } catch (error) {
              handlerError = error;
              child.kill("SIGKILL");
            }
          })();
        }
      }
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  const outcome = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [cliPath, "fill"], {
      cwd: cliDirectory,
      env: { ...process.env, YIJIANFA_SOCKET_PATH: socketPath },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(JSON.stringify({
      requestId: "signal-job-0001",
      type: "dynamic",
      platforms: ["jike"],
      data: { content: "signal test" },
      assets: [{ path: assetPath }],
    }));
  });
  if (handlerError) throw handlerError;
  assert.equal(outcome.code, 0);
  assert.equal(outcome.signal, null);
  assert.equal(outcome.stderr, "");
  assert.equal(JSON.parse(outcome.stdout).result.status, "cancelled");
  await assert.rejects(fetch(blobUrl));
});

test("download flag accepts strict booleans only for task commands", () => {
  for (const command of ['prepare', 'fill', 'publish']) {
    assert.equal(parseArgv([command, '--allow-download', 'true']).options.allowDownload, true);
    assert.equal(parseArgv([command, '--allow-download=false']).options.allowDownload, false);
  }
  for (const args of [['fill','--allow-download'], ['fill','--allow-download','0'], ['fill','--allow-download','False'], ['status','--allow-download','true']]) assert.throws(() => parseArgv(args));
});

test("download flag overrides JSON for prepare/fill/publish and omission remains inherited", async () => {
  const base = { requestId: 'download-0001', type: 'shortVideo', comboName: '常用视频平台', platforms: ['douyin'], data: { title: 'test' } };
  const inheritedRun = await run(['prepare'], { input: JSON.stringify(base) });
  assert.equal(inheritedRun.code, 0, inheritedRun.stderr);
  const inherited = JSON.parse(inheritedRun.stdout).result;
  assert.equal(Object.hasOwn(inherited.data, 'allowDownload'), false);
  for (const command of ['prepare','fill','publish']) {
    for (const selected of [true,false]) {
      const args = [command, '--allow-download', String(selected)];
      if (command !== 'prepare') args.push('--dry-run');
      if (command === 'publish') args.push('--yes');
      const result = await run(args, { input: JSON.stringify({ ...base, data: { ...base.data, allowDownload: !selected, extra: { douyin: { allowDownload: !selected } } } }) });
      assert.equal(result.code, 0, result.stderr);
      const prepared = JSON.parse(result.stdout).result;
      assert.equal(prepared.data.allowDownload, selected);
      assert.equal(prepared.data.extra.douyin.allowDownload, !selected);
      assert.notEqual(prepared.payloadDigest, inherited.payloadDigest);
    }
  }
  const help = await run(['help']);
  assert.deepEqual(JSON.parse(help.stdout).result.downloadPermission.platforms, ['douyin','kuaishou']);
});

test('targets parses discovery flags and rejects invalid combinations offline', async () => {
  assert.equal(parseArgv(['targets','--platform','jike','--content','正文']).options.content,'正文');
  for (const args of [['targets'],['targets','--platform','x'],['targets','--platform','douban','--content','正文'],['targets','--platform','jike','--query','关键词','--content','正文']]) {
    assert.equal((await run(args)).code,2);
  }
});

test('targets uses the selected bridge, negotiates capability, and rejects older extensions', async t => {
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'yijianfa-targets-cli-')); await fs.promises.chmod(root,0o700);
  t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));
  const identity=createBridgeIdentity({installationId:'11111111-1111-4111-8111-111111111111',instanceId:'22222222-2222-4222-8222-222222222222',extensionId:'abcdefghijklmnopabcdefghijklmnop',browserContext:'regular'});
  const socketPath=instanceSocketPath(identity,{directory:root}); let supported=true; const calls=[];
  const server=net.createServer(socket=>{ const parser=new NdjsonParser(); socket.on('data',chunk=>{for(const req of parser.push(chunk)) {
    let result;
    if(req.action==='describe') result={...identity,socketPath,routingVersion:2};
    else if(req.action==='capabilities') result=supported?{targets:{version:1,platforms:{jike:{}}}}:{};
    else if(req.action==='targets') { calls.push(req); result={platform:'jike',items:[{name:'AI探索站'}]}; }
    else result={};
    socket.write(encodeNdjson({protocolVersion:1,kind:'response',id:req.id,ok:true,result,bridgeTarget:identity}));
  }});});
  server.listen(socketPath); await once(server,'listening'); await fs.promises.chmod(socketPath,0o600);
  const unregister=await registerBridge(identity,socketPath,{directory:root}); t.after(async()=>{await unregister();await new Promise(resolve=>server.close(resolve));});
  const args=['targets','--bridge-id',identity.bridgeId,'--browser-context','regular','--platform','jike','--content','正文'];
  const result=await run(args,{env:{YIJIANFA_RUNTIME_DIR:root}});
  assert.equal(result.code,0,result.stderr); assert.equal(calls.length,1); assert.equal(calls[0].bridgeTarget.bridgeId,identity.bridgeId);
  assert.deepEqual(calls[0].payload,{platform:'jike',content:'正文'});
  supported=false;
  const old=await run(args,{env:{YIJIANFA_RUNTIME_DIR:root}}); assert.equal(old.code,2);assert.match(old.stderr,/更新扩展/);assert.equal(calls.length,1);
  const fill=await run(['fill','--bridge-id',identity.bridgeId],{env:{YIJIANFA_RUNTIME_DIR:root},input:JSON.stringify({type:'dynamic',platforms:['douban'],data:{content:'正文',extra:{douban:{groupName:'厦门租房',accountId:'a'}}}})});
  assert.equal(fill.code,2);assert.match(fill.stderr,/不支持豆瓣小组/);
});
