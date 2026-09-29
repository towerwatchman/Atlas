'use strict'

// Persistent, encrypted store for site accounts (F95zone, LewdCorner). One
// account per site. Username is stored in the clear (for display); the password
// and the harvested session cookies are encrypted at rest with Electron's
// safeStorage (OS-backed keychain / DPAPI), so accounts.json never contains a
// readable password or live session token.
//
// A decrypted cookie *header* per site is also kept in memory so the
// webRequest.onBeforeSendHeaders hook (which must run synchronously) can attach
// it to streamed <img> requests without touching disk or decrypting per call.

const fs = require('fs')
const path = require('path')
const { safeStorage } = require('electron')
const {
  SITES,
  login,
  checkCookiesLive,
  cookieHeaderFromArray,
  scrapeLcUserTier,
} = require('./xenforoAuth')
const { loginWithBrowser } = require('./browserLogin')

let storePath = null
// On-disk shape: { [site]: { username, secretEnc (base64), updatedAt } }
// where secretEnc decrypts to JSON { password, cookies: [{name,value,domain,path}] }
let store = {}
// LewdCorner tier-detection config (shop/probe URLs + selectors), passed at
// init from appConfig.LewdCorner. Held module-level so verifyLcTier()
// can feed it to xenforoAuth without threading it through every call site.
let lcConfig = null
// In-memory decrypted cookie header per site, for the synchronous webRequest path.
const cookieHeaderCache = Object.create(null)
// In-memory LewdCorner user tier ('Free' | 'VIP' | null). The stored vocabulary
// matches the content-tier column; Accounts.jsx maps Free→Standard, VIP→Plus
// for display. Populated from the encrypted blob on init; updated by
// verifyLcTier().
let lcTierCache = null

// Successful-but-not-yet-saved logins, keyed by site. The Verify / browser-login
// steps populate this; commitAccount() persists it without logging in again.
// { username, password (nullable), cookies, method: 'password' | 'browser' }
const pending = new Map()

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch (err) {
    return false
  }
}

function encrypt(plainString) {
  return safeStorage.encryptString(plainString).toString('base64')
}

function decrypt(b64) {
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch (err) {
    return null
  }
}

function readSecret(entry) {
  if (!entry || !entry.secretEnc) return null
  const raw = decrypt(entry.secretEnc)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    return null
  }
}

function load() {
  store = {}
  try {
    if (fs.existsSync(storePath)) {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
      if (parsed && typeof parsed === 'object') store = parsed
    }
  } catch (err) {
    console.warn('accountStore: could not read accounts.json:', err.message)
    store = {}
  }
}

function persist() {
  try {
    const tmp = storePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
    fs.renameSync(tmp, storePath)
  } catch (err) {
    console.error('accountStore: failed to persist accounts.json:', err.message)
  }
}

function rebuildCookieCache() {
  for (const site of Object.keys(SITES)) {
    cookieHeaderCache[site] = ''
  }
  lcTierCache = null
  for (const [site, entry] of Object.entries(store)) {
    if (!SITES[site]) continue
    const secret = readSecret(entry)
    if (secret && Array.isArray(secret.cookies)) {
      cookieHeaderCache[site] = cookieHeaderFromArray(secret.cookies)
    }
  }
  const lcEntry = store.lewdcorner
  if (lcEntry) {
    const secret = readSecret(lcEntry)
    if (secret && secret.tier) lcTierCache = secret.tier
  }
}

function init(dataDir, lewdcornerConfig) {
  storePath = path.join(dataDir, 'accounts.json')
  lcConfig = lewdcornerConfig || null
  load()
  rebuildCookieCache()
}

// Map a request URL to a configured site key (covers subdomains, e.g.
// attachments.f95zone.to), or null when it isn't an authenticated site.
function siteForUrl(url) {
  let host
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch (err) {
    return null
  }
  for (const [site, cfg] of Object.entries(SITES)) {
    if (host === cfg.domain || host.endsWith('.' + cfg.domain)) return site
  }
  return null
}

// Synchronous cookie-header lookup for the webRequest / axios paths. Returns ''
// when there's no account or no cached session for the URL's site.
function getCookieHeaderForUrl(url) {
  const site = siteForUrl(url)
  if (!site) return ''
  return cookieHeaderCache[site] || ''
}

// Canonical apex referer for a site's media requests (e.g. LewdCorner's
// hotlink protection expects https://lewdcorner.com/, not a CDN subdomain
// origin). Returns null when the URL isn't a known auth site.
function refererForUrl(url) {
  const site = siteForUrl(url)
  return site ? SITES[site].base + '/' : null
}

// Synchronous tier lookup from the in-memory cache. Returns 'Free' | 'VIP' |
// null (unknown / not checked yet). Used by the Browse SQL gate and UI.
function getLcUserTier() {
  return lcTierCache || null
}

function listAccounts() {
  return Object.keys(SITES).map((site) => {
    const entry = store[site]
    return {
      site,
      label: SITES[site].label,
      username: entry ? entry.username : null,
      connected: Boolean(entry),
      updatedAt: entry ? entry.updatedAt : null,
    }
  })
}

// Attempt a headless login WITHOUT saving. On success the verified session is
// held in `pending` so commitAccount() can persist it without a second login.
// Used by the Verify button.
async function verifyAccount(site, username, password) {
  if (!SITES[site]) return { ok: false, error: `Unsupported site: ${site}` }
  if (!encryptionAvailable()) {
    return {
      ok: false,
      error:
        'Secure credential storage is unavailable on this system, so accounts ' +
        'cannot be stored safely. (On Linux this usually means no keyring is set up.)',
    }
  }
  try {
    const cookies = await login(site, username, password)
    pending.set(site, { username, password, cookies, method: 'password' })
    return { ok: true }
  } catch (err) {
    pending.delete(site)
    return { ok: false, error: err.message }
  }
}

// Open the embedded browser login (handles captcha / 2FA). On success the
// session is held in `pending`; no password is captured this way. Returns the
// site-reported username when it could be read.
async function verifyAccountBrowser(site) {
  if (!SITES[site]) return { ok: false, error: `Unsupported site: ${site}` }
  if (!encryptionAvailable()) {
    return {
      ok: false,
      error:
        'Secure credential storage is unavailable on this system, so the ' +
        'account cannot be saved safely.',
    }
  }
  const result = await loginWithBrowser(site)
  if (!result.ok) {
    pending.delete(site)
    return { ok: false, error: result.error }
  }
  pending.set(site, {
    username: result.username || null,
    password: null,
    cookies: result.cookies,
    method: 'browser',
  })
  return { ok: true, username: result.username || null }
}

// Persist a previously-verified login (from `pending`) WITHOUT re-authenticating.
// One account per site; overwrites any existing account for the site. After
// saving, kicks off a background tier check for the newly-saved account.
function commitAccount(site) {
  if (!SITES[site]) return { ok: false, error: `Unsupported site: ${site}` }
  const p = pending.get(site)
  if (!p) {
    return { ok: false, error: 'No verified login to save — please verify first.' }
  }
  if (!encryptionAvailable()) {
    return {
      ok: false,
      error:
        'Secure credential storage is unavailable on this system, so the ' +
        'account cannot be saved safely.',
    }
  }
  // Preserve any previously-detected tier from the existing account.
  const existingSecret = readSecret(store[site])
  const prevTier = existingSecret && existingSecret.tier ? existingSecret.tier : null
  const prevCheckedAt = existingSecret && existingSecret.tierCheckedAt ? existingSecret.tierCheckedAt : null

  store[site] = {
    username: p.username,
    method: p.method,
    secretEnc: encrypt(JSON.stringify({
      password: p.password,
      cookies: p.cookies,
      tier: prevTier,
      tierCheckedAt: prevCheckedAt,
    })),
    updatedAt: Date.now(),
  }
  persist()
  rebuildCookieCache()
  pending.delete(site)

  // Background tier check — don't block the caller. Force it: the user just
  // (re-)connected, so a cached tier would be stale and they expect the gate to
  // reflect the account right now.
  if (site === 'lewdcorner') {
    verifyLcTier({ force: true }).catch((err) =>
      console.warn(`accountStore: post-commit tier check failed for ${site}:`, err.message),
    )
  }

  return { ok: true }
}

function removeAccount(site) {
  if (store[site]) {
    delete store[site]
    persist()
    rebuildCookieCache()
  }
  cookieHeaderCache[site] = ''
  return { ok: true }
}

// Seamless refresh: verify the stored cookies are still live and, if not,
// re-login with the stored password and update the cache/disk. Safe to call
// before scans or on startup. Returns true if a usable session exists after.
async function ensureFreshCookies(site) {
  const entry = store[site]
  if (!entry) return false
  const secret = readSecret(entry)
  if (!secret) return false

  if (Array.isArray(secret.cookies) && (await checkCookiesLive(site, secret.cookies))) {
    return true
  }
  // Cookie expired. Browser-added accounts have no stored password, so they
  // can't be refreshed headlessly — the user must re-authenticate via the
  // browser login. Signal "not fresh" so the UI can prompt.
  if (!secret.password) {
    console.warn(`accountStore: ${site} session expired and has no stored password to refresh.`)
    return false
  }
  // Password account — re-login with the stored credentials.
  try {
    const cookies = await login(site, entry.username, secret.password)
    // Re-read the live entry: a concurrent verifyLcTier may have updated the tier
    // while we were re-logging in. Update cookies but preserve the live tier.
    const liveEntry = store[site]
    if (!liveEntry) return false
    const liveSecret = readSecret(liveEntry)
    if (!liveSecret) return false
    store[site] = {
      username: liveEntry.username,
      secretEnc: encrypt(JSON.stringify({
        password: liveSecret.password || null,
        cookies,
        tier: liveSecret.tier || null,
        tierCheckedAt: liveSecret.tierCheckedAt || null,
      })),
      updatedAt: Date.now(),
    }
    persist()
    rebuildCookieCache()
    return true
  } catch (err) {
    console.warn(`accountStore: re-login failed for ${site}:`, err.message)
    return false
  }
}

async function refreshAllAccounts() {
  for (const site of Object.keys(store)) {
    if (SITES[site]) await ensureFreshCookies(site)
  }
}

// Scrape the user's LewdCorner tier (shop page + thread probe) and persist the
// result in the encrypted blob. Safe to call on startup or periodically.
// Only operates on the LewdCorner stored account with valid cookies.
// Returns { ok, tier?, lcTierMismatch?, fromCache?, error? } where lcTierMismatch
// is the dev-only stale-parser signal (true only when the shop page concluded
// 'Free' but the thread probe — reflecting real content access — concluded
// 'VIP').
//
// Unless `{ force: true }` is passed, the network scrape is skipped when the
// cached tier is still fresh (checked within lcTierRecheckHours). This bounds
// shop-page traffic to at most one scrape per window no matter how often the
// client is opened; re-linking the account passes force so a reconnect always
// re-scrapes immediately.
async function verifyLcTier({ force = false } = {}) {
  const entry = store.lewdcorner
  if (!entry) return { ok: false, error: 'No account configured.' }

  const secret = readSecret(entry)
  if (!secret || !Array.isArray(secret.cookies) || secret.cookies.length === 0) {
    return { ok: false, error: 'No valid cookies — please re-authenticate.' }
  }

  // Reuse a still-fresh cached tier instead of re-scraping. lcTierRecheckHours of
  // 0 disables the periodic recheck entirely (startup + a force still verify).
  const recheckHours = lcConfig && typeof lcConfig.lcTierRecheckHours === 'number'
    ? lcConfig.lcTierRecheckHours
    : 24
  if (!force && recheckHours > 0 && secret.tier && secret.tierCheckedAt) {
    const ageMs = Date.now() - secret.tierCheckedAt
    if (ageMs >= 0 && ageMs < recheckHours * 3600 * 1000) {
      return { ok: true, tier: secret.tier, fromCache: true }
    }
  }

  const { tier: lcTier, lcTierMismatch } = await scrapeLcUserTier(secret.cookies, lcConfig)
  if (lcTier === null) {
    return { ok: false, error: 'Tier check inconclusive.' }
  }

  // Update the in-memory cache.
  lcTierCache = lcTier

  // Re-read the live entry before persisting. verifyLcTier can run concurrently
  // with ensureFreshCookies / removeAccount (main.js launches both at startup
  // unawaited), so the snapshot taken above may be stale. Merge only the tier
  // into the *current* entry; never write back the pre-await cookies (which
  // would log a just-refreshed user out) or resurrect a removed account.
  const liveEntry = store.lewdcorner
  if (!liveEntry) return { ok: false, error: 'Account removed during tier check.' }
  const liveSecret = readSecret(liveEntry)
  if (!liveSecret) return { ok: false, error: 'Credentials lost during tier check.' }

  store.lewdcorner = {
    username: liveEntry.username,
    method: liveEntry.method,
    secretEnc: encrypt(JSON.stringify({
      password: liveSecret.password || null,
      cookies: liveSecret.cookies,
      tier: lcTier,
      tierCheckedAt: Date.now(),
    })),
    updatedAt: liveEntry.updatedAt,
  }
  persist()
  rebuildCookieCache()

  return { ok: true, tier: lcTier, lcTierMismatch }
}

module.exports = {
  init,
  listAccounts,
  verifyAccount,
  verifyAccountBrowser,
  commitAccount,
  removeAccount,
  getCookieHeaderForUrl,
  refererForUrl,
  getLcUserTier,
  ensureFreshCookies,
  refreshAllAccounts,
  verifyLcTier,
  siteForUrl,
}
