import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import Module from 'module'

// Executes electron/main.js for real, against a stubbed Electron.
//
// This is the check that was missing. `node --check` parses without executing,
// vitest never loaded main.js, and `vite build` does not touch the main process
// at all — so a module-level error threw only on a user's machine. It let two
// startup bugs ship:
//
//   • "Cannot access 'dataWriteState' before initialization" — a let assigned by
//     a hoisted function called above its declaration.
//   • %APPDATA%\atlas being created, because requestSingleInstanceLock() ran
//     before the storage redirect.
//
// Only module-level evaluation is exercised. app.whenReady() never resolves
// here, so nothing inside it runs; that is deliberate — the goal is to catch
// "main.js cannot even be loaded", which is the failure mode that reached users.

let tmpRoot
let restoreResolve

const makeAppStub = (userDataRoot) => {
  const paths = {
    userData: path.join(userDataRoot, 'userData'),
    appData: path.join(userDataRoot, 'appData'),
    logs: path.join(userDataRoot, 'logs'),
    temp: os.tmpdir(),
    exe: path.join(userDataRoot, 'Atlas.exe'),
    crashDumps: path.join(userDataRoot, 'crashDumps'),
    sessionData: path.join(userDataRoot, 'sessionData'),
    cache: path.join(userDataRoot, 'cache'),
  }
  return {
    getPath: (key) => paths[key] ?? path.join(userDataRoot, key),
    setPath: (key, value) => { paths[key] = value },
    getAppPath: () => path.join(userDataRoot, 'resources', 'app.asar'),
    getName: () => 'atlas',
    getVersion: () => '0.0.0-test',
    setName: () => {},
    // Returning true keeps startup on the normal path; the lock-failure branch
    // quits, which would hide later module-level code.
    requestSingleInstanceLock: () => true,
    // Never resolves: whenReady work is out of scope for a load smoke test.
    whenReady: () => new Promise(() => {}),
    on: () => {},
    once: () => {},
    quit: () => {},
    exit: () => {},
    relaunch: () => {},
    isPackaged: true,
    commandLine: { appendSwitch: () => {}, appendArgument: () => {} },
    setAppUserModelId: () => {},
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({}),
    disableHardwareAcceleration: () => {},
    setAsDefaultProtocolClient: () => {},
    dock: { hide: () => {} },
  }
}

const electronStub = (userDataRoot) => {
  const noop = () => {}
  const chainable = () => ({ on: noop, once: noop, handle: noop, removeHandler: noop })
  class BrowserWindowStub {
    constructor() {
      this.webContents = { on: noop, once: noop, send: noop, session: { on: noop }, setWindowOpenHandler: noop }
      this.isDestroyed = () => false
      this.on = noop; this.once = noop; this.loadURL = noop; this.loadFile = noop
      this.show = noop; this.hide = noop; this.close = noop; this.maximize = noop
      this.setMenu = noop; this.setMenuBarVisibility = noop
    }
    static getAllWindows() { return [] }
    static fromWebContents() { return null }
  }
  return {
    app: makeAppStub(userDataRoot),
    BrowserWindow: BrowserWindowStub,
    ipcMain: { handle: noop, on: noop, once: noop, removeHandler: noop, handleOnce: noop },
    dialog: { showMessageBox: async () => ({ response: 1 }), showErrorBox: noop, showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
    shell: { openPath: async () => '', openExternal: async () => {}, showItemInFolder: noop, trashItem: async () => {} },
    Menu: { setApplicationMenu: noop, buildFromTemplate: () => ({ popup: noop }) },
    MenuItem: class {},
    Tray: class { constructor() { this.setToolTip = noop; this.setContextMenu = noop; this.on = noop } },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }) },
    protocol: { handle: noop, registerSchemesAsPrivileged: noop },
    session: { defaultSession: { on: noop, webRequest: { onBeforeSendHeaders: noop } }, fromPartition: () => ({ on: noop }) },
    net: { request: () => chainable() },
    powerSaveBlocker: { start: () => 1, stop: noop },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    globalShortcut: { register: noop, unregisterAll: noop },
    clipboard: { writeText: noop, readText: () => '' },
    crashReporter: { start: noop },
    // preload.js runs in the renderer, so it needs the bridge rather than the
    // main-process surface.
    contextBridge: { exposeInMainWorld: noop },
    ipcRenderer: {
      invoke: async () => null, send: noop, on: noop, once: noop,
      removeListener: noop, removeAllListeners: noop,
    },
    webFrame: { setZoomFactor: noop, getZoomFactor: () => 1 },
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-main-smoke-'))
  const stub = electronStub(tmpRoot)
  const originalResolve = Module._resolveFilename
  restoreResolve = () => { Module._resolveFilename = originalResolve }

  // Intercept require('electron') anywhere in the main-process tree.
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return stub
    if (request === 'electron-updater') {
      return {
        autoUpdater: {
          on: () => {}, once: () => {}, removeAllListeners: () => {},
          setFeedURL: () => {}, checkForUpdates: async () => null,
          checkForUpdatesAndNotify: async () => null,
          downloadUpdate: async () => [], quitAndInstall: () => {},
          logger: null, autoDownload: false, autoInstallOnAppQuit: false,
          allowPrerelease: false, forceDevUpdateConfig: false, currentVersion: '0.0.0-test',
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreResolve = () => {
    Module._load = originalLoad
    Module._resolveFilename = originalResolve
  }
})

afterEach(() => {
  restoreResolve?.()
  vi.resetModules()
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}electron${path.sep}`)) delete require.cache[key]
  }
})

test('electron/main.js evaluates without throwing', () => {
  const mainPath = path.join(__dirname, '..', 'electron', 'main.js')
  expect(fs.existsSync(mainPath)).toBe(true)
  // A TDZ error, a missing require, or a bad module-level call surfaces here.
  expect(() => require(mainPath)).not.toThrow()
})

test('the preload script evaluates without throwing', () => {
  const preloadPath = path.join(__dirname, '..', 'electron', 'preload.js')
  expect(() => require(preloadPath)).not.toThrow()
})
