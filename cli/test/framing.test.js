import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_NATIVE_MESSAGE_BYTES,
  NativeFramingError,
  NativeMessageParser,
  encodeNativeMessage,
} from "../src/index.js";
import { NdjsonParser, encodeNdjson } from "../src/ndjson.js";

test("native framing handles fragmented headers, coalesced frames, and unicode", () => {
  const values = [
    { id: "一", text: "你好，世界 👋" },
    { id: "two", nested: { emoji: "🧑‍💻", value: 2 } },
  ];
  const combined = Buffer.concat(values.map((value) => encodeNativeMessage(value)));
  const parser = new NativeMessageParser();
  const output = [];
  const sizes = [1, 2, 7, 3, 19, 5, combined.length];
  let offset = 0;
  for (const size of sizes) {
    if (offset >= combined.length) break;
    output.push(...parser.push(combined.subarray(offset, Math.min(combined.length, offset + size))));
    offset += size;
  }
  if (offset < combined.length) output.push(...parser.push(combined.subarray(offset)));
  parser.finish();
  assert.deepEqual(output, values);
});

test("native framing rejects messages at or above the one MiB boundary", () => {
  const parser = new NativeMessageParser();
  const header = Buffer.alloc(4);
  if (process.arch) {
    // The encoder and parser share native endianness; use a valid encoded frame's header shape.
    const encoded = encodeNativeMessage({ ok: true });
    const littleEndian = encoded.readUInt32LE(0) === encoded.length - 4;
    if (littleEndian) header.writeUInt32LE(MAX_NATIVE_MESSAGE_BYTES + 1);
    else header.writeUInt32BE(MAX_NATIVE_MESSAGE_BYTES + 1);
  }
  assert.throws(() => parser.push(header), NativeFramingError);
  assert.throws(
    () => encodeNativeMessage({ text: "x".repeat(MAX_NATIVE_MESSAGE_BYTES) }),
    /maximum/,
  );
});

test("NDJSON handles fragments, coalescing, CRLF, and unicode", () => {
  const values = [{ text: "中文" }, { text: "emoji ✅" }];
  const bytes = Buffer.concat([encodeNdjson(values[0]), Buffer.from("\r\n"), encodeNdjson(values[1])]);
  const parser = new NdjsonParser();
  const output = [
    ...parser.push(bytes.subarray(0, 2)),
    ...parser.push(bytes.subarray(2, 13)),
    ...parser.push(bytes.subarray(13)),
  ];
  assert.deepEqual(output, values);
});
