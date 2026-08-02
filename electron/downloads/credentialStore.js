"use strict";

// ── Host credential store ────────────────────────────────────────────────────
//
// Encrypted storage for download-host accounts.
//
// This is the one part of the download feature where a bug hurts users
// somewhere other than Atlas. These are real cloud-storage credentials, often
// reused elsewhere, so the rules here are deliberately strict:
//
//   * Secrets go through Electron's safeStorage, which is backed by the OS
//     keychain (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
//   * If safeStorage reports encryption unavailable, saving REFUSES rather
//     than silently falling back to plaintext. A user who thinks their
//     password is encrypted and finds it in a JSON file has been lied to.
//   * Nothing secret is ever written to config.ini, logged, or returned to the
//     renderer. listAccounts() returns metadata only - which host, what kind
//     of credential, when it was added - never the value.
//   * API keys are preferred over passwords where a host offers them, because
//     a leaked scoped key is a smaller problem than a leaked account password.
//
// Stored as a single JSON file of base64 ciphertext blobs. The file being
// readable is fine; without the OS keychain entry the contents are useless.

const fs = require("fs");
const path = require("path");
const { safeStorage, app } = require("electron");

const FILE_NAME = "host-credentials.json";

let storePath = null;
let cache = null;

const resolvePath = () => {
  if (storePath) return storePath;
  storePath = path.join(app.getPath("userData"), FILE_NAME);
  return storePath;
};

/**
 * Is encryption actually available on this machine?
 *
 * On Linux this depends on a working secret service (gnome-keyring, kwallet).
 * When it is missing we do not degrade - we refuse to store secrets and tell
 * the user why, so anonymous access remains the fallback.
 */
function isAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

const readFile = () => {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(resolvePath(), "utf8");
    const parsed = JSON.parse(raw);
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Missing or corrupt: start clean rather than throwing on every read.
    cache = {};
  }
  return cache;
};

const writeFile = (data) => {
  cache = data;
  const target = resolvePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // 0600: the ciphertext is useless without the keychain entry, but there is
  // no reason for other users on the machine to read it either.
  fs.writeFileSync(target, JSON.stringify(data, null, 2), { mode: 0o600 });
};

const encrypt = (value) =>
  safeStorage.encryptString(String(value ?? "")).toString("base64");

const decrypt = (value) => {
  try {
    return safeStorage.decryptString(Buffer.from(String(value || ""), "base64"));
  } catch {
    // A blob that will not decrypt usually means the OS keychain changed or
    // the file moved between machines. Treat it as absent, not as an error -
    // the user can re-enter it.
    return "";
  }
};

/**
 * Save credentials for a host.
 *
 * @param {string} hostId    plugin id, e.g. "pixeldrain"
 * @param {object} secrets   { apiKey } or { username, password }
 * @param {object} [meta]    non-secret info worth showing in Settings
 */
function saveCredentials(hostId, secrets = {}, meta = {}) {
  const id = String(hostId || "").trim().toLowerCase();
  if (!id) return { ok: false, error: "No host specified" };
  if (!isAvailable()) {
    return {
      ok: false,
      unavailable: true,
      error:
        "This system has no secure credential storage available, so Atlas will " +
        "not save the account. On Linux this usually means no keyring service " +
        "is running. Downloads still work without an account.",
    };
  }

  const data = readFile();
  const entry = {
    hostId: id,
    // Which fields exist, so Settings can render the right form without ever
    // touching the values.
    kind: secrets.apiKey ? "apiKey" : "password",
    username: String(meta.username || secrets.username || "").trim(),
    label: String(meta.label || "").trim(),
    savedAt: Math.floor(Date.now() / 1000),
    secrets: {},
  };
  for (const [key, value] of Object.entries(secrets)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "username") continue; // not a secret
    entry.secrets[key] = encrypt(value);
  }
  if (Object.keys(entry.secrets).length === 0) {
    return { ok: false, error: "No credential value was supplied" };
  }

  data[id] = entry;
  writeFile(data);
  return { ok: true, account: describe(entry) };
}

/** Decrypted secrets for a host. Main process only - never send to a renderer. */
function getCredentials(hostId) {
  const id = String(hostId || "").trim().toLowerCase();
  const entry = readFile()[id];
  if (!entry) return {};
  const out = {};
  if (entry.username) out.username = entry.username;
  for (const [key, value] of Object.entries(entry.secrets || {})) {
    const plain = decrypt(value);
    if (plain) out[key] = plain;
  }
  return out;
}

/** Every host's credentials, keyed by plugin id - what the manager needs. */
function getAllCredentials() {
  const out = {};
  for (const id of Object.keys(readFile())) out[id] = getCredentials(id);
  return out;
}

function removeCredentials(hostId) {
  const id = String(hostId || "").trim().toLowerCase();
  const data = readFile();
  if (!data[id]) return { ok: true, removed: false };
  delete data[id];
  writeFile(data);
  return { ok: true, removed: true };
}

/** Metadata only. Safe to hand to the renderer. */
function describe(entry) {
  return {
    hostId: entry.hostId,
    kind: entry.kind,
    username: entry.username || "",
    label: entry.label || "",
    savedAt: entry.savedAt || null,
    // Presence, never the value.
    hasSecret: Object.keys(entry.secrets || {}).length > 0,
  };
}

function listAccounts() {
  return Object.values(readFile()).map(describe);
}

function hasCredentials(hostId) {
  const id = String(hostId || "").trim().toLowerCase();
  const entry = readFile()[id];
  return Boolean(entry && Object.keys(entry.secrets || {}).length > 0);
}

/** Drops the in-memory copy; the next read comes from disk. */
function resetCache() {
  cache = null;
}

module.exports = {
  isAvailable,
  saveCredentials,
  getCredentials,
  getAllCredentials,
  removeCredentials,
  listAccounts,
  hasCredentials,
  resetCache,
};
