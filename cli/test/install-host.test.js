import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createNativeManifest,
  createWrapper,
  diagnoseNativeHost,
  discoverExtensionIds,
  installNativeHost,
  installationPaths,
  uninstallNativeHost,
  validateExtensionId,
} from "../src/index.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";

test("macOS install writes exact current-user manifest and pinned absolute wrapper", async (t) => {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yijianfa-host-test-"));
  t.after(() => fs.promises.rm(home, { recursive: true, force: true }));
  const execPath = "/opt/Yi Jian Fa/node";
  const hostPath = "/opt/Yi Jian Fa/host.js";
  const result = await installNativeHost({
    extensionId,
    platform: "darwin",
    home,
    execPath,
    hostPath,
  });

  const manifestPath = path.join(
    home,
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "NativeMessagingHosts",
    "com.yijianfa.cli.json",
  );
  const wrapperPath = path.join(home, ".yijianfa", "native-host", "com.yijianfa.cli.sh");
  assert.deepEqual(
    result.files,
    { manifest: "installed", wrapper: "installed" },
  );
  assert.deepEqual(result.extensionIds, [extensionId]);
  assert.equal(
    manifestPath,
    path.join(
      home,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts",
      "com.yijianfa.cli.json",
    ),
  );
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest, {
    name: "com.yijianfa.cli",
    description: "一键发 CLI Native Messaging bridge",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  });
  const wrapper = await fs.promises.readFile(wrapperPath, "utf8");
  assert.equal(wrapper, `#!/bin/sh\nexec '${execPath}' '${hostPath}' "$@"\n`);
  assert.equal((await fs.promises.stat(wrapperPath)).mode & 0o777, 0o700);

  const removed = await uninstallNativeHost({ platform: "darwin", home });
  assert.deepEqual(removed.removed, { manifest: true, wrapper: true });
  await assert.rejects(fs.promises.access(manifestPath));
});

test("extension ID is exactly 32 lowercase a-p characters", () => {
  assert.equal(validateExtensionId(extensionId), extensionId);
  for (const invalid of ["a".repeat(31), "a".repeat(33), "A".repeat(32), "z".repeat(32)]) {
    assert.throws(() => validateExtensionId(invalid), /32 位/);
  }
});

test("Windows host paths, wrapper, and manifest use Chrome-compatible absolute paths", () => {
  const paths = installationPaths({ platform: "win32", home: "C:\\Users\\test" });
  assert.deepEqual(paths, {
    stateDirectory: "C:\\Users\\test\\.yijianfa\\native-host",
    wrapperPath: "C:\\Users\\test\\.yijianfa\\native-host\\com.yijianfa.cli.cmd",
    manifestPath: "C:\\Users\\test\\.yijianfa\\native-host\\com.yijianfa.cli.json",
    registryKey: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.yijianfa.cli",
  });
  const wrapper = createWrapper({
    platform: "win32",
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    hostPath: "C:\\Users\\test user\\AppData\\Roaming\\npm\\node_modules\\@yijianfa\\cli\\bin\\yijianfa-native-host.js",
  });
  assert.equal(
    wrapper,
    "@echo off\r\n\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\test user\\AppData\\Roaming\\npm\\node_modules\\@yijianfa\\cli\\bin\\yijianfa-native-host.js\" %*\r\n",
  );
  assert.equal(
    createNativeManifest({ extensionId, wrapperPath: paths.wrapperPath, platform: "win32" }).path,
    paths.wrapperPath,
  );
});

test("extension discovery reads unpacked manifest and repairs ID drift without a hardcoded ID", async (t) => {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yijianfa-discovery-test-"));
  t.after(() => fs.promises.rm(home, { recursive: true, force: true }));
  const profile = path.join(home, "Library", "Application Support", "Google", "Chrome", "Default");
  const unpacked = path.join(profile, "UnpackedExtensions", "current");
  await fs.promises.mkdir(unpacked, { recursive: true });
  await fs.promises.writeFile(path.join(unpacked, "manifest.json"), JSON.stringify({
    name: "一键发",
    homepage_url: "https://yijianfa.ainativehub.com",
  }));
  await fs.promises.writeFile(path.join(profile, "Secure Preferences"), JSON.stringify({
    extensions: { settings: { [extensionId]: { path: unpacked } } },
  }));
  assert.deepEqual(await discoverExtensionIds({ platform: "darwin", home }), [extensionId]);

  const staleId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await installNativeHost({ extensionId: staleId, platform: "darwin", home });
  const before = await import("../src/host-install.js").then((module) => (
    module.inspectNativeHostInstallation({ platform: "darwin", home })
  ));
  assert.equal(
    diagnoseNativeHost({ installation: before, extensionIds: [extensionId] }).state,
    "extension_id_mismatch",
  );
  await installNativeHost({ platform: "darwin", home });
  const after = await import("../src/host-install.js").then((module) => (
    module.inspectNativeHostInstallation({ platform: "darwin", home })
  ));
  assert.equal(diagnoseNativeHost({ installation: after, extensionIds: [extensionId] }).state, "configured");
  assert.deepEqual(after.manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
});

test("doctor diagnosis separates missing host, broken config, ID drift, and configured host", () => {
  assert.equal(diagnoseNativeHost({ installation: { installed: false } }).state, "host_not_installed");
  assert.equal(diagnoseNativeHost({
    installation: { installed: true, wrapper: { exists: false }, manifest: { type: "stdio" } },
  }).state, "host_config_error");
  assert.equal(diagnoseNativeHost({
    installation: {
      installed: true,
      wrapper: { exists: true, executable: true },
      manifest: { type: "stdio", allowed_origins: ["chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/"] },
    },
    extensionIds: [extensionId],
  }).state, "extension_id_mismatch");
  assert.equal(diagnoseNativeHost({
    installation: {
      installed: true,
      wrapper: { exists: true, executable: true },
      manifest: { type: "stdio", allowed_origins: [`chrome-extension://${extensionId}/`] },
    },
    extensionIds: [extensionId],
  }).state, "configured");
});
