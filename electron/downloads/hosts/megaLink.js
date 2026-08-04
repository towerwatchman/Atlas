"use strict";

// ── Mega link parsing and key derivation ─────────────────────────────────────
//
// Pure: no network, no crypto beyond AES-CBC on 48 bytes of metadata. Separated
// from the plugin so every rule here is testable offline, which matters more for
// Mega than for other hosts because a single off-by-one in the key derivation
// produces a file that downloads perfectly and is unreadable.
//
// ── WHY THE KEY IS NOT IN THE API CALL ──────────────────────────────────────
//
// A Mega link is `https://mega.nz/file/<id>#<key>`. Everything after the `#` is
// a URL FRAGMENT, which browsers and HTTP clients never transmit -- so Mega's
// servers hold only ciphertext and have never seen the key. That is the whole
// design, and it has two consequences for this plugin:
//
//   1. The API call sends ONLY the id. Sending `id#key` as the `p` parameter
//      returns [-2] (EARGS), which is how this was first got wrong.
//   2. There is no URL that yields plaintext. The bytes on Mega's CDN are
//      AES-CTR ciphertext, so unlike Pixeldrain there is no "translate the page
//      url to the file url" step that a generic downloader can then follow. The
//      decryption has to happen inside the transfer.
//
// ── KEY LAYOUT ──────────────────────────────────────────────────────────────
//
// The fragment is 32 bytes of base64url:
//
//   bytes  0..16   key half A
//   bytes 16..32   key half B      -- also carries the nonce and meta-MAC
//
//   AES-128 key = A XOR B
//   nonce       = bytes 16..24     (CTR counter is nonce || 8 zero bytes)
//   meta-MAC    = bytes 24..32     (expected condensed MAC of the plaintext)
//
// Verified against a real link: a 43-character fragment decodes to exactly 32
// bytes, and the derived key decrypts that file's attributes to
// `MEGA{"n":"<filename>"}`.

const crypto = require("crypto");

/** Mega's base64: url-safe alphabet, padding stripped. */
function base64UrlToBuffer(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/[^A-Za-z0-9_-]/.test(text)) return null;
  // 43 chars needs exactly one '='. Getting this wrong silently truncates the
  // last byte of the key, which is a corrupt download with no error anywhere.
  const padding = "==".slice(0, (4 - (text.length % 4)) % 4);
  const normalised = text.replace(/-/g, "+").replace(/_/g, "/") + padding;
  const buffer = Buffer.from(normalised, "base64");
  return buffer.length > 0 ? buffer : null;
}

const FILE_PATTERNS = [
  // Current: https://mega.nz/file/<id>#<key>
  /mega(?:\.co)?\.nz\/file\/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)/i,
  // Legacy: https://mega.nz/#!<id>!<key> -- still posted in old thread history.
  /mega(?:\.co)?\.nz\/#!([A-Za-z0-9_-]+)!([A-Za-z0-9_-]+)/i,
];

const FOLDER_PATTERNS = [
  /mega(?:\.co)?\.nz\/folder\/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)/i,
  /mega(?:\.co)?\.nz\/#F!([A-Za-z0-9_-]+)!([A-Za-z0-9_-]+)/i,
];

/**
 * Parse a Mega link.
 *
 * Folder links are RECOGNISED but reported as their own kind rather than being
 * treated as files, because a folder needs its tree fetched and decrypted before
 * there is any file to download. Recognising them means the plugin can say
 * "folder links are not supported yet" instead of failing as a malformed link.
 */
function parseMegaLink(url) {
  const text = String(url || "");
  if (!text) return null;
  for (const pattern of FILE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { kind: "file", id: match[1], keyBase64: match[2] };
  }
  for (const pattern of FOLDER_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { kind: "folder", id: match[1], keyBase64: match[2] };
  }
  return null;
}

/**
 * Split a 32-byte file key into what the transfer needs.
 * Returns null for anything that is not a file key, rather than deriving
 * nonsense from a folder key or a truncated fragment.
 */
function deriveFileKey(keyBase64) {
  const raw = base64UrlToBuffer(keyBase64);
  if (!raw || raw.length !== 32) return null;
  const key = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) key[i] = raw[i] ^ raw[i + 16];
  const nonce = raw.subarray(16, 24);
  return {
    key,
    nonce: Buffer.from(nonce),
    metaMac: Buffer.from(raw.subarray(24, 32)),
    // AES-CTR counter starts at the nonce followed by a zero block counter.
    ctrIv: Buffer.concat([nonce, Buffer.alloc(8)]),
  };
}

/**
 * Decrypt the `at` field from the API response.
 *
 * The `MEGA` prefix is Mega's own key check: it only appears when the key is
 * right, so a missing prefix means the link's key does not belong to this file
 * rather than that the JSON is malformed. Reported as null so the caller can say
 * that specifically.
 */
function decryptAttributes(at, key) {
  const cipher = base64UrlToBuffer(at);
  if (!cipher || cipher.length === 0 || cipher.length % 16 !== 0) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16));
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
    // Zero-padded to a block boundary.
    const text = plain.toString("utf8").replace(/\0+$/, "");
    if (!text.startsWith("MEGA")) return null;
    return JSON.parse(text.slice(4));
  } catch {
    return null;
  }
}

/** The filename Mega holds for the file, or "" when it cannot be read. */
function fileNameFromAttributes(attributes) {
  const name = attributes && typeof attributes.n === "string" ? attributes.n.trim() : "";
  // Never let a remote value become a path. The download manager joins this onto
  // the downloads directory.
  return name.replace(/[\\/]+/g, "_").replace(/^\.+/, "");
}

// Mega's MAC is computed per chunk, and the chunks grow: 128KB, 256KB, 384KB …
// up to 1MB, then 1MB for the rest of the file. The progression is part of the
// MAC definition, so a wrong boundary produces a wrong MAC on a file whose bytes
// are perfectly correct.
const CHUNK_UNIT = 128 * 1024;
const MAX_CHUNK = 1024 * 1024;

/** Byte length of the nth chunk, n starting at 0. */
function chunkSizeAt(index) {
  return Math.min((index + 1) * CHUNK_UNIT, MAX_CHUNK);
}

/** Offsets at which each chunk starts, for a file of `size` bytes. */
function chunkBoundaries(size) {
  const total = Number(size);
  if (!Number.isFinite(total) || total <= 0) return [];
  const offsets = [];
  let offset = 0;
  let index = 0;
  while (offset < total) {
    offsets.push(offset);
    offset += chunkSizeAt(index);
    index += 1;
  }
  return offsets;
}

module.exports = {
  CHUNK_UNIT,
  MAX_CHUNK,
  base64UrlToBuffer,
  parseMegaLink,
  deriveFileKey,
  decryptAttributes,
  fileNameFromAttributes,
  chunkSizeAt,
  chunkBoundaries,
};
