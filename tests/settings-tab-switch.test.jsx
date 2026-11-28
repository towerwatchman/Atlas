import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Module from 'node:module'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')
const has = (src, needle) => expect(src.includes(needle), needle).toBe(true)

// createSettingsWindow has a default parameter, so the first `{` is not its body.
const functionBodyOf = (src, declaration) => {
  const start = src.indexOf(declaration)
  if (start < 0) return ''
  const open = src.indexOf('{', src.indexOf(')', start))
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return ''
}

describe('open-settings routes a requested tab in the main process', () => {
  const body = () => functionBodyOf(read('electron/main.js'), 'function createSettingsWindow(')

  it('accepts only a string tab and sends it to the existing Settings window', () => {
    const src = body()
    has(src, "typeof options?.tab === 'string' && options.tab")
    has(src, 'if (settingsWindow && !settingsWindow.isDestroyed())')
    has(src, 'focusWindow(settingsWindow)')
    has(src, "settingsWindow.webContents.send('settings-tab', tab)")
    expect(src.indexOf('focusWindow(settingsWindow)'))
      .toBeLessThan(src.indexOf("send('settings-tab', tab)"))
  })

  it('reuses that window instead of opening a second one', () => {
    const src = body()
    const reused = src.indexOf('if (settingsWindow && !settingsWindow.isDestroyed())')
    expect(reused).toBeGreaterThan(-1)
    const send = src.indexOf("send('settings-tab', tab)")
    const create = src.indexOf('settingsWindow = new BrowserWindow(')
    expect(send).toBeLessThan(create)
    expect(src.slice(send, create)).toContain('return')
  })

  it('puts the tab on the URL when a fresh window is needed', () => {
    const src = body()
    has(src, "queryParts.push(`tab=${encodeURIComponent(tab)}`)")
    has(src, "loadURL(VITE_DEV_SERVER_URL + '/settings.html' + queryString)")
    has(src, 'queryString ? { search: queryString } : undefined')
  })
})

describe('preload settings-tab bridge', () => {
  const require_ = createRequire(import.meta.url)
  const preloadPath = require_.resolve('../electron/preload.js')
  let captured
  let restore

  beforeEach(() => {
    captured = { api: null, listeners: {}, removeListenerCalls: [], removeAllListenersCalls: [] }
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
            on: (channel, handler) => { (captured.listeners[channel] ??= []).push(handler) },
            removeListener: (channel, handler) => {
              captured.removeListenerCalls.push({ channel, handler })
              captured.listeners[channel] =
                (captured.listeners[channel] ?? []).filter((h) => h !== handler)
            },
            removeAllListeners: (channel) => { captured.removeAllListenersCalls.push(channel) },
          },
          webUtils: {},
        }
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    restore = () => { Module._load = originalLoad }
    delete require_.cache[preloadPath]
    require_(preloadPath)
  })

  afterEach(() => {
    restore?.()
    delete require_.cache[preloadPath]
  })

  it('passes the tab to its own callback and removes only that handler', () => {
    const api = captured.api
    expect(typeof api.onSettingsTab).toBe('function')

    const first = vi.fn()
    const second = vi.fn()
    const offFirst = api.onSettingsTab(first)
    api.onSettingsTab(second)
    expect(captured.listeners['settings-tab']).toHaveLength(2)

    captured.listeners['settings-tab'].slice().forEach((handler) => handler({}, 'Shortcuts'))
    expect(first).toHaveBeenCalledWith('Shortcuts')
    expect(second).toHaveBeenCalledWith('Shortcuts')

    offFirst()
    expect(captured.removeListenerCalls.some((call) => call.channel === 'settings-tab')).toBe(true)
    expect(captured.listeners['settings-tab']).toHaveLength(1)

    captured.listeners['settings-tab'].slice().forEach((handler) => handler({}, 'Library'))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith('Library')
  })

  it('allows the generic removeAllListeners helper to clear settings-tab', () => {
    const removeAll = functionBodyOf(read('electron/preload.js'), 'removeAllListeners: (channel) =>')
    has(removeAll, '"settings-tab",')

    captured.api.removeAllListeners('settings-tab')
    expect(captured.removeAllListenersCalls).toContain('settings-tab')
  })
})
