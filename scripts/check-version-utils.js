"use strict";

// Lightweight sanity check for the standalone version comparator. The full,
// comprehensive suite lives in tests/versionCompare.test.js (seeded with real
// catalog strings). This script stays sqlite-free so it can run anywhere.

const assert = require("assert");
const {
  isNewerVersion,
  normalizeAppVersion,
} = require("../electron/utils/versionUtils");
const { getIsUpdateAvailable } = require("../electron/utils/versionCompare");

// App-updater semver helpers (self-update, not game versions).
assert.strictEqual(normalizeAppVersion("v1.0.59"), "1.0.59");
assert.strictEqual(isNewerVersion("v1.0.59", "1.0.59"), false);
assert.strictEqual(isNewerVersion("v1.0.60", "1.0.59"), true);
assert.strictEqual(isNewerVersion("1.0.58", "1.0.59"), false);

// Game version update detection (scheme-aware). No timestamp argument — the
// signal is version-string authoritative.
assert.strictEqual(getIsUpdateAvailable("Ch.4", [{ version: "Ch.3" }]), true);
assert.strictEqual(getIsUpdateAvailable("Ep.1 P.2", [{ version: "Ch.3" }]), false); // incomparable → suppress
assert.strictEqual(getIsUpdateAvailable("v0.3.6c", [{ version: "v0.3.6b" }]), true);
assert.strictEqual(getIsUpdateAvailable("Final", [{ version: "v0.9" }]), true);
assert.strictEqual(getIsUpdateAvailable("v1.0 + DLC", [{ version: "v1.0" }]), false);
assert.strictEqual(getIsUpdateAvailable("v1.2", [{ version: "v1.2" }]), false);

console.log("version comparison checks passed");
