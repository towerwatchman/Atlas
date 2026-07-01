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
const { SITES, login, checkCookiesLive, cookieHeaderFromArray } = require('./xenforoAuth')
const { loginWithBrowser } = require('./browserLogin')

let storePath = null
// On-disk shape: { [site]: { username, secretEnc (base64), updatedAt } }
// where secretEnc decrypts to JSON { password, cookies: [{name,value,domain,path}] }
let store = {}
// In-memory decrypted cookie header per site, for the synchronous webRequest path.
const cookieHeaderCache = Object.create(null)

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
  for (const site of Object.keys(SITES)) cookieHeaderCache[site] = ''
  for (const [site, entry] of Object.entries(store)) {
    if (!SITES[site]) continue
    const secret = readSecret(entry)
    if (secret && Array.isArray(secret.cookies)) {
      cookieHeaderCache[site] = cookieHeaderFromArray(secret.cookies)
    }
  }
}

function init(dataDir) {
  storePath = path.join(dataDir, 'accounts.json')
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
// One account per site; overwrites any existing account for the site.
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
  store[site] = {
    username: p.username,
    method: p.method,
    secretEnc: encrypt(JSON.stringify({ password: p.password, cookies: p.cookies })),
    updatedAt: Date.now(),
  }
  persist()
  rebuildCookieCache()
  pending.delete(site)
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
    store[site] = {
      username: entry.username,
      secretEnc: encrypt(JSON.stringify({ password: secret.password, cookies })),
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

module.exports = {
  init,
  listAccounts,
  verifyAccount,
  verifyAccountBrowser,
  commitAccount,
  removeAccount,
  getCookieHeaderForUrl,
  refererForUrl,
  ensureFreshCookies,
  refreshAllAccounts,
  siteForUrl,
}
