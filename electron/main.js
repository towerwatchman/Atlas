'use strict'

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('path')
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
const {
  addVersion, upsertVersion, updateVersion,
  findExistingRecordForImport, checkRecordExist, checkPathExist,
  getVersionForRecord, getInstalledVersionsForRecord, getVersionPathsForRecord,
  getGame, getGames,
} = require('./db/versions')

const {
  repairDoubledApostropheRows, repairStaleVersionExecutables,
} = require('./db/repair')

const {
  addGame, updateGame, removeGame, deleteGameCompletely,
  getGameRecordIds, countVersions, deleteVersion,
  getUniqueFilterOptions, recordGameLaunchStarted, recordGamePlaytime,
} = require('./db/games')

const {
  updateFolderSize, getBannerUrl, getScreensUrlList,
  updateBanners, updatePreviews, getRemotePreviewUrls,
  getPreviews, getBanners, getBanner, getRemoteBannerUrl,
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

const { initializeDatabase } = require('./db/index')
const { db } = require('./db/index')

const { startSteamScan } = require('./scanners/steamscanner')
const { startScan } = require('./scanners/f95scanner')

// IPC domain modules
const { registerGamesHandlers } = require('./ipc/games')
const registerWindowsHandlers = require('./ipc/windows')
const registerSettingsHandlers = require('./ipc/settings')
const registerUpdaterHandlers = require('./ipc/updater')
const registerMediaHandlers = require('./ipc/media')
const registerImporterHandlers = require('./ipc/importer')

// ── Shared mutable state ────────────────────────────────────────────────────

const contextMenuData = new Map()
const recentlyDeletedGamePaths = new Map()
const gameDetailsRecordMap = new Map()

let contextMenuId = 0
let mainWindow
let settingsWindow
let importerWindow
let importSourceDialog
let executableChooserWindow = null
let appConfig
let activeImportSession = null
let activeLibraryValidation = null
let activeScanSession = null
let isQuitting = false

let updateInfo = null
let updateDownloaded = false
let lastUpdateStatus = { status: 'idle' }
let installAfterDownload = false

// In dev, VITE_DEV_SERVER_URL is set by the dev script
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// ── App data paths ──────────────────────────────────────────────────────────

app.commandLine.appendSwitch('force-color-profile', 'srgb')

function getLegacyResourcesPath() {
  return path.resolve(app.getAppPath(), '../../')
}

function getAssetBasePath() {
  // In dev: use app source dir. In prod: use appDataRoot (resolved after init)
  if (process.defaultApp) return app.getAppPath()
  return typeof appDataRoot !== 'undefined' ? appDataRoot : getLegacyResourcesPath()
}

function getMediaStorageMode() {
  return appConfig?.Metadata?.mediaStorageMode === 'download' ? 'download' : 'stream'
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

// In production: try install dir first (portable), fall back to AppData if not writable
function resolveAppDataRoot() {
  if (process.defaultApp) return __dirname
  const installDir = getLegacyResourcesPath()
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

if (process.defaultApp) {
  console.log('Running in development')
} else {
  console.log('Running in release, data root:', appDataRoot)
}

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(launcherDir, { recursive: true })

const updatesDir = path.join(dataDir, 'updates')
if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir, { recursive: true })

const imagesDir = path.join(dataDir, 'images')
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })

const templatesDir = path.join(dataDir, 'templates/banner')
if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true })

const configPath = path.join(dataDir, 'config.ini')
const defaultConfig = {
  Interface: {
    language: 'English',
    atlasStartup: 'Do Nothing',
    gameStartup: 'Do Nothing',
    showDebugConsole: false,
    minimizeToTray: false,
    checkForAppUpdatesOnStartup: true,
  },
  Library: {
    rootPath: dataDir,
    gameFolder: '',
    libraryFolderStructure: '{creator}/{title}/{version}',
    autoSelectLatestReplaceVersion: false,
  },
  Metadata: {
    downloadPreviews: false,
    mediaStorageMode: 'stream',
  },
  Performance: {
    maxHeapSize: 4096,
  },
}

// ── autoUpdater setup ───────────────────────────────────────────────────────

function sendUpdateStatus(status) {
  lastUpdateStatus = status
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('update-status', status)
  })
}

autoUpdater.setFeedURL({ provider: 'github', owner: 'towerwatchman', repo: 'Atlas' })
autoUpdater.autoDownload = false
autoUpdater.allowDowngrade = false

// Pass current install directory to the new installer so it updates in-place.
// NSIS /D= switch sets the install dir and must be the last argument.
// This ensures the update installs to the same folder regardless of where
// the user originally installed (e.g. portable drive, custom directory).
if (!process.defaultApp) {
  autoUpdater.installerArgs = [
    `/D=${path.dirname(process.execPath)}`,
  ]
}

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...')
  sendUpdateStatus({ status: 'checking' })
})
autoUpdater.on('update-available', (info) => {
  updateInfo = info
  updateDownloaded = false
  installAfterDownload = false
  sendUpdateStatus({ status: 'available', version: info.version })
})
autoUpdater.on('update-not-available', () => {
  updateInfo = null
  updateDownloaded = false
  installAfterDownload = false
  sendUpdateStatus({ status: 'not-available' })
})
autoUpdater.on('download-progress', (progress) => {
  sendUpdateStatus({ status: 'downloading', percent: progress.percent })
})
autoUpdater.on('update-downloaded', (info) => {
  updateInfo = info
  updateDownloaded = true
  sendUpdateStatus({ status: 'downloaded', version: info.version })
  if (installAfterDownload) {
    installAfterDownload = false
    setTimeout(() => autoUpdater.quitAndInstall(), 500)
  }
})
autoUpdater.on('error', (err) => {
  console.error('Updater error:', err)
  installAfterDownload = false
  sendUpdateStatus({ status: 'error', error: err.message })
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
    await fs.promises.rm(resolvedPath, { recursive: true, force: true })
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
  isQuitting = true
  app.quit()
}

// ── Window creation ─────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    minWidth: 1366,
    height: 800,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state-changed', 'maximized'))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state-changed', 'normal'))
  mainWindow.on('close', (e) => {
    if (!isQuitting && appConfig?.Interface?.minimizeToTray) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 900,
    height: 650,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(VITE_DEV_SERVER_URL + '/settings.html')
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/renderer/settings.html'))
  }
  settingsWindow.on('maximize', () => settingsWindow.webContents.send('window-state-changed', 'maximized'))
  settingsWindow.on('unmaximize', () => settingsWindow.webContents.send('window-state-changed', 'normal'))
  settingsWindow.on('closed', () => { settingsWindow = null })
}

function createImporterWindow() {
  if (importerWindow && !importerWindow.isDestroyed()) {
    importerWindow.focus()
    return
  }
  importerWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const importerUrl = VITE_DEV_SERVER_URL
    ? VITE_DEV_SERVER_URL + '/importer.html'
    : path.join(__dirname, '../dist/renderer/importer.html')
  console.log('Loading importer:', importerUrl);
  (VITE_DEV_SERVER_URL
    ? importerWindow.loadURL(importerUrl)
    : importerWindow.loadFile(importerUrl)
  ).then(() => {
    console.log('importer.html loaded successfully')
  }).catch((err) => {
    console.error('Failed to load importer.html:', err)
  })
  importerWindow.on('maximize', () => importerWindow.webContents.send('window-state-changed', 'maximized'))
  importerWindow.on('unmaximize', () => importerWindow.webContents.send('window-state-changed', 'normal'))
  importerWindow.on('closed', () => { importerWindow = null })
}

function createGameDetailsWindow(recordId) {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  gameDetailsRecordMap.set(win.webContents.id, recordId)
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '/gamedetails.html')
  } else {
    win.loadFile(path.join(__dirname, '../dist/renderer/gamedetails.html'))
  }
  win.on('maximize', () => win.webContents.send('window-state-changed', 'maximized'))
  win.on('unmaximize', () => win.webContents.send('window-state-changed', 'normal'))
  const webContentsId = win.webContents.id
  win.on('closed', () => { gameDetailsRecordMap.delete(webContentsId) })
}

function showExecutableChooser(title, version, executables) {
  executableChooserWindow = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
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
    mainWindow, settingsWindow, importerWindow, executableChooserWindow,
    createSettingsWindow, createImporterWindow, createGameDetailsWindow, showExecutableChooser,
    quitFromMainWindow,
    // state
    appConfig, configPath, dataDir, launcherDir, templatesDir,
    contextMenuData, contextMenuId, recentlyDeletedGamePaths, gameDetailsRecordMap,
    activeImportSession, activeScanSession, activeLibraryValidation, isQuitting,
    // updater state
    autoUpdater, lastUpdateStatus, updateInfo, updateDownloaded, installAfterDownload,
    // path helpers
    getAssetBasePath, getMediaStorageMode, firstMediaPath,
    normalizeForPathCompare, isPathInside, removeEmptyParentDirectories,
    isAllowedDeletionPath, getTrustedVersion, deleteTitleRecord,
    // db functions
    addGame, updateGame, addVersion, upsertVersion, updateVersion,
    recordGameLaunchStarted, recordGamePlaytime,
    addAtlasMapping, getGame, getGames, getGameRecordIds,
    removeGame, checkDbUpdates, updateFolderSize,
    getBannerUrl, getScreensUrlList,
    getEmulatorConfig, removeEmulatorConfig, saveEmulatorConfig, getEmulatorByExtension,
    GetAtlasIDbyRecord, getPreviews, getBanner, deleteBanner, deletePreviews,
    searchAtlas, searchAtlasByF95Id, findF95Id, checkPathExist,
    findExistingRecordForImport, getImportRecordStatus,
    updateBanners, updatePreviews, getAtlasData, getSteamIDbyRecord,
    countVersions, deleteVersion, deleteGameCompletely,
    getUniqueFilterOptions, getVersionForRecord, getInstalledVersionsForRecord,
    getVersionPathsForRecord, db,
    // scanners
    startSteamScan, startScan,
  }
}

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Initialize database
  initializeDatabase(dataDir)

  // Load or create config
  if (fs.existsSync(configPath)) {
    try { appConfig = ini.parse(fs.readFileSync(configPath, 'utf-8')) }
    catch { appConfig = defaultConfig }
  } else {
    appConfig = defaultConfig
    fs.writeFileSync(configPath, ini.stringify(defaultConfig))
  }

  await repairDoubledApostropheRows()
  await repairStaleVersionExecutables()

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

  if (appConfig?.Interface?.checkForAppUpdatesOnStartup) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('Startup update check failed:', err.message)
    })
  }
})

app.on('before-quit', () => { isQuitting = true })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
