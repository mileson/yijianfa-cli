import test from "node:test";
import assert from "node:assert/strict";
import {
  createPayloadDigest,
  exitCodeForRemoteCode,
  normalizeInput,
  throwForExecuteStatus,
} from "../src/index.js";

const uuid = "11111111-2222-4333-8444-555555555555";

test("declaration settings preserve explicit booleans and reject ambiguous values", () => {
  for (const selected of [true, false]) {
    const data = { personalDeclaration: selected, extra: { douyin: { personalDeclaration: !selected } } };
    assert.deepEqual(normalizeInput({ type: "dynamic", platforms: ["douyin"], data }).data, data);
  }
  for (const invalid of ["false", 0, null, {}]) {
    for (const data of [{ personalDeclaration: invalid }, { extra: { douyin: { personalDeclaration: invalid } } }]) {
      assert.throws(() => normalizeInput({ type: "dynamic", platforms: ["douyin"], data }), /personalDeclaration/);
    }
  }
});

test("schema normalizes defaults without changing platform or asset order", () => {
  const input = normalizeInput({
    requestId: uuid,
    type: "dynamic",
    platforms: ["x", "jike"],
    data: { content: "hello" },
    assets: [
      { path: "/tmp/one.png" },
      { path: "/tmp/two.mp4", role: "cover", sourceUrl: "https://example.com/two.mp4" },
    ],
  });
  assert.equal(input.requestId, uuid);
  assert.equal(input.browserContext, "regular");
  assert.deepEqual(input.platforms, ["x", "jike"]);
  assert.equal(input.assets[0].role, "media");
  assert.equal(input.assets[1].role, "cover");
});

test("schema keeps an optional CLI tab group name and validates its bounds", () => {
  const input = normalizeInput({
    type: "imageText",
    groupName: "  AI 图文矩阵  ",
    platforms: ["xiaohongshu", "douyin"],
  });
  assert.equal(input.groupName, "AI 图文矩阵");
  assert.throws(
    () => normalizeInput({ type: "imageText", groupName: "   ", platforms: ["xiaohongshu"] }),
    /groupName/,
  );
  assert.throws(
    () => normalizeInput({ type: "imageText", groupName: "组".repeat(81), platforms: ["xiaohongshu"] }),
    /1 到 80/,
  );
});

test("schema accepts combo-only publishing and keeps platforms optional", () => {
  const input = normalizeInput({
    type: "imageText",
    comboName: "AI赛道图文",
    data: { content: "按组合填入" },
  });
  assert.equal(input.comboName, "AI赛道图文");
  assert.deepEqual(input.platforms, []);
  assert.doesNotThrow(() => normalizeInput({
    type: "dynamic",
    comboName: "即刻组合",
    data: {
      publishGuard: {
        version: 1,
        expectedTargets: { jike: "AI探索站" },
        requirePublicUrl: true,
      },
    },
  }));
  assert.throws(
    () => normalizeInput({ type: "imageText", data: { content: "缺少选择器" } }),
    /platforms 与 comboName/,
  );
  assert.throws(
    () => normalizeInput({ type: "imageText", comboName: "组".repeat(81) }),
    /comboName/,
  );
});

test("browser context defaults to regular and rejects invalid or conflicting selections", () => {
  assert.equal(normalizeInput({ type: "dynamic", platforms: ["x"] }).browserContext, "regular");
  assert.equal(
    normalizeInput({ type: "dynamic", browserContext: "incognito", platforms: ["x"] }).browserContext,
    "incognito",
  );
  assert.throws(
    () => normalizeInput({ type: "dynamic", browserContext: "profile-2", platforms: ["x"] }),
    /regular 或 incognito/,
  );
  assert.throws(
    () => normalizeInput(
      { type: "dynamic", browserContext: "regular", platforms: ["x"] },
      { browserContext: "incognito" },
    ),
    /不一致/,
  );
});

test("schema rejects relative assets, duplicate platforms, and unknown fields", () => {
  assert.throws(
    () => normalizeInput({ type: "dynamic", platforms: ["x"], assets: [{ path: "relative.png" }] }),
    /绝对路径/,
  );
  assert.throws(
    () => normalizeInput({ type: "dynamic", platforms: ["x", "x"] }),
    /重复/,
  );
  assert.throws(
    () => normalizeInput({ type: "dynamic", platforms: ["x"], surprise: true }),
    /不支持的字段/,
  );
  assert.throws(
    () => normalizeInput({
      type: "dynamic",
      platforms: ["x"],
      assets: [{ path: "/tmp/file.png", role: "thumbnail" }],
    }),
    /role 不受支持/,
  );
  assert.throws(
    () => normalizeInput({
      type: "dynamic",
      platforms: ["x"],
      assets: [{ path: "/tmp/file.png", sourceUrl: "https://user:secret@example.com/file.png" }],
    }),
    /sourceUrl/,
  );
});

test("custom safe request IDs are accepted while UUID remains the default shape", () => {
  const input = normalizeInput({ requestId: "agent-job:2026-08-10_01", type: "dynamic", platforms: ["x"] });
  assert.equal(input.requestId, "agent-job:2026-08-10_01");
  assert.throws(
    () => normalizeInput({ requestId: "unsafe request", type: "dynamic", platforms: ["x"] }),
    /安全标识符/,
  );
  assert.throws(
    () => normalizeInput({ requestId: "short", type: "dynamic", platforms: ["x"] }),
    /8 到 128/,
  );
  assert.throws(
    () => normalizeInput({ requestId: "x".repeat(129), type: "dynamic", platforms: ["x"] }),
    /8 到 128/,
  );
});

test("Shipinhao short-video title rejects punctuation and emoji without rewriting input", () => {
  for (const invalidTitle of [
    "报价越低，企业越不敢用你",
    "报价越低,企业越不敢用你",
    "报价越低😀企业越不敢用你",
  ]) {
    assert.throws(
      () => normalizeInput({
        type: "shortVideo",
        platforms: ["shipinhao"],
        data: { title: invalidTitle },
      }),
      /只允许文字、字母、数字和普通空格/,
    );
  }
  const title = "报价越低企业ABC 123";
  const normalized = normalizeInput({
    type: "shortVideo",
    platforms: ["shipinhao"],
    data: { title },
  });
  assert.equal(normalized.data.title, title, "合法标题必须原样保留，不能静默改写");
  assert.throws(
    () => normalizeInput({
      type: "shortVideo",
      platforms: ["shipinhao"],
      data: { title: "中".repeat(17) },
    }),
    /最多 16 字/,
  );
});

test("publish guard accepts legacy accounts and requires Jike target and public URL", () => {
  const guarded = normalizeInput({
    type: "dynamic",
    platforms: ["x", "threads", "jike"],
    data: {
      content: "hello",
      publishGuard: {
        version: 1,
        expectedAccounts: { x: "example_x_user", threads: "example_threads_user", jike: "example_creator" },
        expectedTargets: { jike: "AI探索站" },
        requirePublicUrl: true,
      },
      extra: { jike: { topic: "AI探索站" } },
    },
  });
  assert.equal(guarded.data.publishGuard.version, 1);
  assert.equal(guarded.data.extra.jike.topic, "AI探索站");
  const juejinGuarded = normalizeInput({
    type: "dynamic",
    platforms: ["juejin"],
    data: {
      content: "hello",
      extra: { juejin: { topic: "大模型生态圈" } },
      publishGuard: {
        version: 1,
        expectedAccounts: { juejin: "example_creator" },
        expectedTargets: { juejin: "大模型生态圈" },
        requirePublicUrl: true,
      },
    },
  });
  assert.equal(juejinGuarded.data.publishGuard.expectedTargets.juejin, "大模型生态圈");
  assert.doesNotThrow(
    () => normalizeInput({
      type: "dynamic",
      platforms: ["x", "jike"],
      data: {
        publishGuard: {
          version: 1,
          expectedAccounts: { x: "example_x_user" },
          expectedTargets: { jike: "AI探索站" },
          requirePublicUrl: true,
        },
      },
    }),
  );
  assert.throws(
    () => normalizeInput({
      type: "dynamic",
      platforms: ["jike"],
      data: {
        publishGuard: {
          version: 1,
          expectedAccounts: { jike: "example_creator" },
          expectedTargets: {},
          requirePublicUrl: true,
        },
      },
    }),
    /expectedTargets|圈子/,
  );
  assert.throws(
    () => normalizeInput({
      type: "dynamic",
      platforms: ["x"],
      data: {
        publishGuard: {
          version: 1,
          expectedAccounts: { x: "example_x_user" },
          expectedTargets: {},
          requirePublicUrl: false,
        },
      },
    }),
    /requirePublicUrl/,
  );
});

test("payload digest sorts object keys, excludes path/blobUrl, and preserves array order", () => {
  const base = {
    type: "dynamic",
    mode: "fill",
    platforms: ["x", "jike"],
    data: { z: 1, nested: { b: 2, a: 1 } },
    assets: [
      {
        path: "/private/one.png",
        blobUrl: "http://127.0.0.1:1/random-a",
        role: "media",
        name: "one.png",
        type: "image/png",
        size: 10,
        sha256: "a".repeat(64),
      },
      {
        path: "/private/two.png",
        blobUrl: "http://127.0.0.1:2/random-b",
        role: "cover",
        name: "two.png",
        type: "image/png",
        size: 20,
        sha256: "b".repeat(64),
      },
    ],
  };
  const sameMeaning = {
    ...base,
    data: { nested: { a: 1, b: 2 }, z: 1 },
    assets: base.assets.map((asset) => ({
      ...asset,
      path: `/different/${asset.name}`,
      blobUrl: `http://127.0.0.1:999/${Math.random()}`,
    })),
  };
  assert.equal(createPayloadDigest(base), createPayloadDigest(sameMeaning));
  assert.notEqual(
    createPayloadDigest(base),
    createPayloadDigest({ ...base, platforms: [...base.platforms].reverse() }),
  );
  assert.notEqual(
    createPayloadDigest(base),
    createPayloadDigest({ ...base, assets: [...base.assets].reverse() }),
  );
  assert.notEqual(
    createPayloadDigest(base),
    createPayloadDigest({ ...base, groupName: "AI 图文矩阵" }),
  );
  assert.notEqual(
    createPayloadDigest(base),
    createPayloadDigest({ ...base, comboName: "AI赛道图文" }),
  );
});

test("terminal business failures map to stable auth, quota, and authorization exit codes", () => {
  const cases = [
    ["auth_session_required", 20],
    ["publish_quota_exceeded", 21],
    ["publish_authorization_unavailable", 22],
  ];
  for (const [code, exitCode] of cases) {
    assert.equal(exitCodeForRemoteCode(code), exitCode);
    assert.throws(
      () => throwForExecuteStatus({
        status: "failed",
        result: { status: "failed", error: { code, message: code } },
      }),
      (error) => error.code === code && error.exitCode === exitCode,
    );
  }
});

test("all platforms accept absent or obsolete account names without changing target guards", () => {
  for (const expectedAccounts of [undefined, {}, { x: "" }, { x: "旧昵称", unused: "旧平台" }, null]) {
    const input = normalizeInput({
      type: "dynamic", platforms: ["x", "threads", "jike"],
      data: { publishGuard: { version: 1, requirePublicUrl: true,
        expectedTargets: { jike: "AI探索站" },
        ...(expectedAccounts === undefined ? {} : { expectedAccounts }),
      } },
    });
    assert.equal(input.data.publishGuard.requirePublicUrl, true);
  }
  assert.doesNotThrow(() => normalizeInput({ type: "dynamic", platforms: ["x"],
    data: { publishGuard: { version: 1, requirePublicUrl: true } } }));
});

test("download permission preserves both booleans and validates overrides", () => {
  for (const selected of [true, false]) {
    const data = { allowDownload: selected, extra: { douyin: { allowDownload: !selected } } };
    assert.deepEqual(normalizeInput({ type: 'shortVideo', platforms: ['douyin'], data }).data, data);
  }
  for (const invalid of ['false', null, 0]) {
    for (const data of [{ allowDownload: invalid }, { extra: { kuaishou: { allowDownload: invalid } } }]) {
      assert.throws(() => normalizeInput({ type: 'shortVideo', platforms: ['kuaishou'], data }), /allowDownload/);
    }
  }
});

test("tab group ID is validated and contributes to task identity", () => {
  const base = { type: "dynamic", platforms: ["jike"], data: { content: "hello" }, assets: [] };
  assert.equal(normalizeInput({ ...base, tabGroupId: 0 }).tabGroupId, 0);
  for (const tabGroupId of [-1, 1.5, "1", null]) {
    assert.throws(() => normalizeInput({ ...base, tabGroupId }), /tabGroupId/);
  }
  const digest = { ...base, mode: "fill" };
  assert.notEqual(createPayloadDigest(digest), createPayloadDigest({ ...digest, tabGroupId: 0 }));
});

test('Douban groups require a bounded name and the account returned by targets', () => {
  const input = { type:'dynamic', platforms:['douban'], data:{extra:{douban:{groupName:'厦门租房',accountId:'35530931'}}} };
  assert.deepEqual(normalizeInput(input).data,input.data);
  for (const group of [{groupName:'厦门租房'},{groupName:123,accountId:'u'},{groupName:' ',accountId:'u'},{groupName:'组',accountId:' '},{groupName:'组',accountId:12}]) {
    assert.throws(()=>normalizeInput({...input,data:{extra:{douban:group}}}),/douban/);
  }
  assert.throws(()=>normalizeInput({...input,type:'article'}),/dynamic/);
  assert.throws(()=>normalizeInput({...input,platforms:['x']}),/douban/);
});
