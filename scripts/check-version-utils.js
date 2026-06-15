const assert = require("assert");
const {
  isNewerVersion,
  normalizeAppVersion,
} = require("../electron/utils/versionUtils");

assert.strictEqual(normalizeAppVersion("v1.0.59"), "1.0.59");
assert.strictEqual(isNewerVersion("v1.0.59", "1.0.59"), false);
assert.strictEqual(isNewerVersion("v1.0.60", "1.0.59"), true);
assert.strictEqual(isNewerVersion("1.0.58", "1.0.59"), false);

console.log("version comparison checks passed");
