import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import Module from 'module'

// run-context-action reported {success:true} for everything, unconditionally.
// The renderer then discarded it anyway (App.jsx fired and forgot), so a failed
// "Open Game Folder" was a click that did nothing, with the reason -- when there
// was one -- going to a main-process console the user does not have open.
//
// Both ends change: the handler reports what happened, and the renderer has
// something worth reading.

const ipcHandlers = new Map()
let restoreLoad
let launchCalls = []

beforeEach(() => {
  ipcHandlers.clear()
  launchCalls = []

  const electronStub = {
    ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    shell: { openPath: async () => '', openExternal: () => {} },
    app: { getVersion: () => '0.0.0' },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    desktopCapturer: { getSources: async () => [] },
    screen: { getAllDisplays: () => [] },
  }
  // windows.js destructures launchGame out of ./games at module scope, so the
  // module has to be replaced rather than the export spied on.
  const gamesStub = {
    launchGame: async (args) => { launchCalls.push(args) },
    registerGamesHandlers: () => {},
  }

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

const register = (over = {}) => {
  const registerWindowsHandlers = require('../electron/ipc/windows.js')
  const ctx = {
    contextMenuData: new Map(),
    contextMenuId: 1,
    mainWindow: null,
    openGameFolderForVersion: async () => ({ success: true }),
    getTrustedVersion: async () => ({ version: 'v1.0', exec_path: '', game_path: '/g' }),
    createGameDetailsWindow: () => {},
    ...over,
  }
  registerWindowsHandlers(ctx)
  return ipcHandlers.get('run-context-action')
}

describe('run-context-action', () => {
  test('carries an open-folder failure back to the renderer', async () => {
    const run = register({
      openGameFolderForVersion: async () => ({
        success: false,
        error: 'The folder no longer exists: /games/Test/gone',
      }),
    })

    const result = await run({ sender: null }, { action: 'openFolder', recordId: 7, versionId: 11 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('/games/Test/gone')
  })

  test('carries an open-folder success back too', async () => {
    const run = register()
    const result = await run({ sender: null }, { action: 'openFolder', recordId: 7, versionId: 11 })
    expect(result.success).toBe(true)
  })

  test('passes the version id straight through to the opener', async () => {
    let seen = null
    const run = register({
      openGameFolderForVersion: async (data) => { seen = data; return { success: true } },
    })
    await run({ sender: null }, { action: 'openFolder', recordId: 7, versionId: 33 })
    expect(seen.recordId).toBe(7)
    expect(seen.versionId).toBe(33)
  })

  // Fire-and-forget actions keep their old shape, so nothing else has to change.
  test('an action that reports nothing still reads as success', async () => {
    const run = register()
    const result = await run({ sender: null }, { action: 'properties', recordId: 7 })
    expect(result.success).toBe(true)
  })

  // launchGame picks steam:// over goggalaxy:// from `source`, and prefers the
  // VERSION's appid over the title-level mapping (electron/ipc/games.js).
  // handleContextAction dropped both, so it fell back to getSteamIDbyRecord --
  // which resolves the TITLE mapping, and therefore launches the wrong version
  // for a title holding two Steam versions.
  test('launch forwards the version source and appid', async () => {
    const run = register({
      getTrustedVersion: async () => ({
        version: 'Steam',
        exec_path: '',
        game_path: '/steam/steamapps/common/Test',
        source: 'steam',
        source_app_id: '620',
      }),
    })

    await run({ sender: null }, { action: 'launch', recordId: 7, versionId: 22 })
    await new Promise((resolve) => setImmediate(resolve))

    expect(launchCalls).toHaveLength(1)
    expect(launchCalls[0].source).toBe('steam')
    expect(launchCalls[0].sourceAppId).toBe('620')
  })
})
