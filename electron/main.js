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
} = require('./db/repair')

const {
  addGame, updateGame, removeGame, deleteGameCompletely,
  getGameRecordIds, countVersions, deleteVersion,
  getUniqueFilterOptions, recordGameLaunchStarted, recordGamePlaytime,
  setGameFavorite, setGamePersonalRatings,
  getManualMappings, setManualMappings, setSelectedGameVersion,
} = require('./db/games')

const {
  updateFolderSize, getBannerUrl, getScreensUrlList,
  updateBanners, updatePreviews, getRemotePreviewUrls,
  getPreviews, getBanners, getBanner, getRemoteBannerUrl, getBrowsePreviewUrls,
  getAllDownloadableAssetUrlsForRecord, upsertMediaAsset,
  deleteBanner, deletePreviews,
} = require('./db/media')

const {
  searchAtlas, searchAtlasByF95Id, findF95Id, GetAtlasIDbyRecord,
  addAtlasMapping, getAtlasData, getImportRecordStatus, insertJsonData,
} = require('./db/atlas')

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
let activeImportSession = null
let activeLibraryValidation = null
let activeScanSession = null
let isQuitting = false

let updateInfo = null
let updateDownloaded = false
let lastUpdateStatus = { status: 'idle' }
let installAfterDownload = false
let activeAppUpdateBranch = null

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
  // Forced portable mode: always use data beside the exe, no AppData fallback.
  if (isPortableForced()) {
    try { fs.mkdirSync(path.join(installDir, 'data'), { recursive: true }) } catch { /* best effort */ }
    return installDir
  }
  try {
    fs.mkdirSync(path.join(installDir, 'data'), { recursive: true })
    // Write test to confirm we have write access
    const testFile = path.join(installDir, 'data', '.write-test')
    fs.writeFileSync(testFile, '1')
    fs.unlinkSync(testFile)
    return installDir
  } catch {
    // Install dir is not writable (e.g. Program Files) — fall back to AppData
    console.warn('Install directory not writable, using AppData instead')
    return app.getPath('userData')
  }
}

const appDataRoot = resolveAppDataRoot()
var dataDir = path.join(appDataRoot, 'data')
var launcherDir = path.join(appDataRoot, 'launchers')

fs.mkdirSync(appDataRoot, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })

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
  } catch (err) {
    console.warn('Failed to redirect Electron storage into data dir:', err?.message || err)
  }
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

fs.mkdirSync(launcherDir, { recursive: true })

const updatesDir = path.join(dataDir, 'updates')
if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir, { recursive: true })

const imagesDir = path.join(dataDir, 'images')
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })

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
const defaultConfig = {
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
    // Max size (MB) of Chromium's disk cache used for streamed banner/preview
    // images. Applied at startup via --disk-cache-size (see readConfiguredCacheBytes).
    imageCacheSizeMB: 1024,
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
    // Game detail page panel layout (3 columns). Stored as a JSON string so it
    // round-trips cleanly through INI. Shared across all games. Panels not
    // listed here (or newly added) are appended to the shortest column.
    detailLayout: '{"columns":[[{"id":"previews","span":2}],[],[{"id":"versions","span":1},{"id":"rating","span":1},{"id":"details","span":1},{"id":"links","span":1},{"id":"tags","span":1}]]}',
    // Nav button presentation ('icons' | 'iconsAndText' | 'text') and
    // whether the header's accent-bar notch strip is shown — both
    // independent of theme/layout, same pattern as layout above. See
    // NAV_DISPLAY_MODE_OPTIONS / DEFAULT_NAV in src/theme/themes.js.
    // Falls back to the active theme's own nav defaults whenever this is
    // unset (fresh install, or before a theme has ever been explicitly
    // picked) — see ThemeProvider.jsx's parseAppearance.
    navDisplayMode: 'icons',
    accentBarEnabled: true,
    // Which edge the filter sidebar (SearchSidebar.jsx) docks to, and
    // whether it overlays the library grid or shares space with it
    // inline — see FILTER_SIDEBAR_SIDE_OPTIONS / FILTER_SIDEBAR_MODE_OPTIONS
    // in src/theme/themes.js. Same independent-of-theme pattern as above.
    filterSidebarSide: 'right',
    filterSidebarMode: 'overlay',
    customTheme: '',
  },
  // Whether the user has opted in to NSFW/adult ("Browse mode") content.
  // Deliberately NOT merged into Interface/Library/etc — see the
  // nsfwConfigured detection below, which checks for the literal absence
  // of this key in the saved ini (not just a falsy value) to decide
  // whether the first-run NSFW confirmation prompt should be shown.
  NSFW: {
    enabled: false,
  },
  WindowBounds: {},
}

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

function getConfiguredAppUpdateBranch(config = appConfig) {
  return normalizeAppUpdateBranch(config?.Interface?.appUpdateBranch) || getDefaultAppUpdateBranch()
}

function configureAppUpdateBranch(branch, { resetStatus = false } = {}) {
  const normalizedBranch = normalizeAppUpdateBranch(branch) || getDefaultAppUpdateBranch()
  const previousBranch = activeAppUpdateBranch
  activeAppUpdateBranch = normalizedBranch
  autoUpdater.setFeedURL({ provider: 'github', owner: 'towerwatchman', repo: 'Atlas', channel: 'latest' })
  autoUpdater.allowPrerelease = normalizedBranch === 'nightly'
  autoUpdater.allowDowngrade = false

  if (resetStatus && previousBranch && previousBranch !== normalizedBranch) {
    updateInfo = null
    updateDownloaded = false
    installAfterDownload = false
    sendUpdateStatus({ status: 'idle' }, 'update-branch-changed')
  }

  console.log(`Configured app update branch: ${normalizedBranch}`)
  return normalizedBranch
}

configureAppUpdateBranch(getDefaultAppUpdateBranch())
autoUpdater.autoDownload = false

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
  console.error('Updater error:', err)
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

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusWindow(mainWindow)
    return mainWindow
  }
  const windowState = applySavedWindowBounds('main', {
    width: 1410,
    minWidth: 1410,
    height: 860,
    minHeight: 860,
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
  return ['atlas', 'steam', 'renpy'].includes(value) ? value : 'atlas'
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
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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
    recordGameLaunchStarted, recordGamePlaytime, setGameFavorite, setGamePersonalRatings,
    addAtlasMapping, getGame, getGames, getCatalogGames, getGameRecordIds,
    removeGame, checkDbUpdates, updateFolderSize,
    addWishlistEntry, removeWishlistEntry, toggleWishlistEntry,
    getWishlistEntries, getWishlistEntryIdentities,
    getBannerUrl, getScreensUrlList, getRemoteBannerUrl, getRemotePreviewUrls,
    getAllDownloadableAssetUrlsForRecord, upsertMediaAsset,
    getEmulatorConfig, removeEmulatorConfig, saveEmulatorConfig, getEmulatorByExtension,
    GetAtlasIDbyRecord, getPreviews, getBanner, deleteBanner, deletePreviews,
    getBrowsePreviewUrls,
    searchAtlas, searchAtlasByF95Id, findF95Id, checkPathExist,
    findExistingRecordForImport, getImportRecordStatus,
    updateBanners, updatePreviews, getAtlasData, getSteamIDbyRecord, addSteamMapping,
    countVersions, deleteVersion, deleteGameCompletely,
    getUniqueFilterOptions, getVersionForRecord, getInstalledVersionsForRecord,
    getVersionPathsForRecord, db: dbIndex.db,
    getManualMappings, setManualMappings, setSelectedGameVersion,
    // scanners
    startSteamScan, startScan,
  }
}

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return

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

  // Load or create config — merge parsed ini with defaults so missing
  // keys always have a value and boolean strings are coerced correctly
  function mergeConfigWithDefaults(parsed) {
    const result = {}
    for (const section of Object.keys(defaultConfig)) {
      result[section] = { ...defaultConfig[section] }
      if (parsed && parsed[section]) {
        for (const key of Object.keys(defaultConfig[section])) {
          const raw = parsed[section][key]
          if (raw === undefined) continue
          const def = defaultConfig[section][key]
          if (typeof def === 'boolean') result[section][key] = raw === true || raw === 'true'
          else if (typeof def === 'number') {
            const parsedNumber = Number(raw)
            result[section][key] = Number.isFinite(parsedNumber) ? parsedNumber : def
          }
          else result[section][key] = raw
        }
        for (const key of Object.keys(parsed[section])) {
          if (!(key in defaultConfig[section])) result[section][key] = parsed[section][key]
        }
      }
    }
    return result
  }

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

  configureAppUpdateBranch(getConfiguredAppUpdateBranch(appConfig))

  await repairDoubledApostropheRows()
  await repairBlankVersionNames()
  await repairMissingTotalPlaytime()
  await repairStaleVersionExecutables()

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

  createWindow()

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

  if (appConfig?.Interface?.checkForAppUpdatesOnStartup) {
    autoUpdater.checkForUpdates().catch((err) => {
      const normalizedError = normalizeUpdateError(err)
      console.warn('Startup update check failed:', normalizedError.technicalMessage)
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
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusWindow(mainWindow)
  } else if (hasSingleInstanceLock) {
    createWindow()
  }
})
