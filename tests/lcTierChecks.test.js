import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest'

// ── lcTierChecks module tests ──────────────────────────────────────────────
//
// xenforoAuth and forumWindowFetch are stubbed via Module._load — same
// technique as the Cloudflare window fallback tests.

const Module = require('module')

// Capture the real loader once so re-installations never recurse into a
// patched version.
const realLoad = Module._load

let restoreLoad = null

function installStubs(overrides = {}) {
  Module._load = function patched(request, parent, isMain) {
    const req = String(request)
    if (req.endsWith('xenforoAuth')) {
      return {
        scrapeLcTierFromProfile: overrides.scrapeLcTierFromProfile || vi.fn(),
        probeLcTierFromThread: overrides.probeLcTierFromThread || vi.fn(),
        cookieHeaderFromArray: overrides.cookieHeaderFromArray || vi.fn(),
        SITES: overrides.SITES || { lewdcorner: { base: 'https://lewdcorner.com', domain: 'lewdcorner.com' } },
      }
    }
    if (req.endsWith('downloads/forumWindowFetch')) {
      return {
        isAvailable: overrides.isAvailable || vi.fn(() => true),
        fetchUrlViaWindow: overrides.fetchUrlViaWindow || vi.fn(),
      }
    }
    return realLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => { Module._load = realLoad }
}

function freshModule() {
  delete require.cache[require.resolve('../electron/accounts/lcTierChecks.js')]
  return require('../electron/accounts/lcTierChecks.js')
}

// ── parseHomepageBanner (pure, no mocks) ────────────────────────────────────

describe('parseHomepageBanner', () => {
  const { parseHomepageBanner } = freshModule()

  test('returns VIP when data-state="owned" is present', () => {
    expect(parseHomepageBanner('<section class="jblcMemberGuide" data-state="owned">')).toBe('VIP')
  })

  test('returns Free when data-state="progress" is present', () => {
    expect(parseHomepageBanner('<section class="jblcMemberGuide" data-state="progress">')).toBe('Free')
  })

  test('returns null when jblcMemberGuide section is absent', () => {
    expect(parseHomepageBanner('<section class="other">')).toBeNull()
  })

  test('returns null when section exists but has no data-state attribute', () => {
    expect(parseHomepageBanner('<section class="jblcMemberGuide">')).toBeNull()
  })

  test('returns null for empty, null, or undefined input', () => {
    expect(parseHomepageBanner('')).toBeNull()
    expect(parseHomepageBanner(null)).toBeNull()
    expect(parseHomepageBanner(undefined)).toBeNull()
  })

  test('handles attribute order variations', () => {
    expect(parseHomepageBanner('<section class="jblcMemberGuide" data-state="owned">')).toBe('VIP')
    expect(parseHomepageBanner('<section data-state="owned" class="jblcMemberGuide">')).toBe('VIP')
  })
})

// ── checkLcTier pipeline (stub individual checks) ───────────────────────────

describe('checkLcTier pipeline', () => {
  afterEach(() => {
    if (restoreLoad) { restoreLoad(); restoreLoad = null }
    vi.restoreAllMocks()
    vi.resetModules()
  })

  test('first definitive verdict wins: homepage VIP, rank-card and thread-probe never called', () => {
    const rankCard = vi.fn(async () => 'Free')
    const threadProbe = vi.fn(async () => 'VIP')
    const homepageFetch = vi.fn(async () => '<section class="jblcMemberGuide" data-state="owned">')
    installStubs({
      scrapeLcTierFromProfile: rankCard,
      probeLcTierFromThread: threadProbe,
      fetchUrlViaWindow: homepageFetch,
      cookieHeaderFromArray: vi.fn(() => 'xf_user=1'),
    })
    const { checkLcTier } = freshModule()

    const result = checkLcTier({ cookies: [] })
    return result.then((res) => {
      expect(res).toEqual({ tier: 'VIP', source: 'homepage' })
      expect(rankCard).not.toHaveBeenCalled()
      expect(threadProbe).not.toHaveBeenCalled()
    })
  })

  test('falls through to rank-card when homepage returns null', () => {
    const rankCard = vi.fn(async () => 'VIP')
    const threadProbe = vi.fn(async () => 'VIP')
    installStubs({ scrapeLcTierFromProfile: rankCard, probeLcTierFromThread: threadProbe })
    const { checkLcTier } = freshModule()

    const result = checkLcTier({ cookies: [] })
    return result.then((res) => {
      expect(res).toEqual({ tier: 'VIP', source: 'rank-card' })
      expect(rankCard).toHaveBeenCalled()
      expect(threadProbe).not.toHaveBeenCalled()
    })
  })

  test('falls through to thread-probe when both homepage and rank-card return null', () => {
    const rankCard = vi.fn(async () => null)
    const threadProbe = vi.fn(async () => 'VIP')
    installStubs({ scrapeLcTierFromProfile: rankCard, probeLcTierFromThread: threadProbe })
    const { checkLcTier } = freshModule()

    const result = checkLcTier({ cookies: [] })
    return result.then((res) => {
      expect(res).toEqual({ tier: 'VIP', source: 'thread-probe' })
      expect(threadProbe).toHaveBeenCalled()
    })
  })

  test('returns { tier: null, source: null } when all checks return null', () => {
    installStubs({
      scrapeLcTierFromProfile: vi.fn(async () => null),
      probeLcTierFromThread: vi.fn(async () => null),
    })
    const { checkLcTier } = freshModule()

    const result = checkLcTier({ cookies: [] })
    return result.then((res) => {
      expect(res).toEqual({ tier: null, source: null })
    })
  })

  test('a check that throws is treated as null (pipeline continues)', () => {
    const threadProbe = vi.fn(async () => 'VIP')
    installStubs({
      scrapeLcTierFromProfile: vi.fn(async () => { throw new Error('boom') }),
      probeLcTierFromThread: threadProbe,
    })
    const { checkLcTier } = freshModule()

    const result = checkLcTier({ cookies: [] })
    return result.then((res) => {
      expect(res).toEqual({ tier: 'VIP', source: 'thread-probe' })
      expect(threadProbe).toHaveBeenCalled()
    })
  })
})

// ── checkHomepageBanner (stub window fetch + parse) ────────────────────────

describe('checkHomepageBanner', () => {
  afterEach(() => {
    if (restoreLoad) { restoreLoad(); restoreLoad = null }
    vi.restoreAllMocks()
    vi.resetModules()
  })

  test('returns null when isAvailable() is false', () => {
    installStubs({ isAvailable: vi.fn(() => false) })
    const { checkHomepageBanner } = freshModule()

    const result = checkHomepageBanner({ cookies: [] })
    return result.then((res) => {
      expect(res).toBeNull()
    })
  })

  test('returns null when cookieHeaderFromArray returns empty', () => {
    installStubs({
      cookieHeaderFromArray: vi.fn(() => ''),
    })
    const { checkHomepageBanner } = freshModule()

    const result = checkHomepageBanner({ cookies: [] })
    return result.then((res) => {
      expect(res).toBeNull()
    })
  })

  test('returns the parsed banner verdict when fetch succeeds', () => {
    const fetchStub = vi.fn(async () => '<section class="jblcMemberGuide" data-state="owned">')
    installStubs({
      fetchUrlViaWindow: fetchStub,
      cookieHeaderFromArray: vi.fn(() => 'xf_user=1'),
    })
    const { checkHomepageBanner } = freshModule()

    const result = checkHomepageBanner({ cookies: [{ name: 'xf_user', value: '1' }] })
    return result.then((res) => {
      expect(res).toBe('VIP')
      expect(fetchStub).toHaveBeenCalledWith(
        'https://lewdcorner.com/',
        'xf_user=1',
        expect.objectContaining({ host: 'lewdcorner.com' }),
      )
    })
  })

  test('returns null when the fetch throws', () => {
    installStubs({
      fetchUrlViaWindow: vi.fn(async () => { throw new Error('network error') }),
      cookieHeaderFromArray: vi.fn(() => 'xf_user=1'),
    })
    const { checkHomepageBanner } = freshModule()

    const result = checkHomepageBanner({ cookies: [{ name: 'xf_user', value: '1' }] })
    return result.then((res) => {
      expect(res).toBeNull()
    })
  })
})
