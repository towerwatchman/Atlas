import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import Module from 'module'
import { createGameFolderOpener } from '../electron/library/gameFolder.js'

const ipcHandlers = new Map()
let openedPaths = []
let restoreLoad

const electronStub = () => ({
  ipcMain: {
    handle: (channel, fn) => ipcHandlers.set(channel, fn),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  shell: {
    openPath: async (targetPath) => {
      openedPaths.push(targetPath)
      return ''
    },
  },
})

beforeEach(() => {
  ipcHandlers.clear()
  openedPaths = []

  const stub = electronStub()
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return stub
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
})

afterEach(() => {
  if (restoreLoad) restoreLoad()
})

const sampleGamePath = path.join(process.cwd(), 'games', 'MyGameFolder')

// Builds the ctx the handler now takes. The opener is the REAL one with stubbed
// io, not a stub of its own, so this still exercises the resolution it delegates.
const buildCtx = (over = {}) => ({
  openGameFolderForVersion: createGameFolderOpener({
    getVersionById: async (recordId, versionId) =>
      versionId === 11 ? { version_id: 11, version: '1.0', game_path: sampleGamePath, exec_path: '' } : null,
    getVersionForRecord: async (recordId, version) =>
      version === '1.0' ? { version: '1.0', game_path: sampleGamePath, exec_path: '' } : null,
    shell: {
      openPath: async (targetPath) => {
        openedPaths.push(targetPath)
        return ''
      },
    },
    fs: { promises: { stat: async () => ({ isDirectory: () => true }) } },
  }),
  ...over,
})

describe('open-game-folder IPC handler', () => {
  // The original regression: the handler took path.dirname(game_path) and so
  // opened the PARENT of the game folder. game_path is already the directory
  // containing the game files.
  it('opens the game folder directly instead of its parent directory', async () => {
    const { registerGamesHandlers } = require('../electron/ipc/games.js')
    registerGamesHandlers(buildCtx())

    const handler = ipcHandlers.get('open-game-folder')
    expect(handler).toBeDefined()

    const result = await handler(null, { recordId: 42, versionId: 11 })
    expect(result.success).toBe(true)

    expect(openedPaths).toHaveLength(1)
    expect(openedPaths[0]).toBe(sampleGamePath)
  })

  // The handler used to resolve the version itself, through getTrustedVersion.
  // It delegates now, because ipc/windows.js opens the same folders from the
  // context menu and two implementations meant two ways to pick the wrong
  // version and two ways to fail silently.
  it('delegates rather than resolving the version itself', async () => {
    const { registerGamesHandlers } = require('../electron/ipc/games.js')
    let seen = null
    registerGamesHandlers(buildCtx({
      openGameFolderForVersion: async (data) => { seen = data; return { success: true } },
    }))

    await ipcHandlers.get('open-game-folder')(null, { recordId: 42, versionId: 11 })
    expect(seen).toEqual({ recordId: 42, versionId: 11 })
  })

  // Previously this returned { success: true } for a folder that never opened:
  // shell.openPath's error string was discarded, and getTrustedVersion's throw
  // was flattened to a bare message with no way to tell the cases apart.
  it('reports a failure instead of claiming success', async () => {
    const { registerGamesHandlers } = require('../electron/ipc/games.js')
    registerGamesHandlers(buildCtx())

    const result = await ipcHandlers.get('open-game-folder')(null, { recordId: 42, versionId: 999 })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(openedPaths).toHaveLength(0)
  })
})
