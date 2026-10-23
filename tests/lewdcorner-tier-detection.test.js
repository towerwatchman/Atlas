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
const Module = require('module')
const mod = require('../electron/accounts/xenforoAuth.js')

const { scrapeLcTierFromProfile, probeLcTierFromThread, scrapeLcUserTier, LC_RANK_IDS } = mod

const DUMMY_COOKIES = [{ name: 'xf_user', value: '1', domain: 'lewdcorner.com', path: '/' }]

function mockGet(handler) {
  vi.spyOn(axios, 'get').mockImplementation(async (url, _opts) => handler(url))
}

function lcTierPageHtml(overrides = {}) {
  // Mirrors the live economy shop catalogue (Oct 2026): one rank card per rank
  // with a hidden item_id input, ownership signalled on the buy button. The
  // fixture covers the full set of rank IDs and defaults to all-unowned; the
  // overrides flip individual cards to owned.
  const cards = [
    { id: 12, name: 'members+ (Donator)', owned: overrides.donatorOwned || false },
    { id: 18, name: 'UwU', owned: overrides.uwuOwned || false },
    { id: 13, name: 'members+', owned: overrides.membersPlusOwned || false },
    { id: 19, name: 'Beta', owned: overrides.betaOwned || false },
    { id: 2, name: 'Prestige 1', owned: overrides.prestige1Owned || false },
    { id: 7, name: 'Donator', owned: overrides.donatorRankOwned || false },
    { id: 8, name: 'Premium', owned: overrides.premiumOwned || false },
    { id: 6, name: 'Prestige 5', owned: overrides.prestige5Owned || false },
  ]
  const rankCards = cards
    .map((c) => {
      const buyButton = c.owned
        ? '<button type="button" class="button jblcEconomy-buyButton" disabled="true"><span class="button-text">Owned</span></button>'
        : '<button type="submit" class="button button--primary jblcEconomy-buyButton" data-economy-buy="true" data-state="disabled" disabled="1"><span class="button-text"><span data-economy-buy-label="">Not enough funds</span><span aria-hidden="true"> →</span></span></button>'
      return `
    <article class="jblcEconomy-item">
      <div class="jblcEconomy-itemCopy"><span class="jblcEconomy-itemType">rank</span><h3>${c.name}</h3></div>
      <form action="/economy/purchase" method="post" class="jblcEconomy-termPurchase">
        <input type="hidden" name="item_id" value="${c.id}">
        ${buyButton}
      </form>
    </article>`
    })
    .join('')
  return `<html><body><div class="jblcEconomy-catalogue">${rankCards}</div></body></html>`
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

  test('fetches the single unified economy shop URL', async () => {
    const urls = []
    mockGet((url) => {
      urls.push(url)
      return { status: 200, data: lcTierPageHtml({ prestige5Owned: true }) }
    })
    const result = await scrapeLcTierFromProfile(DUMMY_COOKIES)
    expect(result).toBe('VIP')
    expect(urls).toEqual(['https://lewdcorner.com/economy/?section=store&category=rank'])
  })

  test('returns null when the shop fetch fails (network error)', async () => {
    mockGet(() => {
      throw new Error('network error')
    })
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBeNull()
  })

  test('detects an owned rank from its disabled Owned buy button (verified LC markup)', async () => {
    const html = `
      <article class="jblcEconomy-item">
        <div class="jblcEconomy-itemCopy"><span class="jblcEconomy-itemType">rank</span><h3>members+</h3></div>
        <form action="/economy/purchase" method="post" class="jblcEconomy-termPurchase">
          <input type="hidden" name="item_id" value="13">
          <button type="button" class="button jblcEconomy-buyButton" disabled="true"><span class="button-text">Owned</span></button>
        </form>
      </article>`
    mockGet(() => ({ status: 200, data: html }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('VIP')
  })

  test('treats a Not-enough-funds buy button as not owned', async () => {
    const html = `
      <article class="jblcEconomy-item">
        <div class="jblcEconomy-itemCopy"><span class="jblcEconomy-itemType">rank</span><h3>members+</h3></div>
        <form action="/economy/purchase" method="post" class="jblcEconomy-termPurchase">
          <input type="hidden" name="item_id" value="13">
          <button type="submit" class="button button--primary jblcEconomy-buyButton" data-economy-buy="true" data-state="disabled" disabled="1"><span class="button-text"><span data-economy-buy-label="">Not enough funds</span><span aria-hidden="true"> →</span></span></button>
        </form>
      </article>`
    mockGet(() => ({ status: 200, data: html }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES)).toBe('Free')
  })

  test('a custom lcConfig with renamed card + button classes still detects ownership', async () => {
    // Simulates LC renaming the buy button and its card container: same
    // structure, new names for both. The config should cover the pair.
    const html = `
      <article class="lc-rank-card">
        <form action="/economy/purchase" method="post" class="jblcEconomy-termPurchase">
          <input type="hidden" name="item_id" value="12">
          <button type="button" class="button lc-rank-buy" disabled="true"><span class="button-text">Owned</span></button>
        </form>
      </article>`
    const lcConfig = {
      lcCardClass: 'lc-rank-card',
      lcBuyButtonClass: 'lc-rank-buy',
    }
    mockGet(() => ({ status: 200, data: html }))
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES, lcConfig)).toBe('VIP')
  })

  test('blank lcConfig keys fall back to built-in defaults', async () => {
    mockGet(() => ({ status: 200, data: lcTierPageHtml({ donatorOwned: true }) }))
    // All blank — the default buy-button/owned selectors must still match.
    const lcConfig = { lcBuyButtonClass: '', lcOwnedText: '' }
    expect(await scrapeLcTierFromProfile(DUMMY_COOKIES, lcConfig)).toBe('VIP')
  })
})

// ── scrapeLcTierFromProfile → Cloudflare window fallback ─────────────────────
//
// Cloudflare blocks the headless fetch. A 403 or a challenge page arriving
// with a 200 status retries through the real-browser window; anything else
// non-200 means the URL is wrong and stays null. The window module is
// stubbed here since tests have no BrowserWindow. The tests pin which
// statuses open the window, that the marker list is the shared one from
// maskedResolver, and that window HTML parses like fetch HTML.

describe('scrapeLcTierFromProfile Cloudflare window fallback', () => {
  const SHOP_URL = 'https://lewdcorner.com/economy/?section=store&category=rank'
  const challengeBody =
    '<html><head><title>Just a moment...</title></head>' +
    '<body>Verifying you are human. Enable JavaScript and cookies to continue.</body></html>'

  let restoreLoad = null

  const installWindowStub = ({ windowHtml = null } = {}) => {
    const fetchUrlViaWindow = vi.fn(async () => windowHtml)
    const originalLoad = Module._load
    Module._load = function patched(request, parent, isMain) {
      if (String(request).endsWith('downloads/forumWindowFetch')) {
        return { isAvailable: () => windowHtml !== null, fetchUrlViaWindow }
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    restoreLoad = () => { Module._load = originalLoad }
    return { fetchUrlViaWindow }
  }

  // The file-top import loaded the real window module; clear the cache so the
  // fresh require picks up the stub instead.
  const freshMod = () => {
    delete require.cache[require.resolve('../electron/accounts/xenforoAuth.js')]
    return require('../electron/accounts/xenforoAuth.js')
  }

  afterEach(() => {
    if (restoreLoad) {
      restoreLoad()
      restoreLoad = null
    }
    vi.restoreAllMocks()
    vi.resetModules()
  })

  test('steers a 403 into the real-browser window and parses the HTML it returns', async () => {
    const { fetchUrlViaWindow } = installWindowStub({ windowHtml: lcTierPageHtml({ membersPlusOwned: true }) })
    mockGet(() => ({ status: 403, data: '' }))
    const result = await freshMod().scrapeLcTierFromProfile(DUMMY_COOKIES)
    expect(result).toBe('VIP')
    expect(fetchUrlViaWindow).toHaveBeenCalledWith(
      SHOP_URL,
      'xf_user=1',
      expect.objectContaining({ host: 'lewdcorner.com' }),
    )
  })

  test('steers a Cloudflare interstitial on HTTP 200 into the window', async () => {
    const { fetchUrlViaWindow } = installWindowStub({ windowHtml: lcTierPageHtml({ prestige1Owned: true }) })
    mockGet(() => ({ status: 200, data: challengeBody }))
    const result = await freshMod().scrapeLcTierFromProfile(DUMMY_COOKIES)
    expect(result).toBe('VIP')
    expect(fetchUrlViaWindow).toHaveBeenCalledTimes(1)
  })

  test('steers a "checking your browser" challenge into the window, not the parser', async () => {
    const { fetchUrlViaWindow } = installWindowStub({ windowHtml: lcTierPageHtml({ donatorOwned: true }) })
    const checkingBody =
      '<html><head><title>Checking your browser before accessing</title></head>' +
      '<body>Enable JavaScript and cookies to continue.</body></html>'
    mockGet(() => ({ status: 200, data: checkingBody }))
    const result = await freshMod().scrapeLcTierFromProfile(DUMMY_COOKIES)
    expect(result).toBe('VIP')
    expect(fetchUrlViaWindow).toHaveBeenCalledTimes(1)
  })

  test('a legit page that merely mentions "challenge" is parsed, not discarded', async () => {
    const { fetchUrlViaWindow } = installWindowStub({ windowHtml: lcTierPageHtml() })
    const legitBody = `<html><head><title>Atlas June challenge announcement</title></head><body></body></html>` +
      lcTierPageHtml()
    mockGet(() => ({ status: 200, data: legitBody }))
    const result = await freshMod().scrapeLcTierFromProfile(DUMMY_COOKIES)
    expect(result).toBe('Free')
    expect(fetchUrlViaWindow).not.toHaveBeenCalled()
  })

  test('an interstitial stays inconclusive (never "Free") when no window exists', async () => {
    installWindowStub({ windowHtml: null })
    mockGet(() => ({ status: 200, data: challengeBody }))
    expect(await freshMod().scrapeLcTierFromProfile(DUMMY_COOKIES)).toBeNull()
  })

  test('a 404 keeps steering closed: no window, inconclusive', async () => {
    const { fetchUrlViaWindow } = installWindowStub({ windowHtml: lcTierPageHtml() })
    mockGet(() => ({ status: 404, data: '' }))
    expect(await freshMod().scrapeLcTierFromProfile(DUMMY_COOKIES)).toBeNull()
    expect(fetchUrlViaWindow).not.toHaveBeenCalled()
  })
})

// ── probeLcTierFromThread ────────────────────────────────────────────────────

describe('probeLcTierFromThread', () => {
  beforeEach(() => vi.restoreAllMocks())

  // The probe is disabled by default (see lcThreadProbeEnabled); these tests
  // exercise its parsing contracts, so each passes the enabled toggle.
  const probeConfig = { lcThreadProbeEnabled: true }

  test('returns Free when attachment-hide block is present', async () => {
    mockGet(() => ({
      status: 200,
      data: '<html><body><div class="messageHide messageHide--attach">You must be registered to see attachments</div></body></html>',
    }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES, probeConfig)).toBe('Free')
  })

  test('returns VIP when attachment content is visible', async () => {
    mockGet(() => ({
      status: 200,
      data: '<html><body><div class="message-attachment"><img class="bbImage" src="test.jpg"></div></body></html>',
    }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES, probeConfig)).toBe('VIP')
  })

  test('returns null when thread loads but no attachment indicators', async () => {
    mockGet(() => ({
      status: 200,
      data: '<html><body><div class="message-body">Just text, no attachments here.</div></body></html>',
    }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES, probeConfig)).toBeNull()
  })

  test('returns null on network error', async () => {
    mockGet(() => { throw new Error('timeout') })
    expect(await probeLcTierFromThread(DUMMY_COOKIES, probeConfig)).toBeNull()
  })

  test('returns null on non-200 status', async () => {
    mockGet(() => ({ status: 404, data: '' }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES, probeConfig)).toBeNull()
  })

  test('returns null when disabled, without fetching', async () => {
    mockGet(() => ({ status: 200, data: '<html></html>' }))
    expect(await probeLcTierFromThread(DUMMY_COOKIES, { lcThreadProbeEnabled: false })).toBeNull()
    expect(axios.get).not.toHaveBeenCalled()
  })

  test('returns null with empty cookies', async () => {
    expect(await probeLcTierFromThread([], probeConfig)).toBeNull()
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

  test('trusts the shop Free verdict without the disabled probe', async () => {
    mockGet(() => ({ status: 200, data: lcTierPageHtml() }))
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES)
    expect(tier).toBe('Free')
    expect(lcTierMismatch).toBe(false)
    // Probe disabled: only the single shop URL is requested, never the thread.
    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  test('shop unreachability is inconclusive, not rescued, while the probe is disabled', async () => {
    mockGet(() => { throw new Error('network error') })
    const { tier } = await scrapeLcUserTier(DUMMY_COOKIES)
    expect(tier).toBeNull()
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

  // ── Probe enabled via [LewdCorner] lcThreadProbeEnabled: true ─────────────
  // The pre-disabled contracts survive under the toggle, so flipping it back
  // on restores the original behaviour without edits.

  test('probe on: shop Free confirmed by the thread probe', async () => {
    let callCount = 0
    mockGet(() => {
      callCount++
      if (callCount === 1) {
        return { status: 200, data: lcTierPageHtml() }
      }
      return {
        status: 200,
        data: '<div class="messageHide messageHide--attach">You must be registered</div>',
      }
    })
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES, { lcThreadProbeEnabled: true })
    expect(tier).toBe('Free')
    expect(lcTierMismatch).toBe(false)
  })

  test('probe on: rescues a Plus verdict when the shop fails', async () => {
    let callCount = 0
    mockGet(() => {
      callCount++
      if (callCount === 1) throw new Error('network error')
      return {
        status: 200,
        data: '<div class="message-attachment"><img class="bbImage"></div>',
      }
    })
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES, { lcThreadProbeEnabled: true })
    expect(tier).toBe('VIP')
    // Shop outage is not a parser bug, so this must NOT be flagged as a mismatch.
    expect(lcTierMismatch).toBe(false)
  })

  // The stale-parser signal: the LC shop page reads 'Free' (no Plus rank parsed)
  // but the thread probe shows real content access. This is the mismatch that
  // tells a developer the [LewdCorner] selectors have drifted.
  test('probe on: flags lcTierMismatch when shop says Free but probe confirms VIP', async () => {
    let callCount = 0
    mockGet(() => {
      callCount++
      if (callCount === 1) {
        return { status: 200, data: lcTierPageHtml() }
      }
      return {
        status: 200,
        data: '<div class="message-attachment"><img class="bbImage"></div>',
      }
    })
    const { tier, lcTierMismatch } = await scrapeLcUserTier(DUMMY_COOKIES, { lcThreadProbeEnabled: true })
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

  test('lcUserTierPath is the unified economy shop URL', () => {
    expect(buildDefaultConfig().LewdCorner.lcUserTierPath).toBe('/economy/?section=store&category=rank')
  })

  test('lcBuyButtonClass, lcCardClass and lcOwnedText are correct', () => {
    expect(buildDefaultConfig().LewdCorner.lcBuyButtonClass).toBe('jblcEconomy-buyButton')
    expect(buildDefaultConfig().LewdCorner.lcCardClass).toBe('jblcEconomy-item')
    expect(buildDefaultConfig().LewdCorner.lcOwnedText).toBe('owned')
  })

  test('xenforoAuth defaults match config', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'accounts', 'xenforoAuth.js'), 'utf8')
    expect(src).toContain("lcUserTierPath: '/economy/?section=store&category=rank'")
    expect(src).toContain("lcCardClass: 'jblcEconomy-item'")
    expect(src).toContain("lcBuyButtonClass: 'jblcEconomy-buyButton'")
    expect(src).toContain("lcOwnedText: 'owned'")
    // The retired two-page shop contract must not creep back in.
    expect(src).not.toContain('lcUserPrestigePath')
    expect(src).not.toContain('lcStatusPill')
  })
})
