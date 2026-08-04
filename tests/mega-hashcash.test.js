import { describe, it, expect } from 'vitest'

const hashcash = require('../electron/downloads/hosts/megaHashcash')

// MEGA gates its ACCOUNT commands behind a proof of work and answers an ungated
// login with HTTP 402 plus an X-Hashcash challenge. Anonymous public-link
// downloads are not gated, which is the asymmetry that surfaced it: a:"g"
// succeeded while a:"us" returned 402 with an empty body.
//
// Every constant below is transcribed from MEGA's own SDK (src/hashcash.cpp,
// src/posix/net.cpp) rather than inferred, and the values are asserted against
// that source: a wrong one produces a proof MEGA silently rejects, which is
// indistinguishable from a wrong password.

// MEGA's own example, from the comment in net.cpp.
const EXAMPLE = '1:100:1731410499:RUvIePV2PNO8ofg8xp1aT5ugBcKSEzwKoLBw9o4E6F_fmn44eC3oMpv388UtFl2K'
const TOKEN = EXAMPLE.split(':')[3]

describe('thresholdFromEasiness', () => {
  it('matches the SDK formula', () => {
    // (((e & 63) << 1) + 1) << ((e >> 6) * 7 + 3)
    expect(hashcash.thresholdFromEasiness(100)).toBe(74752)
    expect(hashcash.thresholdFromEasiness(0)).toBe(8)
    expect(hashcash.thresholdFromEasiness(255)).toBe(2130706432)
  })

  it('stays an unsigned 32-bit value', () => {
    // The shift can pass 2^31, and JS bitwise operators are signed - without the
    // >>> 0 the threshold goes negative and nothing ever passes.
    for (let e = 0; e <= 255; e += 1) {
      const threshold = hashcash.thresholdFromEasiness(e)
      expect(threshold).toBeGreaterThan(0)
      expect(threshold).toBeLessThanOrEqual(0xFFFFFFFF)
    }
  })

  it('is easier at higher values, which is what "easiness" means', () => {
    expect(hashcash.thresholdFromEasiness(200)).toBeGreaterThan(hashcash.thresholdFromEasiness(100))
  })
})

describe('parseHashcashChallenge', () => {
  it('reads MEGA\u2019s documented example', () => {
    expect(hashcash.parseHashcashChallenge(EXAMPLE)).toEqual({
      version: 1, easiness: 100, timestamp: '1731410499', token: TOKEN,
    })
  })

  it('refuses what the SDK refuses', () => {
    // Same four checks MEGA's parser makes.
    expect(hashcash.parseHashcashChallenge(`2:100:1:${TOKEN}`)).toBeNull()
    expect(hashcash.parseHashcashChallenge(`1:256:1:${TOKEN}`)).toBeNull()
    expect(hashcash.parseHashcashChallenge(`1:-1:1:${TOKEN}`)).toBeNull()
    expect(hashcash.parseHashcashChallenge('1:100:1:tooshort')).toBeNull()
    expect(hashcash.parseHashcashChallenge(`1:100:${TOKEN}`)).toBeNull()
    expect(hashcash.parseHashcashChallenge('')).toBeNull()
    expect(hashcash.parseHashcashChallenge(null)).toBeNull()
  })
})

describe('the message area', () => {
  it('is 12MB plus the nonce', () => {
    expect(hashcash.TOKEN_BYTES).toBe(48)
    expect(hashcash.REPEAT).toBe(262144)
    expect(hashcash.BUFFER_SIZE).toBe(4 + 262144 * 48)
    expect(hashcash.BUFFER_SIZE).toBe(12582916)
  })

  it('tiles the token across the whole area', () => {
    const buffer = hashcash.buildMessageBuffer(TOKEN)
    expect(buffer.length).toBe(hashcash.BUFFER_SIZE)
    const first = buffer.subarray(4, 52)
    // Spot-check the start, a middle repetition, and the last one.
    expect(buffer.subarray(52, 100).equals(first)).toBe(true)
    expect(buffer.subarray(4 + 48 * 1000, 4 + 48 * 1001).equals(first)).toBe(true)
    expect(buffer.subarray(hashcash.BUFFER_SIZE - 48).equals(first)).toBe(true)
    // The nonce area starts zeroed.
    expect(buffer.readUInt32BE(0)).toBe(0)
  })

  it('refuses a token that is not 48 bytes', () => {
    expect(hashcash.buildMessageBuffer('abcd')).toBeNull()
    expect(hashcash.buildMessageBuffer('not base64!')).toBeNull()
  })
})

describe('solve and verify', () => {
  // Easiness 255 so this costs a couple of hashes rather than the ~700GB that
  // MEGA's real difficulty of 100 implies.
  it('finds a proof its own verifier accepts', () => {
    const solved = hashcash.solveHashcash({ token: TOKEN, easiness: 255, budgetMs: 20000 })
    expect(solved).not.toBeNull()
    expect(hashcash.verifyHashcash(TOKEN, 255, solved.prefix)).toBe(true)
  })

  it('rejects a proof for a different difficulty', () => {
    const solved = hashcash.solveHashcash({ token: TOKEN, easiness: 255, budgetMs: 20000 })
    // A prefix good enough for easiness 255 is almost certainly not good enough
    // for 0, whose threshold is 8 in 2^32.
    expect(hashcash.verifyHashcash(TOKEN, 0, solved.prefix)).toBe(false)
  })

  it('rejects a malformed prefix rather than throwing', () => {
    expect(hashcash.verifyHashcash(TOKEN, 255, 'AAA')).toBe(false)
    expect(hashcash.verifyHashcash(TOKEN, 255, 'not base64!')).toBe(false)
    expect(hashcash.verifyHashcash('short', 255, 'AAAAAQ')).toBe(false)
  })

  it('returns null when the budget runs out, rather than hanging', () => {
    // Exhausting the budget is a real outcome: the caller has to choose between
    // retrying and telling the user, and a solver that blocks forever removes
    // that choice.
    expect(hashcash.solveHashcash({ token: TOKEN, easiness: 0, budgetMs: 1 })).toBeNull()
  })

  it('honours a stride, so the space can be split across workers', () => {
    const solved = hashcash.solveHashcash({
      token: TOKEN, easiness: 255, budgetMs: 20000, startNonce: 1, stride: 4,
    })
    expect(solved).not.toBeNull()
    const nonce = Buffer.from(
      solved.prefix.replace(/-/g, '+').replace(/_/g, '/') + '==', 'base64',
    ).readUInt32BE(0)
    expect(nonce % 4).toBe(1)
    expect(hashcash.verifyHashcash(TOKEN, 255, solved.prefix)).toBe(true)
  })
})

describe('formatHashcashHeader', () => {
  it('builds the retry header the SDK sends', () => {
    // X-Hashcash: 1:<b64token>:<b64prefix> - note the TOKEN goes back, not the
    // easiness or the timestamp.
    expect(hashcash.formatHashcashHeader(TOKEN, 'AAAAAQ')).toBe(`1:${TOKEN}:AAAAAQ`)
  })
})
