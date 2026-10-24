import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import Module from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Open-external-url branching plus resolveBrowserLaunch coverage. The unit
// under test is the pure branch helper in windows.js, so the table is
// exercised without Electron: ({ url, browserId, resolve, allowed }) =>
// { action: 'os' | 'spawn' | 'fallback', ... } or throw.
//
// windows.js requires electron (and ./games for launchGame) at module scope,
// so both are stubbed through Module._load like the context-action tests do;
// without the stub the require below throws before any test runs.

let restoreLoad
const ipcHandlers = new Map()

beforeEach(() => {
  ipcHandlers.clear()
  const electronStub = {
    ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    dialog: { showMessageBox: async () => ({ response: 1 }) },
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

// Required lazily so the Module._load stub above is in place first.
const helper = () => require('../electron/ipc/windows.js').resolveOpenExternalTarget

describe('open-external-url branching', () => {
  test('default id goes through the OS handler, no spawn', () => {
    expect(helper()({
      url: 'https://example.com', browserId: 'default',
      resolve: () => ({ appPath: 'C:\\x\\brave.exe' }),
      allowed: () => true,
    }).action).toBe('os')
  })

  test('specific id plus http(s) spawns with URL as a single argv element', () => {
    const out = helper()({
      url: 'https://example.com', browserId: 'brave',
      resolve: () => ({ appPath: 'C:\\Tools\\brave.exe' }),
      allowed: () => true,
    })
    expect(out).toEqual({ action: 'spawn', appPath: 'C:\\Tools\\brave.exe', args: ['https://example.com'] })
  })

  test('specific id plus steam:// always uses the OS handler', () => {
    expect(helper()({
      url: 'steam://install/123', browserId: 'brave',
      resolve: () => ({ appPath: 'C:\\Tools\\brave.exe' }),
      allowed: (u) => u.startsWith('steam://'),
    }).action).toBe('os')
  })

  test('unresolvable id falls back to OS plus fallback flag', () => {
    // keepStoredId is always present on fallback: the stored id is left
    // untouched until the user picks a new one.
    expect(helper()({
      url: 'https://example.com', browserId: 'edge',
      resolve: () => null, allowed: () => true,
    })).toEqual({ action: 'fallback', keepStoredId: true })
  })

  test('disallowed URL throws in both branches', () => {
    expect(() => helper()({
      url: 'file:///etc/passwd', browserId: 'brave',
      resolve: () => ({ appPath: 'C:\\Tools\\brave.exe' }),
      allowed: () => false,
    })).toThrow()
    expect(() => helper()({
      url: 'file:///etc/passwd', browserId: 'default',
      resolve: () => ({ appPath: 'C:\\Tools\\brave.exe' }),
      allowed: () => false,
    })).toThrow()
  })
})

// These pin resolveBrowserLaunch: macOS resolves to the app bundle path,
// Windows to the exe path, and default/unknown ids resolve to null so the
// caller uses the OS handler.
const { resolveBrowserLaunch } = require('../electron/utils/browserDetect')

const REG_BRAVE_HKCU = [
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.64XATULHQ53463XA5N4NLLZX3E',
  '    (Default)    REG_SZ    Brave',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.64XATULHQ53463XA5N4NLLZX3E\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Users\\phand\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"',
  '',
].join('\r\n')

describe('resolveBrowserLaunch', () => {
  test('macOS resolves a stored id to its app bundle path', () => {
    expect(resolveBrowserLaunch('brave', 'https://example.com', {
      platform: 'darwin',
      env: { HOME: '/Users/test' },
      fs: { existsSync: (p) => p === '/Applications/Brave Browser.app' },
      runCommand: () => '',
    })).toEqual({ appPath: '/Applications/Brave Browser.app' })
  })

  test('macOS probes only the chosen browser, never a sibling', () => {
    const probed = []
    const out = resolveBrowserLaunch('chrome', 'https://example.com', {
      platform: 'darwin',
      env: { HOME: '/Users/test' },
      fs: {
        existsSync: (p) => {
          probed.push(p)
          return p === '/Applications/Google Chrome.app'
        },
      },
      runCommand: () => '',
    })
    expect(out).toEqual({ appPath: '/Applications/Google Chrome.app' })
    expect(probed.length).toBeGreaterThan(0)
    expect(probed.every((p) => !p.includes('Brave'))).toBe(true)
  })

  test('Windows resolves a stored id to its exe path', () => {
    expect(resolveBrowserLaunch('brave', 'https://example.com', {
      platform: 'win32',
      runRegQuery: () => REG_BRAVE_HKCU,
      isExecutableFile: () => true,
    })).toEqual({ appPath: 'C:\\Users\\phand\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' })
  })

  // Only the chosen browser is existence-checked per click. The registry
  // still enumerates (subkey names are opaque), but the disk check runs for
  // the requested id alone.
  test('Windows existence-checks only the chosen browser, never a sibling', () => {
    const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    const braveExe = 'C:\\Users\\phand\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    const both = [
      'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Chrome',
      '    (Default)    REG_SZ    Google Chrome',
      '',
      'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Chrome\\shell\\open\\command',
      `    (Default)    REG_SZ    "${chromeExe}"`,
      '',
      REG_BRAVE_HKCU,
    ].join('\r\n')
    const probed = []
    const out = resolveBrowserLaunch('brave', 'https://example.com', {
      platform: 'win32',
      runRegQuery: () => both,
      isExecutableFile: (p) => { probed.push(p); return true },
    })
    expect(out).toEqual({ appPath: braveExe })
    expect(probed).toEqual([braveExe])
  })

  test('default id resolves to null', () => {
    expect(resolveBrowserLaunch('default', 'https://example.com')).toBeNull()
    expect(resolveBrowserLaunch('', 'https://example.com')).toBeNull()
    expect(resolveBrowserLaunch(undefined, 'https://example.com')).toBeNull()
  })

  test('unknown id resolves to null', () => {
    expect(resolveBrowserLaunch('safari', 'https://example.com', {
      platform: 'win32',
      runRegQuery: () => REG_BRAVE_HKCU,
      isExecutableFile: () => true,
    })).toBeNull()
  })
})

// The browsers-list handler re-enumerates on every Settings open: installs
// show up without a restart, so repeated invokes must be fresh results,
// and not one cached snapshot.
describe('browsers-list fresh enumeration', () => {
  test('repeated invokes return equal but distinct results', async () => {
    const registerWindowsHandlers = require('../electron/ipc/windows.js')
    registerWindowsHandlers({
      contextMenuData: new Map(),
      contextMenuId: 1,
      mainWindow: null,
      appConfig: {},
    })
    const list = ipcHandlers.get('browsers-list')
    const first = await list()
    const second = await list()
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })
})

// macOS launches via `open -a <appPath> <url>`. Bare `open <appPath> <url>`
// opens the URL in the OS-default handler instead.
const spawnTarget = () => require('../electron/ipc/windows.js').resolveSpawnTarget
const spawnUrl = () => require('../electron/ipc/windows.js').spawnBrowserUrl

// spawn() settles on the child 'spawn' event; errors reject.
const fakeSpawnedChild = () => ({
  once: (event, cb) => { if (event === 'spawn') cb() },
  unref: () => {},
})

describe('spawnBrowserUrl argv', () => {
  test('darwin keeps the -a prefix through the spawner, not just the resolver', async () => {
    const calls = []
    await spawnUrl()('/Applications/Brave Browser.app', 'https://example.com', {
      platform: 'darwin',
      spawnFn: (command, argv) => { calls.push([command, argv]); return fakeSpawnedChild() },
    })
    expect(calls).toEqual([['open', ['-a', '/Applications/Brave Browser.app', 'https://example.com']]])
  })
})

describe('resolveSpawnTarget', () => {
  test('darwin pins the -a argv', () => {
    expect(spawnTarget()('/Applications/Brave Browser.app', 'https://example.com', 'darwin')).toEqual({
      command: 'open',
      args: ['-a', '/Applications/Brave Browser.app', 'https://example.com'],
      options: { detached: true, stdio: 'ignore' },
    })
  })

  test('win32 spawns the exe directly with windowsHide', () => {
    expect(spawnTarget()('C:\\Tools\\brave.exe', 'https://example.com', 'win32')).toEqual({
      command: 'C:\\Tools\\brave.exe',
      args: ['https://example.com'],
      options: { detached: true, stdio: 'ignore', windowsHide: true },
    })
  })
})

// Fallback through the shared launch function, with fake spawn/shell so no
// real browser or OS handler is touched.
const through = () => require('../electron/ipc/windows.js').openExternalThroughBrowser

describe('openExternalThroughBrowser', () => {
  test('success returns undefined and spawns once, OS handler untouched', async () => {
    const spawns = []
    const opens = []
    const result = await through()('https://example.com', 'brave', {
      resolve: () => ({ appPath: 'C:\\Tools\\brave.exe' }),
      spawnBrowser: async (appPath, url) => { spawns.push([appPath, url]) },
      openExternal: async (url) => { opens.push(url) },
    })
    expect(result).toBeUndefined()
    expect(spawns).toEqual([['C:\\Tools\\brave.exe', 'https://example.com']])
    expect(opens).toEqual([])
  })

  test('spawn ENOENT falls back to the OS handler with the fallback flag', async () => {
    const opens = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await through()('https://example.com', 'brave', {
        resolve: () => ({ appPath: 'C:\\Tools\\brave.exe' }),
        spawnBrowser: async () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) },
        openExternal: async (url) => { opens.push(url) },
      })
      expect(result).toEqual({ success: true, fallback: true })
      expect(opens).toEqual(['https://example.com'])
      expect(String(errSpy.mock.calls[0][0])).toContain('brave')
    } finally {
      errSpy.mockRestore()
    }
  })

  test('unresolvable id falls back without spawning', async () => {
    const spawns = []
    const opens = []
    const result = await through()('https://example.com', 'edge', {
      resolve: () => null,
      spawnBrowser: async (appPath, url) => { spawns.push([appPath, url]) },
      openExternal: async (url) => { opens.push(url) },
    })
    expect(result).toEqual({ success: true, fallback: true })
    expect(spawns).toEqual([])
    expect(opens).toEqual(['https://example.com'])
  })

  test('disallowed URL throws before any spawn or open', async () => {
    const spawns = []
    const opens = []
    await expect(through()('file:///etc/passwd', 'brave', {
      resolve: () => ({ appPath: 'C:\\Tools\\brave.exe' }),
      spawnBrowser: async (appPath, url) => { spawns.push([appPath, url]) },
      openExternal: async (url) => { opens.push(url) },
    })).rejects.toThrow()
    expect(spawns).toEqual([])
    expect(opens).toEqual([])
  })
})

// The context-menu openUrl path returns nothing: a disallowed URL must log
// like the other menu paths, never throw.
describe('context-menu openUrl', () => {
  test('a disallowed URL logs and reads as success, not a throw', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const registerWindowsHandlers = require('../electron/ipc/windows.js')
      registerWindowsHandlers({
        contextMenuData: new Map(),
        contextMenuId: 1,
        mainWindow: null,
        appConfig: { Interface: { browserId: 'brave' } },
      })
      const run = ipcHandlers.get('run-context-action')
      const result = await run({ sender: null }, { action: 'openUrl', url: 'file:///etc/passwd' })
      expect(result).toEqual({ success: true })
      expect(errSpy).toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })
})

const linuxExecFs = (paths) => ({
  isExecutableFile: (p) => paths.has(p),
})

describe('resolveBrowserLaunch (linux)', () => {
  test('native id resolves to its PATH binary', () => {
    expect(resolveBrowserLaunch('firefox', 'https://example.com', {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      ...linuxExecFs(new Set(['/usr/bin/firefox'])),
    })).toEqual({ appPath: '/usr/bin/firefox' })
  })

  test('missing native id reads as null, caller falls back', () => {
    expect(resolveBrowserLaunch('firefox', 'https://example.com', {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      ...linuxExecFs(new Set()),
    })).toBeNull()
  })

  test('unknown id resolves to null', () => {
    expect(resolveBrowserLaunch('definitely-not-a-browser', 'https://example.com', {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      ...linuxExecFs(new Set(['/usr/bin/firefox'])),
    })).toBeNull()
  })
})

const dialogOptions = () => require('../electron/ipc/windows.js').customBrowserDialogOptions

describe('customBrowserDialogOptions', () => {
  test('darwin opens apps and directories with an app filter', () => {
    expect(dialogOptions()('darwin')).toEqual({
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Application', extensions: ['app'] }],
    })
  })

  test('win32 filters to executables', () => {
    expect(dialogOptions()('win32')).toEqual({
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: ['exe'] }],
    })
  })

  test('linux shows all files, binaries carry no extension', () => {
    expect(dialogOptions()('linux')).toEqual({ properties: ['openFile'] })
  })
})

describe('check-path executable bit', () => {
  const checkPathHandler = () => {
    const registerWindowsHandlers = require('../electron/ipc/windows.js')
    registerWindowsHandlers({
      contextMenuData: new Map(),
      contextMenuId: 1,
      mainWindow: null,
      appConfig: { Interface: { browserId: 'default' } },
    })
    return ipcHandlers.get('check-path')
  }

  test('reports the executable bit for a real file', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'atlas-exec-'))
    const file = path.join(dir, 'browser')
    await fs.promises.writeFile(file, '#!/bin/sh\n')
    // writeFile makes 0644; the bit under test must be set explicitly or
    // this is green on Windows and red on POSIX.
    await fs.promises.chmod(file, 0o755)
    try {
      await expect(checkPathHandler()({}, file)).resolves.toMatchObject({
        exists: true, isFile: true, isExecutable: true,
      })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  test('execute-access failure clears isExecutable on POSIX, ignored on Windows', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'atlas-exec-'))
    const file = path.join(dir, 'browser')
    await fs.promises.writeFile(file, '#!/bin/sh\n')
    const accessSpy = vi.spyOn(fs, 'accessSync').mockImplementation(() => { throw new Error('EACCES') })
    try {
      // Windows never probes (matches defaultIsExecutableFile); POSIX honors it.
      const expected = process.platform === 'win32'
      await expect(checkPathHandler()({}, file)).resolves.toMatchObject({
        exists: true, isFile: true, isExecutable: expected,
      })
    } finally {
      accessSpy.mockRestore()
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})
