import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'
import { EventEmitter } from 'events'

// The resolve window stays hidden while the page is doing something and is
// shown once it has been quiet long enough to need a human. That decision is
// what replaced the fixed 9s reveal timer, so both the rule and its wiring in
// the resolver are covered here.

const { shouldReveal, IDLE_REVEAL_MS, LOAD_GRACE_MS, DL_POLL_SCRIPT } = require('../electron/downloads/dlGate.js')

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

  const resolver = require('../electron/downloads/maskedResolver.js')
  return { resolveMaskedLink: resolver.resolveMaskedLink, windows, resolver }
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

describe('resolver captcha mode', () => {
  const gateCalls = (contents) =>
    contents.executeJavaScript.mock.calls.filter((c) => c[0].includes('f95dl')).length

  it('reveals the window and stops polling when a captcha appears', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const contents = windows[0].webContents
    contents.executeJavaScript.mockImplementation(async (script) => {
      if (script.includes('f95dl')) {
        return { dlActive: false, seconds: null, declaredHost: null, clicked: false, captcha: true }
      }
      return { clicked: false, cf: false, hostLink: false }
    })

    contents.emit('dom-ready')
    contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(1000)

    expect(windows[0].shown).toBe(1)

    // The poll stopped: no further gate-script calls after the reveal.
    const before = gateCalls(contents)
    await vi.advanceTimersByTimeAsync(5000)
    expect(gateCalls(contents)).toBe(before)

    await settle(promise, windows[0])
  })

  it('reveals the window after three clicks of the same button with no countdown', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const contents = windows[0].webContents
    contents.executeJavaScript.mockImplementation(async (script) => {
      if (script.includes('f95dl')) {
        return { dlActive: false, seconds: null, declaredHost: null, clicked: 'continue', captcha: false }
      }
      return { clicked: false, cf: false, hostLink: false }
    })

    contents.emit('dom-ready')
    contents.emit('did-finish-load')

    await vi.advanceTimersByTimeAsync(1000)
    expect(windows[0].shown).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(windows[0].shown).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)
    expect(windows[0].shown).toBe(1)

    await settle(promise, windows[0])
  })

  it('does not treat a countdown as a click-loop', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const contents = windows[0].webContents
    let phase = 0
    contents.executeJavaScript.mockImplementation(async (script) => {
      if (script.includes('f95dl')) {
        if (phase === 0) {
          phase = 1
          return { dlActive: false, seconds: null, declaredHost: null, clicked: 'continue', captcha: false }
        }
        return { dlActive: true, seconds: 5, declaredHost: null, clicked: false, captcha: false }
      }
      return { clicked: false, cf: false, hostLink: false }
    })

    contents.emit('dom-ready')
    contents.emit('did-finish-load')

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(windows[0].shown).toBe(0)

    await settle(promise, windows[0])
  })

  it('keeps the gate clicks off when the page reloads after captcha mode', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p')
    await vi.advanceTimersByTimeAsync(0)
    const contents = windows[0].webContents
    contents.executeJavaScript.mockImplementation(async (script) => {
      if (script.includes('f95dl')) {
        return { dlActive: false, seconds: null, declaredHost: null, clicked: false, captcha: true }
      }
      return { clicked: false, cf: false, hostLink: false }
    })

    contents.emit('dom-ready')
    contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(1000)
    expect(windows[0].shown).toBe(1)

    // A rejected captcha POST reloads the gate page. That load runs
    // did-finish-load again, and it used to re-arm the polling - and with it
    // the clicking - for the rest of the resolve.
    const before = gateCalls(contents)
    contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(5000)
    expect(gateCalls(contents)).toBe(before)

    await settle(promise, windows[0])
  })
})

describe('gate captcha detection', () => {
  // hCaptcha builds #anchor inside its own iframe, and executeJavaScript only
  // reaches the main frame, so the widget internals are invisible to the poll.
  // The container div belongs to the gate page and is what it can see.
  it('looks for the hCaptcha container, not the widget internals', () => {
    expect(DL_POLL_SCRIPT).toContain('[data-sitekey]')
    expect(DL_POLL_SCRIPT).not.toContain('#anchor')
  })
})

describe('resolver manual resolve', () => {
  it('shows the window at once and never clicks the gate', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows } = installStubs()
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p', { manualResolve: true })
    await vi.advanceTimersByTimeAsync(0)

    const contents = windows[0].webContents
    expect(windows[0].shown).toBe(1)

    contents.emit('dom-ready')
    contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(3000)
    const clicked = contents.executeJavaScript.mock.calls.filter((call) => /\.click\(\)/.test(call[0]))
    expect(clicked).toHaveLength(0)

    await settle(promise, windows[0])
  })

  it('uses the takeover budget so a human has time to solve it', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows, resolver } = installStubs()
    let result = null
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p', { manualResolve: true })
    promise.then((value) => { result = value })
    await vi.advanceTimersByTimeAsync(0)
    windows[0].webContents.emit('dom-ready')

    await vi.advanceTimersByTimeAsync(resolver.DEFAULT_TIMEOUT_MS + 1000)
    expect(result).toBeNull()

    await vi.advanceTimersByTimeAsync(resolver.F95_CAPTCHA_TIMEOUT_MS)
    expect(result?.timedOut).toBe(true)
  })

  it('gives the full budget from when the gate finishes loading', async () => {
    vi.useFakeTimers()
    const { resolveMaskedLink, windows, resolver } = installStubs()
    let result = null
    const promise = resolveMaskedLink('https://f95zone.to/masked/mega.nz/1/2/s/i/p', { manualResolve: true })
    promise.then((value) => { result = value })
    await vi.advanceTimersByTimeAsync(0)

    // Most of the original budget goes on the load, before the user can act.
    await vi.advanceTimersByTimeAsync(resolver.F95_CAPTCHA_TIMEOUT_MS - 1000)
    expect(result).toBeNull()

    windows[0].webContents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(2000)
    expect(result).toBeNull()

    await vi.advanceTimersByTimeAsync(resolver.F95_CAPTCHA_TIMEOUT_MS)
    expect(result?.timedOut).toBe(true)
  })
})
