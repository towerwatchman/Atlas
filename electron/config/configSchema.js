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
const CONFIG_VERSION = 2

// Sections whose KEY NAMES are generated at runtime and therefore cannot be
// enumerated in a static default. The sanitizer must never treat an unknown key
// in one of these as stale — WindowBounds legitimately holds
// `<WindowName>X/Y/Width/Height/Maximized` for every window the user has opened.
const DYNAMIC_SECTIONS = {
  WindowBounds: /^[A-Za-z0-9]+(X|Y|Width|Height|Maximized)$/,
}

// Keys written by 0.7/0.8-era builds that no longer mean anything. Listed
// explicitly rather than inferred, so removal is a deliberate, reviewable act
// and an unrecognised key from a NEWER build is never destroyed by an older one.
const DEPRECATED_KEYS = {
  Interface: [
    'theme',              // superseded by Appearance.themeId
    'colorScheme',        // superseded by Appearance.themeId
    'accentColor',        // now part of the theme definition
    'viewMode',           // superseded by Appearance.layout
    'gridSize',           // superseded by the banner layout system
    'bannerSize',
    'showTitles',
    'enableAnimations',
    'startMinimized',     // never implemented
    'updateChannel',      // superseded by Interface.appUpdateBranch
  ],
  Library: [
    'defaultGameFolder',  // superseded by Library.gameFolder
    'scanOnStartup',      // superseded by Library.validatePathsOnStartup
    'autoImport',
    'archiveExtensions',  // superseded by Library.extractionExtensions
    'sevenZipLocation',   // superseded by Library.sevenZipPath
  ],
  Metadata: [
    'downloadBanners',    // moved to [Importer].downloadBannerImages
    'imageQuality',       // fixed by imageUtils now
    'bannerWidth',
    'previewWidth',
    'useF95',             // superseded by Metadata.sourceOrder
    'useSteam',
    'preferSteamArt',
  ],
  Performance: [
    'threadCount',        // superseded by mediaDownloadConcurrency
    'maxConcurrentDownloads',
    'enableGpu',
  ],
  Importer: [
    'lastSourcePath',     // superseded by Importer.sourceGamePath
    'flattenFolders',
  ],
}

// Whole sections from older builds that no longer exist.
const DEPRECATED_SECTIONS = ['Theme', 'Colors', 'Grid', 'Scanner', 'Proxy']

// `rootPath` defaults to the data directory, so the defaults depend on where
// that is — hence a builder rather than a frozen object.
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
  buildDefaultConfig,
  mergeWithDefaults,
  isDynamicSectionKey,
}
