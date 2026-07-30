'use strict'

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen, session, protocol, desktopCapturer } = require('electron')
const path = require('path')

// Local downloaded media (banners/previews) is served to renderers through a
// dedicated privileged scheme. Raw file:// URLs are blocked when the renderer
// is served over http (the Vite dev server), so this makes downloaded images
// load in both dev and packaged builds. Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'atlas-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
])

function mediaContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.webp': return 'image/webp'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.gif': return 'image/gif'
    case '.avif': return 'image/avif'
    case '.svg': return 'image/svg+xml'
    case '.bmp': return 'image/bmp'
    case '.mp4': return 'video/mp4'
    case '.webm': return 'video/webm'
    case '.m4v': return 'video/x-m4v'
    default: return 'application/octet-stream'
  }
}
const fs = require('fs')
// electron-updater compares currentVersion with its OWN nested copy of semver
// (electron-updater/node_modules/semver). Its comparison functions do
// `new SemVer(x)`, which rejects a SemVer instance created by any *other* copy
// of semver with: 'Invalid version. Must be a string. Got type "object".'
// So the baseline must be parsed with electron-updater's exact semver module,
// not the top-level one. Resolve that copy specifically; fall back to the
// hoisted/top-level semver only if the nested path is unavailable.
let semver
try {
  semver = require('electron-updater/node_modules/semver')
} catch {
  try {
    semver = require('semver')
  } catch {
    semver = null
  }
}
const fsp = require('fs').promises
const sharp = require('sharp')
const axios = require('axios')
const { autoUpdater } = require('electron-updater')
const { spawn } = require('child_process')
const { Worker } = require('worker_threads')
const ini = require('ini')
const cp = require('child_process')

const { isNewerVersion } = require('./utils/versionUtils')
const { normalizeUpdateError } = require('./utils/updateErrors')
const {
  addVersion, upsertVersion, updateVersion,
  findExistingRecordForImport, checkRecordExist, checkPathExist,
  getVersionForRecord, getInstalledVersionsForRecord, getVersionPathsForRecord,
  getGame, getGames, getCatalogGames,
} = require('./db/versions')

const {
  repairDoubledApostropheRows, repairStaleVersionExecutables,
  repairBlankVersionNames, repairMissingTotalPlaytime,
  validateGameMetadataOverrides, countGameMetadataOverrideRows,
} = require('./db/repair')

const {
  addGame, updateGame, removeGame, deleteGameCompletely,
  getGameRecordIds, countVersions, deleteVersion,
  getUniqueFilterOptions, recordGameLaunchStarted, recordGamePlaytime,
  setGameFavorite, setGamePersonalRatings, setGamePlaystate, setVersionPlaystate,
  getManualMappings, setManualMappings, setSelectedGameVersion,
  getGameOverrides, clearGameOverrides,
} = require('./db/games')

const {
  updateFolderSize, getBannerUrl, getScreensUrlList,
  updateBanners, updatePreviews, getRemotePreviewUrls, getSteamMovieThumbnails,
  getPreviews, getBanners, getBanner, getRemoteBannerUrl, getBrowsePreviewUrls,
  getSteamBrowseMediaForAppId,
  getAllDownloadableAssetUrlsForRecord, upsertMediaAsset,
  deleteBanner, deletePreviews,
} = require('./db/media')

const {
  searchAtlas, searchAtlasByF95Id, findF95Id, GetAtlasIDbyRecord,
  addAtlasMapping, getAtlasData, getImportRecordStatus, insertJsonData,
  recomputeNormalizedTitles,
} = require('./db/atlas')
const { getCatalogIndexStatus, rebuildCatalogIndex } = require('./db/catalogIndex')
const { isWriteLockBusy, activeWriteLockLabel } = require('./db/writeLock')
const { buildDefaultConfig, mergeWithDefaults } = require('./config/configSchema')
const { sanitizeConfigFile } = require('./config/configSanitizer')
const { migrateActiveLayoutToFile, readActiveLayout, writeActiveLayout } = require('./config/bannerLayoutStore')

const { checkDbUpdates } = require('./db/updates')

const {
  getSteamIDbyRecord, addSteamMapping, getSteamBannerUrl, getSteamScreensUrlList,
} = require('./db/steam')

const {
  saveEmulatorConfig, getEmulatorConfig, removeEmulatorConfig, getEmulatorByExtension,
} = require('./db/settings')

const {
  addWishlistEntry, removeWishlistEntry, toggleWishlistEntry,
  getWishlistEntries, getWishlistEntryIdentities,
} = require('./db/wishlist')

const { initializeDatabase } = require('./db/index')
// NOTE: do NOT destructure `db` from db/index at require time — it is null until
// initializeDatabase() runs. Read it live via dbIndex.db inside buildCtx instead.
const dbIndex = require('./db/index')

const { startSteamScan } = require('./scanners/steamscanner')
const { startScan } = require('./scanners/f95scanner')
const { deletePathWithElevationFallback } = require('./deleteUtils')

// IPC domain modules
const { registerGamesHandlers } = require('./ipc/games')
const registerWindowsHandlers = require('./ipc/windows')
const registerSettingsHandlers = require('./ipc/settings')
const registerUpdaterHandlers = require('./ipc/updater')
const registerMediaHandlers = require('./ipc/media')
const registerImporterHandlers = require('./ipc/importer')
const registerThemeHandlers = require('./ipc/themes')
const registerAccountsHandlers = require('./ipc/accounts')
const registerCollectionsHandlers = require('./ipc/collections')
const {
  resolveDataRoot, grantUsersModify, isElevated,
  getLegacyDataDirs, directorySize, migrateLegacyData,
} = require('./dataLocation')
const accountStore = require('./accounts/accountStore')

// ── Shared mutable state ────────────────────────────────────────────────────

const contextMenuData = new Map()
const recentlyDeletedGamePaths = new Map()
const gameDetailsRecordMap = new Map()

let contextMenuId = 0
let mainWindow
let settingsWindow
let importerWindow
let themeBuilderWindow
let bannerEditorWindow
let importSourceDialog
let executableChooserWindow = null
let appConfig
// True once the user has been asked (and answered) the NSFW/adult-content
// opt-in prompt at least once — distinct from appConfig.NSFW.enabled, which
// only tells us their current answer (true/false), not whether they've
// ever actually been asked. Detected by checking for the literal presence
// of the [NSFW] enabled key in the saved config.ini, not by reading the
// merged-with-defaults appConfig (which would always report a value).
let nsfwConfigured = false
// Result of the startup config prune, collected by the Client Check panel.
let configSanitizeReport = null
// Result of moving Appearance.customBannerLayout into its own file.
let bannerLayoutMigrationReport = null
let activeImportSession = null
let activeLibraryValidation = null
let activeScanSession = null
let isQuitting = false

let updateInfo = null
let updateDownloaded = false
let lastUpdateStatus = { status: 'idle' }
let installAfterDownload = false
let activeAppUpdateBranch = null

// Data always lives beside the executable. There is no AppData fallback: the old
// behaviour silently relocated to %APPDATA%\Atlas whenever the write probe
// failed, so the app could run from one root on one boot and another on the next
// with nothing reporting it — which is what made the cache failures so hard to
// place. If the folder is not writable we say so and offer to repair the
// permissions, rather than quietly moving.
//
// Declared HERE, above the resolveAppDataRoot() call below, and not next to the
// function itself. Function declarations hoist but `let` does not, so with the
// call site moved above the instance lock a declaration further down the file
// left this in the temporal dead zone and threw
// "Cannot access 'dataWriteState' before initialization".
let dataWriteState = { writable: true, error: null }

// ── Data root and Chromium storage redirect ─────────────────────────────────
// This runs BEFORE requestSingleInstanceLock() below, and the order is the whole
// point. Chromium's ProcessSingleton is keyed to the user-data-dir, so acquiring
// the lock initialises that path — and if we have not redirected it yet, it
// initialises at Electron's default, %APPDATA%\atlas, creating the folder we are
// trying to avoid. (Lowercase because app.getName() reads the top-level "name"
// field; the "Atlas" productName lives under "build" and is electron-builder
// config only, invisible at runtime.) Redirecting first also means the instance
// lock is keyed to OUR data dir rather than a shared AppData one.
const appDataRoot = resolveAppDataRoot()
var dataDir = path.join(appDataRoot, 'data')
var launcherDir = path.join(appDataRoot, 'launchers')

// Wrapped because an unwritable install dir would otherwise throw here, before
// there is any window or dialog to explain what went wrong.
try {
  fs.mkdirSync(appDataRoot, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
} catch (err) {
  dataWriteState = { writable: false, error: err.message }
  console.error('Failed to create data directories:', err.message)
}

// Point Electron/Chromium's own storage (userData, session data, HTTP cache,
// GPUCache, cookies, logs) at our data folder instead of the OS default
// (%APPDATA%\Atlas on Windows). Without this, Electron ALWAYS creates that
// AppData folder for its cache/cookies even though our own data lives beside
// the exe — which is exactly the stray folder that broke portability. Must run
// before app is ready. In dev we leave the defaults alone.
if (!process.defaultApp) {
  try {
    const chromeDataDir = path.join(dataDir, 'chrome')
    fs.mkdirSync(chromeDataDir, { recursive: true })
    app.setPath('userData', chromeDataDir)
    app.setPath('sessionData', chromeDataDir)
    try { app.setPath('cache', path.join(chromeDataDir, 'cache')) } catch { /* some platforms disallow */ }
    try { app.setPath('logs', path.join(dataDir, 'logs')) } catch { /* best effort */ }
    // Crashpad creates its database eagerly at startup; without this it lands
    // in the default userData folder regardless of the redirect above.
    try { app.setPath('crashDumps', path.join(dataDir, 'crashDumps')) } catch { /* best effort */ }
  } catch (err) {
    // Leaving this unhandled is what put a stray %APPDATA%\atlas folder on disk:
    // Chromium keeps using its default path, so the cache and cookies go there
    // even though our own data is meant to live beside the exe. Treat it as the
    // same fatal condition as an unwritable data folder so startup explains it.
    dataWriteState = { writable: false, error: err?.message || String(err) }
    console.error('Failed to redirect Electron storage into data dir:', err?.message || err)
  }
}


const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  console.log('Failed to acquire single instance lock, quitting')
  app.quit()
} else {
  console.log('Acquired single instance lock')
  app.on('second-instance', () => {
    console.log('Second instance attempted, focusing existing window')
    if (mainWindow && !mainWindow.isDestroyed()) {
      focusWindow(mainWindow)
    } else if (app.isReady()) {
      createWindow()
    }
  })
}

// In dev, VITE_DEV_SERVER_URL is set by the dev script
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL


let mediaAuthHeadersRegistered = false

function setRequestHeader(headers, name, value) {
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
  headers[existingKey || name] = value
}

// Injects the referer/UA (and, when an account is configured, the auth Cookie)
// for streamed <img>/media requests to F95zone and LewdCorner, so login-gated
// artwork loads in the renderer. The cookie is read synchronously from the
// account store's in-memory cache. Downloaded (non-streamed) images get the
// same cookie via imageUtils' axios headers.
function registerMediaAuthHeaders() {
  if (mediaAuthHeadersRegistered) return
  mediaAuthHeadersRegistered = true
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://lewdcorner.com/*',
        'https://*.lewdcorner.com/*',
        'https://f95zone.to/*',
        'https://*.f95zone.to/*',
      ],
    },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      const resourceType = String(details.resourceType || '').toLowerCase()
      if (['image', 'media', 'xhr', 'fetch'].includes(resourceType)) {
        let referer = 'https://lewdcorner.com/'
        try {
          referer =
            accountStore.refererForUrl(details.url) ||
            new URL(details.url).origin + '/'
        } catch (err) {
          /* keep default */
        }
        setRequestHeader(headers, 'Referer', referer)
        setRequestHeader(headers, 'Accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8')
        if (!Object.keys(headers).some((key) => key.toLowerCase() === 'user-agent')) {
          setRequestHeader(headers, 'User-Agent', 'Mozilla/5.0 Atlas/1.0')
        }
        try {
          const cookie = accountStore.getCookieHeaderForUrl(details.url)
          if (cookie) setRequestHeader(headers, 'Cookie', cookie)
        } catch (err) {
          /* no account configured — proceed without cookie */
        }
      }
      callback({ requestHeaders: headers })
    },
  )
}

// Backwards-compatible alias for the original call site.
function registerLewdCornerMediaHeaders() {
  registerMediaAuthHeaders()
}

// ── App data paths ──────────────────────────────────────────────────────────

app.commandLine.appendSwitch('force-color-profile', 'srgb')

function getLegacyResourcesPath() {
  return path.resolve(app.getAppPath(), '../../')
}

function getAssetBasePath() {
  // Assets/media live under <appDataRoot>/data (see dataDir/imagesDir). In dev
  // appDataRoot is the electron dir; in prod it's the install dir / AppData.
  // Reads and writes must resolve to the same base, so always use appDataRoot.
  return typeof appDataRoot !== 'undefined' ? appDataRoot : getLegacyResourcesPath()
}

function getMediaStorageMode() {
  return appConfig?.Metadata?.mediaStorageMode === 'download' ? 'download' : 'stream'
}

const { normalizeSourceOrder } = require('./db/mediaSources')
function getMetadataSourceOrder() {
  return normalizeSourceOrder(appConfig?.Metadata?.sourceOrder)
}

function copyDirectoryIfMissing(source, target) {
  if (!source || !fs.existsSync(source)) return
  if (fs.existsSync(target)) {
    const targetStats = fs.statSync(target)
    if (!targetStats.isDirectory() || fs.readdirSync(target).length > 0) return
  }
  try {
    fs.cpSync(source, target, { recursive: true, errorOnExist: false })
    console.log(`Migrated ${source} to ${target}`)
  } catch (err) {
    console.error(`Failed to migrate ${source} to ${target}:`, err)
  }
}

const firstMediaPath = (value) => Array.isArray(value) ? value[0] || '' : value || ''

// In production: try install dir first (portable), fall back to AppData if not writable.
// A `portable.txt` marker beside the executable forces portable mode — data is
// ALWAYS stored in `data/` next to the exe and AppData is never used, even if
// the install dir looks unwritable (we still create it). This is the explicit
// opt-in portable switch.
function portableMarkerPath() {
  // In production the exe lives at <installDir>/Atlas.exe and getLegacyResourcesPath()
  // resolves to <installDir>; in dev it resolves to the electron project dir.
  return path.join(getLegacyResourcesPath(), 'portable.txt')
}

function isPortableForced() {
  try {
    return fs.existsSync(portableMarkerPath())
  } catch {
    return false
  }
}

function resolveAppDataRoot() {
  if (process.defaultApp) return __dirname
  const installDir = getLegacyResourcesPath()
  // app.getPath('userData') honours XDG_CONFIG_HOME on Linux and is where
  // existing installs already keep their data, so choosing it needs no migration.
  let userDataDir = null
  try { userDataDir = app.getPath('userData') } catch { /* pre-ready is fine */ }
  const resolved = resolveDataRoot({
    installDir,
    isDev: false,
    userDataDir,
    portable: isPortableForced(),
  })
  dataWriteState = {
    writable: resolved.writable,
    error: resolved.error,
    repairable: resolved.repairable === true,
  }
  if (!resolved.writable) {
    console.error('Atlas data folder is not writable:', resolved.error)
  }
  // NOTE: returns resolved.root, not installDir. On Linux the install tree
  // (/opt/Atlas, or a read-only AppImage mount) is never the data root.
  return resolved.root
}

// Streamed banner/preview images rely on Chromium's HTTP disk cache. Its
// default is small and evicts aggressively, so streamed art appears to "reset".
// Size it explicitly (configurable; see Metadata.imageCacheSizeMB) and keep it
// in our portable data dir via the userData redirect above.
function readConfiguredCacheBytes() {
  const DEFAULT_MB = 1024 // 1 GB default — plenty for banner/preview streaming
  const MIN_MB = 128
  const MAX_MB = 16384
  try {
    if (fs.existsSync(path.join(dataDir, 'config.ini'))) {
      const parsed = ini.parse(fs.readFileSync(path.join(dataDir, 'config.ini'), 'utf-8'))
      const raw = parsed?.Metadata?.imageCacheSizeMB
      const mb = Number.parseInt(raw, 10)
      if (Number.isFinite(mb)) return Math.min(MAX_MB, Math.max(MIN_MB, mb)) * 1024 * 1024
    }
  } catch { /* fall through to default */ }
  return DEFAULT_MB * 1024 * 1024
}
try {
  app.commandLine.appendSwitch('disk-cache-size', String(readConfiguredCacheBytes()))
} catch (err) {
  console.warn('Failed to set disk-cache-size:', err?.message || err)
}

if (process.defaultApp) {
  console.log('Running in development')
} else {
  console.log('Running in release, data root:', appDataRoot)
}

// Wrapped for the same reason as the data directories above: an uncaught throw
// at module scope produces Electron's raw "A JavaScript error occurred in the
// main process" dialog, which tells the user nothing. On an unwritable root this
// threw before checkDataFolderWritable() could explain the real problem.
try {
  fs.mkdirSync(launcherDir, { recursive: true })
} catch (err) {
  if (dataWriteState.writable) {
    dataWriteState = { ...dataWriteState, writable: false, error: err.message }
  }
  console.error('Failed to create launchers directory:', err.message)
}

const updatesDir = path.join(dataDir, 'updates')
const imagesDir = path.join(dataDir, 'images')
for (const dir of [updatesDir, imagesDir]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.error(`Failed to create ${dir}:`, err.message)
  }
}

const templatesDir = path.join(dataDir, 'templates/banner')
if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true })

// User-editable theme JSON files live here — mirrors the banner template
// folder convention above. The Default theme always stays code-defined
// (src/theme/themes.js) as a guaranteed baseline; every other theme,
// including the built-in-by-default "XLibrary" look, ships as a .json
// file in this folder so it can be copied, edited, or replaced without a
// rebuild. See electron/ipc/themes.js for the read/list/validate logic.
const themeTemplatesDir = path.join(dataDir, 'templates/theme')
if (!fs.existsSync(themeTemplatesDir)) fs.mkdirSync(themeTemplatesDir, { recursive: true })

const configPath = path.join(dataDir, 'config.ini')
const defaultConfig = buildDefaultConfig(dataDir)

// ── autoUpdater setup ───────────────────────────────────────────────────────

function getUpdateFooterAction(status) {
  if (status.status === 'installing') return 'installing'
  if (status.status === 'downloaded') return 'install'
  if (status.status === 'downloading') return 'downloading'
  if (status.status === 'checking') return 'checking'
  if (['error', 'package_not_ready', 'not-available'].includes(status.status)) return 'check'
  return 'download'
}

function sendUpdateStatus(status, source = 'unknown') {
  const previousStatus = lastUpdateStatus?.status || 'idle'
  const nextStatus = status.status || 'idle'
  lastUpdateStatus = { ...status, branch: activeAppUpdateBranch || getConfiguredAppUpdateBranch() }
  console.log(
    `update-state: ${previousStatus} -> ${nextStatus} via ${source}; ` +
    `footerAction=${getUpdateFooterAction(status)}; canInstallUpdate=${['downloaded', 'installing'].includes(nextStatus)}`,
  )
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('update-status', lastUpdateStatus)
  })
}

function normalizeAppUpdateBranch(value) {
  if (value === 'stable' || value === 'nightly') return value
  return null
}

function getDefaultAppUpdateBranch() {
  return app.getVersion().includes('-nightly') ? 'nightly' : 'stable'
}

// The config key under [Updates] that stores the last-installed version for
// a given branch.
function versionKeyForBranch(branch) {
  return branch === 'nightly' ? 'nightlyVersion' : 'stableVersion'
}

// The version baseline the updater should compare a channel's latest release
// against. This is the version last INSTALLED from that channel, or 0.0.0 if
// the user has never installed from it (so its latest is always offered).
function getInstalledVersionForBranch(branch) {
  const key = versionKeyForBranch(branch)
  const stored = String(appConfig?.Updates?.[key] || '').trim()
  return stored || '0.0.0'
}

// Persist the version last installed from a branch.
function setInstalledVersionForBranch(branch, version) {
  const key = versionKeyForBranch(branch)
  const value = String(version || '').trim()
  appConfig = {
    ...appConfig,
    Updates: {
      ...(appConfig?.Updates || {}),
      [key]: value,
    },
  }
  writeConfigSafely()
  console.log(`Recorded installed ${branch} version: ${value || '(none)'}`)
}

// Stamp the currently-running build's version onto whichever channel it
// actually belongs to. Called on launch: whatever build is running IS, by
// definition, the installed version for its own channel. The other channel's
// stored version is left untouched (it reflects what was last installed from
// there, or nothing).
function recordRunningBuildVersion() {
  const runningBranch = getDefaultAppUpdateBranch()
  setInstalledVersionForBranch(runningBranch, app.getVersion())
}

function getConfiguredAppUpdateBranch(config = appConfig) {
  return normalizeAppUpdateBranch(config?.Interface?.appUpdateBranch) || getDefaultAppUpdateBranch()
}

function configureAppUpdateBranch(branch, { resetStatus = false } = {}) {
  const normalizedBranch = normalizeAppUpdateBranch(branch) || getDefaultAppUpdateBranch()
  const previousBranch = activeAppUpdateBranch
  const branchChanged = Boolean(previousBranch && previousBranch !== normalizedBranch)
  activeAppUpdateBranch = normalizedBranch
  // The feed channel decides WHICH manifest electron-updater fetches from the
  // GitHub release: stable builds publish `latest.yml`, while nightly builds
  // carry a prerelease semver (0.9.2-nightly.N) and electron-builder writes
  // their manifest to `beta.yml`. Hardcoding `latest` here meant every branch
  // — nightly included — pulled the stable manifest, so the app always tried
  // to update to the latest stable/main release. allowPrerelease does NOT fix
  // this: it only governs whether prerelease tags inside the already-fetched
  // manifest are honored, not which channel file is downloaded. Selecting the
  // channel per branch is what actually routes nightly to its own releases.
  // Route the check to the correct release channel. Two things must be set for
  // electron-updater v6's GitHub provider to resolve the right release:
  //
  //  1. autoUpdater.channel — the provider reads `updater.channel` (NOT just the
  //     channel passed to setFeedURL) both to choose the manifest filename and,
  //     for prereleases, to match the release tag in the atom feed. In v6's
  //     GitHubProvider.getLatestVersion, when allowPrerelease is true it walks
  //     the feed looking for a release whose tag prerelease word equals
  //     `updater.channel || semver.prerelease(currentVersion)[0]`. If that is
  //     null it silently grabs the newest release overall — which is why
  //     nightly was pulling the latest stable/main release.
  //
  //  2. currentVersion — the baseline the found release is compared against. We
  //     keep a per-branch baseline so each channel is judged against its own
  //     last-installed version. For nightly we ensure the baseline carries a
  //     `-nightly` prerelease component so the feed matcher has a channel word
  //     to lock onto even before setting `.channel` takes effect.
  const isNightly = normalizedBranch === 'nightly'
  autoUpdater.allowPrerelease = isNightly
  // Assigning `.channel` also flips allowDowngrade to true internally, so set
  // allowDowngrade explicitly afterwards.
  autoUpdater.channel = isNightly ? 'nightly' : 'latest'
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'towerwatchman',
    repo: 'Atlas',
    channel: isNightly ? 'nightly' : 'latest',
  })

  // electron-updater resolves & caches the provider lazily; setFeedURL already
  // resets clientPromise, but we also clear the check/result caches so a
  // mid-session branch switch fully re-resolves. Guarded for version drift.
  try { autoUpdater.checkForUpdatesPromise = null } catch {}
  try { autoUpdater.updateInfoAndProvider = null } catch {}

  // Compare the channel's latest release against the version last INSTALLED
  // from THAT channel, not against the running build. This is the core of
  // correct channel switching: electron-updater normally compares the feed
  // against app.getVersion(), which is the running build and therefore only
  // ever right for the running build's own channel. By overriding
  // currentVersion per channel, semver comparison alone resolves every case
  // and the old allowDowngrade hacks are no longer needed:
  //   - Switch to a channel never installed -> baseline 0.0.0 -> latest is
  //     higher -> offered.
  //   - Switch back to your real channel without updating -> baseline is its
  //     true installed version -> latest is equal -> up to date.
  //   - Nightly (0.9.2-nightly.5) vs stable (0.9.2): each channel is judged
  //     against its own last-installed baseline, so the prerelease-sorts-
  //     lower problem that previously required allowDowngrade disappears.
  //
  // IMPORTANT: electron-updater v6 stores currentVersion as a parsed semver
  // SemVer object (it calls .format()/gt()/eq() on it in doCheckForUpdates).
  // Assigning a raw string throws "this.currentVersion.format is not a
  // function" at check time — which is exactly what surfaced as the generic
  // "could not check for updates right now" error.
  //
  // Even parsing with a require('semver') is not enough: electron-updater's
  // comparison functions instantiate `new SemVer(x)` from ITS nested semver
  // copy, and that constructor rejects a SemVer produced by any other copy
  // ('Invalid version. Must be a string. Got type "object".'). To guarantee
  // class identity, build the baseline from the SemVer CLASS of the object
  // electron-updater itself created at construction time
  // (autoUpdater.currentVersion.constructor) — that is, by definition, its own
  // semver. Fall back to the resolved `semver` module, then to leaving the
  // running build's version in place, so a check never crashes.
  const baselineString = getInstalledVersionForBranch(normalizedBranch)
  let parsedBaseline = null
  try {
    const ExistingSemVer = autoUpdater.currentVersion && autoUpdater.currentVersion.constructor
    if (typeof ExistingSemVer === 'function') {
      try {
        parsedBaseline = new ExistingSemVer(baselineString)
      } catch {
        parsedBaseline = new ExistingSemVer('0.0.0')
      }
    }
  } catch {
    parsedBaseline = null
  }
  if (parsedBaseline == null && semver) {
    parsedBaseline = semver.parse(baselineString) || semver.parse('0.0.0')
  }
  if (parsedBaseline != null) {
    autoUpdater.currentVersion = parsedBaseline
  }
  // If parsedBaseline is still null, leave autoUpdater.currentVersion as the
  // running build's version (set by electron-updater at construction) rather
  // than assigning a foreign/invalid value — the check will still run.
  autoUpdater.allowDowngrade = false
  updaterLog(
    'CONFIGURE',
    `branch=${normalizedBranch}`,
    `channel=${autoUpdater.channel}`,
    `allowPrerelease=${autoUpdater.allowPrerelease}`,
    `baseline=${(parsedBaseline && typeof parsedBaseline.format === 'function') ? parsedBaseline.format() : String(autoUpdater.currentVersion)}`
  )

  if (resetStatus && branchChanged) {
    updateInfo = null
    updateDownloaded = false
    installAfterDownload = false
    sendUpdateStatus({ status: 'idle' }, 'update-branch-changed')
  }

  console.log(`Configured app update branch: ${normalizedBranch} (baseline=${autoUpdater.currentVersion})`)
  return normalizedBranch
}

configureAppUpdateBranch(getDefaultAppUpdateBranch())
autoUpdater.autoDownload = false
// Set explicitly rather than relying on the default. quitAndInstall ignores its
// isForceRunAfter argument whenever isSilent is false and uses this instead, so
// leaving it implicit makes whether the app reopens depend on a default we do
// not control.
autoUpdater.autoRunAppAfterInstall = true

// ── Updater diagnostics ─────────────────────────────────────────────────────
// electron-updater's console output only appears in the main-process log, which
// is invisible in packaged builds. Mirror updater diagnostics to a plain-text
// file in userData so they can be retrieved without launching from a terminal.
// Path: <userData>/atlas-updater.log (e.g. %AppData%/Atlas/atlas-updater.log).
function updaterLogPath() {
  try {
    return path.join(app.getPath('userData'), 'atlas-updater.log')
  } catch {
    return null
  }
}

function updaterLog(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`
  console.log('[updater]', line)
  const file = updaterLogPath()
  if (!file) return
  try {
    fs.appendFileSync(file, line + '\n')
  } catch {}
}

// Route electron-updater's internal logger through our file logger so its full
// resolution trace (which release/tag/manifest it picked) is captured too.
autoUpdater.logger = {
  info: (m) => updaterLog('INFO', m),
  warn: (m) => updaterLog('WARN', m),
  error: (m) => updaterLog('ERROR', m),
  debug: (m) => updaterLog('DEBUG', m),
}

// Pass the CURRENT install directory to the new installer so it updates
// in-place. electron-updater appends this as the NSIS /D= switch (the last
// installer argument), which the electron-builder NSIS template honors over
// the stale InstallLocation recorded in the registry. Without this, a moved
// portable copy would reinstall to the original location (e.g. AppData).
// NOTE: the property is `installDirectory` (a string); `installerArgs` is not
// a real electron-updater option and is silently ignored.
if (!process.defaultApp && process.platform === 'win32') {
  autoUpdater.installDirectory = path.dirname(process.execPath)
}

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...')
  sendUpdateStatus({ status: 'checking' }, 'checking-for-update')
})
autoUpdater.on('update-available', (info) => {
  updateInfo = info
  updateDownloaded = false
  installAfterDownload = false
  sendUpdateStatus({ status: 'available', version: info.version }, 'update-available')
})
autoUpdater.on('update-not-available', () => {
  updateInfo = null
  updateDownloaded = false
  installAfterDownload = false
  sendUpdateStatus({ status: 'not-available' }, 'update-not-available')
})
autoUpdater.on('download-progress', (progress) => {
  if (updateDownloaded || lastUpdateStatus?.status === 'installing') {
    console.log('update-state: ignored download-progress after update-downloaded')
    return
  }
  sendUpdateStatus({
    status: 'downloading',
    version: updateInfo?.version || '',
    percent: progress.percent,
  }, 'download-progress')
})
autoUpdater.on('update-downloaded', (info) => {
  updateInfo = info
  updateDownloaded = true
  if (installAfterDownload) {
    installAfterDownload = false
    sendUpdateStatus({ status: 'installing', version: info.version, percent: null }, 'update-downloaded')
    setTimeout(() => {
      try {
        // Silent — see electron/ipc/updater.js. A non-silent update never
        // relaunches the app.
        autoUpdater.quitAndInstall(true, true)
      } catch (err) {
        console.error('Auto install after download failed:', err)
        sendUpdateStatus({ status: 'downloaded', version: info.version, percent: null }, 'auto-install-failed')
      }
    }, 500)
    return
  }
  sendUpdateStatus({ status: 'downloaded', version: info.version, percent: null }, 'update-downloaded')
})
autoUpdater.on('error', (err) => {
  const normalizedError = normalizeUpdateError(err)
  // Full raw diagnostics to the file log so a packaged build can be diagnosed.
  updaterLog(
    'RAW-ERROR',
    `code=${err?.code || '(none)'}`,
    `status=${err?.statusCode || err?.status || '(none)'}`,
    `message=${err?.message || String(err)}`,
    `-> normalized=${normalizedError.code}`
  )
  console.error(
    `[updater] raw error code=${err?.code || '(none)'} status=${err?.statusCode || err?.status || '(none)'} ` +
    `message=${err?.message || String(err)} -> normalized=${normalizedError.code}`
  )
  console.error('Updater error normalized:', normalizedError)
  installAfterDownload = false
  updateInfo = null
  updateDownloaded = false
  sendUpdateStatus({
    status: 'error',
    error: normalizedError.userMessage,
    code: normalizedError.code,
    retryable: normalizedError.retryable,
  }, normalizedError.code === 'UPDATE_PACKAGE_NOT_READY' ? 'package-not-ready' : 'error')
})

// ── Shared helper functions ─────────────────────────────────────────────────

function normalizeForPathCompare(targetPath) {
  return path.resolve(targetPath).toLowerCase()
}

function isPathInside(parentPath, childPath) {
  const parent = normalizeForPathCompare(parentPath)
  const child = normalizeForPathCompare(childPath)
  const relative = path.relative(parent, child)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

async function removeEmptyParentDirectories(startPath, stopAtPath) {
  if (!startPath || !stopAtPath) return
  let current = path.dirname(path.resolve(startPath))
  const stopAt = path.resolve(stopAtPath)
  while (
    current &&
    current !== path.parse(current).root &&
    isPathInside(stopAt, current) &&
    normalizeForPathCompare(current) !== normalizeForPathCompare(stopAt)
  ) {
    const entries = await fs.promises.readdir(current).catch(() => null)
    if (!entries || entries.length > 0) break
    await fs.promises.rmdir(current).catch(() => {})
    current = path.dirname(current)
  }
}

async function isAllowedDeletionPath(recordId, folderPath) {
  if (!recordId || !folderPath || typeof folderPath !== 'string') return false
  const resolvedPath = path.resolve(folderPath)
  const knownVersionPaths = await getVersionPathsForRecord(recordId)
  const recentlyDeletedPaths = recentlyDeletedGamePaths.get(recordId) || []
  if (
    [...knownVersionPaths, ...recentlyDeletedPaths].some(
      (knownPath) => normalizeForPathCompare(knownPath) === normalizeForPathCompare(resolvedPath)
    )
  ) return true
  const libraryRoot = appConfig?.Library?.gameFolder
  return Boolean(libraryRoot && fs.existsSync(libraryRoot) && isPathInside(libraryRoot, resolvedPath))
}

async function getTrustedVersion(recordId, version) {
  if (!recordId) throw new Error('Missing record id')
  const selectedVersion = await getVersionForRecord(recordId, version)
  if (!selectedVersion) throw new Error('Version not found')
  if (!selectedVersion.isInstalled) throw new Error('Version is not installed or its paths are missing')
  return selectedVersion
}

function dedupeDeletionPaths(paths = []) {
  const seen = new Set()
  return paths
    .filter(Boolean)
    .map((p) => path.resolve(p))
    .filter((p) => {
      const key = normalizeForPathCompare(p)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.length - a.length)
}

async function deleteLinkedGameFolders(recordId, versionPaths) {
  const pathsToDelete = dedupeDeletionPaths(versionPaths)
  for (const targetPath of pathsToDelete) {
    const resolvedPath = path.resolve(targetPath)
    if (resolvedPath === path.parse(resolvedPath).root) throw new Error('Refusing to delete a drive root')
    if (!(await isAllowedDeletionPath(recordId, resolvedPath))) throw new Error(`Folder is not linked to this game: ${resolvedPath}`)
    const stat = await fs.promises.stat(resolvedPath).catch(() => null)
    if (!stat) continue
    if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${resolvedPath}`)
    const deleteResult = await deletePathWithElevationFallback(resolvedPath, {
      recursive: true,
      force: true,
      description: 'Delete game folder',
      window: mainWindow,
      validatePath: async (candidatePath) => {
        if (candidatePath === path.parse(candidatePath).root) throw new Error('Refusing to delete a drive root')
        if (!(await isAllowedDeletionPath(recordId, candidatePath))) {
          throw new Error(`Folder is not linked to this game: ${candidatePath}`)
        }
      },
    })
    if (!deleteResult.success) throw new Error(deleteResult.error || 'Delete skipped')
    await removeEmptyParentDirectories(resolvedPath, appConfig?.Library?.gameFolder)
  }
}

async function deleteTitleRecord(recordId, { deleteFiles = false } = {}) {
  if (!recordId) return { success: false, error: 'Missing record id' }
  try {
    const versionPaths = await getVersionPathsForRecord(recordId)
    if (deleteFiles) {
      await deleteLinkedGameFolders(recordId, versionPaths)
    }
    const result = await deleteGameCompletely(recordId, getAssetBasePath(), process.defaultApp)
    if (!result.success) return result
    recentlyDeletedGamePaths.set(recordId, versionPaths)
    setTimeout(() => recentlyDeletedGamePaths.delete(recordId), 5 * 60 * 1000)
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('game-deleted', recordId)
    })
    return { success: true }
  } catch (err) {
    console.error('delete-title failed:', err)
    return { success: false, error: err.message }
  }
}

// Window icon for Linux.
//
// On Windows the icon is embedded in the .exe and on macOS it comes from the
// bundle, so neither needs this. On Linux the launcher entry is covered by
// build/icons via electron-builder's linux.icon, but several window managers
// take the titlebar and alt-tab icon from the WINDOW, which falls back to the
// default Electron logo unless it is set explicitly.
//
// Reads from src/assets/ui because that path is already in build.files and so
// exists inside the packaged asar; build/icons is a build-time input only and is
// NOT packaged.
function getWindowIconPath() {
  if (process.platform !== 'linux') return undefined
  const candidate = process.defaultApp
    ? path.join(__dirname, '..', 'src', 'assets', 'ui', 'appicon.png')
    : path.join(app.getAppPath(), 'src', 'assets', 'ui', 'appicon.png')
  try {
    return fs.existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

function quitFromMainWindow() {
  if (isQuitting) return
  console.log('Main window close requested; quitting Atlas')
  isQuitting = true
  if (activeImportSession) activeImportSession.cancelRequested = true
  if (activeScanSession) activeScanSession.cancelRequested = true
  if (activeLibraryValidation) activeLibraryValidation.cancelRequested = true
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win || win.isDestroyed() || win === mainWindow) return
    let url = 'unknown url'
    try { url = win.webContents?.getURL?.() || url } catch {}
    console.log(`Closing secondary window during app quit: ${url}`)
    win.close()
  })
  app.quit()
}

// ── Window creation ─────────────────────────────────────────────────────────

function focusWindow(win) {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function getWindowStateKey(name) {
  return String(name || '').replace(/[^A-Za-z0-9]/g, '')
}

function toPositiveInteger(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

function toBoundsBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function getSavedWindowBounds(name) {
  const section = appConfig?.WindowBounds || {}
  const key = getWindowStateKey(name)
  const x = Number(section[`${key}X`])
  const y = Number(section[`${key}Y`])
  const width = toPositiveInteger(section[`${key}Width`])
  const height = toPositiveInteger(section[`${key}Height`])
  if (!width || !height) return null
  return {
    x: Number.isFinite(x) ? Math.round(x) : null,
    y: Number.isFinite(y) ? Math.round(y) : null,
    width,
    height,
    maximized: toBoundsBoolean(section[`${key}Maximized`]),
  }
}

function isBoundsVisibleOnAnyDisplay(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false
  const rect = {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width || 1),
    height: Math.max(1, bounds.height || 1),
  }
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      rect.x < area.x + area.width &&
      rect.x + rect.width > area.x &&
      rect.y < area.y + area.height &&
      rect.y + rect.height > area.y
    )
  })
}

// Centers a width x height window on the main window's CURRENT bounds —
// not the screen, and not wherever this child window happened to be left
// last time. Used by every secondary window (Settings, Theme Builder,
// Banner Editor, Importer, Game Details, Executable Chooser) so they
// always reopen next to the window the person is actually looking at,
// rather than on whichever monitor a saved position happens to still be
// "visible" on (see isBoundsVisibleOnAnyDisplay above — a saved position
// can be perfectly valid and still be on a completely different screen
// than the main window is on right now).
// Keeps a computed x/y, width x height window fully within whichever
// display its center point falls on — without this, centering on a main
// window that's snapped to a screen edge (or sized very differently from
// the child window) can push the child window partly or entirely off that
// screen, which is exactly as unusable as opening on the wrong monitor.
function clampBoundsToDisplay({ x, y, width, height }) {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  })
  const area = display.workArea
  const maxX = area.x + Math.max(0, area.width - width)
  const maxY = area.y + Math.max(0, area.height - height)
  return {
    x: Math.min(Math.max(x, area.x), maxX),
    y: Math.min(Math.max(y, area.y), maxY),
  }
}

function getCenteredBoundsOnMain(width, height) {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const mainBounds = mainWindow.getBounds()
      const x = Math.round(mainBounds.x + (mainBounds.width - w) / 2)
      const y = Math.round(mainBounds.y + (mainBounds.height - h) / 2)
      return clampBoundsToDisplay({ x, y, width: w, height: h })
    }
    // No main window to center on (shouldn't normally happen — every one
    // of these is only ever opened from within the running app) — fall
    // back to centering on whichever display currently has the cursor,
    // same as Electron's own default placement for a window with no x/y
    // at all.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    return clampBoundsToDisplay({
      x: Math.round(area.x + (area.width - w) / 2),
      y: Math.round(area.y + (area.height - h) / 2),
      width: w,
      height: h,
    })
  } catch (err) {
    // Centering is a nice-to-have, not something that should ever be able
    // to take down window creation — if anything here throws (an
    // unexpected display/bounds API failure), fall back to no explicit
    // position at all, which lets Electron place the window using its own
    // built-in default instead.
    console.error('getCenteredBoundsOnMain: failed to compute a centered position:', err)
    return { x: undefined, y: undefined }
  }
}

function applySavedWindowBounds(name, defaultOptions, { centerOnMain = false } = {}) {
  const saved = getSavedWindowBounds(name)
  const minWidth = defaultOptions.minWidth || 0
  const minHeight = defaultOptions.minHeight || 0

  if (!saved) {
    if (!centerOnMain) return { options: { ...defaultOptions }, maximized: false }
    const { x, y } = getCenteredBoundsOnMain(defaultOptions.width, defaultOptions.height)
    const options = { ...defaultOptions }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      options.x = x
      options.y = y
    }
    return { options, maximized: false }
  }

  const width = Math.max(saved.width, minWidth, 320)
  const height = Math.max(saved.height, minHeight, 240)
  const options = { ...defaultOptions, width, height }

  if (centerOnMain) {
    // Still honor the saved SIZE (someone may have deliberately resized
    // this window before), just never the saved position — every reopen
    // re-centers on the main window's current location instead.
    const { x, y } = getCenteredBoundsOnMain(width, height)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      options.x = x
      options.y = y
    }
    return { options, maximized: saved.maximized }
  }

  if (isBoundsVisibleOnAnyDisplay({ ...saved, width, height })) {
    options.x = saved.x
    options.y = saved.y
    console.log(`Restored window bounds for ${name}: ${JSON.stringify({ x: options.x, y: options.y, width, height, maximized: saved.maximized })}`)
  } else {
    console.log(`Ignored off-screen window position for ${name}; restoring saved size only`)
  }

  return { options, maximized: saved.maximized }
}

function writeConfigSafely() {
  if (!appConfig || !configPath) return
  try {
    fs.writeFileSync(configPath, ini.stringify(appConfig))
  } catch (err) {
    console.error('Failed to save window bounds:', err)
  }
}

function saveWindowBounds(name, win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  const key = getWindowStateKey(name)
  const bounds = win.isMaximized() && typeof win.getNormalBounds === 'function'
    ? win.getNormalBounds()
    : win.getBounds()
  if (!bounds?.width || !bounds?.height) return

  appConfig = {
    ...appConfig,
    WindowBounds: {
      ...(appConfig?.WindowBounds || {}),
      [`${key}X`]: bounds.x,
      [`${key}Y`]: bounds.y,
      [`${key}Width`]: bounds.width,
      [`${key}Height`]: bounds.height,
      [`${key}Maximized`]: win.isMaximized(),
    },
  }
  writeConfigSafely()
  console.log(`Saved window bounds for ${name}: ${JSON.stringify({ ...bounds, maximized: win.isMaximized() })}`)
}

function registerWindowBoundsPersistence(name, win, restoreState = {}) {
  if (!win || win.isDestroyed()) return
  let isRestoring = true
  let saveTimer = null
  const scheduleSave = () => {
    if (isRestoring || win.isDestroyed()) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowBounds(name, win), 300)
  }
  const saveNow = () => {
    if (isRestoring || win.isDestroyed()) return
    clearTimeout(saveTimer)
    saveWindowBounds(name, win)
  }

  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', saveNow)
  win.on('unmaximize', saveNow)
  win.on('close', saveNow)
  win.on('closed', () => clearTimeout(saveTimer))

  setTimeout(() => {
    isRestoring = false
    if (restoreState.maximized && !win.isDestroyed()) {
      win.maximize()
    }
  }, 0)
}

// ── Boot progress window ─────────────────────────────────────────────────────
// Startup database repairs run BEFORE createWindow(), so a slow one leaves the
// app with nothing on screen at all and reads as a hang. This puts a small
// frameless window up to say what is happening.
//
// It is created LAZILY: the window only appears if the task is still running
// after BOOT_PROGRESS_DEFER_MS, so the common fast path stays invisible instead
// of flashing a splash for a few milliseconds.
//
// The window is intentionally self-contained (inline HTML via data URL, no
// preload, no node integration) so it needs no build-config entry and cannot
// depend on anything that might itself be mid-repair.
const BOOT_PROGRESS_DEFER_MS = 400

// True until the main window exists. Guards window-all-closed so dismissing the
// transient progress window cannot quit the app mid-boot.
let isBooting = true

// Result of the startup custom-metadata repair, held for the renderer to collect
// once it mounts. Startup repairs finish BEFORE createWindow(), so there is no
// renderer listening at the time — the summary is PULLED via
// get-startup-repair-summary rather than pushed, which avoids racing the window
// load. Reading it clears it, so the notice shows once per launch.
let startupRepairSummary = null
let bootProgressWindow = null

function bootProgressHtml(heading) {
  const safeHeading = String(heading).replace(/[&<>]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]
  ))
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #16181d; color: #e6e8ec;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    border: 1px solid #2c3038; border-radius: 6px;
    -webkit-user-select: none; user-select: none;
  }
  .wrap { width: 100%; padding: 20px 22px; }
  .heading { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .msg {
    color: #9aa0aa; font-size: 12px; margin-bottom: 14px;
    min-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .track { height: 4px; background: #262a31; border-radius: 2px; overflow: hidden; }
  .bar { height: 100%; width: 0%; background: #4b8ef7; border-radius: 2px; transition: width .18s linear; }
  /* Indeterminate state, used until the task reports a real fraction. */
  .bar.indeterminate { width: 35%; animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(320%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar { transition: none; }
    .bar.indeterminate { animation: none; width: 100%; opacity: .5; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="heading">${safeHeading}</div>
    <div class="msg" id="msg">Working&hellip;</div>
    <div class="track"><div class="bar indeterminate" id="bar"></div></div>
  </div>
</body>
</html>`
}

function createBootProgressWindow(heading) {
  const win = new BrowserWindow({
    width: 380,
    height: 130,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#16181d',
    title: heading,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bootProgressHtml(heading))}`)
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive() })
  win.on('closed', () => { if (bootProgressWindow === win) bootProgressWindow = null })
  return win
}

// Runs `task`, showing a boot progress window only if it turns out to be slow.
// `task` receives a report(message, fraction) callback; fraction may be null for
// an indeterminate bar. Always resolves/rejects with whatever `task` does, and
// always tears the window down.
async function withBootProgress(heading, task) {
  let latest = { message: 'Working…', fraction: null }
  let timer = null
  let settled = false

  const push = () => {
    const win = bootProgressWindow
    if (!win || win.isDestroyed()) return
    const message = JSON.stringify(String(latest.message ?? ''))
    const pct = latest.fraction == null
      ? 'null'
      : String(Math.max(0, Math.min(100, Math.round(latest.fraction * 100))))
    // executeJavaScript rather than IPC so the window needs no preload script.
    win.webContents.executeJavaScript(`(() => {
      const m = document.getElementById('msg');
      const b = document.getElementById('bar');
      if (m) m.textContent = ${message};
      if (b) {
        const pct = ${pct};
        if (pct === null) { b.classList.add('indeterminate'); }
        else { b.classList.remove('indeterminate'); b.style.width = pct + '%'; }
      }
    })()`, true).catch(() => {})
  }

  const report = (message, fraction = null) => {
    latest = { message: message ?? latest.message, fraction }
    push()
  }

  timer = setTimeout(() => {
    if (settled) return
    try {
      bootProgressWindow = createBootProgressWindow(heading)
      bootProgressWindow.webContents.once('did-finish-load', push)
    } catch (err) {
      console.warn('Could not show boot progress window:', err.message)
    }
  }, BOOT_PROGRESS_DEFER_MS)

  try {
    return await task(report)
  } finally {
    settled = true
    clearTimeout(timer)
    const win = bootProgressWindow
    bootProgressWindow = null
    if (win && !win.isDestroyed()) {
      try { win.destroy() } catch { /* ignore */ }
    }
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusWindow(mainWindow)
    return mainWindow
  }
  const windowState = applySavedWindowBounds('main', {
    icon: getWindowIconPath(),
    width: 1410,
    minWidth: 1410,
    height: 860,
    minHeight: 860,
    // Native OS window chrome with a custom header. titleBarStyle: 'hidden'
    // removes the native title bar strip so our own client-area header (see
    // App.jsx) is the title bar. On Windows, 'hidden' ALONE also removes the
    // native caption buttons and the OS drag/snap behavior -- titleBarOverlay
    // is what brings both back: it tells Chromium to paint the native
    // minimize/maximize/close buttons as an overlay in the top-right corner
    // and to treat that strip as a real caption region (so Aero snap,
    // drag-to-edge, Win+arrow, and double-click-to-maximize all work). The
    // OS still draws the frame, rounded corners, shadow, and resize border.
    // color/symbolColor must be set explicitly or the overlay renders on a
    // mismatched default strip; these match the default theme's header
    // (primary) -- see App.jsx header bg-primary. height matches the 70px
    // Native OS window chrome with a custom header and CUSTOM caption
    // buttons. titleBarStyle: 'hidden' removes the native title bar strip
    // (so no doubled bar and no native min/max/close), while the OS still
    // draws the frame, rounded corners, shadow, and resize border. Window
    // snapping (drag-to-edge, Win+arrow, double-click-maximize) works via
    // the -webkit-app-region: drag header in App.jsx, which Windows treats
    // as a caption region. No titleBarOverlay here on purpose -- that's what
    // drew the fixed-width native buttons; our own buttons live in the
    // header instead (see App.jsx) so they match the theme and header size.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  mainWindow = new BrowserWindow(windowState.options)
  registerLewdCornerMediaHeaders()
  registerWindowBoundsPersistence('main', mainWindow, windowState)
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    mainWindow.webContents.openDevTools()
  }
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state-changed', 'maximized'))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state-changed', 'normal'))
  mainWindow.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    quitFromMainWindow()
  })
  mainWindow.on('closed', () => { mainWindow = null })
  return mainWindow
}

function createSettingsWindow(options = {}) {
  const wantTour = options && options.tour === true
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    focusWindow(settingsWindow)
    // If the window already exists and a tour was requested, tell it to start.
    if (wantTour) {
      try { settingsWindow.webContents.send('start-settings-tour') } catch { /* ignore */ }
    }
    return
  }
  const windowState = applySavedWindowBounds('settings', {
    width: 950,
    height: 650,
    // Native OS window chrome with a custom header and CUSTOM caption
    // buttons -- same pattern as the main window (see createWindow above).
    // titleBarStyle: 'hidden' removes the native title bar strip (no doubled
    // bar, no native buttons) while the OS still draws the frame, rounded
    // corners, shadow, and resize border. Snapping works via the
    // -webkit-app-region: drag header (WindowTitleBar.jsx). No titleBarOverlay
    // on purpose -- the custom buttons in the header match the theme instead.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }, { centerOnMain: true })
  settingsWindow = new BrowserWindow(windowState.options)
  registerWindowBoundsPersistence('settings', settingsWindow, windowState)
  const tourQuery = wantTour ? '?tour=1' : ''
  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(VITE_DEV_SERVER_URL + '/settings.html' + tourQuery)
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/renderer/settings.html'), tourQuery ? { search: tourQuery } : undefined)
  }
  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    settingsWindow.webContents.openDevTools()
  }
  settingsWindow.on('maximize', () => settingsWindow.webContents.send('window-state-changed', 'maximized'))
  settingsWindow.on('unmaximize', () => settingsWindow.webContents.send('window-state-changed', 'normal'))
  settingsWindow.on('closed', () => { settingsWindow = null })
}

// A genuinely separate OS-level window, NOT a React modal layered over the
// Settings window — same general shape as createSettingsWindow above, its
// own frameless BrowserWindow with its own bounds-persistence slot
// ('themeBuilder'). While open, every draft edit is broadcast to all OTHER
// windows via 'theme-preview-changed' (see ipc/themes.js's
// broadcast-theme-preview handler) so the live preview is visible
// app-wide, not just within this window — and however this window closes
// (the in-app Back button, titlebar, Alt+F4), the 'closed' handler below
// broadcasts 'theme-preview-ended' so those windows revert to whatever
// theme is actually persisted, rather than being stuck showing the
// in-progress draft forever.
function createThemeBuilderWindow() {
  if (themeBuilderWindow && !themeBuilderWindow.isDestroyed()) {
    focusWindow(themeBuilderWindow)
    return
  }
  const windowState = applySavedWindowBounds('themeBuilder', {
    width: 1410,
    height: 860,
    // Match the main library window's minimum size (see createMainWindow)
    // so the Theme Builder is always wide enough for its side-by-side
    // settings + live-preview layout — the preview stays a right-hand
    // column and never has to collapse to a cramped bottom strip.
    minWidth: 1410,
    minHeight: 860,
    // Native OS window chrome with a custom header + custom caption buttons
    // -- same pattern as the main and settings windows (see createWindow).
    // titleBarStyle: 'hidden' removes the native title bar strip while the
    // OS draws the frame, corners, shadow and resize border; snapping works
    // via the -webkit-app-region: drag header (WindowTitleBar.jsx).
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }, { centerOnMain: true })
  themeBuilderWindow = new BrowserWindow(windowState.options)
  registerWindowBoundsPersistence('themeBuilder', themeBuilderWindow, windowState)
  if (VITE_DEV_SERVER_URL) {
    themeBuilderWindow.loadURL(VITE_DEV_SERVER_URL + '/themebuilder.html')
  } else {
    themeBuilderWindow.loadFile(path.join(__dirname, '../dist/renderer/themebuilder.html'))
  }
  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    themeBuilderWindow.webContents.openDevTools()
  }
  themeBuilderWindow.on('maximize', () => themeBuilderWindow.webContents.send('window-state-changed', 'maximized'))
  themeBuilderWindow.on('unmaximize', () => themeBuilderWindow.webContents.send('window-state-changed', 'normal'))
  themeBuilderWindow.on('closed', () => {
    themeBuilderWindow = null
    // Tell every remaining window the preview session is over, so they
    // drop the draft theme and re-apply whatever is actually persisted.
    // This fires no matter how the window closed (the in-app Back button
    // calling window.close(), the titlebar X, Alt+F4, etc.) since it's
    // bound to the BrowserWindow's own 'closed' event rather than any
    // particular UI action — so there's exactly one place this broadcast
    // needs to happen. Same inline BrowserWindow.getAllWindows() pattern
    // save-settings already uses for 'appearance-changed' below, rather
    // than a new helper function.
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('theme-preview-ended')
    })
  })
}

function normalizeImporterSource(source) {
  const value = String(source || '').trim().toLowerCase()
  // Keep in sync with importerSources.js in the renderer.
  return ['atlas', 'steam', 'gog', 'renpy', 'manual'].includes(value) ? value : 'atlas'
}

function createBannerEditorWindow() {
  if (bannerEditorWindow && !bannerEditorWindow.isDestroyed()) {
    focusWindow(bannerEditorWindow)
    return
  }
  const windowState = applySavedWindowBounds('bannerEditor', {
    width: 1644,
    height: 1150,
    minWidth: 1644,
    minHeight: 1150,
    // Native OS window chrome with a custom header + custom caption buttons
    // -- same pattern as the main/settings/theme-builder windows (see
    // createWindow). titleBarStyle: 'hidden' removes the native title bar
    // strip while the OS draws the frame, corners, shadow and resize border;
    // snapping works via the -webkit-app-region: drag header
    // (WindowTitleBar.jsx).
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }, { centerOnMain: true })
  bannerEditorWindow = new BrowserWindow(windowState.options)
  registerWindowBoundsPersistence('bannerEditor', bannerEditorWindow, windowState)
  if (VITE_DEV_SERVER_URL) {
    bannerEditorWindow.loadURL(VITE_DEV_SERVER_URL + '/bannereditor.html')
  } else {
    bannerEditorWindow.loadFile(path.join(__dirname, '../dist/renderer/bannereditor.html'))
  }
  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    bannerEditorWindow.webContents.openDevTools()
  }
  bannerEditorWindow.on('maximize', () => bannerEditorWindow.webContents.send('window-state-changed', 'maximized'))
  bannerEditorWindow.on('unmaximize', () => bannerEditorWindow.webContents.send('window-state-changed', 'normal'))
  bannerEditorWindow.on('closed', () => { bannerEditorWindow = null })
}

let importerHelpWindow = null
function createImporterHelpWindow() {
  if (importerHelpWindow && !importerHelpWindow.isDestroyed()) {
    focusWindow(importerHelpWindow)
    return
  }
  const windowState = applySavedWindowBounds('importerHelp', {
    width: 820,
    height: 800,
    minWidth: 560,
    minHeight: 480,
    // Native OS window chrome (see createWindow). titleBarStyle: 'hidden'
    // removes the native title bar strip; the OS draws the frame, corners,
    // shadow and resize border, snapping via the drag-region header.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }, { centerOnMain: true })
  importerHelpWindow = new BrowserWindow(windowState.options)
  registerWindowBoundsPersistence('importerHelp', importerHelpWindow, windowState)
  if (VITE_DEV_SERVER_URL) {
    importerHelpWindow.loadURL(VITE_DEV_SERVER_URL + '/importerhelp.html')
  } else {
    importerHelpWindow.loadFile(path.join(__dirname, '../dist/renderer/importerhelp.html'))
  }
  importerHelpWindow.on('maximize', () => importerHelpWindow.webContents.send('window-state-changed', 'maximized'))
  importerHelpWindow.on('unmaximize', () => importerHelpWindow.webContents.send('window-state-changed', 'normal'))
  importerHelpWindow.on('closed', () => { importerHelpWindow = null })
}

function sendImporterSource(source) {
  if (importerWindow && !importerWindow.isDestroyed()) {
    importerWindow.webContents.send('import-source', normalizeImporterSource(source))
  }
}

function createImporterWindow(source = 'atlas') {
  const importerSource = normalizeImporterSource(source)
  if (importerWindow && !importerWindow.isDestroyed()) {
    focusWindow(importerWindow)
    sendImporterSource(importerSource)
    return
  }
  const windowState = applySavedWindowBounds('importer', {
    width: 1100,
    height: 750,
    // Native OS window chrome with a custom header + custom caption buttons
    // -- same pattern as the other migrated windows (see createWindow).
    // titleBarStyle: 'hidden' removes the native title bar strip while the
    // OS draws the frame, corners, shadow and resize border; snapping works
    // via the -webkit-app-region: drag header. NOTE: this window previously
    // hit a compositing "gray-screen" bug from the transparent + clip-path
    // combo (see src/assets/css/main.css); native (opaque) chrome avoids
    // that failure mode entirely.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }, { centerOnMain: true })
  importerWindow = new BrowserWindow(windowState.options)
  registerWindowBoundsPersistence('importer', importerWindow, windowState)
  const importerUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}/importer.html?source=${encodeURIComponent(importerSource)}`
    : path.join(__dirname, '../dist/renderer/importer.html')
  console.log('Loading importer:', importerUrl);
  (VITE_DEV_SERVER_URL
    ? importerWindow.loadURL(importerUrl)
    : importerWindow.loadFile(importerUrl, { query: { source: importerSource } })
  ).then(() => {
    console.log('importer.html loaded successfully')
    sendImporterSource(importerSource)
    if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
      importerWindow.webContents.openDevTools()
    }
  }).catch((err) => {
    console.error('Failed to load importer.html:', err)
  })
  importerWindow.on('maximize', () => importerWindow.webContents.send('window-state-changed', 'maximized'))
  importerWindow.on('unmaximize', () => importerWindow.webContents.send('window-state-changed', 'normal'))
  importerWindow.on('closed', () => { importerWindow = null })
}

function createGameDetailsWindow(recordId) {
  const existingWindow = BrowserWindow.getAllWindows().find((win) => (
    !win.isDestroyed() && gameDetailsRecordMap.get(win.webContents.id) === recordId
  ))
  if (existingWindow) {
    focusWindow(existingWindow)
    return
  }
  const windowState = applySavedWindowBounds('gameDetails', {
    width: 1100,
    height: 750,
    // Native OS window chrome with a custom header + custom caption buttons
    // -- same pattern as the other migrated windows (see createWindow).
    // titleBarStyle: 'hidden' removes the native title bar strip while the
    // OS draws the frame, corners, shadow and resize border; snapping works
    // via the -webkit-app-region: drag header (WindowTitleBar.jsx).
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }, { centerOnMain: true })
  const win = new BrowserWindow(windowState.options)
  registerWindowBoundsPersistence('gameDetails', win, windowState)
  gameDetailsRecordMap.set(win.webContents.id, recordId)
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '/gamedetails.html')
  } else {
    win.loadFile(path.join(__dirname, '../dist/renderer/gamedetails.html'))
  }
  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    win.webContents.openDevTools()
  }
  win.on('maximize', () => win.webContents.send('window-state-changed', 'maximized'))
  win.on('unmaximize', () => win.webContents.send('window-state-changed', 'normal'))
  const webContentsId = win.webContents.id
  win.on('closed', () => { gameDetailsRecordMap.delete(webContentsId) })
}

function showExecutableChooser(title, version, executables) {
  if (executableChooserWindow && !executableChooserWindow.isDestroyed()) {
    focusWindow(executableChooserWindow)
    executableChooserWindow.webContents.send('init-executable-chooser', { title, version, executables })
    return
  }
  const windowState = applySavedWindowBounds('executableChooser', {
    width: 600,
    height: 400,
    frame: false,
    // Windows draws a native DWM resize border (often tinted with the
    // system accent color) around frame:false windows that aren't also
    // transparent -- that's the stray colored line on the left/right/
    // bottom edges that no amount of CSS could ever reach, since it's
    // painted by the OS outside the web content entirely. The renderer
    // already paints a fully opaque background on every window's root
    // element (bg-canvas/bg-secondary/etc. -- see e.g. App.jsx), so it's
    // safe to go fully transparent at the native level instead.
    transparent: true,
    // Windows needs an explicit zero-alpha background color for true
    // per-pixel transparency to render cleanly -- without it, the
    // "transparent" region (e.g. outside a rounded-corner content clip)
    // can render with artifacts instead of properly showing through.
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }, { centerOnMain: true })
  executableChooserWindow = new BrowserWindow(windowState.options)
  registerWindowBoundsPersistence('executableChooser', executableChooserWindow, windowState)
  executableChooserWindow.loadFile(
    path.join(__dirname, '../../src/assets/ui/executable-chooser.html')
  )
  executableChooserWindow.webContents.on('did-finish-load', () => {
    executableChooserWindow.webContents.send('init-executable-chooser', { title, version, executables })
  })
  executableChooserWindow.on('closed', () => { executableChooserWindow = null })
}

// ── Register all IPC handlers ───────────────────────────────────────────────

function buildCtx() {
  return {
    // windows
    mainWindow, settingsWindow, importerWindow, executableChooserWindow, themeBuilderWindow, bannerEditorWindow,
    createSettingsWindow, createImporterWindow, createGameDetailsWindow, showExecutableChooser,
    createThemeBuilderWindow, createBannerEditorWindow, createImporterHelpWindow,
    quitFromMainWindow,
    // state
    appConfig, configPath, dataDir, launcherDir, templatesDir, themeTemplatesDir,
    imagesDir, updatesDir,
    // Read by the Client Check panel so the config prune that already ran at
    // startup can be reported rather than repeated.
    get configSanitizeReport() { return configSanitizeReport },
    get bannerLayoutMigrationReport() { return bannerLayoutMigrationReport },
    readActiveBannerLayout: () => readActiveLayout(dataDir, appConfig),
    writeActiveBannerLayout: (layout) => writeActiveLayout(dataDir, layout),
    nsfwConfigured,
    contextMenuData, contextMenuId, recentlyDeletedGamePaths, gameDetailsRecordMap,
    activeImportSession, activeScanSession, activeLibraryValidation, isQuitting,
    // updater state
    autoUpdater, lastUpdateStatus, updateInfo, updateDownloaded, installAfterDownload,
    getConfiguredAppUpdateBranch, configureAppUpdateBranch,
    // path helpers
    getAssetBasePath, getMediaStorageMode, firstMediaPath,
    getMetadataSourceOrder,
    normalizeForPathCompare, isPathInside, removeEmptyParentDirectories,
    deletePathWithElevationFallback,
    isAllowedDeletionPath, getTrustedVersion, deleteTitleRecord,
    // db functions
    addGame, updateGame, addVersion, upsertVersion, updateVersion,
    recordGameLaunchStarted, recordGamePlaytime, setGameFavorite, setGamePersonalRatings, setGamePlaystate, setVersionPlaystate,
    addAtlasMapping, getGame, getGames, getCatalogGames, getGameRecordIds,
    removeGame, checkDbUpdates, updateFolderSize,
    addWishlistEntry, removeWishlistEntry, toggleWishlistEntry,
    getWishlistEntries, getWishlistEntryIdentities,
    getBannerUrl, getScreensUrlList, getRemoteBannerUrl, getRemotePreviewUrls, getSteamMovieThumbnails,
    getAllDownloadableAssetUrlsForRecord, upsertMediaAsset,
    getEmulatorConfig, removeEmulatorConfig, saveEmulatorConfig, getEmulatorByExtension,
    GetAtlasIDbyRecord, getPreviews, getBanner, deleteBanner, deletePreviews,
    getBrowsePreviewUrls,
    getSteamBrowseMediaForAppId,
    searchAtlas, searchAtlasByF95Id, findF95Id, checkPathExist,
    findExistingRecordForImport, getImportRecordStatus,
    updateBanners, updatePreviews, getAtlasData, getSteamIDbyRecord, addSteamMapping,
    countVersions, deleteVersion, deleteGameCompletely,
    getUniqueFilterOptions, getVersionForRecord, getInstalledVersionsForRecord,
    getVersionPathsForRecord, db: dbIndex.db,
    getManualMappings, setManualMappings, setSelectedGameVersion,
    getGameOverrides, clearGameOverrides, validateGameMetadataOverrides,
    // Reading the startup repair summary clears it, so the renderer shows the
    // notice once per launch even if it remounts.
    takeStartupRepairSummary: () => {
      const summary = startupRepairSummary
      startupRepairSummary = null
      return summary
    },
    // scanners
    startSteamScan, startScan,
  }
}

// ── Boot instrumentation ────────────────────────────────────────────────────
// Every startup phase is timed and logged so a slow launch can be attributed to
// a phase from the log alone, instead of being guessed at. Cheap: one Date.now()
// pair per phase.
const bootStartedAt = Date.now()

async function withPhaseTiming(label, task) {
  const startedAt = Date.now()
  try {
    return await task()
  } finally {
    const elapsed = Date.now() - startedAt
    // Only the slow ones are worth a line; anything sub-250ms is noise.
    if (elapsed >= 250) console.log(`boot: ${label} took ${elapsed}ms (+${Date.now() - bootStartedAt}ms)`)
  }
}

// Stale exec_path repair, scheduled off the boot critical path.
//
// Two things decide how much work this does:
//
//   * Library.validatePathsOnStartup — the setting the user already has for
//     "check my library against the filesystem when Atlas starts". When it is
//     ON, the full sweep runs. When it is OFF, only 'quick' runs: rows whose
//     exec_path is blank, i.e. versions that cannot be launched at all. Doing
//     the full sweep against the setting was the bug — path validation was
//     explicitly disabled and Atlas walked the whole library anyway.
//   * A wall-clock budget, so even the full sweep cannot run away on a cold
//     mechanical drive. It resumes on the next launch where it left off,
//     because the repair is idempotent and re-queries every time.
//
// The delay lets the renderer's own initial get-games query (which runs with
// skipPathValidation, so it never touches disk) finish first — the sqlite
// connection is shared, and there is no reason to make the library grid wait
// behind a maintenance pass.
function scheduleStaleExecutableRepair() {
  const validateOnStartup =
    appConfig?.Library?.validatePathsOnStartup === true ||
    appConfig?.Library?.validatePathsOnStartup === 'true'

  const extensions = String(appConfig?.Library?.gameExtensions || '')
    .split(',')
    .map((ext) => ext.trim())
    .filter(Boolean)

  setTimeout(async () => {
    try {
      const summary = await repairStaleVersionExecutables(
        extensions.length > 0 ? extensions : undefined,
        {
          mode: validateOnStartup ? 'full' : 'quick',
          // A mechanical drive gets slower, not faster, with a deeper queue.
          concurrency: 8,
          budgetMs: validateOnStartup ? 60000 : 15000,
        },
      )
      if (summary?.repaired > 0) {
        // Repointing exec_path changes installed/missing state, so let the grid
        // pick the rows up instead of showing stale badges until the next launch.
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send('library-exec-paths-repaired', summary)
        })
      }
    } catch (err) {
      console.warn('Stale executable repair failed:', err?.message || err)
    }
  }, 4000)
}

// ── App lifecycle ───────────────────────────────────────────────────────────


// ── Data folder health and legacy migration ─────────────────────────────────

const MIGRATION_MARKER = () => path.join(dataDir, '.appdata-migration-prompted')
const REPAIR_FLAG = '--atlas-repair-permissions'

// Relaunch elevated to fix the ACL on the data folder, then relaunch normally.
// Elevating ONCE to repair permissions is very different from running the whole
// app as administrator: Atlas spawns game executables, and a child process
// inherits its parent's elevation, so a permanently elevated Atlas would hand
// admin rights to every game it launches.
function relaunchElevatedForRepair() {
  if (process.platform !== 'win32') return false
  const exe = process.execPath
  const args = [...process.argv.slice(1), REPAIR_FLAG]
    .map((a) => `'${String(a).replace(/'/g, "''")}'`)
    .join(',')
  const psArgs = args ? `-ArgumentList ${args}` : ''
  try {
    require('child_process').spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', `Start-Process -FilePath '${exe}' ${psArgs} -Verb RunAs`],
      { detached: true, stdio: 'ignore', windowsHide: true },
    ).unref()
    return true
  } catch (err) {
    console.error('Failed to relaunch elevated:', err.message)
    return false
  }
}

async function runPermissionRepair() {
  // Deleting the data folder takes its ACL with it, and recreating it needs
  // write access on the PARENT (Program Files) which only this elevated pass
  // has. grantUsersModify() mkdirs before applying the grant for that reason,
  // so a deleted folder is recoverable rather than a reinstall.
  const result = await grantUsersModify(dataDir)
  if (!result.ok) {
    dialog.showErrorBox(
      'Atlas — could not repair permissions',
      `Granting write access to:\n\n${dataDir}\n\nfailed:\n${result.error || 'unknown error'}`,
    )
    return false
  }
  return true
}

async function checkDataFolderWritable() {
  if (process.defaultApp) return true
  if (dataWriteState.writable) return true

  // Launched with the repair flag: we should be elevated, so fix and restart.
  if (process.argv.includes(REPAIR_FLAG)) {
    if (await isElevated()) {
      const ok = await runPermissionRepair()
      if (ok) {
        app.relaunch({ args: process.argv.slice(1).filter((a) => a !== REPAIR_FLAG) })
      }
      app.exit(0)
      return false
    }
  }

  // Only Windows has an installer-granted ACL to repair. On Linux the data root
  // is inside the user's own home directory, so if that is unwritable there is
  // nothing Atlas can grant itself — offering to elevate would be a dead end.
  if (!dataWriteState.repairable) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Atlas — data folder is not writable',
      message: 'Atlas cannot write to its data folder, so the cache and database cannot be created.',
      detail:
        `${dataDir}\n\n${dataWriteState.error || ''}\n\n` +
        'Check that you own this directory and that the disk is not full or mounted read-only.',
      buttons: ['Quit'],
      noLink: true,
    })
    app.exit(1)
    return false
  }

  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Atlas — data folder is not writable',
    message: 'Atlas cannot write to its data folder, so the cache and database cannot be created.',
    detail:
      `${dataDir}\n\n${dataWriteState.error || ''}\n\n` +
      'Atlas can restart with administrator rights just once to grant your account ' +
      'write access to this folder. Atlas itself will keep running normally afterwards.',
    buttons: ['Grant Access and Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response === 0 && relaunchElevatedForRepair()) {
    app.exit(0)
    return false
  }
  app.exit(1)
  return false
}

// Offers to bring data across from the old %APPDATA%\Atlas location. Prompts at
// most once on its own; after that it is only reachable from the client check
// (see the migrate-legacy-data / get-data-location-status handlers).
async function maybePromptLegacyMigration({ force = false } = {}) {
  if (process.defaultApp) return
  let alreadyPrompted = false
  try { alreadyPrompted = fs.existsSync(MIGRATION_MARKER()) } catch { /* ignore */ }
  if (alreadyPrompted && !force) return

  const legacy = getLegacyDataDirs(app).filter(
    (dir) => path.resolve(dir).toLowerCase() !== path.resolve(dataDir).toLowerCase(),
  )
  if (legacy.length === 0) {
    try { fs.writeFileSync(MIGRATION_MARKER(), String(Date.now())) } catch { /* ignore */ }
    return
  }

  const source = legacy[0]
  const { bytes, files } = await directorySize(source)
  const mb = (bytes / (1024 * 1024)).toFixed(1)
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Atlas — move existing data?',
    message: 'Atlas found data in the old AppData location.',
    detail:
      `${source}\n\n${files} files, ${mb} MB\n\n` +
      `Move it to:\n${dataDir}\n\n` +
      'Files are copied and verified first; the old folder is only deleted once ' +
      'the copy is confirmed. Any file already present in the new location is kept.',
    buttons: ['Move Data', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })

  // Recorded either way, so declining does not re-prompt every launch.
  try { fs.writeFileSync(MIGRATION_MARKER(), String(Date.now())) } catch { /* ignore */ }
  if (response !== 0) return

  const result = await migrateLegacyData(source, dataDir)
  if (!result.success) {
    dialog.showErrorBox(
      'Atlas — data move failed',
      `${result.error}\n\nYour original data has been left untouched at:\n${source}`,
    )
    return
  }
  await dialog.showMessageBox({
    type: 'info',
    title: 'Atlas — data moved',
    message: `Moved ${result.files} files (${(result.bytes / (1024 * 1024)).toFixed(1)} MB).`,
    detail: result.warning || `The old folder at ${source} has been removed.`,
    buttons: ['OK'],
    noLink: true,
  })
  app.relaunch()
  app.exit(0)
}

function registerDataLocationHandlers() {
  ipcMain.handle('get-data-location-status', async () => {
    const legacy = getLegacyDataDirs(app).filter(
      (dir) => path.resolve(dir).toLowerCase() !== path.resolve(dataDir).toLowerCase(),
    )
    let legacySize = null
    if (legacy.length > 0) legacySize = await directorySize(legacy[0])
    return {
      dataDir,
      installDir: appDataRoot,
      writable: dataWriteState.writable,
      error: dataWriteState.error,
      portableForced: isPortableForced(),
      legacyDir: legacy[0] || null,
      legacyFiles: legacySize?.files || 0,
      legacyBytes: legacySize?.bytes || 0,
    }
  })

  // Re-offer the move from a client check, ignoring the one-shot marker.
  ipcMain.handle('migrate-legacy-data', async () => {
    await maybePromptLegacyMigration({ force: true })
    return { success: true }
  })

  ipcMain.handle('repair-data-permissions', async () => {
    if (await isElevated()) {
      const ok = await runPermissionRepair()
      return { success: ok, elevated: true }
    }
    const launched = relaunchElevatedForRepair()
    if (launched) app.exit(0)
    return { success: launched, elevated: false }
  })
}

app.whenReady().then(async () => {
  // The writability check comes BEFORE the single-instance gate on purpose. It
  // used to sit after, so when the lock failed this handler returned early and
  // the repair dialog never appeared — the user got only console noise and a
  // silent exit, which is exactly what happened when someone deleted their data
  // folder. An unwritable data folder needs explaining whether or not we hold
  // the lock, and a stale lock is itself a plausible symptom of broken storage.
  if (!(await checkDataFolderWritable())) return
  if (!hasSingleInstanceLock) return

  registerDataLocationHandlers()

  // Serve local downloaded media (atlas-media://local/<encoded-abs-path>).
  // Files are only served from within the app's asset base directory.
  protocol.handle('atlas-media', async (request) => {
    try {
      const url = new URL(request.url)
      const decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const resolved = path.resolve(decoded)
      const baseResolved = path.resolve(getAssetBasePath())
      const withinBase =
        resolved.toLowerCase() === baseResolved.toLowerCase() ||
        resolved.toLowerCase().startsWith(baseResolved.toLowerCase() + path.sep)
      if (!withinBase) {
        console.warn('atlas-media: blocked out-of-base request:', resolved)
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fsp.readFile(resolved)
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { 'Content-Type': mediaContentType(resolved) },
      })
    } catch (err) {
      console.error('atlas-media protocol error:', request.url, err.message)
      return new Response('Not found', { status: 404 })
    }
  })

  // Initialize database
  initializeDatabase(dataDir)

  // Correct any normalized_title values computed by the old SQL migration (which
  // diverged from the JS import matcher on accented/non-Latin titles, breaking
  // import-to-atlas matching for non-English-region users). Deferred so it runs
  // after initializeDatabase's async table/migration work has settled; it's
  // idempotent and only rewrites rows whose key actually differs.
  setTimeout(() => {
    recomputeNormalizedTitles()
      .then((res) => { if (res?.fixed) console.log(`normalized_title repair: fixed ${res.fixed} rows`); })
      .catch((err) => console.error('normalized_title repair failed:', err?.message))
  }, 3000)

  // Load or create config — merge parsed ini with defaults so missing
  // keys always have a value and boolean strings are coerced correctly
  // Delegates to the shared schema so main.js and ipc/settings.js can never
  // drift apart again — that divergence is what silently deleted [Updates] and
  // [WindowBounds] from config.ini on every settings save.
  const mergeConfigWithDefaults = (parsed) => mergeWithDefaults(parsed, defaultConfig)

  // Prune keys left behind by 0.7/0.8-era builds before anything reads the
  // file. Only keys on an explicit deprecation list are touched, and config.ini
  // is backed up to config.ini.bak first; the report is held for the Client
  // Check panel in Settings -> Database rather than shown as a startup toast.
  configSanitizeReport = sanitizeConfigFile(configPath, ini, dataDir)

  if (fs.existsSync(configPath)) {
    try {
      const rawParsed = ini.parse(fs.readFileSync(configPath, 'utf-8'))
      nsfwConfigured = rawParsed?.NSFW?.enabled !== undefined
      appConfig = mergeConfigWithDefaults(rawParsed)
    } catch {
      appConfig = { ...defaultConfig }
      nsfwConfigured = false
    }
  } else {
    appConfig = { ...defaultConfig }
    fs.writeFileSync(configPath, ini.stringify(defaultConfig))
    nsfwConfigured = false
  }

  // Move the active banner layout out of config.ini and into its own file. It was
  // 18,421 bytes on a real config -- 89% of the whole file -- which made
  // config.ini unreadable by hand and meant every settings save rewrote all of
  // it. Themes already work this way (themeId in config, definition in
  // templates/theme). Runs after appConfig is loaded and writes the file, reads
  // it back and compares BEFORE dropping the ini key, so a failed write cannot
  // lose the layout; on any error the key stays and the next launch retries.
  try {
    bannerLayoutMigrationReport = migrateActiveLayoutToFile(dataDir, appConfig, configPath, ini)
    if (bannerLayoutMigrationReport?.config) appConfig = bannerLayoutMigrationReport.config
  } catch (err) {
    console.warn('Banner layout migration skipped:', err.message)
  }

  // Stamp the running build's version onto its own channel BEFORE resolving
  // the update baseline, so the active channel always reflects the true
  // on-disk version and only the *other* channel can be a never-installed
  // 0.0.0. Must run after appConfig is loaded above.
  recordRunningBuildVersion()

  configureAppUpdateBranch(getConfiguredAppUpdateBranch(appConfig))

  // DB-only repairs. These are all filtered SQL passes with no filesystem
  // access, so they are cheap even on a large library and safe to run before the
  // window: repairDoubledApostropheRows in particular fixes titles the grid is
  // about to display.
  //
  // repairStaleVersionExecutables() used to be awaited HERE, and it was the
  // whole reason a large library on a mechanical drive took minutes to reach the
  // UI after a reboot — see the header comment on it in db/repair.js. It now
  // runs after createWindow(); see scheduleStaleExecutableRepair() below.
  await withPhaseTiming('repair:apostrophes', () => repairDoubledApostropheRows())
  await withPhaseTiming('repair:blank-versions', () => repairBlankVersionNames())
  await withPhaseTiming('repair:playtime', () => repairMissingTotalPlaytime())
  // Repairs the blanking/redundant custom-metadata rows left behind by the old
  // write-everything updateGame(). Idempotent, so this is a no-op on every boot
  // after the first, but the FIRST run on an affected library has real work to
  // do — and it happens before createWindow(), with nothing on screen. Report
  // progress so a slow pass reads as progress rather than a hang.
  try {
    // Nothing to validate if no title has custom data at all.
    if ((await countGameMetadataOverrideRows()) > 0) {
      await withBootProgress('Updating your library', async (report) => {
        report('Checking custom game data…')
        const summary = await validateGameMetadataOverrides({
          onProgress: ({ processed, total, message }) => {
            report(message, total > 0 ? processed / total : null)
          },
        })
        const repaired = (summary?.blankedFields || 0) + (summary?.redundantFields || 0)
        if (repaired > 0) {
          report('Finishing up…', 1)
          console.log(
            `Custom metadata repaired on first run: ${repaired} field(s) across ` +
            `${summary.affectedTitles.length} title(s) in ${summary.durationMs}ms`,
          )
          // Held for the renderer to pick up and show as a toast, so a silent
          // bulk change to the user's library is actually reported to them.
          startupRepairSummary = {
            blankedFields: summary.blankedFields,
            redundantFields: summary.redundantFields,
            repairedFields: repaired,
            titleCount: summary.affectedTitles.length,
            deletedRows: summary.deletedRows,
            durationMs: summary.durationMs,
            // A few examples so the notice can name what changed.
            sampleTitles: summary.affectedTitles.slice(0, 5).map((t) => t.title),
          }
        }
      })
    }
  } catch (err) {
    console.warn('Custom metadata validation failed:', err.message)
  }

  // Load encrypted site accounts before the window (and its webRequest cookie
  // hook) come up, then refresh any expired sessions in the background.
  try {
    accountStore.init(dataDir)
    accountStore.refreshAllAccounts().catch((err) =>
      console.warn('Account cookie refresh failed:', err.message),
    )
  } catch (err) {
    console.warn('Account store init failed:', err.message)
  }

  // Steam owned-library store (separate from the cookie-based accountStore).
  try {
    require('./accounts/steamStore').init(dataDir)
  } catch (err) {
    console.warn('Steam store init failed:', err.message)
  }

  createWindow()
  // The main window exists, so window-all-closed can quit normally again.
  isBooting = false
  console.log(`boot: window created at +${Date.now() - bootStartedAt}ms`)

  // Filesystem-touching repair, deliberately AFTER the window and never awaited.
  scheduleStaleExecutableRepair()

  // Offer to bring across data from the old AppData location. After the window
  // so the prompt has a parent and does not delay startup; prompts at most once
  // on its own, and is re-offered from the client check thereafter.
  maybePromptLegacyMigration().catch((err) =>
    console.warn('Legacy data migration check failed:', err?.message || err),
  )

  // Build the Browse catalog index if it is missing or stale. Deliberately AFTER
  // createWindow() and not awaited: the library grid does not depend on it, so
  // there is no reason to hold the window back. rebuildCatalogIndex() commits in
  // chunks and yields between them, which matters because every query shares one
  // sqlite connection — a single long transaction would queue the library's own
  // reads behind it and read as a freeze. Progress is streamed to the renderer so
  // Browse can show it instead of an empty grid.
  setTimeout(async () => {
    try {
      // The DB update check also runs at startup. The write lock makes the two
      // safe to overlap, but there is no point queueing every index chunk behind
      // a long catalog sync — wait for the writer to finish first, up to a cap so
      // a stuck sync can never block the build forever.
      for (let waited = 0; isWriteLockBusy() && waited < 120000; waited += 1000) {
        if (waited === 0) {
          console.log(`catalog_index build waiting for ${activeWriteLockLabel() || 'another writer'}…`)
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
      const status = await getCatalogIndexStatus()
      if (status.ready) {
        console.log(`catalog_index ready: ${status.rowCount} entries`)
        return
      }
      console.log(
        `catalog_index needs building (version ${status.version} -> ${status.expectedVersion}` +
        `${status.stale ? `, stale: ${status.staleReason}` : ''}); building in background`,
      )
      await rebuildCatalogIndex({
        onProgress: (payload) => {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('catalog-index-progress', payload)
          })
        },
      })
    } catch (err) {
      console.error('Background catalog index build failed:', err?.message || err)
    }
  }, 1500)

  const ctx = buildCtx()

  // Patch ctx so mutable references stay live via getters
  Object.defineProperty(ctx, 'mainWindow', { get: () => mainWindow })
  Object.defineProperty(ctx, 'settingsWindow', { get: () => settingsWindow })
  Object.defineProperty(ctx, 'importerWindow', { get: () => importerWindow })
  Object.defineProperty(ctx, 'appConfig', {
    get: () => appConfig,
    set: (v) => { appConfig = v },
  })
  Object.defineProperty(ctx, 'nsfwConfigured', {
    get: () => nsfwConfigured,
    set: (v) => { nsfwConfigured = v },
  })
  Object.defineProperty(ctx, 'contextMenuId', {
    get: () => contextMenuId,
    set: (v) => { contextMenuId = v },
  })
  Object.defineProperty(ctx, 'activeImportSession', {
    get: () => activeImportSession,
    set: (v) => { activeImportSession = v },
  })
  Object.defineProperty(ctx, 'activeScanSession', {
    get: () => activeScanSession,
    set: (v) => { activeScanSession = v },
  })
  Object.defineProperty(ctx, 'activeLibraryValidation', {
    get: () => activeLibraryValidation,
    set: (v) => { activeLibraryValidation = v },
  })
  Object.defineProperty(ctx, 'lastUpdateStatus', {
    get: () => lastUpdateStatus,
    set: (v) => { lastUpdateStatus = v },
  })
  Object.defineProperty(ctx, 'updateDownloaded', {
    get: () => updateDownloaded,
    set: (v) => { updateDownloaded = v },
  })
  Object.defineProperty(ctx, 'installAfterDownload', {
    get: () => installAfterDownload,
    set: (v) => { installAfterDownload = v },
  })

  registerGamesHandlers(ctx)
  registerWindowsHandlers(ctx)
  registerSettingsHandlers(ctx)
  registerUpdaterHandlers(ctx)
  registerMediaHandlers(ctx)
  registerImporterHandlers(ctx)
  registerThemeHandlers(ctx)
  registerAccountsHandlers(ctx)
  registerCollectionsHandlers(ctx)

  if (appConfig?.Interface?.checkForAppUpdatesOnStartup) {
    autoUpdater.checkForUpdates().catch((err) => {
      const normalizedError = normalizeUpdateError(err)
      console.warn('Startup update check failed:', normalizedError.technicalMessage)
      // The startup check is a background, unsolicited action. Only surface
      // outcomes the user can actually act on. A benign "no release on this
      // channel yet" (nothing published for this branch) is not an error and
      // must not pop a failure notice on every launch — stay silent and let
      // the footer remain idle. Real, actionable failures (network, package
      // not ready, genuine check failure) still surface.
      if (normalizedError.code === 'UPDATE_NO_RELEASE_ON_CHANNEL') {
        sendUpdateStatus({ status: 'not-available' }, 'startup-no-release-on-channel')
        return
      }
      sendUpdateStatus({
        status: 'error',
        error: normalizedError.userMessage,
        code: normalizedError.code,
        retryable: normalizedError.retryable,
      })
    })
  }
})

app.on('before-quit', () => { isQuitting = true })

app.on('window-all-closed', () => {
  // During boot the only window on screen may be the transient progress window
  // (see withBootProgress). Closing it must not quit the app before the main
  // window has been created.
  if (isBooting) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusWindow(mainWindow)
  } else if (hasSingleInstanceLock) {
    createWindow()
  }
})
