import { readFileSync } from "node:fs";

export const PACKAGE_NAME = "@yijianfa/cli";
// package.json 是版本唯一来源，避免安装包和命令显示各自保留一份版本号。
export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const PROTOCOL_VERSION = 1;
export const CAPABILITIES_SCHEMA = "yijianfa.cli.capabilities.v1";
export const PREPARED_SCHEMA = "yijianfa.cli.prepared.v1";
export const RESULT_SCHEMA = "yijianfa.cli.result.v1";
export const NATIVE_HOST_NAME = "com.yijianfa.cli";
export const OFFICIAL_EXTENSION_ID = "dmcejnbkknlkpcbaggoeiminccbpliaj";
export const BROWSER_CONTEXTS = Object.freeze(["regular", "incognito"]);
export const DEFAULT_BROWSER_CONTEXT = "regular";

// Chrome Native Messaging documents a 1 MiB host-to-browser ceiling. Keep both
// directions strictly below it so an exact 1 MiB payload is rejected locally.
export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024 - 1;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_DOCTOR_WAIT_MS = 30_000;

export const EXIT_CODES = Object.freeze({
  OK: 0,
  INPUT: 2,
  CONFIRMATION_REQUIRED: 10,
  AUTH: 20,
  QUOTA: 21,
  AUTHORIZATION_UNAVAILABLE: 22,
  BRIDGE: 30,
  EXECUTION: 40,
});

export const CONTENT_TYPES = Object.freeze([
  "dynamic",
  "imageText",
  "article",
  "shortVideo",
]);

export const ASSET_ROLES = Object.freeze([
  "media",
  "cover",
  "horizontalCover",
  "wordFile",
]);

export const COMMANDS = Object.freeze([
  "help",
  "version",
  "bridges",
  "doctor",
  "capabilities",
  "targets",
  "transfer",
  "prepare",
  "fill",
  "publish",
  "status",
  "cancel",
  "install-host",
  "uninstall-host",
]);
