import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'

// The resolver-session wipe is a field-only switch: it must clear exactly the
// resolver partition's cookie jar and nothing else, so a fetch re-earns the
// Cloudflare challenge on demand.

let restoreLoad = null

const installStubs = () => {
  const ipcHandlers = new Map()
  const fakeSes = {
    clearStorageData: vi.fn(async () => {}),
  }
  const electronStub = {
    ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) },
    session: { fromPartition: vi.fn(() => fakeSes) },
    BrowserWindow: { getAllWindows: () => [] },
    shell: {},
    app: {},
    dialog: {},
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronStub
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
  const registerDownloadsHandlers = require('../electron/ipc/downloads.js')
  registerDownloadsHandlers({})
  return { fakeSes, handler: ipcHandlers.get('downloads-clear-resolver-session') }
}

afterEach(() => {
  if (restoreLoad) {
    restoreLoad()
    restoreLoad = null
  }
  vi.resetModules()
})

describe('downloads-clear-resolver-session', () => {
  it('clears cookies only, from the resolver partition', async () => {
    const { fakeSes, handler } = installStubs()
    const result = await handler()
    expect(result.ok).toBe(true)
    expect(fakeSes.clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] })
  })
})
