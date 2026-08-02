"use strict";

// Tests for the download-host credential store.
//
// This module holds real cloud-storage passwords and API keys, so the
// behaviour worth proving is not "it round-trips" but the safety properties:
//
//   * secrets never leave the main process in plaintext
//   * when the OS has no secure storage, saving REFUSES rather than quietly
//     writing plaintext to disk
//   * nothing secret appears in the file, and nothing secret appears in what
//     the renderer is handed
//
// electron is stubbed, so safeStorage can be driven into both its available
// and unavailable states - the unavailable path is the one that matters and is
// impossible to trigger on a healthy machine.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-creds-"));

// Reversible stand-in for the OS keychain. Deliberately NOT encryption - the
// point is to observe what gets written, not to test Electron's crypto.
let encryptionAvailable = true;
const fakeElectron = {
  app: { getPath: () => tempDir },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (text) => Buffer.from(`enc:${text}`, "utf8"),
    decryptString: (buf) => {
      const text = Buffer.from(buf).toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("bad blob");
      return text.slice(4);
    },
  },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (request === "electron") return "electron-stub";
  return originalResolve.call(this, request, ...rest);
};
require.cache["electron-stub"] = { id: "electron-stub", filename: "electron-stub",
  loaded: true, exports: fakeElectron };

const store = require("../electron/downloads/credentialStore");

let checks = 0;
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };

const storeFile = () => path.join(tempDir, "host-credentials.json");
const rawFile = () => fs.readFileSync(storeFile(), "utf8");

// ── Round trip ──────────────────────────────────────────────────────────────
{
  const result = store.saveCredentials("pixeldrain", { apiKey: "secret-key-123" },
    { username: "tower" });
  eq(result.ok, true, "saved");
  eq(result.account.hostId, "pixeldrain", "host recorded");
  eq(result.account.kind, "apiKey", "kind inferred from the field supplied");
  eq(result.account.username, "tower", "username is metadata, not a secret");
  eq(result.account.hasSecret, true, "presence reported");
  // The returned account object must never carry the value itself.
  ok(!JSON.stringify(result.account).includes("secret-key-123"),
     "the saved-account response contains no secret");
}
{
  const creds = store.getCredentials("pixeldrain");
  eq(creds.apiKey, "secret-key-123", "decrypts in the main process");
  eq(creds.username, "tower", "username returned alongside");
}

// ── Nothing plaintext on disk ───────────────────────────────────────────────
ok(!rawFile().includes("secret-key-123"), "the secret is not plaintext in the file");
ok(rawFile().includes("pixeldrain"), "but the host id is, so the file is inspectable");

// ── Renderer-facing surface leaks nothing ───────────────────────────────────
{
  const listed = store.listAccounts();
  eq(listed.length, 1, "one account");
  ok(!JSON.stringify(listed).includes("secret-key-123"), "listAccounts leaks no secret");
  eq(listed[0].hasSecret, true, "presence only");
  eq(listed[0].username, "tower", "metadata is fine to expose");
}
eq(store.hasCredentials("pixeldrain"), true, "presence check");
eq(store.hasCredentials("mega"), false, "absent host");

// ── getAllCredentials feeds the download manager ────────────────────────────
{
  const all = store.getAllCredentials();
  eq(all.pixeldrain.apiKey, "secret-key-123", "keyed by plugin id");
}

// ── Refuse rather than downgrade ────────────────────────────────────────────
// The important one. On a machine with no keyring, saving must fail loudly.
// Writing plaintext while the UI implies encryption would be a betrayal.
{
  encryptionAvailable = false;
  store.resetCache();
  const result = store.saveCredentials("mega", { password: "hunter2" });
  eq(result.ok, false, "save refused with no secure storage");
  eq(result.unavailable, true, "flagged as an environment problem, not a user error");
  ok(/secure credential storage/i.test(result.error), "explains why");
  ok(!rawFile().includes("hunter2"), "and absolutely nothing was written");
  encryptionAvailable = true;
  store.resetCache();
}

// ── Rejections ──────────────────────────────────────────────────────────────
{
  const result = store.saveCredentials("pixeldrain", {});
  eq(result.ok, false, "a save with no secret value is rejected");
}
{
  const result = store.saveCredentials("", { apiKey: "x" });
  eq(result.ok, false, "a save with no host is rejected");
}

// ── Undecryptable blobs degrade rather than throw ───────────────────────────
// Happens when the keychain changes or the file is copied between machines.
{
  const data = JSON.parse(rawFile());
  data.pixeldrain.secrets.apiKey = Buffer.from("garbage").toString("base64");
  fs.writeFileSync(storeFile(), JSON.stringify(data));
  store.resetCache();
  const creds = store.getCredentials("pixeldrain");
  eq(creds.apiKey, undefined, "a bad blob reads as absent, not as an exception");
  // The entry still lists, so the user can see it and re-enter it.
  eq(store.listAccounts().length, 1, "the account is still visible for repair");
}

// ── Removal ─────────────────────────────────────────────────────────────────
{
  const result = store.removeCredentials("pixeldrain");
  eq(result.removed, true, "removed");
  eq(store.listAccounts().length, 0, "gone from the list");
  eq(store.removeCredentials("pixeldrain").removed, false, "removing twice is a no-op");
}

// ── Corrupt store file ──────────────────────────────────────────────────────
{
  fs.writeFileSync(storeFile(), "{ not json");
  store.resetCache();
  eq(store.listAccounts().length, 0, "a corrupt file reads as empty rather than crashing");
}

fs.rmSync(tempDir, { recursive: true, force: true });
Module._resolveFilename = originalResolve;

console.log(`Credential store checks passed (${checks} assertions)`);
