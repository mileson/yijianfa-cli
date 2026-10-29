import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeInput } from "../src/schema.js";
import { prepareInput } from "../src/cli.js";
import { limitXArticleImages, prepareXArticleImages } from "../src/x-article-images.js";

function fixture(count) {
  const media = Array.from({ length: count }, (_, index) => ({ path: `/images/${index}.png`, role: "media" }));
  return { type: "article", platforms: ["x"], data: { content: media.map(asset => `<p>before ${asset.path}</p><img src='${asset.path}'/>`).join("") }, assets: [{ path: "/images/cover.png", role: "cover" }, ...media] };
}

test("CLI keeps the first 25 images and cover, replacing each overflow in place", () => {
  const input = fixture(46);
  const result = prepareXArticleImages(input);
  assert.equal(result.assets.length, 26);
  assert.equal(result.data.xArticleImageOverflow.length, 21);
  assert.equal((result.data.content.match(/<img\b/g) || []).length, 25);
  assert.ok(result.data.content.includes('before /images/25.png</p><p>【超过25张图片上限，需人工替换】 /images/25.png</p>'));
  assert.ok(input.data.content.includes("src='/images/45.png'"), "source remains intact");
  assert.equal(prepareXArticleImages(result), result, "re-preparing is idempotent");
});

test("document order decides which assets survive, not asset array order", () => {
  const input = fixture(26);
  input.assets.reverse();
  const result = prepareXArticleImages(input);
  assert.ok(!result.assets.some(asset => asset.path === "/images/25.png"));
  assert.ok(result.assets.some(asset => asset.path === "/images/0.png"));
});

test("unused assets cannot push uploads beyond 25", () => {
  const input = fixture(46);
  input.data.content = fixture(25).data.content;
  const result = prepareXArticleImages(input);
  assert.equal(result.assets.length, 26);
  assert.equal(result.data.xArticleImageOverflow.length, 0);
  assert.equal(result.data.content, input.data.content);
});

test("25 images stay unchanged; other platforms and shared jobs stay unchanged", () => {
  for (const input of [fixture(25), { ...fixture(46), platforms: ["wechat"] }, { ...fixture(46), platforms: ["x", "wechat"] }, { ...fixture(46), type: "imageText" }]) {
    assert.equal(prepareXArticleImages(input), input);
  }
});

test("source addresses survive encoded filenames and HTML escaping", () => {
  const input = fixture(25);
  input.data.content += '<img src="folder/%E4%BD%A0%E5%A5%BD.png" />';
  input.assets.push({ path: '/images/你好.png', role: 'media' });
  assert.ok(prepareXArticleImages(input).data.content.includes('/images/你好.png'));
  const media = [{ name: 'overflow.png', originalPath: '/images/<a>&.png', blobUrl: 'blob:overflow' }];
  const result = limitXArticleImages('<img src="ok.png"/>'.repeat(25) + '<img src="blob:overflow"/>', media);
  assert.ok(result.content.includes('/images/&lt;a&gt;&amp;.png'));
  assert.ok(!result.content.includes('blob:overflow'));
});

test("prepare hashes and serves only retained assets, returning overflow addresses", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-article-limit-"));
  try {
    const file = path.join(dir, "image.png");
    fs.writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
    const input = fixture(26);
    input.assets = input.assets.map((asset, index) => {
      const filename = path.join(dir, `${index}.png`);
      if (index < 26) fs.copyFileSync(file, filename);
      return { ...asset, path: filename };
    });
    input.data.content = input.assets.slice(1).map(asset => `<img src="${asset.path}"/>`).join("");
    const prepared = await prepareInput(normalizeInput(input), "fill");
    assert.equal(prepared.assets.length, 26);
    assert.equal(prepared.data.xArticleImageOverflow.length, 1);
    assert.ok(prepared.data.content.includes(path.join(dir, "26.png")), "missing overflow file needs no upload");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
