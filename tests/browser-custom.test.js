import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import Module from 'module'
import fs from 'fs'
import path from 'path'
import {
  parseCustomBrowserId,
  addCustomBrowserPath,
  removeCustomBrowserPath,
} from '../src/utils/customBrowsers.js'

// A list of custom browsers behind `custom:<i>` ids replaces the single
// `custom` + `customBrowserPath` shape.

const { listInstalledBrowsers, resolveBrowserLaunch } = require('../electron/utils/browserDetect')

// HKLM holds only IE on the 2026-10-09 box; HKCU holds the real installs.
// Full paths so the skip-list is pinned against the real registry shape.
const REG_IE_AND_BRAVE = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\IEXPLORE.EXE',
  '    (Default)    REG_SZ    Internet Explorer',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\IEXPLORE.EXE\\shell\\open\\command',
  '    (Default)    REG_SZ    C:\\Program Files\\Internet Explorer\\iexplore.exe',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.64XATULHQ53463XA5N4NLLZX3E',
  '    (Default)    REG_SZ    Brave',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.64XATULHQ53463XA5N4NLLZX3E\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Users\\phand\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"',
  '',
].join('\r\n')

describe('Interface.customBrowserPaths config', () => {
  test('defaults to an empty array next to browserId, old string key gone', () => {
    const { buildDefaultConfig } = require('../electron/config/configSchema')
    const iface = buildDefaultConfig().Interface
    expect(iface.browserId).toBe('default')
    expect(iface.customBrowserPaths).toEqual([])
    expect('customBrowserPath' in iface).toBe(false)
  })

  test('round-trips an array through mergeWithDefaults like browserId', () => {
    const { buildDefaultConfig, mergeWithDefaults } = require('../electron/config/configSchema')
    const merged = mergeWithDefaults(
      { Interface: { ...buildDefaultConfig().Interface, browserId: 'custom:1', customBrowserPaths: ['C:\\Tools\\a.exe', 'C:\\Tools\\b.exe'] } },
      buildDefaultConfig(),
    )
    expect(merged.Interface.browserId).toBe('custom:1')
    expect(merged.Interface.customBrowserPaths).toEqual(['C:\\Tools\\a.exe', 'C:\\Tools\\b.exe'])
  })

  test('missing key falls back to the default empty array', () => {
    const { buildDefaultConfig, mergeWithDefaults } = require('../electron/config/configSchema')
    const merged = mergeWithDefaults({ Interface: { browserId: 'default' } }, buildDefaultConfig())
    expect(merged.Interface.customBrowserPaths).toEqual([])
  })
})

describe('custom browser resolve by index', () => {
  const PATHS = ['C:\\Tools\\a.exe', 'C:\\Tools\\b.exe']

  test('win32 resolves each custom:<i> id to its own list entry', () => {
    for (const [i, exe] of PATHS.entries()) {
      expect(resolveBrowserLaunch(`custom:${i}`, 'https://example.com', {
        platform: 'win32',
        customBrowserPaths: PATHS,
        isExecutableFile: (p) => p === exe,
      })).toEqual({ appPath: exe })
    }
  })

  test('win32 out-of-range id resolves to null (OS-default fallback)', () => {
    for (const id of ['custom:2', 'custom:99']) {
      expect(resolveBrowserLaunch(id, 'https://example.com', {
        platform: 'win32',
        customBrowserPaths: PATHS,
        isExecutableFile: () => true,
      })).toBeNull()
    }
  })

  test('win32 bare custom and malformed ids resolve to null', () => {
    for (const id of ['custom', 'custom:', 'custom:abc', 'custom:-1', 'custom:1.5']) {
      expect(resolveBrowserLaunch(id, 'https://example.com', {
        platform: 'win32',
        customBrowserPaths: PATHS,
        isExecutableFile: () => true,
      })).toBeNull()
    }
  })

  test('win32 missing file resolves to null (entry itself stays listed)', () => {
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'win32',
      customBrowserPaths: PATHS,
      isExecutableFile: () => false,
    })).toBeNull()
  })

  test('win32 wrong-kind path is rejected even when it exists', () => {
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'win32',
      customBrowserPaths: ['C:\\Tools\\notes.txt'],
      isExecutableFile: () => true,
    })).toBeNull()
  })

  test('empty list resolves to null on both platforms', () => {
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'win32',
      customBrowserPaths: [],
      isExecutableFile: () => true,
    })).toBeNull()
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'darwin',
      customBrowserPaths: [],
      fs: { existsSync: () => true },
    })).toBeNull()
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'win32',
      isExecutableFile: () => true,
    })).toBeNull()
  })

  test('darwin resolves a stored .app bundle path by index', () => {
    expect(resolveBrowserLaunch('custom:1', 'https://example.com', {
      platform: 'darwin',
      customBrowserPaths: ['/Applications/Other.app', '/Applications/My Browser.app'],
      fs: { existsSync: (p) => p === '/Applications/My Browser.app' },
    })).toEqual({ appPath: '/Applications/My Browser.app' })
  })

  test('darwin missing bundle resolves to null', () => {
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'darwin',
      customBrowserPaths: ['/Applications/My Browser.app'],
      fs: { existsSync: () => false },
    })).toBeNull()
  })

  test('darwin wrong-kind path is rejected even when it exists', () => {
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'darwin',
      customBrowserPaths: ['/Applications/mybrowser.exe'],
      fs: { existsSync: () => true },
    })).toBeNull()
  })
})

describe('custom entry add/remove bookkeeping', () => {
  test('parseCustomBrowserId reads the index, -1 for anything else', () => {
    expect(parseCustomBrowserId('custom:0')).toBe(0)
    expect(parseCustomBrowserId('custom:2')).toBe(2)
    expect(parseCustomBrowserId('custom')).toBe(-1)
    expect(parseCustomBrowserId('default')).toBe(-1)
    expect(parseCustomBrowserId('brave')).toBe(-1)
    expect(parseCustomBrowserId('custom:abc')).toBe(-1)
    expect(parseCustomBrowserId('custom:1')).toBe(1)
    expect(parseCustomBrowserId('custom')).toBe(-1)
  })

  test('add appends the validated path and selects the new entry', () => {
    expect(addCustomBrowserPath([], 'C:\\Tools\\a.exe')).toEqual({
      paths: ['C:\\Tools\\a.exe'],
      browserId: 'custom:0',
    })
    expect(addCustomBrowserPath(['C:\\Tools\\a.exe'], 'C:\\Tools\\b.exe')).toEqual({
      paths: ['C:\\Tools\\a.exe', 'C:\\Tools\\b.exe'],
      browserId: 'custom:1',
    })
  })

  test('removing the selected entry drops it and resets to default', () => {
    expect(removeCustomBrowserPath(['C:\\Tools\\a.exe', 'C:\\Tools\\b.exe'], 'custom:0', 0)).toEqual({
      paths: ['C:\\Tools\\b.exe'],
      browserId: 'default',
    })
  })

  test('removing an earlier entry remaps a selected later index down', () => {
    expect(removeCustomBrowserPath(['C:\\A\\a.exe', 'C:\\B\\b.exe', 'C:\\C\\c.exe'], 'custom:2', 0)).toEqual({
      paths: ['C:\\B\\b.exe', 'C:\\C\\c.exe'],
      browserId: 'custom:1',
    })
  })

  test('removing a later entry keeps the earlier selection', () => {
    expect(removeCustomBrowserPath(['C:\\A\\a.exe', 'C:\\B\\b.exe'], 'custom:0', 1)).toEqual({
      paths: ['C:\\A\\a.exe'],
      browserId: 'custom:0',
    })
  })
})

describe('iexplore.exe skip-list', () => {
  test('iexplore is absent from the detected list even when its exe exists', () => {
    const browsers = listInstalledBrowsers({
      platform: 'win32',
      runRegQuery: () => REG_IE_AND_BRAVE,
      isExecutableFile: () => true,
    })
    expect(browsers.map((b) => b.id)).toEqual(['brave'])
  })

  test('iexplore is unresolvable even when its exe exists (case-insensitive)', () => {
    const upper = REG_IE_AND_BRAVE.replace(/iexplore\.exe/g, 'IEXPLORE.EXE')
    for (const fixture of [REG_IE_AND_BRAVE, upper]) {
      expect(resolveBrowserLaunch('iexplore', 'https://example.com', {
        platform: 'win32',
        runRegQuery: () => fixture,
        isExecutableFile: () => true,
      })).toBeNull()
    }
  })
})

// The picker handler is main-process code behind dialog.showOpenDialog, so it
// is exercised through the same Module._load electron stub the launch tests
// use. No real dialog ever opens.
describe('select-custom-browser picker wiring', () => {
  let restoreLoad
  const ipcHandlers = new Map()
  let dialogResult

  beforeEach(() => {
    ipcHandlers.clear()
    dialogResult = { canceled: true, filePaths: [] }
    const electronStub = {
      ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) },
      BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
      dialog: { showOpenDialog: async () => dialogResult, showMessageBox: async () => ({ response: 1 }) },
      shell: { openExternal: async () => {} },
      app: { getVersion: () => '0.0.0' },
      Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
      desktopCapturer: { getSources: async () => [] },
      screen: { getAllDisplays: () => [] },
    }
    const gamesStub = { launchGame: async () => {}, registerGamesHandlers: () => {} }
    const originalLoad = Module._load
    Module._load = function patched(request, parent, isMain) {
      if (request === 'electron') return electronStub
      if (request === './games') return gamesStub
      return originalLoad.call(this, request, parent, isMain)
    }
    restoreLoad = () => { Module._load = originalLoad }
  })

  afterEach(() => {
    if (restoreLoad) restoreLoad()
  })

  test('picker cancel reads as null so the renderer can revert and save nothing', async () => {
    const registerWindowsHandlers = require('../electron/ipc/windows.js')
    registerWindowsHandlers({
      contextMenuData: new Map(),
      contextMenuId: 1,
      mainWindow: null,
      appConfig: {},
    })
    const pick = ipcHandlers.get('select-custom-browser')
    expect(typeof pick).toBe('function')
    dialogResult = { canceled: true, filePaths: [] }
    await expect(pick({ sender: null })).resolves.toBeNull()
  })

  test('picker accept returns the chosen path for the renderer to validate', async () => {
    const registerWindowsHandlers = require('../electron/ipc/windows.js')
    registerWindowsHandlers({
      contextMenuData: new Map(),
      contextMenuId: 1,
      mainWindow: null,
      appConfig: {},
    })
    const pick = ipcHandlers.get('select-custom-browser')
    dialogResult = { canceled: false, filePaths: ['C:\\Tools\\mybrowser.exe'] }
    await expect(pick({ sender: null })).resolves.toBe('C:\\Tools\\mybrowser.exe')
  })
})

describe('custom launch branching', () => {
  test('browserId custom:<i> plus http(s) spawns through the normal path', () => {
    const { resolveOpenExternalTarget } = require('../electron/ipc/windows.js')
    expect(resolveOpenExternalTarget({
      url: 'https://example.com', browserId: 'custom:0',
      resolve: () => ({ appPath: 'C:\\Tools\\mybrowser.exe' }),
      allowed: () => true,
    })).toEqual({ action: 'spawn', appPath: 'C:\\Tools\\mybrowser.exe', args: ['https://example.com'] })
  })

  test('browserId custom:<i> with a vanished path falls back, keepStoredId set', () => {
    const { resolveOpenExternalTarget } = require('../electron/ipc/windows.js')
    expect(resolveOpenExternalTarget({
      url: 'https://example.com', browserId: 'custom:0',
      resolve: () => null, allowed: () => true,
    })).toEqual({ action: 'fallback', keepStoredId: true })
  })
})

// Renderer wiring asserted against source: the picker/cancel/Clear flow
// lives in React and cannot be unit-tested except through the source text.
const ifaceSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'settings', 'Interface.jsx'),
  'utf8',
)

describe('Interface custom-browser row wiring', () => {
  test('Add custom... entry opens the picker through preload', () => {
    expect(ifaceSrc).toMatch(/selectCustomBrowser/)
    expect(ifaceSrc).toMatch(/value="add-custom"/)
    expect(ifaceSrc).toMatch(/Add custom\.\.\./)
  })

  test('stored paths render as one option per entry, nothing existence-gated', () => {
    expect(ifaceSrc).toMatch(/customBrowserPaths\.map\(/)
    expect(ifaceSrc).toMatch(/custom:\$\{i\}/)
  })

  test('picking the Add entry appends, selects the new entry, and saves both', () => {
    expect(ifaceSrc).toMatch(/addCustomBrowserPath\(customBrowserPaths, picked\)/)
    expect(ifaceSrc).toMatch(/saveSettings\(\{ browserId: added\.browserId, customBrowserPaths: added\.paths \}\)/)
  })

  test('cancelling the picker reverts and saves nothing', () => {
    expect(ifaceSrc).toMatch(/if \(!picked\) \{\s*setBrowserId\(previous\);\s*return;\s*\}/)
    expect(ifaceSrc.match(/selectCustomBrowser/g)).toHaveLength(1)
  })

  test('selecting an existing custom entry is a plain change, picker stays shut', () => {
    expect(ifaceSrc).toMatch(/does not trigger file picker/)
    expect(ifaceSrc).toMatch(/saveSettings\(\{ browserId: next \}\)/)
  })

  test('Clear renders only for a selected custom entry and removes just it', () => {
    expect(ifaceSrc).toMatch(/customSelectionInRange &&/)
    expect(ifaceSrc).toMatch(/removeCustomBrowserPath\(customBrowserPaths, browserId, selected\)/)
    expect(ifaceSrc).toMatch(/customBrowserPaths: removed\.paths/)
  })

  test('out-of-range custom id displays as default', () => {
    expect(ifaceSrc).toMatch(/customSelectionInRange \? browserId : /)
  })
})

describe('resolveBrowserLaunch custom on linux', () => {
  test('executable path resolves, no extension required', () => {
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'linux',
      customBrowserPaths: ['/opt/browsers/nightly'],
      isExecutableFile: () => true,
    })).toEqual({ appPath: '/opt/browsers/nightly' })
  })

  test('non-executable path reads as null', () => {
    expect(resolveBrowserLaunch('custom:0', 'https://example.com', {
      platform: 'linux',
      customBrowserPaths: ['/opt/browsers/nightly'],
      isExecutableFile: () => false,
    })).toBeNull()
  })
})
