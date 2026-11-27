import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Module from 'module'

let restoreLoad
let electronStubInstance

const electronStub = () => {
  const testWindow = {
    webContents: {
      send: vi.fn(),
    },
    isDestroyed: () => false,
  }
  return {
    ipcMain: {
      handle: () => {},
    },
    BrowserWindow: {
      getAllWindows: () => [testWindow],
    },
    shell: {
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(),
    },
    app: {},
  }
}

beforeEach(() => {
  electronStubInstance = electronStub()
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronStubInstance
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
})

afterEach(() => {
  if (restoreLoad) restoreLoad()
})

describe('broadcastGameDeleted', () => {
  it('sends game-deleted and downloads-changed to every live window', () => {
    const { broadcastGameDeleted } = require('../electron/ipc/games.js')
    broadcastGameDeleted(1)

    const win = electronStubInstance.BrowserWindow.getAllWindows()[0]
    const sendCalls = win.webContents.send.mock.calls

    expect(sendCalls).toContainEqual(['game-deleted', 1])
    expect(sendCalls).toContainEqual(['downloads-changed', {}])
  })

  it('skips destroyed windows', () => {
    electronStubInstance.BrowserWindow.getAllWindows = () => {
      const destroyedWin = {
        webContents: {
          send: vi.fn(),
        },
        isDestroyed: () => true,
      }
      return [destroyedWin]
    }

    const { broadcastGameDeleted } = require('../electron/ipc/games.js')
    broadcastGameDeleted(1)

    const win = electronStubInstance.BrowserWindow.getAllWindows()[0]
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
