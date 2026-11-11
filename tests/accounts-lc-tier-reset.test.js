import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest'

// ── Stale-tier reset on re-authentication ───────────────────────────────────
//
// The LC tier is only valid for the session that produced it; both re-auth
// paths (commitAccount save, ensureFreshCookies re-login) must drop it to
// null so the next scrape runs against the new cookies.
//
// accountStore couples to Electron's safeStorage at require time, so the
// electron / xenforoAuth / browserLogin modules are stubbed via Module._load
// (same technique as the Cloudflare window fallback tests).

const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const SITES = {
  f95: { base: 'https://f95zone.to', domain: 'f95zone.to', label: 'F95zone' },
  lewdcorner: { base: 'https://lewdcorner.com', domain: 'lewdcorner.com', label: 'LewdCorner' },
}

const FRESH_COOKIES = [{ name: 'xf_user', value: 'fresh', domain: 'lewdcorner.com', path: '/' }]
const STALE_COOKIES = [{ name: 'xf_user', value: 'stale', domain: 'lewdcorner.com', path: '/' }]

let stubs = {}
let restoreLoad = null

function installStubs(overrides = {}) {
  stubs = {
    login: vi.fn(async () => FRESH_COOKIES),
    checkCookiesLive: vi.fn(async () => false),
    scrapeLcUserTier: vi.fn(async () => ({ tier: 'VIP' })),
    cookieHeaderFromArray: (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    loginWithBrowser: vi.fn(async () => ({ ok: false, error: 'stub' })),
    ...overrides,
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      // Identity "encryption" so seeded secrets read back in plain text.
      return {
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (s) => Buffer.from(s, 'utf-8'),
          decryptString: (b) => b.toString('utf-8'),
        },
      }
    }
    if (request === './xenforoAuth') {
      return {
        SITES,
        login: stubs.login,
        checkCookiesLive: stubs.checkCookiesLive,
        cookieHeaderFromArray: stubs.cookieHeaderFromArray,
        scrapeLcUserTier: stubs.scrapeLcUserTier,
      }
    }
    if (request === './browserLogin') {
      return { loginWithBrowser: stubs.loginWithBrowser }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => { Module._load = originalLoad }
}

function freshStore() {
  delete require.cache[require.resolve('../electron/accounts/accountStore.js')]
  return require('../electron/accounts/accountStore.js')
}

function seedAccount(dataDir, site, secret) {
  const entry = {
    username: secret.username,
    method: 'password',
    secretEnc: Buffer.from(JSON.stringify(secret), 'utf-8').toString('base64'),
    updatedAt: Date.now(),
  }
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify({ [site]: entry }, null, 2))
}

function readSecret(dataDir, site) {
  const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, 'accounts.json'), 'utf-8'))
  return JSON.parse(Buffer.from(parsed[site].secretEnc, 'base64').toString('utf-8'))
}

// commitAccount is synchronous; the background tier check it kicks off persists
// on a later microtask, so the file read right after the call sees the reset.
async function flushBackground() {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('lewdcorner tier reset on re-authentication', () => {
  let dataDir

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-accounts-'))
    installStubs()
  })

  afterEach(() => {
    if (restoreLoad) {
      restoreLoad()
      restoreLoad = null
    }
    vi.restoreAllMocks()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  test('commitAccount drops the stale tier; the background check re-resolves it', async () => {
    seedAccount(dataDir, 'lewdcorner', {
      username: 'olduser',
      password: 'pass',
      cookies: STALE_COOKIES,
      tier: 'VIP',
      tierCheckedAt: Date.now() - 1000,
    })
    const store = freshStore()
    store.init(dataDir, { lcTierRecheckDays: 30 })

    expect((await store.verifyAccount('lewdcorner', 'newuser', 'pass')).ok).toBe(true)
    expect(store.commitAccount('lewdcorner').ok).toBe(true)

    const saved = readSecret(dataDir, 'lewdcorner')
    expect(saved.tier).toBeNull()
    expect(saved.tierCheckedAt).toBeNull()
    expect(saved.cookies).toEqual(FRESH_COOKIES)

    await flushBackground()
    expect(readSecret(dataDir, 'lewdcorner').tier).toBe('VIP')
  })

  test('ensureFreshCookies drops the stale tier on re-login; the chained check re-resolves it', async () => {
    seedAccount(dataDir, 'lewdcorner', {
      username: 'user',
      password: 'pass',
      cookies: STALE_COOKIES,
      tier: 'VIP',
      tierCheckedAt: Date.now() - 1000,
    })
    const store = freshStore()
    store.init(dataDir, { lcTierRecheckDays: 30 })

    expect(await store.ensureFreshCookies('lewdcorner')).toBe(true)

    const saved = readSecret(dataDir, 'lewdcorner')
    expect(saved.tier).toBeNull()
    expect(saved.tierCheckedAt).toBeNull()
    expect(saved.cookies).toEqual(FRESH_COOKIES)

    // main.js chains the non-forced tier check off refreshAllAccounts; with the
    // tier nulled it must scrape and resolve, not trust the cache.
    const result = await store.verifyLcTier()
    expect(result.ok).toBe(true)
    expect(result.tier).toBe('VIP')
    expect(readSecret(dataDir, 'lewdcorner').tier).toBe('VIP')
  })

  test('non-lewdcorner saves keep preserving the stored tier', async () => {
    seedAccount(dataDir, 'f95', {
      username: 'user',
      password: 'pass',
      cookies: STALE_COOKIES,
      tier: 'VIP',
      tierCheckedAt: Date.now() - 1000,
    })
    const store = freshStore()
    store.init(dataDir, { lcTierRecheckDays: 30 })

    expect((await store.verifyAccount('f95', 'user', 'pass')).ok).toBe(true)
    expect(store.commitAccount('f95').ok).toBe(true)

    const saved = readSecret(dataDir, 'f95')
    expect(saved.tier).toBe('VIP')
    expect(saved.tierCheckedAt).not.toBeNull()
  })

  test('non-lewdcorner re-login keeps the stored tier', async () => {
    seedAccount(dataDir, 'f95', {
      username: 'user',
      password: 'pass',
      cookies: STALE_COOKIES,
      tier: 'VIP',
      tierCheckedAt: Date.now() - 1000,
    })
    const store = freshStore()
    store.init(dataDir, { lcTierRecheckDays: 30 })

    expect(await store.ensureFreshCookies('f95')).toBe(true)

    const saved = readSecret(dataDir, 'f95')
    expect(saved.tier).toBe('VIP')
    expect(saved.tierCheckedAt).not.toBeNull()
    expect(saved.cookies).toEqual(FRESH_COOKIES)
  })
})

// ── Tier cache TTL ───────────────────────────────────────────────────────────
//
// The LC tier is cached for lcTierRecheckDays (default 30d): past the window
// it is re-scraped, within it the cached value is trusted.

describe('lewdcorner tier cache respects recheck window', () => {
  let dataDir

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-accounts-'))
    installStubs()
  })

  afterEach(() => {
    if (restoreLoad) {
      restoreLoad()
      restoreLoad = null
    }
    vi.restoreAllMocks()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  test('a set tier past the recheck window is re-scraped', async () => {
    seedAccount(dataDir, 'lewdcorner', {
      username: 'user',
      password: 'pass',
      cookies: FRESH_COOKIES,
      tier: 'VIP',
      tierCheckedAt: Date.now() - 31 * 24 * 3600 * 1000, // 31d ago, past the 30d window
    })
    const store = freshStore()
    store.init(dataDir, { lcTierRecheckDays: 30 })

    const result = await store.verifyLcTier()
    expect(result.ok).toBe(true)
    expect(result.tier).toBe('VIP')
    expect(result.fromCache).toBe(undefined)
    expect(stubs.scrapeLcUserTier).toHaveBeenCalledTimes(1)
  })

  test('a set tier within the recheck window is trusted from cache', async () => {
    seedAccount(dataDir, 'lewdcorner', {
      username: 'user',
      password: 'pass',
      cookies: FRESH_COOKIES,
      tier: 'VIP',
      tierCheckedAt: Date.now() - 1 * 24 * 3600 * 1000, // 1d ago, within the 30d window
    })
    const store = freshStore()
    store.init(dataDir, { lcTierRecheckDays: 30 })

    const result = await store.verifyLcTier()
    expect(result.ok).toBe(true)
    expect(result.tier).toBe('VIP')
    expect(result.fromCache).toBe(true)
    expect(stubs.scrapeLcUserTier).not.toHaveBeenCalled()
  })
})
