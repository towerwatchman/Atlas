import { test, expect, vi, describe, beforeEach } from 'vitest'

// ── Tier detection scraping tests ──────────────────────────────────────────
//
// Tests the HTML parsing logic for detecting a user's LewdCorner membership
// tier from the shop page and thread probe. These are pure parsing contracts;
// no Electron or DB involved.
//
// The detected values are stored as 'Free'/'VIP' — the same vocabulary as the
// content-tier column. The Accounts page displays the friendlier labels
// Standard/Plus (Free→Standard, VIP→Plus) but the stored value and these
// contracts use 'Free'/'VIP'.

// xenforoAuth.js is CJS and requires axios at load time. Rather than trying to
// mock the CJS module (which doesn't work well with vi.mock hoisting), we
// import the real module and spy on axios.get directly.
const axios = require('axios')
const mod = require('../electron/accounts/xenforoAuth.js')

const { scrapeLcTierFromProfile, probeLcTierFromThread, scrapeLcUserTier, LC_RANK_IDS } = mod

const DUMMY_COOKIES = [{ name: 'xf_user', value: '1', domain: 'lewdcorner.com', path: '/' }]

function mockGet(handler) {
  vi.spyOn(axios, 'get').mockImplementation(async (url, _opts) => handler(url))
}

function lcTierPageHtml(overrides = {}) {
  const cards = [
    { id: 18, name: 'UwU', owned: overrides.uwuOwned || false },
    { id: 12, name: 'members+ (Donator)', owned: overrides.donatorOwned || false },
    { id: 13, name: 'members+', owned: overrides.membersPlusOwned || false },
    { id: 2, name: 'Prestige 1', owned: overrides.prestige1Owned || false },
    { id: 6, name: 'Prestige 5', owned: overrides.prestige5Owned || false },
  ]
  const rankCards = cards
    .map(
      (c) => `
    <div class="rankCard productCard purchasableCard" data-item-id="${c.id}">
      <span class="statusPill ${c.owned ? 'owned' : ''}">${c.owned ? 'Owned' : 'Available'}</span>
      <div class="rankBody"><h3>${c.name}</h3></div>
    </div>`,
    )
    .join('')
  return `<html><body><div class="rankGrid">${rankCards}</div></body></html>`
}

// ── scrapeLcTierFromProfile ─────────────────────────────────────────────────

describe('scrapeLcTierFromProfile', () => {
  beforeEach(() => vi.restoreAllMocks())

  test('returns VIP when a VIP-granting rank is owned', async () => {
    mockGet(() => ({ status: 200, data: lcTierPageHtml({ donatorOwned: true }) }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('VIP')
  })

  test('returns Free when only UwU is owned', async () => {
    mockGet(() => ({ status: 200, data: lcTierPageHtml({ uwuOwned: true }) }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('Free')
  })

  test('returns Free when no ranks are owned', async () => {
    mockGet(() => ({ status: 200, data: lcTierPageHtml() }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('Free')
  })

  test('returns VIP for Prestige rank ownership', async () => {
    mockGet(() => ({ status: 200, data: lcTierPageHtml({ prestige1Owned: true }) }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('VIP')
  })

  test('returns null when shop page returns non-200 (inconclusive)', async () => {
    mockGet(() => ({ status: 403, data: '' }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBeNull()
  })

  test('returns null with empty cookies', async () => {
    expect(await scrapeLcTierFromProfile([])).toBeNull()
  })

  test('checks both main shop and prestige bundle URLs', async () => {
    const urls = []
    mockGet((url) => {
      urls.push(url)
      if (url.includes('rank_bundle=prestige')) {
        return { status: 200, data: lcTierPageHtml({ prestige5Owned: true }) }
      }
      return { status: 200, data: lcTierPageHtml() }
    })
    const result = await scrapeLcTierFromProfile(DUMMY_COOKIES)
    expect(result).toBe('VIP')
    expect(urls.length).toBeGreaterThanOrEqual(2)
    expect(urls[1]).toContain('rank_bundle=prestige')
  })

  test('returns Free when first URL fails but second succeeds with no VIP', async () => {
    let callCount = 0
    mockGet(() => {
      callCount++
      if (callCount === 1) throw new Error('network error')
      return { status: 200, data: lcTierPageHtml() }
    })
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('Free')
  })

  test('detects an owned rank from its owned statusPill (verified LC markup)', async () => {
    const html = `
      <div class="rankCard productCard purchasableCard" data-item-id="13">
        <div class="rankTop rankTopBanner"><span class="statusPill owned">Owned</span></div>
        <div class="rankBody"><h3>members+</h3></div>
        <div class="checkout"><button class="buyBtn" data-item-id="13" disabled="">Owned</button></div>
      </div>`
    mockGet(() => ({ status: 200, data: html }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('VIP')
  })

  test('treats an available statusPill as not owned', async () => {
    const html = `
      <div class="rankCard productCard purchasableCard" data-item-id="13">
        <div class="rankTop rankTopBanner"><span class="statusPill ">Available</span></div>
        <div class="rankBody"><h3>members+</h3></div>
        <div class="checkout"><button class="buyBtn" data-item-id="13">Purchase Rank</button></div>
      </div>`
    mockGet(() => ({ status: 200, data: html }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('Free')
  })

  test('a custom lcConfig with renamed statusPill class/token still detects ownership', async () => {
    // Simulates LC renaming the ownership pill: same structure, but the container
    // class and owned class-fragment have new names. The config should cover it.
    const html = `
      <div class="rankCard productCard purchasableCard" data-item-id="12">
        <div class="rankTop rankTopBanner"><span class="tierBadge highlight">Owned</span></div>
        <div class="rankBody"><h3>members+</h3></div>
      </div>`
    const lcConfig = {
      lcStatusPillClass: 'tierBadge',
      lcStatusPillOwnedToken: 'highlight',
    }
    mockGet(() => ({ status: 200, data: html }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES, lcConfig)).toBe('VIP')
  })

  test('blank lcConfig keys fall back to built-in defaults', async () => {
    mockGet(() => ({ status: 200, data: lcTierPageHtml({ donatorOwned: true }) }))
    // All blank — the default statusPill/owned selectors must still match.
    const lcConfig = { lcStatusPillClass: '', lcStatusPillOwnedToken: '', lcStatusPillOwnedText: '' }
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES, lcConfig)).toBe('VIP')
  })
})

// ── probeLcTierFromThread ────────────────────────────────────────────────────

describe('probeLcTierFromThread', () => {
  beforeEach(() => vi.restoreAllMocks())

  test('returns Free when attachment-hide block is present', async () => {
    mockGet(() => ({
      status: 200,
      data: '<html><body><div class="messageHide messageHide--attach">You must be registered to see attachments</div></body></html>',
    }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES)).toBe('Free')
  })

  test('returns VIP when attachment content is visible', async () => {
    mockGet(() => ({
      status: 200,
      data: '<html><body><div class="message-attachment"><img class="bbImage" src="test.jpg"></div></body></html>',
    }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES)).toBe('VIP')
  })

  test('returns null when thread loads but no attachment indicators', async () => {
    mockGet(() => ({
      status: 200,
      data: '<html><body><div class="message-body">Just text, no attachments here.</div></body></html>',
    }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES)).toBeNull()
  })

  test('returns null on network error', async () => {
    mockGet(() => { throw new Error('timeout') })
    expect(await probeLcTierFromThread(DUMMY_COOKIES)).toBeNull()
  })

  test('returns null on non-200 status', async () => {
    mockGet(() => ({ status: 404, data: '' }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES)).toBeNull()
  })

  test('returns null with empty cookies', async () => {
    expect(await probeLcTierFromThread([])).toBeNull()
  })
})

// ── scrapeLcUserTier ─────────────────────────────────────────────────────────

describe('scrapeLcUserTier', () => {
  beforeEach(() => vi.restoreAllMocks())

  test('returns VIP when shop page shows owned VIP rank', async () => {
    mockGet(() => ({
      status: 200,
      data: lcTierPageHtml({ membersPlusOwned: true }),
    }))
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES)
    expect(tier).toBe('VIP')
    expect(lcTierMismatch).toBe(false)
  })

  test('returns Free when shop says Free and thread probe confirms', async () => {
    let callCount = 0
    mockGet(() => {
      callCount++
      if (callCount <= 2) {
        return { status: 200, data: lcTierPageHtml() }
      }
      return {
        status: 200,
        data: '<div class="messageHide messageHide--attach">You must be registered</div>',
      }
    })
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES)
    expect(tier).toBe('Free')
    expect(lcTierMismatch).toBe(false)
  })

  test('returns VIP when shop fails but thread probe confirms', async () => {
    let callCount = 0
    mockGet(() => {
      callCount++
      if (callCount <= 2) throw new Error('network error')
      return {
        status: 200,
        data: '<div class="message-attachment"><img class="bbImage"></div>',
      }
    })
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES)
    expect(tier).toBe('VIP')
    // Shop outage is not a parser bug, so this must NOT be flagged as a mismatch.
    expect(lcTierMismatch).toBe(false)
  })

  test('returns null when all methods fail', async () => {
    mockGet(() => { throw new Error('network error') })
    const { tier } = await scrapeLcUserTier(DUMMY_COOKIES)
    expect(tier).toBeNull()
  })

  test('returns VIP immediately when shop page shows VIP (skips thread probe)', async () => {
    mockGet(() => ({
      status: 200,
      data: lcTierPageHtml({ prestige5Owned: true }),
    }))
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES)
    expect(tier).toBe('VIP')
    expect(lcTierMismatch).toBe(false)
    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  // The stale-parser signal: the LC shop page reads 'Free' (no Plus rank parsed)
  // but the thread probe shows real content access. This is the mismatch that
  // tells a developer the [LewdCorner] selectors have drifted.
  test('flags lcTierMismatch when shop says Free but probe confirms VIP', async () => {
    let callCount = 0
    mockGet(() => {
      callCount++
      if (callCount <= 2) {
        return { status: 200, data: lcTierPageHtml() }
      }
      return {
        status: 200,
        data: '<div class="message-attachment"><img class="bbImage"></div>',
      }
    })
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES)
    expect(tier).toBe('VIP')
    expect(lcTierMismatch).toBe(true)
  })
})

// ── LC_RANK_IDS constant ───────────────────────────────────────────────────

describe('LC_RANK_IDS', () => {
  test('does not include UwU (18)', () => {
    expect(LC_RANK_IDS.has(18)).toBe(false)
  })

  test('includes all known VIP-granting ranks', () => {
    for (const id of [2, 6, 7, 8, 12, 13]) {
      expect(LC_RANK_IDS.has(id)).toBe(true)
    }
  })
})

// ── Isolation to LewdCorner ────────────────────────────────────────────────
//
// The tier check + cache must never touch any other site (f95 has no shop page,
// and the probe/shop URLs are LC-specific). These are source-contract checks on
// accountStore, where the production guard lives, since the store itself can't
// be unit-tested (it couples to Electron's safeStorage).

describe('tier logic is isolated to lewdcorner', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'electron', 'accounts', 'accountStore.js'),
    'utf8',
  )

  test('verifyLcTier is LewdCorner-only and takes no site param', () => {
    expect(source).toContain('async function verifyLcTier')
    expect(source).not.toContain('async function verifyTier')
    expect(source).not.toContain('async function verifyAllTiers')
    // Uses lcTierCache scalar, not a per-site tierCache map
    expect(source).toContain('lcTierCache')
    expect(source).not.toMatch(/tierCache\[site\]/)
    // Reads/writes only the lewdcorner store entry
    expect(source).toContain('store.lewdcorner')
  })

  test('getLcUserTier takes no site param and reads lcTierCache', () => {
    const fn = source.slice(
      source.indexOf('function getLcUserTier'),
      source.indexOf('function listAccounts'),
    )
    expect(fn).toMatch(/function getLcUserTier\(\)/)
    expect(fn).toContain('lcTierCache')
    expect(fn).not.toContain('site')
  })
})

// ── Config: lcTierRecheckHours ───────────────────────────────────────────────
//
// The freshness window is config-driven. Default 24; coerced to a number from
// the ini string; blank/absent falls back to the default.

describe('[LewdCorner] lcTierRecheckHours config', () => {
  const { buildDefaultConfig, mergeWithDefaults } = require('../electron/config/configSchema')

  test('defaults to 24 in the config schema', () => {
    expect(buildDefaultConfig().LewdCorner.lcTierRecheckHours).toBe(24)
  })

  test('coerces a string from the ini to a number', () => {
    const merged = mergeWithDefaults(
      { LewdCorner: { lcTierRecheckHours: '12' } },
      { LewdCorner: buildDefaultConfig().LewdCorner },
    )
    expect(merged.LewdCorner.lcTierRecheckHours).toBe(12)
  })

  test('falls back to the default for a non-numeric value', () => {
    const merged = mergeWithDefaults(
      { LewdCorner: { lcTierRecheckHours: 'soon' } },
      { LewdCorner: buildDefaultConfig().LewdCorner },
    )
    expect(merged.LewdCorner.lcTierRecheckHours).toBe(24)
  })
})

describe('[LewdCorner] shop URL defaults', () => {
  const { buildDefaultConfig } = require('../electron/config/configSchema')
  const fs = require('fs')
  const path = require('path')

  test('lcUserTierPath is correct', () => {
    expect(buildDefaultConfig().LewdCorner.lcUserTierPath).toBe('/shop/index.php#user-ranks')
  })

  test('lcUserPrestigePath is correct', () => {
    expect(buildDefaultConfig().LewdCorner.lcUserPrestigePath).toBe('/shop/index.php?rank_bundle=prestige')
  })

  test('xenforoAuth defaults match config', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'accounts', 'xenforoAuth.js'), 'utf8')
    expect(src).toContain("lcUserTierPath: '/shop/index.php#user-ranks'")
    expect(src).toContain("lcUserPrestigePath: '/shop/index.php?rank_bundle=prestige'")
  })
})
