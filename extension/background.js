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
})
