import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'

// The real 403/challenge tail both link fetchers share
// (forumWindowFetch.withWindowFallback). With no electron runtime,
// isAvailable() is false, so the no-window branches run here directly; the
// delegation test builds a fake window and ends in the bounded timeout, which
// still proves the thread URL, host and steer fired before it.

let restoreLoad = null

const loadHelper = ({ BrowserWindow = undefined } = {}) => {
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return BrowserWindow ? { BrowserWindow } : {}
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => { Module._load = originalLoad }
  return require('../electron/downloads/forumWindowFetch.js')
}

afterEach(() => {
  vi.useRealTimers()
  if (restoreLoad) {
    restoreLoad()
    restoreLoad = null
  }
  vi.resetModules()
})

// Enough session for applyCookies' cf lookup; loadURL succeeds, no
// did-stop-loading ever fires, so the helper's window run ends in timeout.
const fakeWindowStack = () => {
  const calls = []
  class FakeWebContents {
    constructor() {
      this.isDestroyed = () => false
      this.on = () => {}
      this.loadURL = vi.fn(async (url) => { calls.push(url) })
      this.executeJavaScript = vi.fn(async () => { throw new Error('stub') })
      this.session = { cookies: { get: vi.fn(async () => []), set: vi.fn(async () => {}) } }
    }
  }
  class FakeBrowserWindow {
    constructor() {
      this.webContents = new FakeWebContents()
      this.isDestroyed = () => false
      this.destroy = () => {}
    }
    on() {}
    show() {}
    moveTop() {}
    focus() {}
  }
  const helper = loadHelper({ BrowserWindow: FakeBrowserWindow })
  return { helper, calls }
}

const stages = { windowMs: 0 }

describe('withWindowFallback', () => {
  it('hands a plain 200 body through with the caller stage object', async () => {
    const { withWindowFallback } = loadHelper()
    const out = await withWindowFallback('308445', 'xf_session=2', {
      siteLabel: 'F95zone',
      response: { ok: true, status: 200, text: async () => '<html>ok</html>' },
      stages,
    })
    expect(out).toEqual({ html: '<html>ok</html>', stages: { windowMs: 0 } })
  })

  it('throws the caller-named site error on a 403 with no window runtime', async () => {
    const { withWindowFallback } = loadHelper()
    await expect(withWindowFallback('5', 'xf_session=2', {
      siteLabel: 'LewdCorner',
      response: { ok: false, status: 403 },
      stages: { windowMs: 0 },
    })).rejects.toThrow('LewdCorner returned 403 for thread 5')
  })

  it('passes a challenge-200 body through untouched when no window exists', async () => {
    const { withWindowFallback } = loadHelper()
    const challenge = '<html><body>Just a moment. Enable JavaScript.</body></html>'
    const out = await withWindowFallback('5', '', {
      siteLabel: 'F95zone',
      response: { ok: true, status: 200, text: async () => challenge },
      stages: { windowMs: 0 },
    })
    expect(out.html).toBe(challenge)
  })

  it('steers a 403 into the window fetch on the requested host, firing the steer hook first', async () => {
    const { helper, calls } = fakeWindowStack()
    const steered = []
    await expect(helper.withWindowFallback('3272', 'xf_session=2', {
      host: 'lewdcorner.com',
      siteLabel: 'LewdCorner',
      response: { ok: false, status: 403 },
      stages,
      onSteer: (status) => steered.push(status),
      timeoutMs: 60,
    })).rejects.toThrow('Timed out')
    expect(steered).toEqual([403])
    expect(calls).toEqual(['https://lewdcorner.com/threads/3272/'])
    expect(stages.windowMs).toBeGreaterThanOrEqual(0)
  })

  it('starts both hidden challenge windows at once instead of queueing one behind the other', async () => {
    const { helper, calls } = fakeWindowStack()
    const fallback = (threadId, host, siteLabel) => helper.withWindowFallback(threadId, 'xf_session=2', {
      host,
      siteLabel,
      response: { ok: false, status: 403 },
      stages: { windowMs: 0 },
      timeoutMs: 80,
    }).catch(() => {})

    const both = Promise.all([
      fallback('1', 'f95zone.to', 'F95zone'),
      fallback('2', 'lewdcorner.com', 'LewdCorner'),
    ])
    // Both loads should begin while the first window is still waiting; poll
    // rather than sleep so a slow runner cannot starve the second window's
    // startup, and the queueing behaviour of the gate shows as exactly one
    // call.
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 50, interval: 5 })
    expect([...calls].sort()).toEqual([
      'https://f95zone.to/threads/1/',
      'https://lewdcorner.com/threads/2/',
    ].sort())
    await both
  })
})
