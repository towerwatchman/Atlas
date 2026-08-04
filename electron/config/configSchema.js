'use strict'

// ── Config schema ────────────────────────────────────────────────────────────
//
// There used to be TWO `defaultConfig` objects — one in electron/main.js and one
// in electron/ipc/settings.js — and they had drifted apart. main.js knew about
// [Updates], [WindowBounds], Library.rootPath, Metadata.imageCacheSizeMB and
// Appearance.detailLayout; settings.js knew about [Importer] and
// Metadata.steamAssetSourceOrder. That caused active data loss:
//
//   get-settings returned mergeWithDefaults(appConfig, <settings.js defaults>),
//   and that merge iterates Object.keys(defaults) for SECTIONS, so any section
//   missing from settings.js's copy was dropped from the result. Every renderer
//   save path then does getConfig() -> spread the whole object -> saveSettings(),
//   and save-settings writes exactly what it receives. Net effect: changing ANY
//   setting silently deleted [Updates] and [WindowBounds] from config.ini —
//   losing every window's saved position/size and resetting the update-channel
//   baseline to 0.0.0.
//
// This module is now the only definition. Both consumers import it, so the two
// copies cannot drift again.
//
// It is intentionally dependency-free (no electron, no fs) so it can be required
// from the main process, the ipc layer, and tests alike.

// Bump when a migration is added to configSanitizer.js. Stamped into
// [Meta] configVersion so a 0.7-era file can be told apart from a current one —
// previously there was no version marker anywhere, which is why stale keys could
// accumulate indefinitely with no way to know what needed cleaning.
const { DEFAULT_SEARCH_FIELD_IDS } = require('../db/searchFields')

const CONFIG_VERSION = 3

// Sections whose KEY NAMES are generated at runtime and therefore cannot be
// enumerated in a static default. The sanitizer must never treat an unknown key
// in one of these as stale — WindowBounds legitimately holds
// `<WindowName>X/Y/Width/Height/Maximized` for every window the user has opened.
const DYNAMIC_SECTIONS = {
  WindowBounds: /^[A-Za-z0-9]+(X|Y|Width|Height|Maximized)$/,
}

// Keys that older builds wrote and that NOTHING in the current tree reads.
//
// Every entry here has been verified against a real config.ini by grepping the
// whole of electron/ and src/ for reads — an earlier version of this list was
// written from guesswork about what 0.7 might have stored, matched nothing at
// all on a real file, and gave a false impression that the config had been
// cleaned. Do not add to this list speculatively: keys that are merely
// unrecognised are reported by the Client Check (see configSanitizer's
// unknownKeys) and only graduate to removal once confirmed dead.
const DEPRECATED_KEYS = {
  Interface: [
    // Superseded by Appearance.detailLayout. The two are from different
    // generations of the detail page — this one holds the old
    // { order: [...], sizes: {...} } shape while detailLayout holds the current
    // { rows: [{ type: 'columns', ... }] } shape. Only detailLayout is read
    // (src/components/detail/GameDetailPage.jsx).
    'detailsPageLayout',
    'detailsPageModuleOrder',
  ],
}

// Whole sections no longer used. Empty on purpose: no real config has yet shown
// one, and inventing entries here is exactly the mistake described above.
const DEPRECATED_SECTIONS = []

// `rootPath` defaults to the data directory, so the defaults depend on where
// that is — hence a builder rather than a frozen object.
// Keys that have moved to their own file and are removed by a dedicated
// migration, not by the deprecation sweep. Listed so the Client Check does not
// report them as unrecognised while the migration is pending.
const MIGRATED_KEYS = {
  // -> templates/banner-layout-active.json (electron/config/bannerLayoutStore.js).
  // Was 18,421 bytes on a real config: 89% of the entire file.
  Appearance: ['customBannerLayout'],
}

const buildDefaultConfig = (dataDir = '') => ({
  Meta: {
    configVersion: CONFIG_VERSION,
  },
  Interface: {
    language: 'English',
    atlasStartup: 'Do Nothing',
    gameStartup: 'Do Nothing',
    showDebugConsole: false,
    minimizeToTray: false,
    checkForAppUpdatesOnStartup: true,
    appUpdateBranch: null,
    showGameList: true,
    sidePanelMode: 'games',
  },
  // Per-channel record of the app version last INSTALLED from each update
  // channel. The updater compares the active channel's latest release against
  // THIS baseline rather than the running build's version, which is what lets a
  // channel switch behave correctly. Empty = never installed from that channel.
  // Was being wiped on every settings save; see the header comment.
  Updates: {
    stableVersion: '',
    nightlyVersion: '',
  },
  Library: {
    rootPath: dataDir,
    gameFolder: '',
    // Where downloaded archives land BEFORE they are installed.
    // Deliberately not derived from gameFolder: the library folder holds
    // installed games, and dropping half-finished archives into it means
    // a library scan sees partial downloads as games. Empty falls back to
    // the OS downloads directory, never to a subfolder of the library.
    downloadsFolder: '',
    gameExtensions: 'exe,swf,flv,f4v,rag,cmd,bat,jar,html',
    extractionExtensions: 'zip,7z,rar',
    libraryFolderStructure: '{creator}/{title}/{version}',
    autoSelectLatestReplaceVersion: false,
    validatePathsOnStartup: false,
    sevenZipPath: '',
  },
  Metadata: {
    downloadPreviews: false,
    mediaStorageMode: 'stream',
    sourceOrder: 'f95,lewdcorner,steam',
    // Order Atlas tries Steam's art sources in when resolving
    // header/hero/capsule/logo — see steamscanner.js resolveLibraryAssets().
    steamAssetSourceOrder: 'fastly,akamaihd,getitems',
    // Max size (MB) of Chromium's disk cache for streamed banner/preview
    // images. Applied at startup via --disk-cache-size.
    imageCacheSizeMB: 1024,
  },
  Importer: {
    sourceGamePath: '',
    sourceFolderStructure: '{creator}/{title}/{version}',
    useUnstructured: true,
    downloadBannerImages: null,
    downloadPreviewImages: null,
    previewLimit: 'Unlimited',
    downloadVideos: false,
    scanSize: false,
    moveFoldersToLibrary: false,
    deleteSourceArchiveAfterImport: false,
    includeUnmatched: false,
    forceReimport: false,
  },
  Extension: {
    rpcEnabled: true,
    rpcPort: 57096,
    backgroundAdd: true,
    iconGlow: true,
    highlightTags: false,
    tagHighlights: {},
  },
  Performance: {
    maxHeapSize: 4096,
    mediaDownloadConcurrency: 3,
    mediaPerHostConcurrency: 2,
    mediaRequestDelayMs: 100,
  },
  Appearance: {
    themeId: 'default',
    layout: 'sidebar',
    detailLayout: '{"rows":[{"type":"columns","columns":[{"mode":"flex"},{"mode":"fixed","px":360}],"cells":[["previews"],["versions","rating","details","links","tags"]]}]}',
    navDisplayMode: 'icons',
    accentBarEnabled: true,
    filterSidebarSide: 'right',
    filterSidebarMode: 'overlay',
    customTheme: '',
    // Short id of the active banner layout, mirroring how themeId names a theme
    // whose definition lives in templates/theme/*.json. The layout itself is NOT
    // stored here — see MIGRATED_KEYS above.
    bannerTemplate: 'Default',
  },
  // Which fields the search box looks at when no per-search override is chosen.
  // Comma-separated field ids from electron/db/searchFields.js. Stored as a
  // string rather than a list because ini has no array type and every other
  // list-valued setting here (gameExtensions, sourceOrder, …) uses the same
  // convention.
  Search: {
    defaultFields: DEFAULT_SEARCH_FIELD_IDS.join(','),
  },
  // Whether the user has opted in to NSFW/adult ("Browse mode") content.
  // Deliberately NOT folded into another section — nsfwConfigured detection
  // checks for the literal ABSENCE of this key in the saved ini to decide
  // whether to show the first-run confirmation.
  NSFW: {
    enabled: false,
  },
  WindowBounds: {},
})

// Deep-merge a parsed ini over the defaults so every known key always has a
// value, coercing the strings ini.parse() produces back to booleans/numbers
// where the default says so.
//
// Unknown keys inside a KNOWN section are preserved — that is what keeps
// WindowBounds' generated keys alive, and it means a config written by a newer
// build survives being opened by an older one. Pruning stale keys is the
// sanitizer's job (explicit list, with a backup), not this function's.
const mergeWithDefaults = (parsed, defaults) => {
  const result = {}
  for (const section of Object.keys(defaults)) {
    result[section] = { ...defaults[section] }
    if (!parsed || !parsed[section]) continue
    for (const key of Object.keys(defaults[section])) {
      const raw = parsed[section][key]
      if (raw === undefined) continue
      const def = defaults[section][key]
      if (typeof def === 'boolean') {
        result[section][key] = raw === true || raw === 'true'
      } else if (typeof def === 'number') {
        const n = Number(raw)
        result[section][key] = Number.isFinite(n) ? n : def
      } else {
        result[section][key] = raw
      }
    }
    for (const key of Object.keys(parsed[section])) {
      if (!(key in defaults[section])) result[section][key] = parsed[section][key]
    }
  }
  // Sections present on disk but absent from the defaults are carried through
  // untouched. Dropping them here is exactly the bug that deleted [Updates] and
  // [WindowBounds]; the sanitizer decides what is genuinely stale.
  if (parsed && typeof parsed === 'object') {
    for (const section of Object.keys(parsed)) {
      if (section in result) continue
      const value = parsed[section]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[section] = { ...value }
      }
    }
  }
  return result
}

const isDynamicSectionKey = (section, key) => {
  const pattern = DYNAMIC_SECTIONS[section]
  return Boolean(pattern && pattern.test(key))
}

module.exports = {
  CONFIG_VERSION,
  DYNAMIC_SECTIONS,
  DEPRECATED_KEYS,
  DEPRECATED_SECTIONS,
  MIGRATED_KEYS,
  buildDefaultConfig,
  mergeWithDefaults,
  isDynamicSectionKey,
}
