import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectAsset, startAssetServer } from "../src/index.js";

test("asset preparation hashes and serves a file larger than one MiB", async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yijianfa-asset-test-"));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "大图.png");
  const content = Buffer.alloc(1024 * 1024 + 257);
  for (let index = 0; index < content.length; index += 1) content[index] = index % 251;
  content.set(Buffer.from("89504e470d0a1a0a", "hex"), 0);
  await fs.promises.writeFile(filePath, content);

  const asset = await inspectAsset({ path: filePath, role: "media" });
  assert.equal(asset.size, content.length);
  assert.equal(asset.type, "image/png");
  assert.equal(asset.sha256, createHash("sha256").update(content).digest("hex"));

  const server = await startAssetServer([asset]);
  t.after(() => server.close());
  const transport = server.transportAssets[0];
  assert.equal("path" in transport, false);
  assert.equal(transport.sha256, asset.sha256);

  const options = await fetch(transport.blobUrl, {
    method: "OPTIONS",
    headers: { Origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-private-network"), "true");
  assert.match(options.headers.get("cache-control"), /no-store/);

  const head = await fetch(transport.blobUrl, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), content.length);
  assert.equal(head.headers.get("accept-ranges"), "bytes");

  const range = await fetch(transport.blobUrl, { headers: { Range: "bytes=100-199" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), `bytes 100-199/${content.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), content.subarray(100, 200));

  const suffix = await fetch(transport.blobUrl, { headers: { Range: "bytes=-32" } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), content.subarray(-32));

  const invalid = await fetch(transport.blobUrl, { headers: { Range: "bytes=99999999-" } });
  assert.equal(invalid.status, 416);

  const whole = Buffer.from(await (await fetch(transport.blobUrl)).arrayBuffer());
  assert.equal(createHash("sha256").update(whole).digest("hex"), asset.sha256);
});
