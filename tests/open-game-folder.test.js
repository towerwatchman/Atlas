import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import Module from 'module'

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

describe('open-game-folder IPC handler', () => {
  it('opens the game folder directly instead of its parent directory', async () => {
    // Load electron/ipc/games.js with mocked electron
    const { registerGamesHandlers } = require('../electron/ipc/games.js')

    const sampleGamePath = path.join(process.cwd(), 'games', 'MyGameFolder')
    const mockCtx = {
      getTrustedVersion: async (recordId, version) => ({
        record_id: recordId,
        version: version || '1.0',
        game_path: sampleGamePath,
      }),
    }

    registerGamesHandlers(mockCtx)

    const handler = ipcHandlers.get('open-game-folder')
    expect(handler).toBeDefined()

    const result = await handler(null, { recordId: 42, version: '1.0' })
    expect(result).toEqual({ success: true })

    expect(openedPaths).toHaveLength(1)
    expect(openedPaths[0]).toBe(sampleGamePath)
  })
})
