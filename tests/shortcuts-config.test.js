import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Module from 'module'
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require_ = createRequire(import.meta.url)

const SETTINGS_PATH = require_.resolve('../electron/ipc/settings.js')
const PRELOAD_PATH = require_.resolve('../electron/preload.js')

let handlers
let windows
let sends
let restoreLoad

const installSettingsStub = () => {
  handlers = {}
  sends = []
  const makeWindow = () => ({
    isDestroyed: () => false,
    webContents: {
      send: vi.fn((channel, payload) => sends.push({ channel, payload })),
    },
  })
  windows = [makeWindow(), makeWindow()]
  const electronStub = {
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn } },
    BrowserWindow: {
      getAllWindows: () => windows,
      fromWebContents: () => null,
    },
  }
  // Keep writes off disk; everything else in fs stays real so transitive
  // requires behave normally.
  const fsStub = { ...fs, writeFileSync: vi.fn() }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronStub
    if (request === 'fs') return fsStub
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => { Module._load = originalLoad }
}

describe('shortcut config default', () => {
  it('includes an empty Shortcuts.bindings string in the default config', () => {
    const { buildDefaultConfig } = require_('../electron/config/configSchema.js')
    expect(buildDefaultConfig('/data')).toHaveProperty('Shortcuts.bindings', '')
  })
})

describe('save-settings shortcuts broadcast', () => {
  beforeEach(() => {
    installSettingsStub()
    delete require_.cache[SETTINGS_PATH]
  })

  afterEach(() => {
    restoreLoad?.()
    delete require_.cache[SETTINGS_PATH]
  })

  const makeCtx = (bindings) => ({
    appConfig: { Shortcuts: { bindings } },
    dataDir: '/data',
    configPath: '/tmp/shortcuts.ini',
  })

  it('broadcasts the new bindings once to every window when they change', async () => {
    const bindings = JSON.stringify({ openViewLibrary: ['Ctrl+1'] })
    require_(SETTINGS_PATH)(makeCtx(''))
    const save = handlers['save-settings']
    expect(typeof save).toBe('function')

    const result = await save({}, { Shortcuts: { bindings } })

    expect(result.success).toBe(true)
    const shortcutSends = sends.filter((s) => s.channel === 'shortcuts-changed')
    expect(shortcutSends).toHaveLength(windows.length)
    for (const win of windows) {
      expect(win.webContents.send).toHaveBeenCalledTimes(1)
      expect(win.webContents.send).toHaveBeenCalledWith('shortcuts-changed', bindings)
    }
  })

  it('does not broadcast when the bindings are unchanged', async () => {
    const bindings = JSON.stringify({ openViewLibrary: ['Ctrl+1'] })
    require_(SETTINGS_PATH)(makeCtx(bindings))
    const save = handlers['save-settings']

    const result = await save({}, { Shortcuts: { bindings } })

    expect(result.success).toBe(true)
    expect(sends.some((s) => s.channel === 'shortcuts-changed')).toBe(false)
  })
})

describe('preload shortcuts subscription', () => {
  let captured

  beforeEach(() => {
    captured = { api: null, listeners: {}, removeListenerCalls: [], removeAllListenersCalls: [] }
    const originalLoad = Module._load
    Module._load = function patched(request, parent, isMain) {
      if (request === 'electron') {
        return {
          contextBridge: {
            exposeInMainWorld: (name, api) => {
              if (name === 'electronAPI') captured.api = api
            },
          },
          ipcRenderer: {
            invoke: async () => null,
            send: () => {},
            on: (channel, handler) => {
              (captured.listeners[channel] ??= []).push(handler)
            },
            removeListener: (channel, handler) => {
              captured.removeListenerCalls.push({ channel, handler })
              captured.listeners[channel] =
                (captured.listeners[channel] ?? []).filter((h) => h !== handler)
            },
            removeAllListeners: (channel) => {
              captured.removeAllListenersCalls.push(channel)
            },
          },
          webUtils: {},
        }
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    restoreLoad = () => { Module._load = originalLoad }
    delete require_.cache[PRELOAD_PATH]
    require_(PRELOAD_PATH)
  })

  afterEach(() => {
    restoreLoad?.()
    delete require_.cache[PRELOAD_PATH]
  })

  it('registers a shortcuts-changed listener and unsubscribes only its own', () => {
    const api = captured.api
    expect(typeof api.onShortcutsChanged).toBe('function')

    const cb = vi.fn()
    const unsubscribe = api.onShortcutsChanged(cb)
    expect(typeof unsubscribe).toBe('function')
    expect(captured.listeners['shortcuts-changed']).toHaveLength(1)

    ;(captured.listeners['shortcuts-changed'] ?? []).slice().forEach((h) => h({}, 'payload'))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('payload')

    unsubscribe()
    expect(
      captured.removeListenerCalls.some((c) => c.channel === 'shortcuts-changed'),
    ).toBe(true)
    expect(captured.listeners['shortcuts-changed']).toHaveLength(0)
  })

  it('allows the generic removeAllListeners helper to clear shortcuts-changed', () => {
    const api = captured.api
    expect(typeof api.removeAllListeners).toBe('function')

    api.removeAllListeners('shortcuts-changed')

    expect(captured.removeAllListenersCalls).toContain('shortcuts-changed')
  })
})
