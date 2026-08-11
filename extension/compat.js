// compat.js - one WebExtension API surface for Chrome, Edge and Firefox.
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// The three targets do not disagree about *which* APIs exist so much as about
// how they answer. Chromium MV3 returns promises from `chrome.*` when no
// callback is passed. Firefox returns promises from `browser.*`, but keeps a
// `chrome.*` alias that is callback-only for several methods -- notably
// storage and tabs. Code written against `chrome.storage.local.get(keys, cb)`
// therefore works everywhere, and code written against
// `await chrome.tabs.query(...)` silently resolves to undefined on Firefox.
// Picking one style and one namespace here is cheaper than auditing every call
// site for that asymmetry forever.
//
// The rule: prefer `browser` when it exists (Firefox, promise-native), fall
// back to `chrome` (Chromium MV3, also promise-native). Everything downstream
// then gets to `await` unconditionally.
//
// A polyfill package (webextension-polyfill) would do the same job, but the
// extension has no bundler -- the files are loaded raw, unpacked, straight off
// disk by Atlas -- so adding one means adding a build step to ship ~20 lines
// of behaviour.
//
// ── Loading ──────────────────────────────────────────────────────────────────
//
// Content scripts and the popup load this by declaration order (manifest
// content_scripts js array / <script> tag). The background context differs by
// browser and is handled at the top of background.js; see the note there.
//
// Content scripts from the same extension share one isolated-world global, so
// assigning to globalThis here is visible to content.js loaded after it.

;(function initAtlasCompat() {
  // Firefox exposes both; `browser` is the promise-native one, so it wins.
  const api =
    typeof globalThis.browser !== 'undefined' && globalThis.browser?.runtime
      ? globalThis.browser
      : globalThis.chrome

  globalThis.atlasBrowser = api

  // getBrowserInfo is Gecko-only and has stayed that way. Used for the two
  // places where Firefox genuinely needs different behaviour rather than a
  // different spelling: MV3 host permissions are optional-by-default there, so
  // the popup has to offer a "grant access" affordance that Chromium neither
  // needs nor can render.
  globalThis.atlasIsFirefox =
    typeof api?.runtime?.getBrowserInfo === 'function'

  // Host permissions the extension needs to do anything useful. Declared in
  // every manifest, but only *granted* at install time on Chromium.
  globalThis.atlasHostPermissions = [
    '*://*.f95zone.to/*',
    '*://*.lewdcorner.com/*',
  ]

  // True when the extension may actually touch the forums. Always true on
  // Chromium; on Firefox it is false until the user opts in.
  globalThis.atlasHasHostAccess = async () => {
    try {
      if (!api?.permissions?.contains) return true
      return await api.permissions.contains({
        origins: globalThis.atlasHostPermissions,
      })
    } catch {
      // A browser that cannot answer is not a browser that should block the
      // UI. The forum request will fail visibly on its own if access is
      // genuinely missing.
      return true
    }
  }
})()
