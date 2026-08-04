"use strict";

// ── MEGA hashcash (proof of work) ────────────────────────────────────────────
//
// MEGA gates its ACCOUNT commands behind a proof of work. A login request is
// answered with HTTP 402 and an `X-Hashcash` challenge; the client must burn CPU
// to find a nonce and retry with the answer. Anonymous public-link downloads are
// not gated, which is exactly the asymmetry observed: `a:"g"` succeeded while
// `a:"us"` returned 402 with an empty body.
//
// Transcribed from MEGA's own SDK -- src/hashcash.cpp and src/posix/net.cpp --
// rather than inferred, because every constant here is load-bearing and a wrong
// one produces a proof the server silently rejects.
//
//   challenge (response header):  <version>:<easiness>:<timestamp>:<b64token>
//   answer    (request header):   1:<b64token>:<b64prefix>
//
// MEGA's own example, from the comment in net.cpp:
//   1:100:1731410499:RUvIePV2PNO8ofg8xp1aT5ugBcKSEzwKoLBw9o4E6F_fmn44eC3oMpv388UtFl2K
//
// ── THE WORK ────────────────────────────────────────────────────────────────
//
//   message = <4-byte nonce, big endian> || <48-byte token repeated 262144 times>
//   accept when  uint32be(sha256(message)[0..4])  <=  threshold(easiness)
//   threshold(e) = (((e & 63) << 1) + 1) << ((e >> 6) * 7 + 3)
//
// The message is 12 MB and it is rehashed IN FULL for every nonce: the nonce sits
// in the first block, and SHA-256 is sequential, so nothing downstream can be
// reused. That is the point -- it is deliberately memory-hard.
//
// "Easiness" grows with the threshold, so a HIGH value is easy. At the easiness of
// 100 in MEGA's example the threshold is 74,752 out of 2^32, roughly one nonce in
// 57,000 -- around 700 GB of SHA-256. MEGA's own client spends up to 8 threads and
// a 300-second budget on it.

const crypto = require("crypto");

const TOKEN_BYTES = 48;
const PREFIX_BYTES = 4;
const REPEAT = 262144; // 12MB / 48B
const BUFFER_SIZE = PREFIX_BYTES + REPEAT * TOKEN_BYTES;

function fromBase64Url(value) {
  const text = String(value ?? "").trim();
  if (!text || /[^A-Za-z0-9_-]/.test(text)) return null;
  const padding = "==".slice(0, (4 - (text.length % 4)) % 4);
  return Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/") + padding, "base64");
}

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Larger easiness means an easier target. */
function thresholdFromEasiness(easiness) {
  const e = Number(easiness) & 0xff;
  // >>> 0 because the shift can exceed 2^31 and JS bitwise ops are signed.
  return ((((e & 63) << 1) + 1) << (((e >> 6) * 7) + 3)) >>> 0;
}

/**
 * Parse the `X-Hashcash` challenge. Validates the same four things MEGA's own
 * parser does, so a malformed challenge is refused here rather than producing a
 * proof against nonsense.
 */
function parseHashcashChallenge(header) {
  const parts = String(header ?? "").trim().split(":");
  if (parts.length !== 4) return null;
  const version = Number(parts[0]);
  const easiness = Number(parts[1]);
  const token = parts[3];
  if (version !== 1) return null;
  if (!Number.isInteger(easiness) || easiness < 0 || easiness > 255) return null;
  if (token.length !== 64) return null;
  if (!fromBase64Url(token)) return null;
  return { version, easiness, timestamp: parts[2], token };
}

/** The 12MB message area, with the token tiled and the nonce left zeroed. */
function buildMessageBuffer(token) {
  const tokenBin = fromBase64Url(token);
  if (!tokenBin || tokenBin.length !== TOKEN_BYTES) return null;
  const buffer = Buffer.allocUnsafe(BUFFER_SIZE);
  buffer.fill(0, 0, PREFIX_BYTES);
  tokenBin.copy(buffer, PREFIX_BYTES);
  // Doubling copy, as the SDK does: 48 bytes becomes 96, 192, … far fewer calls
  // than 262,144 individual writes.
  let filled = TOKEN_BYTES;
  while (filled < REPEAT * TOKEN_BYTES) {
    const span = Math.min(filled, REPEAT * TOKEN_BYTES - filled);
    buffer.copy(buffer, PREFIX_BYTES + filled, PREFIX_BYTES, PREFIX_BYTES + span);
    filled += span;
  }
  return buffer;
}

/**
 * The offline verifier, mirroring MEGA's validateHashcash. Used by the tests, and
 * worth having in its own right: it is the only way to know a solver is correct
 * without asking MEGA.
 */
function verifyHashcash(token, easiness, prefixBase64) {
  const prefix = fromBase64Url(prefixBase64);
  if (!prefix || prefix.length !== PREFIX_BYTES) return false;
  const buffer = buildMessageBuffer(token);
  if (!buffer) return false;
  prefix.copy(buffer, 0);
  const digest = crypto.createHash("sha256").update(buffer).digest();
  return digest.readUInt32BE(0) <= thresholdFromEasiness(easiness);
}

/**
 * Search the nonce space for a proof.
 *
 * Single-threaded and therefore SLOW at realistic difficulties -- see the note at
 * the top. `budgetMs` bounds it so a caller cannot be blocked indefinitely, and
 * `startNonce`/`stride` exist so this can be driven by several workers over
 * disjoint slices of the space without changing anything here.
 *
 * Returns null on exhausting the budget, which is a real outcome rather than an
 * error: the caller has to decide between retrying and telling the user.
 */
function solveHashcash({ token, easiness, budgetMs = 60000, startNonce = 0, stride = 1 }) {
  const buffer = buildMessageBuffer(token);
  if (!buffer) return null;
  const threshold = thresholdFromEasiness(easiness);
  const deadline = Date.now() + Math.max(1, budgetMs);
  let attempts = 0;
  for (let nonce = startNonce >>> 0; ; nonce = (nonce + stride) >>> 0) {
    buffer.writeUInt32BE(nonce, 0);
    const digest = crypto.createHash("sha256").update(buffer).digest();
    attempts += 1;
    if (digest.readUInt32BE(0) <= threshold) {
      const prefix = Buffer.allocUnsafe(PREFIX_BYTES);
      prefix.writeUInt32BE(nonce, 0);
      return { prefix: toBase64Url(prefix), attempts };
    }
    // Checked every 32 hashes rather than every one: Date.now() is not free and a
    // 12MB hash already dwarfs it, but 32 keeps the overshoot under a second.
    if ((attempts & 31) === 0 && Date.now() > deadline) return null;
  }
}

/** The value for the retry's `X-Hashcash` request header. */
function formatHashcashHeader(token, prefixBase64) {
  return `1:${token}:${prefixBase64}`;
}

module.exports = {
  TOKEN_BYTES,
  PREFIX_BYTES,
  REPEAT,
  BUFFER_SIZE,
  thresholdFromEasiness,
  parseHashcashChallenge,
  buildMessageBuffer,
  verifyHashcash,
  solveHashcash,
  formatHashcashHeader,
  toBase64Url,
  fromBase64Url,
};
