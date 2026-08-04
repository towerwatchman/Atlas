"use strict";

// ── MEGA account crypto ──────────────────────────────────────────────────────
//
// Signing in, so a download can be attributed to the user's account and get its
// transfer quota instead of the anonymous one.
//
// Everything here is pure: given the same inputs it produces the same bytes, and
// no function makes a network call. That is deliberate -- this is the code where a
// silent mistake produces "wrong password" against a correct password, and the
// only way to be sure of it offline is to be able to run it offline.
//
// ── THE SHAPE OF A MEGA LOGIN ───────────────────────────────────────────────
//
//   1. Ask which account generation this email is (`us0`) and get its salt.
//   2. Turn the password into a 16-byte derived key plus a hash to send.
//      v2: PBKDF2-SHA512, 100k iterations -> 32 bytes, split 16/16.
//      v1: an AES-based iterated derivation over the password (see prepareKeyV1),
//          with the hash derived from the email instead of a server salt.
//   3. Send the hash (`us`) and get back `k`, `privk` and `csid`.
//   4. AES-ECB-decrypt `k` with the derived key -> the MASTER key.
//   5. AES-ECB-decrypt `privk` with the master key -> RSA private components.
//   6. RSA-decrypt `csid` with those -> the session id, which authenticates
//      every later request.
//
// Step 6 is the one that looks intimidating and is not. MEGA stores the private
// EXPONENT `d` in privk alongside `p` and `q`, so the decryption is c^d mod (p*q):
// a single modular exponentiation, which BigInt does natively. There is no need to
// reassemble a PKCS#8 key or to use the CRT components at all -- `u` is present
// and simply unused.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
//
// Nothing stores a password. validate() exchanges the credentials for a session
// once and only the session is persisted, so a copied config cannot be replayed
// as a login. The cost is that an expired session needs signing in again rather
// than being refreshed silently -- the same trade the F95 browser-added accounts
// already make.

const crypto = require("crypto");

const AES_ZERO_IV = Buffer.alloc(16);

/** MEGA's base64: url-safe, unpadded. */
function toBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const text = String(value ?? "").trim();
  if (!text || /[^A-Za-z0-9_-]/.test(text)) return null;
  const padding = "==".slice(0, (4 - (text.length % 4)) % 4);
  return Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/") + padding, "base64");
}

/** AES-128-ECB, no padding. MEGA's workhorse for key wrapping. */
function aesEcb(key, data, mode) {
  const cipher = mode === "encrypt"
    ? crypto.createCipheriv("aes-128-ecb", key, null)
    : crypto.createDecipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * v2 password derivation. 32 bytes out: the first 16 are the key that unwraps the
 * master key, the last 16 are sent to the server as proof of the password.
 *
 * The password is UTF-8 and the salt arrives base64url from `us0`.
 */
function deriveKeyV2(password, saltBase64) {
  const salt = fromBase64Url(saltBase64);
  if (!salt) return null;
  const derived = crypto.pbkdf2Sync(
    Buffer.from(String(password), "utf8"), salt, 100000, 32, "sha512",
  );
  return { derivedKey: derived.subarray(0, 16), passwordHash: derived.subarray(16, 32) };
}

/**
 * v1 (legacy) password derivation.
 *
 * 65,536 rounds over the password in 16-byte blocks, where each block acts as an
 * AES key encrypting the running value. The starting value is MEGA's fixed
 * constant. Unusual, but it is what the accounts predating v2 were created with,
 * and there is no way to migrate one from the client.
 */
function prepareKeyV1(password) {
  const bytes = Buffer.from(String(password), "utf8");
  // Zero-padded to a block boundary; the padding is part of the definition.
  const blocks = Math.ceil(bytes.length / 16) || 1;
  const padded = Buffer.alloc(blocks * 16);
  bytes.copy(padded);

  let key = Buffer.from([
    0x93, 0xC4, 0x67, 0xE3, 0x7D, 0xB0, 0xC7, 0xA4,
    0xD1, 0xBE, 0x3F, 0x81, 0x01, 0x52, 0xCB, 0x56,
  ]);
  for (let round = 0; round < 65536; round += 1) {
    for (let block = 0; block < blocks; block += 1) {
      key = aesEcb(padded.subarray(block * 16, block * 16 + 16), key, "encrypt");
    }
  }
  return key;
}

/** v1 proof-of-password: a hash of the lowercased email under the derived key. */
function stringHashV1(email, derivedKey) {
  const text = Buffer.from(String(email).toLowerCase(), "utf8");
  const accumulator = Buffer.alloc(16);
  for (let i = 0; i < text.length; i += 1) accumulator[i % 16] ^= text[i];
  let hash = accumulator;
  for (let i = 0; i < 16384; i += 1) hash = aesEcb(derivedKey, hash, "encrypt");
  // Only two of the four words are sent.
  return Buffer.concat([hash.subarray(0, 4), hash.subarray(8, 12)]);
}

/** Unwrap the master key from the `k` field of a login response. */
function decryptMasterKey(kBase64, derivedKey) {
  const wrapped = fromBase64Url(kBase64);
  if (!wrapped || wrapped.length !== 16) return null;
  return aesEcb(derivedKey, wrapped, "decrypt");
}

/**
 * Parse MEGA's MPI sequence: each big integer is a 2-byte big-endian BIT length
 * followed by that many bits, rounded up to whole bytes.
 *
 * Returns BigInts. A truncated buffer yields null rather than a short integer,
 * because a silently-wrong modulus produces a session id that looks like data and
 * is rejected by the server with no clue why.
 */
function parseMpiSequence(buffer, count) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < count; i += 1) {
    if (offset + 2 > buffer.length) return null;
    const bits = buffer.readUInt16BE(offset);
    const bytes = Math.ceil(bits / 8);
    offset += 2;
    if (offset + bytes > buffer.length) return null;
    const slice = buffer.subarray(offset, offset + bytes);
    out.push(slice.length === 0 ? 0n : BigInt(`0x${slice.toString("hex")}`));
    offset += bytes;
  }
  return out;
}

/** Modular exponentiation, right-to-left binary. One call per login. */
function modPow(base, exponent, modulus) {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

/**
 * Decrypt `privk` with the master key and pull out the RSA components.
 *
 * privk holds [p, q, d, u]. `u` is the CRT coefficient and is unused here: with
 * `d` present, decryption is a plain c^d mod n, so there is nothing to gain from
 * the CRT for a single operation.
 */
function decryptPrivateKey(privkBase64, masterKey) {
  const wrapped = fromBase64Url(privkBase64);
  if (!wrapped || wrapped.length === 0 || wrapped.length % 16 !== 0) return null;
  const plain = aesEcb(masterKey, wrapped, "decrypt");
  const parts = parseMpiSequence(plain, 4);
  if (!parts) return null;
  const [p, q, d] = parts;
  if (!p || !q || !d) return null;
  return { p, q, d, n: p * q };
}

/**
 * RSA-decrypt the session id challenge.
 *
 * The plaintext is a raw big integer, not a padded block, and MEGA takes the
 * FIRST 43 BYTES of it as the session id. Those bytes are left-aligned in the
 * modulus width, so the BigInt has to be rendered back to a fixed-width buffer --
 * trimming leading zeros here shifts every byte and yields a session id the
 * server rejects.
 */
function decryptSessionId(csidBase64, privateKey) {
  const csid = fromBase64Url(csidBase64);
  if (!csid) return null;
  const parts = parseMpiSequence(csid, 1);
  if (!parts || !parts[0]) return null;
  const plain = modPow(parts[0], privateKey.d, privateKey.n);
  const width = Math.ceil(privateKey.n.toString(16).length / 2);
  let hex = plain.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const buffer = Buffer.alloc(width);
  Buffer.from(hex, "hex").copy(buffer, width - Buffer.from(hex, "hex").length);
  // The integer is left-aligned within the modulus: the first MPI byte of the
  // plaintext is at the start of the significant bytes, so strip the leading
  // zero padding that the fixed width introduced.
  const significant = buffer.subarray(width - Buffer.from(hex, "hex").length);
  if (significant.length < 43) return null;
  return toBase64Url(significant.subarray(0, 43));
}

module.exports = {
  AES_ZERO_IV,
  toBase64Url,
  fromBase64Url,
  aesEcb,
  deriveKeyV2,
  prepareKeyV1,
  stringHashV1,
  decryptMasterKey,
  parseMpiSequence,
  modPow,
  decryptPrivateKey,
  decryptSessionId,
};
