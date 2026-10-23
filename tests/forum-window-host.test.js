import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'

// Locks the host option added to fetchThreadHtmlViaWindow: the thread URL and
// the cookie seeding must target the requested site rather than the F95
// default, and the default must stay F95 for the existing callers.

let restoreLoad = null

const installStubs = ({ loadError = null } = {}) => {
  const windows = []
  const seedCalls = []
  const fakeSes = {
    cookies: {
      get: vi.fn(async () => []),
      set: vi.fn(async (spec) => seedCalls.push([spec.name, spec.domain])),
    },
  }
  class FakeWebContents {
    constructor() {
      this.isDestroyed = () => false
      this.on = () => {}
      this.loadURL = vi.fn(async () => {
        if (loadError) throw new Error(loadError)
      })
      this.executeJavaScript = vi.fn(async () => {
        throw new Error('stub')
      })
      this.session = fakeSes
    }
  }
  class FakeBrowserWindow {
    constructor() {
      this.webContents = new FakeWebContents()
      this.isDestroyed = () => false
      this.destroy = () => {}
      windows.push(this)
    }
    on() {}
    show() {}
    moveTop() {}
    focus() {}
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return { BrowserWindow: FakeBrowserWindow, ipcMain: { handle: () => {} } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
  const forumWindowFetch = require('../electron/downloads/forumWindowFetch.js')
  return { forumWindowFetch, windows, seedCalls }
}

afterEach(() => {
  if (restoreLoad) {
    restoreLoad()
    restoreLoad = null
  }
  vi.resetModules()
})

// No did-stop-loading is fired and the executeJavaScript stub always rejects,
// so the window fetch ends in the bounded timeout with URL and seeding done.
const rejected = (promise) => expect(promise).rejects.toThrow('Timed out')

describe('fetchThreadHtmlViaWindow host option', () => {
  it('names the requested host when the thread load itself fails', async () => {
    const { forumWindowFetch } = installStubs({ loadError: 'boom' })

    await expect(
      forumWindowFetch.fetchThreadHtmlViaWindow('3272', 'xf_session=2', {
        timeoutMs: 60,
        host: 'lewdcorner.com',
      }),
    ).rejects.toThrow('Could not load the lewdcorner.com thread (boom).')
  })

  it('navigates and seeds on the requested host instead of the F95 default', async () => {
    const { forumWindowFetch, windows, seedCalls } = installStubs()

    await rejected(
      forumWindowFetch.fetchThreadHtmlViaWindow('3272', 'xf_session=2', {
        timeoutMs: 30,
        host: 'lewdcorner.com',
      }),
    )

    const contents = windows[0].webContents
    expect(contents.loadURL).toHaveBeenCalledWith('https://lewdcorner.com/threads/3272/')
    expect(seedCalls.some(([, domain]) => domain === '.lewdcorner.com')).toBe(true)
  })

  it('keeps the F95 default so existing callers are untouched', async () => {
    const { forumWindowFetch, windows, seedCalls } = installStubs()

    await rejected(
      forumWindowFetch.fetchThreadHtmlViaWindow('308445', 'xf_session=2', { timeoutMs: 30 }),
    )

    const contents = windows[0].webContents
    expect(contents.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('https://f95zone.to/threads/308445/'),
    )
    expect(seedCalls.some(([, domain]) => domain === '.f95zone.to')).toBe(true)
  })
})
