import { describe, it, expect, vi } from 'vitest'
import Module from 'module'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)

// Mock electron the way main-startup-smoke.test.js does: intercept require('electron')
// via Module._load, but keep the two pieces preload.js actually uses: contextBridge
// (captures the API object it exposes) and ipcRenderer (tracks on/removeListener).
const installPreloadStub = () => {
  const captured = { api: null, listeners: {}, removeListenerCalls: [] }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld: (name, api) => { if (name === 'electronAPI') captured.api = api },
        },
        ipcRenderer: {
          invoke: async () => null,
          send: () => {},
          once: () => {},
          on: (channel, handler) => {
            (captured.listeners[channel] ??= []).push(handler)
          },
          removeListener: (channel, handler) => {
            captured.removeListenerCalls.push({ channel, handler })
            captured.listeners[channel] =
              (captured.listeners[channel] ?? []).filter((h) => h !== handler)
          },
          removeAllListeners: () => {},
        },
        webUtils: {},
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const restore = () => { Module._load = originalLoad }
  return { captured, restore }
}

const fireChannel = (channel, payload) => {
  // Simulate the main process sending to the renderer.
  const captured = globalThis.__captured
  ;(captured?.listeners?.[channel] ?? []).slice().forEach((h) => h({}, payload))
}

describe('preload onLastTrackedCleared listener cleanup', () => {
  it('calls back on the event, stops after the remover runs, and uses removeListener', () => {
    const { captured, restore } = installPreloadStub()
    globalThis.__captured = captured
    try {
      // Drop the cached module so the fresh stub is picked up.
      const preloadPath = require_.resolve('../electron/preload.js')
      delete require_.cache[preloadPath]
      require_(preloadPath)

      const api = captured.api
      expect(api).toBeDefined()
      expect(typeof api.onLastTrackedCleared).toBe('function')

      const cb = vi.fn()
      const remover = api.onLastTrackedCleared(cb)

      // First fire: callback should run with the payload.
      fireChannel('last-tracked-cleared', 42)
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith(42)

      // The remover must be a function.
      expect(typeof remover).toBe('function')

      // Call the remover; it must have gone through removeListener for the right channel.
      remover()
      expect(
        captured.removeListenerCalls.some((c) => c.channel === 'last-tracked-cleared'),
      ).toBe(true)

      // Second fire after removal: callback must not run again.
      fireChannel('last-tracked-cleared', 99)
      expect(cb).toHaveBeenCalledTimes(1)
    } finally {
      delete globalThis.__captured
      restore()
    }
  })
})
