const assert = require("assert");
const {
  isNewerVersion,
  normalizeAppVersion,
} = require("../electron/utils/versionUtils");
const { getIsUpdateAvailable } = require("../electron/db/versions");

assert.strictEqual(normalizeAppVersion("v1.0.59"), "1.0.59");
assert.strictEqual(isNewerVersion("v1.0.59", "1.0.59"), false);
assert.strictEqual(isNewerVersion("v1.0.60", "1.0.59"), true);
assert.strictEqual(isNewerVersion("1.0.58", "1.0.59"), false);
assert.strictEqual(
  getIsUpdateAvailable("Ep.1 P.2", [{ version: "Ch.3" }]),
  true,
);
assert.strictEqual(
  getIsUpdateAvailable("Episode 1 - Part 2", [{ version: "Ep.1 P.2" }]),
  false,
);
assert.strictEqual(
  getIsUpdateAvailable("Ch.4", [{ version: "Ch.3" }]),
  true,
);

console.log("version comparison checks passed");
