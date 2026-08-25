 // background.js - Atlas Browser Extension background context
//
// ── How this file gets `atlasBrowser` ────────────────────────────────────────
//
// Chromium runs this as an MV3 service worker declared via
// `background.service_worker`, which cannot list a second file -- so compat.js
// is pulled in with importScripts, which is available in a worker global and
// nowhere else.
//
// Firefox runs MV3 backgrounds as non-persistent event pages declared via
// `background.scripts`, an array. compat.js is listed first there and is
// already loaded by the time this runs; importScripts does not exist in that
// context, and calling it would throw before a single listener registered.
//
// Hence the double guard: only call it where it exists, and only if the shim
// has not already been loaded by the manifest. That second half also covers a
// future Firefox that switches to service_worker, where both mechanisms would
// otherwise fire.
if (typeof importScripts === 'function' && !globalThis.atlasBrowser) {
  importScripts('./compat.js')
}

const api = globalThis.atlasBrowser

const DEFAULT_RPC_PORT = 57096
let rpcPort = DEFAULT_RPC_PORT
let rpcURL = `http://127.0.0.1:${rpcPort}`

// Pairing token, copied by the user from Atlas Settings. Atlas rejects every
// request without it, so a page the user happens to be visiting cannot reach
// the local server and read their library.
let rpcToken = ''

// Promise form rather than the old callback form: see compat.js for why the
// callback signature is not portable to Firefox.
const loadToken = async () => {
  try {
    const result = await api.storage.local.get(['rpcToken'])
    if (result && result.rpcToken) rpcToken = result.rpcToken
  } catch (err) {
    console.warn('Atlas: could not read stored pairing token:', err)
  }
}
loadToken()

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.rpcToken) {
    rpcToken = changes.rpcToken.newValue || ''
  }
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const rpcCall = async (method, path, body, tabId) => {
  if (
    typeof method !== 'string' ||
    typeof path !== 'string' ||
    (typeof body !== 'string' && body !== null)
  ) {
    return null
  }
  try {
    const headers = {}
    if (body) headers['Content-Type'] = 'application/json'
    // Atlas answers 401 to anything without this. An empty token is still
    // sent so the server's reply is a clean 401 rather than a network error,
    // which is what lets the popup say "not paired" instead of "offline".
    headers['X-Atlas-Token'] = rpcToken

    const res = await fetch(`${rpcURL}${path}`, {
      method: method,
      headers: headers,
      body: body,
    })
    if (!res.ok) {
      throw res.status
    }
    return res
  } catch (err) {
    if (tabId) {
      Promise.resolve(
        api.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            alert(
              'Could not connect to Atlas!\nIs Atlas running and RPC enabled in Settings?',
            )
          },
        }),
      ).catch(() => {})
    }
    return null
  }
}

const notifyTabsToRefresh = async () => {
  try {
    const tabs = await api.tabs.query({
      url: ['*://*.f95zone.to/*', '*://*.lewdcorner.com/*'],
    })
    for (const tab of tabs || []) {
      if (tab && tab.id) {
        // Firefox rejects rather than resolving-with-lastError when no content
        // script is listening in that tab, so the catch is load-bearing there.
        Promise.resolve(
          api.tabs.sendMessage(tab.id, { action: 'refresh' }),
        ).catch(() => {})
      }
    }
  } catch (err) {
    console.warn('Error notifying tabs:', err)
  }
}

const addGame = async (url, tabId) => {
  await rpcCall('POST', '/api/games/add', JSON.stringify([url]), tabId)
  await sleep(400)
  await notifyTabsToRefresh()
}

// ── Remote AtlasDB queue-refresh (admin API) ────────────────────────────────
//
// The content script cannot safely do a credentialed cross-origin POST itself
// in every browser, so it asks the background to perform it. credentials:
// "include" is required so the user's existing atlas-gamesdb.com session cookie
// is sent; without it the admin endpoint returns 401.
const ATLAS_GAMESDB_ORIGIN = 'https://atlas-gamesdb.com'

// Cache admin-session check for a few minutes so MutationObserver + page
// navigations do not hammer the admin origin.
let adminSessionCache = { ok: false, checkedAt: 0 }
const ADMIN_SESSION_TTL_MS = 5 * 60 * 1000

const checkAdminSession = async (force = false) => {
  const now = Date.now()
  if (
    !force &&
    adminSessionCache.checkedAt &&
    now - adminSessionCache.checkedAt < ADMIN_SESSION_TTL_MS
  ) {
    return adminSessionCache.ok
  }

  try {
    // Hitting /admin/home:
    //   - logged in  → stays on /admin/home
    //   - logged out → redirected to /admin
    const res = await fetch(`${ATLAS_GAMESDB_ORIGIN}/admin/home`, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    })

    const finalUrl = (res.url || '').toLowerCase()
    const ok = finalUrl.includes('/admin/home')

    adminSessionCache = { ok, checkedAt: now }
    return ok
  } catch (err) {
    console.warn('[Atlas] admin session check failed:', err)
    adminSessionCache = { ok: false, checkedAt: now }
    return false
  }
}

const queueF95Refresh = async (f95Id, source) => {
  const id = Number(f95Id)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid thread id')
  }

  const body = { f95Id: id }
  if (source) body.source = source

  const res = await fetch(`${ATLAS_GAMESDB_ORIGIN}/admin/api/f95-refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  })

  let data = null
  try {
    data = await res.json()
  } catch (_) {
    // non-JSON body is fine; we still surface status
  }

  if (res.status >= 200 && res.status < 300) {
    // Successful queue implies a valid admin session — refresh the cache.
    adminSessionCache = { ok: true, checkedAt: Date.now() }
    return data || {}
  }

  // Auth failure → clear cache so the button disappears on next check
  if (res.status === 401 || res.status === 403) {
    adminSessionCache = { ok: false, checkedAt: Date.now() }
  }

  const errMsg =
    (data && (data.error || data.message)) ||
    (typeof data === 'string' ? data : null) ||
    `HTTP ${res.status}`
  throw new Error(`${res.status}: ${errMsg}`)
}

// Firefox keeps context menus under browser.menus and aliases contextMenus
// only when that permission is present. Chromium has no `menus` namespace at
// all. Resolve once rather than at every call site.
const menus = api.contextMenus || api.menus

// Extension Lifecycle Setup
api.runtime.onInstalled.addListener(() => {
  if (!menus) return

  menus.create({
    id: 'add-page-to-atlas',
    title: 'Add this game to wishlist',
    contexts: ['page'],
    documentUrlPatterns: [
      '*://*.f95zone.to/threads/*',
      '*://*.lewdcorner.com/threads/*',
    ],
  })

  menus.create({
    id: 'add-link-to-atlas',
    title: 'Add this game to wishlist',
    contexts: ['link'],
    targetUrlPatterns: [
      '*://*.f95zone.to/threads/*',
      '*://*.lewdcorner.com/threads/*',
    ],
  })
})

if (menus) {
  menus.onClicked.addListener((info, tab) => {
    if (tab && tab.id) {
      switch (info.menuItemId) {
        case 'add-page-to-atlas':
          addGame(info.pageUrl, tab.id)
          break
        case 'add-link-to-atlas':
          addGame(info.linkUrl || info.pageUrl, tab.id)
          break
      }
    }
  })
}

// ── There is deliberately no action.onClicked listener here ──────────────────
//
// There used to be one, and it never ran. `action.default_popup` is set in
// every manifest, and when a popup is declared the browser opens it instead of
// dispatching onClicked -- in Chrome, Edge and Firefox alike. The toolbar-click
// path is served by the "Add Current Page to Atlas" button in popup.js, which
// is the code that was actually doing the work all along. Re-adding a listener
// here will not fix a toolbar button that appears unresponsive; removing
// default_popup from the manifests is the only thing that would, and that
// would cost the pairing UI.

// Handle messages from content.js (proxy RPC requests cleanly to prevent
// cross-origin issues or special permission popups)
api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'get_data') {
    Promise.all([
      rpcCall('GET', '/api/games', null),
      rpcCall('GET', '/api/settings', null),
    ])
      .then(async ([resG, resS]) => {
        const games = resG ? await resG.json() : []
        const settings = resS ? await resS.json() : {}
        sendResponse({ games, settings })
      })
      .catch(() => {
        sendResponse({ games: [], settings: {} })
      })
    return true // async response
  }

  if (request && request.action === 'queue_f95_refresh') {
    queueF95Refresh(request.f95Id, request.source)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : String(err),
        }),
      )
    return true // async response
  }

  if (request && request.action === 'check_admin_session') {
    checkAdminSession(Boolean(request.force))
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }))
    return true // async response
  }
})