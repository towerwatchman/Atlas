import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'
import { EventEmitter } from 'events'

// The resolve window stays hidden while the page is doing something and is
// shown once it has been quiet long enough to need a human. That decision is
// what replaced the fixed 9s reveal timer, so both the rule and its wiring in
// the resolver are covered here.

const { shouldReveal, IDLE_REVEAL_MS, LOAD_GRACE_MS } = require('../electron/downloads/dlGate.js')

let restoreLoad = null

const installStubs = () => {
  const windows = []
  const fakeSes = new EventEmitter()
  fakeSes.cookies = {
    get: vi.fn(async () => []),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  }
  fakeSes.webRequest = {
    onBeforeRequest: vi.fn(),
    onHeadersReceived: vi.fn(),
  }

  class FakeContents extends EventEmitter {
    constructor() {
      super()
      this._url = ''
      this.userAgent = 'test-agent'
      this.session = fakeSes
      this.executeJavaScript = vi.fn(async () => ({ clicked: false, cf: false, hostLink: false }))
      this.loadURL = vi.fn(async (url) => {
        this._url = url
      })
      this.setWindowOpenHandler = vi.fn()
    }
    getURL() {
      return this._url
    }
    getTitle() {
      return 'Test page'
    }
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.webContents = new FakeContents()
      this.shown = 0
      windows.push(this)
    }
    static getAllWindows() {
      return []
    }
    isDestroyed() {
      return false
    }
    destroy() {}
    show() {
      this.shown += 1
    }
    moveTop() {}
    focus() {}
  }

  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return { BrowserWindow: FakeBrowserWindow, session: { fromPartition: () => fakeSes } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
  // The resolver destructures electron at load, so each test needs its own copy
  // bound to that test's fake BrowserWindow (and its own resolve chain).
  delete require.cache[require.resolve('../electron/downloads/maskedResolver.js')]

  const { resolveMaskedLink } = require('../electron/downloads/maskedResolver.js')
  return { resolveMaskedLink, windows }
}

const settle = async (promise, win) => {
  win.emit('closed')
  await promise
}

afterEach(() => {
  if (restoreLoad) {
    restoreLoad()
    restoreLoad = null
  }
  vi.useRealTimers()
  vi.resetModules()
})

describe('shouldReveal', () => {
  it('waits out the idle window, then reveals', () => {
    expect(shouldReveal({ lastProgressAt: 1000 }, 1000 + IDLE_REVEAL_MS - 1)).toBe(false)
    expect(shouldReveal({ lastProgressAt: 1000 }, 1000 + IDLE_REVEAL_MS)).toBe(true)
  })

  it('never reveals a settled resolve or an already-shown window', () => {
    const now = 1000 + IDLE_REVEAL_MS
    expect(shouldReveal({ lastProgressAt: 1000, settled: true }, now)).toBe(false)
    expect(shouldReveal({ lastProgressAt: 1000, revealed: true }, now)).toBe(false)
  })

  it('applies a longer threshold while a load is still waiting for its document', () => {
    expect(shouldReveal({ lastProgressAt: 1000 }, 1000 + LOAD_GRACE_MS - 1, LOAD_GRACE_MS)).toBe(false)
    expect(shouldReveal({ lastProgressAt: 1000 }, 1000 + LOAD_GRACE_MS, LOAD_GRACE_MS)).toBe(true)
  })
})

describe('resolver idle reveal', () => {
  it('leaves the window hidden until the page goes quiet', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const win = windows[0]
    win.webContents.emit('dom-ready')

    await vi.advanceTimersByTimeAsync(IDLE_REVEAL_MS - 1000)
    expect(win.shown).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)
    expect(win.shown).toBe(1)

    await settle(promise, win)
  })

  it('restarts the clock when the page makes progress', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const win = windows[0]

    await vi.advanceTimersByTimeAsync(3000)
    win.webContents.emit('did-start-loading')
    win.webContents.emit('dom-ready')

    await vi.advanceTimersByTimeAsync(2000)
    expect(win.shown).toBe(0)

    await vi.advanceTimersByTimeAsync(2000)
    expect(win.shown).toBe(1)

    await settle(promise, win)
  })

  it('waits out a slow load instead of showing a blank window', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const win = windows[0]

    await vi.advanceTimersByTimeAsync(5000)
    expect(win.shown).toBe(0)

    win.webContents.emit('dom-ready')
    await vi.advanceTimersByTimeAsync(3000)
    expect(win.shown).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)
    expect(win.shown).toBe(1)

    await settle(promise, win)
  })

  it('shows a load that never reaches the document', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const win = windows[0]

    await vi.advanceTimersByTimeAsync(LOAD_GRACE_MS - 1000)
    expect(win.shown).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)
    expect(win.shown).toBe(1)

    await settle(promise, win)
  })

  it('keeps one poll loop per window, not one per load', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const win = windows[0]
    const contents = win.webContents

    contents.emit('did-finish-load')
    contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(0)
    const before = contents.executeJavaScript.mock.calls.length

    await vi.advanceTimersByTimeAsync(1000)
    // One tick runs the gate script and the /dl/ script. A second interval
    // left behind by the first load would double this.
    expect(contents.executeJavaScript.mock.calls.length - before).toBe(2)

    await settle(promise, win)
  })

  it('a moving countdown resets the idle clock', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const win = windows[0]
    const contents = win.webContents
    let seconds = 7
    contents.executeJavaScript.mockImplementation(async (script) => {
      if (script.includes('f95dl')) {
        return { dlActive: true, seconds, declaredHost: null, clicked: false }
      }
      return { clicked: false, cf: false, hostLink: false }
    })

    contents.emit('dom-ready')
    contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(1000)
    seconds = 6
    await vi.advanceTimersByTimeAsync(1000)
    seconds = 5
    await vi.advanceTimersByTimeAsync(1000)

    // Frozen at 5: the last tick that changed the countdown was at 3s.
    await vi.advanceTimersByTimeAsync(3000)
    expect(win.shown).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(win.shown).toBe(1)

    await settle(promise, win)
  })

  it('a frozen countdown does not keep the window hidden', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const win = windows[0]
    const contents = win.webContents
    contents.executeJavaScript.mockImplementation(async (script) => {
      if (script.includes('f95dl')) {
        return { dlActive: true, seconds: 7, declaredHost: null, clicked: false }
      }
      return { clicked: false, cf: false, hostLink: false }
    })

    contents.emit('dom-ready')
    contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(3000)
    expect(win.shown).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)
    expect(win.shown).toBe(1)

    await settle(promise, win)
  })

  it('does not throttle the hidden window', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)

    expect(windows[0].options.webPreferences.backgroundThrottling).toBe(false)

    await settle(promise, windows[0])
  })
})
