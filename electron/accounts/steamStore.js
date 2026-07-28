'use strict'

// Persistent store for the connected Steam account. Kept deliberately separate
// from accountStore.js: Steam is key-based (a Web API key), not cookie-based
// like the XenForo forum accounts, so folding it into that SITES/cookie machinery
// would only muddy both.
//
// On-disk shape (steam.json):
//   {
//     steamId:   "7656119…",        // clear — public id, used for display + API
//     persona:   "displayName",     // clear — cosmetic
//     apiKeyEnc: "base64…",         // encrypted via safeStorage (OS keychain/DPAPI)
//     ownedCache: { fetchedAt, games: [...] },  // reconciled at read time, not here
//     updatedAt: 1699999999999
//   }
//
// The API key is the only secret, so it's the only field encrypted at rest.

const fs = require('fs')
const path = require('path')
const { safeStorage } = require('electron')
const steamAuth = require('./steamAuth')

let storePath = null
let store = {} // in-memory mirror of steam.json

// Owned-games cache is considered fresh for this long; past it, a read triggers
// a background refetch. A manual refresh always refetches regardless.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Bumped whenever the shape of a cached entry or the set of GetOwnedGames
// request parameters changes. A cache written by an older schema is treated as
// stale immediately rather than being trusted for up to CACHE_TTL_MS.
//
// This exists because of v2: the request was missing include_free_sub and
// skip_unvetted_apps, so every cached list was already missing the user's
// unplayed free-to-play, delisted and age-gated games. Without the version
// check, fixing the request would have appeared to do nothing for a day.
const OWNED_CACHE_SCHEMA = 2

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encrypt(plainString) {
  return safeStorage.encryptString(plainString).toString('base64')
}

function decrypt(b64) {
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
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
    console.warn('steamStore: could not read steam.json:', err.message)
    store = {}
  }
}

function persist() {
  try {
    const tmp = storePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
    fs.renameSync(tmp, storePath)
  } catch (err) {
    console.error('steamStore: failed to persist steam.json:', err.message)
  }
}

function init(dataDir) {
  storePath = path.join(dataDir, 'steam.json')
  load()
}

function getApiKey() {
  if (!store.apiKeyEnc) return null
  return decrypt(store.apiKeyEnc)
}

// Public-facing connection state (never exposes the key itself).
function status() {
  const connected = Boolean(store.steamId && store.apiKeyEnc)
  return {
    connected,
    steamId: store.steamId || null,
    persona: store.persona || null,
    hasApiKey: Boolean(store.apiKeyEnc),
    updatedAt: store.updatedAt || null,
    cachedAt: store.ownedCache ? store.ownedCache.fetchedAt : null,
    cachedCount: store.ownedCache && Array.isArray(store.ownedCache.games)
      ? store.ownedCache.games.length
      : 0,
    // A cache written before OWNED_CACHE_SCHEMA's current value is known to be
    // an incomplete library (it predates include_free_sub/skip_unvetted_apps),
    // and getOwnedGames() will discard it on the next read. Reporting that here
    // stops Settings from advertising a count it is about to throw away — which
    // is what made the panel and the importer disagree until a manual refresh.
    cacheIncomplete: Boolean(store.ownedCache) && store.ownedCache.schema !== OWNED_CACHE_SCHEMA,
  }
}

// Step 1 of connecting: run the OpenID sign-in and remember the SteamID.
// The key is set separately (setApiKey) so the UI can guide the user through
// obtaining it after we know who they are.
async function signIn() {
  const result = await steamAuth.signInWithSteam()
  if (!result.ok) return result
  store.steamId = result.steamId
  store.updatedAt = Date.now()
  // Preserve any existing key/persona across a re-sign-in of the same account;
  // clear the owned cache since identity may have changed.
  if (store.ownedCache) delete store.ownedCache
  persist()
  return { ok: true, steamId: result.steamId }
}

// Step 2: validate + store the user's Web API key. Requires a prior signIn so we
// have a SteamID to validate against.
async function setApiKey(apiKey) {
  if (!store.steamId) {
    return { ok: false, error: 'Sign in through Steam first, then add your API key.' }
  }
  if (!encryptionAvailable()) {
    return {
      ok: false,
      error:
        'Secure credential storage is unavailable on this system, so the Steam ' +
        'API key cannot be saved safely. (On Linux this usually means no keyring is set up.)',
    }
  }
  const check = await steamAuth.validateApiKey(apiKey, store.steamId)
  if (!check.ok) return check

  store.apiKeyEnc = encrypt(String(apiKey).trim())
  store.updatedAt = Date.now()
  delete store.ownedCache // force a fresh pull on next read
  persist()
  return { ok: true }
}

function disconnect() {
  store = {}
  persist()
  return { ok: true }
}

// Reconcile a normalized owned-games list against locally-installed Steam games
// (from the disk scanner), tagging each with install state. Join key is appid.
//
// This is a UNION, not a left join on the owned list, and that matters. Steam
// hides some titles from GetOwnedGames entirely — free titles in particular are
// omitted regardless of include_played_free_games/include_free_sub/
// skip_unvetted_apps, which was verified against a real account by running every
// parameter permutation and getting an identical count each time. So the API list
// is authoritative for what the account OWNS but is not a complete picture of
// what is in the library.
//
// The local appmanifest scan does see those titles: appmanifest_<appid>.acf has
// the appid, the real name, the install dir and the size on disk. An installed
// game the API refuses to mention is therefore still perfectly importable, and
// dropping it (which is what mapping over ownedGames alone did) is the reason a
// game could be installed, playable, visible in the Steam client, and yet absent
// from Atlas's import wizard.
//
// Local-only entries are flagged with apiListed:false so the UI can say why they
// look different, and carry playtime 0 because the API is the only playtime
// source and it does not report these.
function reconcileInstalled(ownedGames, installedGames) {
  const installedByAppId = new Map()
  for (const g of installedGames || []) {
    if (g && g.appid) installedByAppId.set(String(g.appid), g)
  }

  const ownedAppIds = new Set()
  const merged = (ownedGames || []).map((g) => {
    const appId = String(g.appid)
    ownedAppIds.add(appId)
    const installed = installedByAppId.get(appId) || null
    return {
      ...g,
      installed: Boolean(installed),
      installDir: installed ? installed.installDir : null,
      sizeOnDisk: installed ? installed.size || 0 : 0,
      apiListed: true,
    }
  })

  for (const [appId, installed] of installedByAppId) {
    if (ownedAppIds.has(appId)) continue
    const name = typeof installed.name === 'string' ? installed.name.trim() : ''
    merged.push({
      appid: appId,
      // The .acf name is Steam's own, so it needs no enrichment to be useful.
      name: name || `App ${appId}`,
      playtimeForever: 0,
      playtimeRecent: 0,
      iconHash: null,
      hasStoreInfo: name.length > 0,
      installed: true,
      installDir: installed.installDir || null,
      sizeOnDisk: installed.size || 0,
      // Found on disk but absent from GetOwnedGames.
      apiListed: false,
    })
  }

  return merged
}

// Read the owned-games list. Uses the on-disk cache when fresh unless forceRefresh
// is set. `installedGames` is supplied by the caller (main process has the scanner)
// so this module stays free of scanner/db dependencies. Returns:
//   { ok, games, fetchedAt, fromCache } | { ok:false, code?, error }
async function getOwnedGames({ installedGames = [], forceRefresh = false } = {}) {
  if (!store.steamId) {
    return { ok: false, code: 'not_connected', error: 'No Steam account is connected.' }
  }
  const apiKey = getApiKey()
  if (!apiKey) {
    return { ok: false, code: 'no_key', error: 'No Steam API key is saved. Add one in Settings \u2192 Accounts.' }
  }

  const cache = store.ownedCache
  const cacheCurrent = cache && cache.schema === OWNED_CACHE_SCHEMA
  const cacheFresh =
    cacheCurrent &&
    Array.isArray(cache.games) &&
    Date.now() - (cache.fetchedAt || 0) < CACHE_TTL_MS

  if (!forceRefresh && cacheFresh) {
    return {
      ok: true,
      fromCache: true,
      fetchedAt: cache.fetchedAt,
      games: reconcileInstalled(cache.games, installedGames),
    }
  }

  try {
    const games = await steamAuth.getOwnedGames(apiKey, store.steamId)
    store.ownedCache = { schema: OWNED_CACHE_SCHEMA, fetchedAt: Date.now(), games }
    persist()
    return {
      ok: true,
      fromCache: false,
      fetchedAt: store.ownedCache.fetchedAt,
      games: reconcileInstalled(games, installedGames),
    }
  } catch (err) {
    // On a network hiccup, fall back to whatever cache we have rather than
    // leaving the user with nothing.
    if (cache && Array.isArray(cache.games)) {
      return {
        ok: true,
        fromCache: true,
        stale: true,
        // An old-schema cache is incomplete (see OWNED_CACHE_SCHEMA) but is
        // still better than showing the user nothing when Steam is unreachable.
        incomplete: !cacheCurrent,
        fetchedAt: cache.fetchedAt,
        games: reconcileInstalled(cache.games, installedGames),
      }
    }
    const code = err.code === 'invalid_key' ? 'invalid_key' : 'network'
    return { ok: false, code, error: err.message || 'Could not fetch your Steam library.' }
  }
}

module.exports = {
  init,
  status,
  signIn,
  setApiKey,
  disconnect,
  getOwnedGames,
  getApiKey,
}
