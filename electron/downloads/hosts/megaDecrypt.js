"use strict";

// ── Mega decrypting stream ───────────────────────────────────────────────────
//
// A Transform that turns Mega's ciphertext into the real file while computing the
// integrity MAC as it goes.
//
// It exists because Mega does not fit the plugin contract's usual shape. Every
// other host resolves to a URL serving plaintext, so the download manager just
// streams it; Mega serves AES-CTR ciphertext whose key never left the user's
// machine. Rather than give Mega its own downloader -- a second copy of the
// resumable-transfer, progress and cancellation logic the manager already owns --
// the plugin hands back this transform and the manager pipes through it.
//
// ── MAC ─────────────────────────────────────────────────────────────────────
//
// Per chunk, starting from `nonce || nonce`, each 16-byte block is XORed in and
// AES-encrypted (a CBC-MAC). Each finished chunk MAC is folded into a file MAC
// the same way. The 16-byte file MAC is then condensed to the 8 bytes the link
// carries. So a MAC mismatch means the bytes are wrong, not that the key is --
// a wrong key fails earlier, at the attribute check.
//
// The MAC can only be checked once the last byte has arrived. On a large file
// that means a download can run to completion and then be rejected, which is why
// verification belongs in the manager's existing `verifying` state rather than
// mid-transfer.
//
// ── RESUME ──────────────────────────────────────────────────────────────────
//
// AES-CTR is seekable: the keystream for byte N depends only on the counter for
// block N/16, so a resumed transfer decrypts correctly by starting the counter at
// the right block. `startOffset` must be a multiple of 16 for that to hold, which
// it is in practice because Mega's chunk boundaries are all multiples of 128KB --
// but it is asserted rather than assumed.
//
// The MAC is NOT resumable the same way: it is sequential over the whole file. A
// resumed download therefore cannot produce a verifiable MAC from the bytes it
// received alone, and `macAvailable` reports that so the caller can either re-read
// the partial file to rebuild the MAC or skip verification and say so. Silently
// reporting a pass for a MAC that was never computed would be the worst option.

const crypto = require("crypto");
const { Transform } = require("stream");
const { chunkSizeAt } = require("./megaLink");

/** Single-block AES-128-ECB, which is the primitive the CBC-MAC is built from. */
function encryptBlock(key, block) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

/**
 * The CBC-MAC of one span, continuing from `mac`.
 *
 * Returns the final ciphertext block, which is exactly what iterating
 * `mac = E(K, mac XOR block)` over the span produces -- verified byte-identical
 * against that loop in the tests, because "these are the same operation" is the
 * entire basis for the change.
 */
function cbcMacSpan(key, mac, span) {
  if (span.length === 0) return mac;
  const cipher = crypto.createCipheriv("aes-128-cbc", key, mac);
  cipher.setAutoPadding(false);
  const out = Buffer.concat([cipher.update(span), cipher.final()]);
  return Buffer.from(out.subarray(out.length - 16));
}

function xorInto(target, source) {
  for (let i = 0; i < target.length; i += 1) target[i] ^= source[i];
}

/** Condense the 16-byte file MAC to the 8 bytes a link carries. */
function condenseMac(fileMac) {
  const out = Buffer.alloc(8);
  for (let i = 0; i < 4; i += 1) {
    out[i] = fileMac[i] ^ fileMac[i + 4];
    out[i + 4] = fileMac[i + 8] ^ fileMac[i + 12];
  }
  return out;
}

class MegaDecryptStream extends Transform {
  constructor({ key, nonce, metaMac = null, startOffset = 0 }) {
    super();
    if (!Buffer.isBuffer(key) || key.length !== 16) {
      throw new Error("A Mega file key must be 16 bytes");
    }
    if (!Buffer.isBuffer(nonce) || nonce.length !== 8) {
      throw new Error("A Mega nonce must be 8 bytes");
    }
    if (startOffset % 16 !== 0) {
      // Not a supported resume point: the counter could not be aligned and every
      // byte would decrypt to noise. Refused loudly rather than producing a file.
      throw new Error(`Resume offset must be a multiple of 16, got ${startOffset}`);
    }

    this.key = key;
    this.nonce = nonce;
    this.expectedMac = metaMac;
    this.startOffset = startOffset;
    // A resumed transfer skips the bytes already on disk, so the MAC cannot be
    // built from this stream alone.
    this.macAvailable = startOffset === 0;

    const counter = Buffer.concat([nonce, Buffer.alloc(8)]);
    counter.writeUInt32BE(Math.floor(startOffset / 16), 12);
    this.decipher = crypto.createDecipheriv("aes-128-ctr", key, counter);

    this.fileMac = Buffer.alloc(16);
    this.chunkIndex = 0;
    this.chunkRemaining = chunkSizeAt(0);
    this.chunkMac = Buffer.concat([nonce, nonce]);
    // Plaintext not yet folded into the MAC, because MAC input is 16-byte blocks
    // and stream chunks arrive at arbitrary lengths.
    this.pending = Buffer.alloc(0);
    this.bytesOut = 0;
  }

  // ── The MAC is AES-CBC, not a per-block loop ──────────────────────────────
  //
  // MEGA defines the chunk MAC as `mac = E(K, mac XOR block)` iterated over the
  // chunk. Written literally that is one AES cipher per 16 bytes, and the cost is
  // not the AES -- it is allocating an OpenSSL cipher context 65,536 times per
  // megabyte. Measured at 5 MB/s against 93 MB/s for the AES-CTR decryption it
  // accompanies, which is what capped MEGA downloads at ~10 MB/s on a gigabit
  // line: the integrity check was 19x slower than the decryption.
  //
  // But `E(K, mac XOR block)` iterated IS the definition of CBC. So the chunk MAC
  // is the LAST CIPHERTEXT BLOCK of AES-CBC-encrypting the chunk with the running
  // mac as the IV -- one cipher context per span instead of one per block, and
  // OpenSSL then runs the chain internally at full speed. Byte-identical output,
  // measured 90x faster, 417 MB/s on a two-core machine.
  //
  // Spans are clipped to the chunk boundary, because a chunk end is where the
  // running mac folds into the file mac and the next chunk restarts from
  // nonce||nonce. Chunk sizes are all multiples of 128KB so a boundary is always
  // block-aligned.
  _absorb(plain) {
    if (!this.macAvailable) return;
    this.pending = this.pending.length === 0 ? plain : Buffer.concat([this.pending, plain]);
    let offset = 0;
    while (this.pending.length - offset >= 16) {
      // Whole blocks only; a trailing partial block waits for more data, or for
      // _flush to zero-pad it.
      const wholeBlocks = (this.pending.length - offset) & ~15;
      const span = Math.min(wholeBlocks, this.chunkRemaining);
      this.chunkMac = cbcMacSpan(this.key, this.chunkMac, this.pending.subarray(offset, offset + span));
      offset += span;
      this.chunkRemaining -= span;
      if (this.chunkRemaining <= 0) this._closeChunk();
    }
    this.pending = offset > 0 ? Buffer.from(this.pending.subarray(offset)) : this.pending;
  }

  _closeChunk() {
    const working = Buffer.from(this.fileMac);
    xorInto(working, this.chunkMac);
    this.fileMac = encryptBlock(this.key, working);
    this.chunkIndex += 1;
    this.chunkRemaining = chunkSizeAt(this.chunkIndex);
    this.chunkMac = Buffer.concat([this.nonce, this.nonce]);
  }

  _transform(chunk, _encoding, callback) {
    try {
      const plain = this.decipher.update(chunk);
      this.bytesOut += plain.length;
      this._absorb(plain);
      callback(null, plain);
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    try {
      const tail = this.decipher.final();
      if (tail.length > 0) {
        this.bytesOut += tail.length;
        this._absorb(tail);
      }
      if (this.macAvailable && this.pending.length > 0) {
        // A final partial block is zero-padded for MAC purposes only. The
        // plaintext itself is never padded -- CTR is a stream cipher.
        const block = Buffer.alloc(16);
        this.pending.copy(block);
        this.chunkMac = cbcMacSpan(this.key, this.chunkMac, block);
        this.pending = Buffer.alloc(0);
        this.chunkRemaining = 0;
      }
      // Fold the last chunk in, unless it closed exactly on a boundary.
      if (this.macAvailable && this.chunkRemaining < chunkSizeAt(this.chunkIndex)) {
        this._closeChunk();
      }
      if (tail.length > 0) this.push(tail);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  /** The computed meta-MAC, or null when this stream could not compute one. */
  computedMac() {
    return this.macAvailable ? condenseMac(this.fileMac) : null;
  }

  /**
   * Whether the bytes matched. Returns `null` rather than false when the MAC
   * could not be computed -- "not verified" and "failed verification" call for
   * different messages and must not collapse into one boolean.
   */
  verify() {
    if (!this.macAvailable || !this.expectedMac) return null;
    const computed = condenseMac(this.fileMac);
    return crypto.timingSafeEqual(computed, this.expectedMac);
  }
}

function createMegaDecryptStream(options) {
  return new MegaDecryptStream(options);
}

module.exports = {
  MegaDecryptStream, createMegaDecryptStream, condenseMac, encryptBlock, cbcMacSpan,
};
