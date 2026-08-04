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
})

describe('MEGA account crypto', () => {
  const account = require('../electron/downloads/hosts/megaAccount')

  const mpi = (value) => {
    let hex = value.toString(16)
    if (hex.length % 2) hex = `0${hex}`
    const body = Buffer.from(hex, 'hex')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(value.toString(2).length)
    return Buffer.concat([length, body])
  }

  it('parses MEGA\u2019s MPI sequence', () => {
    // 2-byte big-endian BIT length, then that many bits rounded up to bytes.
    const parsed = account.parseMpiSequence(Buffer.concat([mpi(65537n), mpi(255n)]), 2)
    expect(parsed).toEqual([65537n, 255n])
  })

  it('returns null on a truncated MPI rather than a short integer', () => {
    // A silently-wrong modulus produces a session id that looks like data and is
    // rejected by the server with no clue why.
    const length = Buffer.alloc(2)
    length.writeUInt16BE(2048)
    expect(account.parseMpiSequence(Buffer.concat([length, Buffer.alloc(8)]), 1)).toBeNull()
    expect(account.parseMpiSequence(Buffer.alloc(1), 1)).toBeNull()
  })

  it('does modular exponentiation', () => {
    expect(account.modPow(4n, 13n, 497n)).toBe(445n)
    expect(account.modPow(123n, 0n, 7n)).toBe(1n)
    expect(account.modPow(5n, 3n, 1n)).toBe(0n)
  })

  it('round-trips a session id through a real RSA key', async () => {
    // The whole point of the login: MEGA stores the private EXPONENT in privk, so
    // decryption is c^d mod (p*q) - one modPow, no PKCS#8 reconstruction and no
    // use for the CRT coefficient that privk also carries.
    const crypto = await import('node:crypto')
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = privateKey.export({ format: 'jwk' })
    const big = (b64) => BigInt(`0x${Buffer.from(b64, 'base64url').toString('hex')}`)
    const p = big(jwk.p); const q = big(jwk.q); const d = big(jwk.d); const n = big(jwk.n)
    expect(n).toBe(p * q)

    const sid = crypto.randomBytes(43)
    // The plaintext is the session id LEFT-aligned in a modulus-width buffer, so
    // its leading byte is sid[0] and the integer it forms must be a valid RSA
    // plaintext: strictly less than n, and with no leading zero byte for
    // decryptSessionId's leading-zero strip to eat.
    //
    // Random bytes satisfy neither. n's top byte is uniform-ish over [0x80,0xFF],
    // so a raw sid[0] exceeded it about a quarter of the time and the modPow
    // wrapped; sid[0] === 0 broke it a further 1-in-256. This test failed 2 runs
    // in 8 on a pristine tree and passed at the end of the last session by luck.
    // Clamping sid[0] into [1, nTop-1] makes the comparison decide on the first
    // byte alone, which is what makes it deterministic rather than merely likelier.
    const nTop = Number(n >> BigInt((n.toString(16).length / 2 - 1) * 8) & 0xffn)
    sid[0] = (sid[0] % (nTop - 1)) + 1
    const width = Math.ceil(n.toString(16).length / 2)
    const padded = Buffer.alloc(width)
    sid.copy(padded, 0)
    expect(BigInt(`0x${padded.toString('hex')}`) < n).toBe(true)
    const cipher = account.modPow(BigInt(`0x${padded.toString('hex')}`), big(jwk.e), n)

    expect(account.decryptSessionId(account.toBase64Url(mpi(cipher)), { d, n }))
      .toBe(account.toBase64Url(sid))
  })

  it('reads p, q and d back out of a privk-shaped buffer', async () => {
    const crypto = await import('node:crypto')
    const key = crypto.randomBytes(16)
    const p = 0xC5n; const q = 0xD7n; const d = 0x1234n
    const plain = Buffer.concat([mpi(p), mpi(q), mpi(d), mpi(1n)])
    // privk is AES-ECB wrapped under the master key and block aligned.
    const padded = Buffer.alloc(Math.ceil(plain.length / 16) * 16)
    plain.copy(padded)
    const wrapped = account.aesEcb(key, padded, 'encrypt')
    const parsed = account.decryptPrivateKey(account.toBase64Url(wrapped), key)
    expect(parsed).toMatchObject({ p, q, d })
    expect(parsed.n).toBe(p * q)
  })

  it('derives a stable v2 key and splits it 16/16', () => {
    // PBKDF2-SHA512, 100k iterations, 32 bytes: the first half unwraps the master
    // key, the second half is the proof sent to the server. Swapping them fails
    // with "wrong password" against a correct password.
    const first = account.deriveKeyV2('correct horse', 'c2FsdHlzYWx0')
    const second = account.deriveKeyV2('correct horse', 'c2FsdHlzYWx0')
    expect(first.derivedKey.length).toBe(16)
    expect(first.passwordHash.length).toBe(16)
    expect(first.derivedKey.equals(second.derivedKey)).toBe(true)
    expect(first.derivedKey.equals(first.passwordHash)).toBe(false)
    // A different password must not collide.
    expect(account.deriveKeyV2('other', 'c2FsdHlzYWx0').derivedKey.equals(first.derivedKey))
      .toBe(false)
  })

  it('rejects an unreadable salt instead of deriving from nothing', () => {
    expect(account.deriveKeyV2('pw', 'not base64!')).toBeNull()
    expect(account.deriveKeyV2('pw', '')).toBeNull()
  })

  it('derives a v1 key deterministically', () => {
    // Legacy accounts cannot be migrated from the client, so this path stays.
    const key = account.prepareKeyV1('hunter2')
    expect(key.length).toBe(16)
    expect(account.prepareKeyV1('hunter2').equals(key)).toBe(true)
    expect(account.prepareKeyV1('hunter3').equals(key)).toBe(false)
  })

  it('produces an 8-byte v1 password hash', () => {
    const key = account.prepareKeyV1('pw')
    const hash = account.stringHashV1('USER@example.com', key)
    expect(hash.length).toBe(8)
    // Email is lowercased before hashing, so case must not change the result.
    expect(account.stringHashV1('user@example.com', key).equals(hash)).toBe(true)
  })

  it('unwraps a master key of exactly one block', () => {
    const derived = Buffer.alloc(16, 7)
    const master = Buffer.alloc(16, 3)
    const wrapped = account.aesEcb(derived, master, 'encrypt')
    expect(account.decryptMasterKey(account.toBase64Url(wrapped), derived).equals(master)).toBe(true)
    // Anything not 16 bytes is not a wrapped master key.
    expect(account.decryptMasterKey(account.toBase64Url(Buffer.alloc(8)), derived)).toBeNull()
  })

  it('round-trips MEGA base64url, unpadded and url-safe', () => {
    const bytes = Buffer.from([251, 255, 190, 0, 1])
    const encoded = account.toBase64Url(bytes)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(account.fromBase64Url(encoded).equals(bytes)).toBe(true)
    expect(account.fromBase64Url('has spaces')).toBeNull()
  })
})

describe('mega plugin account surface', () => {
  it('asks for email, password and an optional two-factor code', () => {
    const keys = mega.credentialFields.map((f) => f.key)
    expect(keys).toEqual(['email', 'password', 'mfa'])
  })

  it('says the password is not stored, in the field help', () => {
    // The plugin returns replacement secrets so only the session is persisted;
    // the form has to say so, because a password field implies otherwise.
    const password = mega.credentialFields.find((f) => f.key === 'password')
    expect(password.help).toMatch(/never the password/i)
  })

  it('requires both an email and a password before calling MEGA', async () => {
    expect((await mega.validate({})).ok).toBe(false)
    expect((await mega.validate({ email: 'a@b.c' })).error).toMatch(/both required/i)
    expect((await mega.validate({ password: 'x' })).error).toMatch(/both required/i)
  })

  it('refuses a quota lookup with no session rather than calling anonymously', async () => {
    const result = await mega.getQuota({})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/sign in/i)
  })

  it('classifies the two-factor error codes as auth', () => {
    expect(mega.classifyError(null, { body: '-26' })).toBe('auth')
    expect(mega.classifyError(null, { body: '-27' })).toBe('auth')
  })
})

describe('describeHttpStatus', () => {
  it('names an unreadable proof-of-work challenge for a bare 402', () => {
    // A 402 is MEGA asking for proof of work. Reaching this message means the
    // challenge header was missing or unparseable, which is a different problem
    // from the work being too slow - and neither is a wrong password.
    const message = mega.describeHttpStatus(402, '')
    expect(message).toMatch(/402/)
    expect(message).toMatch(/proof-of-work challenge/i)
    expect(message).toMatch(/anonymous downloads are unaffected/i)
    expect(message).not.toMatch(/password/i)
  })

  it('distinguishes a proof of work that ran out of time', () => {
    // Retryable and CPU-bound, so it says so rather than reporting a refusal.
    const message = mega.describeHttpStatus(402, 'the proof of work did not finish in time')
    expect(message).toMatch(/did not finish in time/i)
    expect(message).toMatch(/trying again/i)
  })

  it('includes whatever MEGA said, when it said anything', () => {
    // The body used to be discarded, which is why a 402 arrived with no evidence.
    expect(mega.describeHttpStatus(402, '-15')).toMatch(/MEGA said: -15/)
    expect(mega.describeHttpStatus(500, 'try later')).toMatch(/MEGA said: try later/)
  })

  it('truncates nothing it was not given', () => {
    expect(mega.describeHttpStatus(500, '')).not.toMatch(/MEGA said/)
  })

  it('marks 5xx as worth retrying and 429 as rate limiting', () => {
    expect(mega.describeHttpStatus(503, '')).toMatch(/worth retrying/i)
    expect(mega.describeHttpStatus(429, '')).toMatch(/rate limiting/i)
  })
})

describe('the MAC is CBC, and identical to the per-block definition', () => {
  const crypto = require('crypto')
  const { cbcMacSpan, encryptBlock } = require('../electron/downloads/hosts/megaDecrypt')

  // MEGA defines the chunk MAC as `mac = E(K, mac XOR block)` iterated. Written
  // literally that allocates an OpenSSL cipher context per 16 bytes, which
  // measured 5 MB/s against 93 MB/s for the AES-CTR beside it - the integrity
  // check was capping MEGA downloads at ~10 MB/s on a gigabit line.
  //
  // Iterated `E(K, mac XOR block)` IS CBC, so the MAC is the last ciphertext
  // block of one CBC pass. This is the reference implementation of the literal
  // definition, kept solely to prove the fast path agrees with it: "these are the
  // same operation" is the whole basis for the change, so it is asserted rather
  // than reasoned about.
  const naiveMac = (key, startMac, data) => {
    let mac = Buffer.from(startMac)
    for (let i = 0; i < data.length; i += 16) {
      const working = Buffer.from(mac)
      for (let j = 0; j < 16; j += 1) working[j] ^= data[i + j]
      mac = encryptBlock(key, working)
    }
    return mac
  }

  it('agrees with the per-block loop on a single block', () => {
    const key = crypto.randomBytes(16)
    const mac = crypto.randomBytes(16)
    const data = crypto.randomBytes(16)
    expect(cbcMacSpan(key, mac, data).equals(naiveMac(key, mac, data))).toBe(true)
  })

  it('agrees across many blocks', () => {
    const key = crypto.randomBytes(16)
    const mac = crypto.randomBytes(16)
    for (const blocks of [2, 3, 17, 256, 1024]) {
      const data = crypto.randomBytes(blocks * 16)
      expect(cbcMacSpan(key, mac, data).equals(naiveMac(key, mac, data)))
        .toBe(true)
    }
  })

  it('agrees when a span is split, which is what arriving network chunks do', () => {
    // The stream feeds spans of whatever size the socket delivered, clipped to
    // chunk boundaries. Splitting a span must not change the result, or the MAC
    // would depend on network timing.
    const key = crypto.randomBytes(16)
    const start = crypto.randomBytes(16)
    const data = crypto.randomBytes(64 * 16)
    const whole = cbcMacSpan(key, start, data)
    let piecewise = start
    for (const cut of [[0, 16], [16, 400], [400, 640], [640, 1024]]) {
      piecewise = cbcMacSpan(key, piecewise, data.subarray(cut[0], cut[1]))
    }
    expect(piecewise.equals(whole)).toBe(true)
  })

  it('returns the running mac unchanged for an empty span', () => {
    const key = crypto.randomBytes(16)
    const mac = crypto.randomBytes(16)
    expect(cbcMacSpan(key, mac, Buffer.alloc(0)).equals(mac)).toBe(true)
  })

  it('produces the same meta-MAC as before for a multi-chunk file', async () => {
    // End to end: a file spanning several chunk boundaries must still verify,
    // which is the property the download depends on.
    const { createMegaDecryptStream } = require('../electron/downloads/hosts/megaDecrypt')
    const key = crypto.randomBytes(16)
    const nonce = crypto.randomBytes(8)
    // 900KB crosses the 128K, 256K and 384K chunks and lands inside the fourth.
    const plain = crypto.randomBytes(900 * 1024)
    const enc = crypto.createCipheriv('aes-128-ctr', key, Buffer.concat([nonce, Buffer.alloc(8)]))
    const cipher = Buffer.concat([enc.update(plain), enc.final()])

    const run = (stream) => new Promise((resolve, reject) => {
      const out = []
      stream.on('data', (d) => out.push(d))
      stream.on('end', () => resolve(Buffer.concat(out)))
      stream.on('error', reject)
      // Written in odd-sized pieces so spans do not align to chunk boundaries.
      let offset = 0
      while (offset < cipher.length) {
        const end = Math.min(offset + 7777, cipher.length)
        stream.write(cipher.subarray(offset, end))
        offset = end
      }
      stream.end()
    })

    const first = createMegaDecryptStream({ key, nonce })
    expect((await run(first)).equals(plain)).toBe(true)
    const mac = first.computedMac()

    const second = createMegaDecryptStream({ key, nonce, metaMac: mac })
    await run(second)
    expect(second.verify()).toBe(true)
  })
})
