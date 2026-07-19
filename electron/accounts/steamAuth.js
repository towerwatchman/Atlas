'use strict'

// Steam authentication + Web API access for the owned-library feature.
//
// Two distinct pieces of identity are involved and it's worth being precise:
//
//   1. SteamID  — the user's public 64-bit account id. We obtain this via Steam's
//      OpenID 2.0 "Sign in through Steam" flow, opened in an embedded, ephemeral
//      BrowserWindow (same pattern as browserLogin.js). OpenID gives us identity
//      ONLY — it grants no authority over the account, which is exactly why it's
//      safe and why Valve blesses it for third-party sites.
//
//   2. Web API key — a per-user key the user registers once at
//      https://steamcommunity.com/dev/apikey. This is what authorizes read calls
//      like IPlayerService/GetOwnedGames. Storing each user's own key (encrypted)
//      avoids baking an extractable shared secret into the distributed binary.
//
// This module performs NO account actions (no install, launch, purchase). It
// reads identity and the owned-games list, nothing more.

const { BrowserWindow } = require('electron')

const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
// The realm/return_to don't have to resolve to a real server for the desktop
// OpenID flow — Steam redirects the embedded window back to this URL with the
// claimed id appended, and we intercept that navigation before it ever loads.
const REALM = 'https://atlas-gamesdb.com'
const RETURN_TO = 'https://atlas-gamesdb.com/steam/openid/return'

// Steam's claimed_id comes back as a URL ending in the 64-bit id.
const STEAMID_RE = /https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

// ── OpenID sign-in ──────────────────────────────────────────────────────────

// Build the OpenID 2.0 authentication request URL (checkid_setup).
function buildAuthUrl() {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': RETURN_TO,
    'openid.realm': REALM,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  })
  return `${OPENID_ENDPOINT}?${params.toString()}`
}

// Verify the OpenID assertion by echoing the response params back to Steam with
// mode=check_authentication. This is the step that makes the flow trustworthy:
// it proves the redirect actually came from Steam and wasn't forged. Returns the
// validated SteamID string, or null.
async function verifyAssertion(responseUrl) {
  let url
  try {
    url = new URL(responseUrl)
  } catch {
    return null
  }
  const params = url.searchParams
  const claimedId = params.get('openid.claimed_id') || ''
  const match = claimedId.match(STEAMID_RE)
  if (!match) return null
  const steamId = match[1]

  // Echo everything back, flipping mode to check_authentication.
  const verifyParams = new URLSearchParams()
  for (const [k, v] of params.entries()) verifyParams.set(k, v)
  verifyParams.set('openid.mode', 'check_authentication')

  try {
    const res = await fetch(OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verifyParams.toString(),
    })
    const text = await res.text()
    if (/is_valid\s*:\s*true/i.test(text)) return steamId
    return null
  } catch (err) {
    console.warn('steamAuth: OpenID verification request failed:', err.message)
    return null
  }
}

// Open the embedded Steam login window and resolve with the verified SteamID.
// Mirrors browserLogin.js: ephemeral partition, single-settle guard, window is
// destroyed on completion or cancel. Returns { ok, steamId?, error? }.
function signInWithSteam() {
  return new Promise((resolve) => {
    const partition = `steam-openid-${Date.now()}`
    const win = new BrowserWindow({
      width: 500,
      height: 720,
      title: 'Sign in through Steam',
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      try {
        if (!win.isDestroyed()) win.destroy()
      } catch {
        /* already gone */
      }
      resolve(result)
    }

    // Intercept the redirect back to our return_to before it loads. Steam sends
    // the browser to RETURN_TO?…openid params…; we catch it, verify, and stop.
    const onRedirect = async (event, targetUrl) => {
      if (!targetUrl || !targetUrl.startsWith(RETURN_TO)) return
      event.preventDefault()
      const steamId = await verifyAssertion(targetUrl)
      if (steamId) {
        finish({ ok: true, steamId })
      } else {
        finish({ ok: false, error: 'Could not verify the Steam sign-in response.' })
      }
    }

    win.webContents.on('will-redirect', onRedirect)
    win.webContents.on('will-navigate', onRedirect)

    win.on('closed', () => {
      // User closed the window without completing sign-in.
      if (!settled) {
        settled = true
        resolve({ ok: false, error: 'Sign-in window was closed before completing.' })
      }
    })

    win.loadURL(buildAuthUrl()).catch((err) => {
      finish({ ok: false, error: `Could not open Steam sign-in: ${err.message}` })
    })
  })
}

// ── Web API ─────────────────────────────────────────────────────────────────

const OWNED_GAMES_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'

// Low-level GetOwnedGames call. Returns the raw `response` object from Steam, or
// throws on a transport/HTTP error. include_appinfo=1 gives us name + img hashes;
// include_played_free_games=1 so free titles the user has played show up too.
async function fetchOwnedGames(apiKey, steamId) {
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    include_appinfo: '1',
    include_played_free_games: '1',
    format: 'json',
  })
  const res = await fetch(`${OWNED_GAMES_URL}?${params.toString()}`)
  if (res.status === 401 || res.status === 403) {
    const err = new Error('invalid_key')
    err.code = 'invalid_key'
    throw err
  }
  if (!res.ok) {
    throw new Error(`Steam API returned HTTP ${res.status}`)
  }
  const json = await res.json()
  return json && json.response ? json.response : {}
}

// Validate a key against a SteamID with a live probe. Distinguishes the two
// failure modes users actually hit:
//   - invalid_key: the key is wrong / revoked
//   - private_profile: key is fine but the profile's game details are private,
//     so GetOwnedGames returns no `games` array (Steam gives {} in that case).
// Returns { ok } | { ok:false, code, error }.
async function validateApiKey(apiKey, steamId) {
  const key = String(apiKey || '').trim()
  if (!/^[0-9A-Fa-f]{32}$/.test(key)) {
    return { ok: false, code: 'invalid_key', error: 'That does not look like a valid Steam Web API key (expected 32 hex characters).' }
  }
  try {
    const response = await fetchOwnedGames(key, steamId)
    // A public profile returns game_count + games (even if 0 owned, game_count
    // is present). A private profile returns an empty object.
    if (typeof response.game_count === 'undefined' && !Array.isArray(response.games)) {
      return {
        ok: false,
        code: 'private_profile',
        error: 'Your key works, but your Steam profile\u2019s game details are private. Set "Game details" to Public in your Steam privacy settings, then try again.',
      }
    }
    return { ok: true }
  } catch (err) {
    if (err.code === 'invalid_key') {
      return { ok: false, code: 'invalid_key', error: 'Steam rejected that API key. Double-check you copied it correctly.' }
    }
    return { ok: false, code: 'network', error: err.message || 'Could not reach the Steam API.' }
  }
}

// Fetch and normalize the owned-games list. Returns an array of:
//   { appid, name, playtimeForever, playtimeRecent, iconHash }
// iconHash lets the UI build a library-capsule URL without an extra call.
async function getOwnedGames(apiKey, steamId) {
  const response = await fetchOwnedGames(String(apiKey || '').trim(), steamId)
  const games = Array.isArray(response.games) ? response.games : []
  return games.map((g) => ({
    appid: String(g.appid),
    name: g.name || `App ${g.appid}`,
    playtimeForever: g.playtime_forever || 0,
    playtimeRecent: g.playtime_2weeks || 0,
    iconHash: g.img_icon_url || null,
  }))
}

module.exports = {
  signInWithSteam,
  validateApiKey,
  getOwnedGames,
}
