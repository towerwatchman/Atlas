import { describe, it, expect } from 'vitest'
import crypto from 'crypto'

const link = require('../electron/downloads/hosts/megaLink')
const { createMegaDecryptStream, condenseMac } = require('../electron/downloads/hosts/megaDecrypt')
const mega = require('../electron/downloads/hosts/mega')

// ── MEGA ─────────────────────────────────────────────────────────────────────
//
// The key-derivation and attribute vectors below were confirmed against a real
// mega.nz link before any of this was written, then regenerated SYNTHETICALLY for
// the suite: committing the real key would publish a working download link for
// somebody's file in git history forever.
//
// What is NOT covered here is the bulk transfer against MEGA's servers, which no
// test in this repo can reach. The round-trip tests prove the implementation is
// self-consistent; they cannot prove it matches MEGA's spec. Only a real download
// does that.

// Built from a known key so the expectations are derivable rather than magic.
const KEY_HALVES = Buffer.from('00112233445566778899aabbccddeeff' + 'f0e1d2c3b4a5968778695a4b3c2d1e0f', 'hex')
const FILE_KEY_B64 = KEY_HALVES.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('parseMegaLink', () => {
  it('reads the current /file/ form', () => {
    expect(link.parseMegaLink(`https://mega.nz/file/AbCd1234#${FILE_KEY_B64}`))
      .toEqual({ kind: 'file', id: 'AbCd1234', keyBase64: FILE_KEY_B64 })
  })

  it('reads the legacy #! form still posted in old threads', () => {
    const parsed = link.parseMegaLink(`https://mega.nz/#!AbCd1234!${FILE_KEY_B64}`)
    expect(parsed).toMatchObject({ kind: 'file', id: 'AbCd1234' })
  })

  it('accepts mega.co.nz as well as mega.nz', () => {
    expect(link.parseMegaLink(`https://mega.co.nz/file/AbCd1234#${FILE_KEY_B64}`)?.kind).toBe('file')
  })

  it('reports a folder link as a folder rather than failing to parse', () => {
    // So the plugin can say "not supported yet" instead of "malformed link".
    expect(link.parseMegaLink('https://mega.nz/folder/AbCd1234#somekey')?.kind).toBe('folder')
    expect(link.parseMegaLink('https://mega.nz/#F!AbCd1234!somekey')?.kind).toBe('folder')
  })

  it('rejects a link with no key at all', () => {
    expect(link.parseMegaLink('https://mega.nz/file/AbCd1234')).toBeNull()
    expect(link.parseMegaLink('https://example.com/file/x#y')).toBeNull()
    expect(link.parseMegaLink('')).toBeNull()
  })
})

describe('base64UrlToBuffer', () => {
  it('pads a 43-character fragment to exactly 32 bytes', () => {
    // A real file key is 43 chars and needs one '='. Getting the padding wrong
    // truncates the last byte, which is a corrupt download with no error.
    const fortyThree = 'n6gPfr4aERckcOlwi3pZP9iDoX_2wLzM2v5TOH3Myoc'
    expect(fortyThree.length).toBe(43)
    expect(link.base64UrlToBuffer(fortyThree).length).toBe(32)
  })

  it('translates the url-safe alphabet', () => {
    expect(link.base64UrlToBuffer('-_')).not.toBeNull()
    expect(link.base64UrlToBuffer('a+b/c')).toBeNull()
  })

  it('rejects non-base64 input', () => {
    expect(link.base64UrlToBuffer('has spaces')).toBeNull()
    expect(link.base64UrlToBuffer(null)).toBeNull()
  })
})

describe('deriveFileKey', () => {
  it('XORs the two halves into the AES key', () => {
    const material = link.deriveFileKey(FILE_KEY_B64)
    const expected = Buffer.alloc(16)
    for (let i = 0; i < 16; i += 1) expected[i] = KEY_HALVES[i] ^ KEY_HALVES[i + 16]
    expect(material.key.equals(expected)).toBe(true)
  })

  it('splits the nonce and meta-MAC out of the second half', () => {
    const material = link.deriveFileKey(FILE_KEY_B64)
    expect(material.nonce.equals(KEY_HALVES.subarray(16, 24))).toBe(true)
    expect(material.metaMac.equals(KEY_HALVES.subarray(24, 32))).toBe(true)
  })

  it('starts the CTR counter at the nonce with a zero block counter', () => {
    const material = link.deriveFileKey(FILE_KEY_B64)
    expect(material.ctrIv.length).toBe(16)
    expect(material.ctrIv.subarray(8).equals(Buffer.alloc(8))).toBe(true)
  })

  it('refuses anything that is not 32 bytes', () => {
    // A folder key is a different length; deriving from one would produce a
    // plausible-looking key that decrypts to noise.
    expect(link.deriveFileKey('c2hvcnQ')).toBeNull()
    expect(link.deriveFileKey('')).toBeNull()
    expect(link.deriveFileKey(null)).toBeNull()
  })
})

describe('decryptAttributes', () => {
  const key = link.deriveFileKey(FILE_KEY_B64).key

  const encryptAttributes = (text) => {
    const padded = Buffer.alloc(Math.ceil((4 + text.length) / 16) * 16)
    Buffer.from(`MEGA${text}`).copy(padded)
    const cipher = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16))
    cipher.setAutoPadding(false)
    const out = Buffer.concat([cipher.update(padded), cipher.final()])
    return out.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  it('reads the filename out of the MEGA envelope', () => {
    const at = encryptAttributes('{"n":"Game-1.2-pc.zip"}')
    expect(link.decryptAttributes(at, key)).toEqual({ n: 'Game-1.2-pc.zip' })
  })

  it('returns null when the key is wrong', () => {
    // The MEGA prefix only appears with the right key, so its absence means the
    // link does not belong to this file - not that the response was corrupt.
    const at = encryptAttributes('{"n":"x"}')
    expect(link.decryptAttributes(at, crypto.randomBytes(16))).toBeNull()
  })

  it('returns null for a body that is not a whole number of blocks', () => {
    expect(link.decryptAttributes('AAAA', key)).toBeNull()
  })
})

describe('fileNameFromAttributes', () => {
  it('cannot produce a path or a dotfile from a remote filename', () => {
    // This value is joined onto the downloads directory, so a name MEGA supplies
    // must not be able to escape it. Separators become underscores and leading
    // dots go, which also stops a download becoming a hidden file.
    const traversal = link.fileNameFromAttributes({ n: '../../etc/passwd' })
    expect(traversal).toBe('_.._etc_passwd')
    expect(traversal).not.toMatch(/[\\/]/)
    expect(traversal.startsWith('.')).toBe(false)
    expect(link.fileNameFromAttributes({ n: 'a\\b/c.zip' })).toBe('a_b_c.zip')
    expect(link.fileNameFromAttributes({ n: '.hidden' })).toBe('hidden')
  })

  it('returns an empty string when there is no name', () => {
    expect(link.fileNameFromAttributes({})).toBe('')
    expect(link.fileNameFromAttributes(null)).toBe('')
  })
})

describe('chunk progression', () => {
  it('grows 128KB at a time and caps at 1MB', () => {
    expect(link.chunkSizeAt(0)).toBe(128 * 1024)
    expect(link.chunkSizeAt(1)).toBe(256 * 1024)
    expect(link.chunkSizeAt(7)).toBe(1024 * 1024)
    expect(link.chunkSizeAt(8)).toBe(1024 * 1024)
    expect(link.chunkSizeAt(500)).toBe(1024 * 1024)
  })

  it('covers the whole file exactly once', () => {
    const size = 5 * 1024 * 1024 + 12345
    const offsets = link.chunkBoundaries(size)
    expect(offsets[0]).toBe(0)
    expect(offsets[offsets.length - 1]).toBeLessThan(size)
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i] - offsets[i - 1]).toBe(link.chunkSizeAt(i - 1))
    }
  })

  it('has no chunks for an empty file', () => {
    expect(link.chunkBoundaries(0)).toEqual([])
    expect(link.chunkBoundaries(-1)).toEqual([])
  })
})

describe('MegaDecryptStream', () => {
  const key = crypto.randomBytes(16)
  const nonce = crypto.randomBytes(8)

  const encrypt = (plain) => {
    const cipher = crypto.createCipheriv('aes-128-ctr', key, Buffer.concat([nonce, Buffer.alloc(8)]))
    return Buffer.concat([cipher.update(plain), cipher.final()])
  }
  const run = (stream, cipher) => new Promise((resolve, reject) => {
    const out = []
    stream.on('data', (d) => out.push(d))
    stream.on('end', () => resolve(Buffer.concat(out)))
    stream.on('error', reject)
    stream.end(cipher)
  })

  it('round-trips plaintext across a chunk boundary', async () => {
    // 300KB spans the 128KB first chunk and part of the 256KB second, so the
    // chunk-rollover path is exercised rather than just one chunk.
    const plain = crypto.randomBytes(300 * 1024)
    const stream = createMegaDecryptStream({ key, nonce })
    expect((await run(stream, encrypt(plain))).equals(plain)).toBe(true)
  })

  it('round-trips a file smaller than one block', async () => {
    const plain = Buffer.from('tiny')
    const stream = createMegaDecryptStream({ key, nonce })
    expect((await run(stream, encrypt(plain))).equals(plain)).toBe(true)
  })

  it('verifies its own MAC', async () => {
    const plain = crypto.randomBytes(200 * 1024)
    const first = createMegaDecryptStream({ key, nonce })
    await run(first, encrypt(plain))
    const mac = first.computedMac()
    expect(mac.length).toBe(8)

    const second = createMegaDecryptStream({ key, nonce, metaMac: mac })
    await run(second, encrypt(plain))
    expect(second.verify()).toBe(true)
  })

  it('rejects a MAC that does not match', async () => {
    const plain = crypto.randomBytes(64 * 1024)
    const stream = createMegaDecryptStream({ key, nonce, metaMac: Buffer.alloc(8) })
    await run(stream, encrypt(plain))
    expect(stream.verify()).toBe(false)
  })

  it('reports null rather than false when the MAC was never computed', async () => {
    // A resumed transfer only sees part of the file, and the MAC is sequential.
    // "not verified" and "failed verification" need different messages, so they
    // must not collapse into one boolean.
    const plain = crypto.randomBytes(64 * 1024)
    const stream = createMegaDecryptStream({ key, nonce, metaMac: Buffer.alloc(8), startOffset: 16 })
    await run(stream, encrypt(plain))
    expect(stream.verify()).toBeNull()
    expect(stream.computedMac()).toBeNull()
  })

  it('decrypts correctly from a resume offset', async () => {
    // AES-CTR is seekable: byte N depends only on block N/16, so a resumed
    // transfer must decrypt to the same plaintext from that point on.
    const plain = crypto.randomBytes(80 * 1024)
    const cipher = encrypt(plain)
    const offset = 32 * 1024
    const stream = createMegaDecryptStream({ key, nonce, startOffset: offset })
    const got = await run(stream, cipher.subarray(offset))
    expect(got.equals(plain.subarray(offset))).toBe(true)
  })

  it('refuses a resume offset that is not block aligned', () => {
    // The alternative is a file of noise that passes every length check.
    expect(() => createMegaDecryptStream({ key, nonce, startOffset: 5 }))
      .toThrow(/multiple of 16/)
  })

  it('rejects a malformed key or nonce', () => {
    expect(() => createMegaDecryptStream({ key: Buffer.alloc(8), nonce })).toThrow(/16 bytes/)
    expect(() => createMegaDecryptStream({ key, nonce: Buffer.alloc(4) })).toThrow(/8 bytes/)
  })
})

describe('mega plugin', () => {
  it('claims mega links and nothing else', () => {
    expect(mega.matches(`https://mega.nz/file/AbCd#${FILE_KEY_B64}`)).toBe(true)
    expect(mega.matches('https://pixeldrain.com/u/abc')).toBe(false)
  })

  it('supports anonymous downloads', () => {
    expect(mega.supportsAnonymous).toBe(true)
  })

  it('presents as the host label the mirror gate matches on', () => {
    // The gate uses the first label of the hostname, so mega.nz and mega.co.nz
    // both arrive as "mega".
    expect(mega.hostAliases).toContain('mega')
  })

  it('refuses a folder link as unsupported, not as malformed', async () => {
    const result = await mega.probe('https://mega.nz/folder/AbCd1234#key')
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('fatal')
    expect(result.error).toMatch(/folder link/i)
  })

  it('refuses a truncated key before making a request', async () => {
    const result = await mega.probe('https://mega.nz/file/AbCd1234#short')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/truncated|not a file key/i)
  })

  it('classifies MEGA\u2019s numeric error codes', () => {
    // MEGA reports failure as a bare negative number, not an object.
    expect(mega.classifyError(null, { body: '-17' })).toBe('quota')
    expect(mega.classifyError(null, { body: '-9' })).toBe('fatal')
    expect(mega.classifyError(null, { body: '-3' })).toBe('transient')
    expect(mega.classifyError(null, { body: '-15' })).toBe('auth')
  })

  it('says accounts are not supported yet rather than accepting details', async () => {
    const result = await mega.validate({ email: 'a@b.c', password: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not sign in/i)
  })
})
