import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'
import { isCloudflareChallenge } from '../electron/downloads/maskedResolver.js'

// Covers the LewdCorner 403 handoff, mirroring update-links-fallback.test.js.
// The node fetch can lose the Cloudflare race (its TLS fingerprint never
// looks browser-class); the thread then loads in a resolver-partition window
// seeded for lewdcorner.com. The stored header travels whole: whether the
// harvested grant reaches the jar is applyCookies' only-if-absent decision.
// The window module is stubbed (no BrowserWindow under test); what is
// verified is the delegation, its arguments, and that the returned HTML
// flows through the existing parser into offerable links. The fallback
// branch logic itself is unit-tested against the real helper in
// window-fallback.test.js; this stub copy only has to mirror it.

const COOKIES = 'xf_user=1; xf_session=2; cf_clearance=stale-harvest'

const lcpage = (loggedIn, body, contentKey = 'thread-3272', title = 'Summertime Saga [v21.0.0 wip.7712] [Kompas Productions] | LewdCorner') =>
  `<html id="XF" data-content-key="${contentKey}" data-logged-in="${loggedIn}">` +
  `<head><title>${title}</title></head>` +
  `<div class="message-userContent">${body}</div></html>`

const bodyWithMega = `<b>DOWNLOAD</b><br><a href="https://mega.nz/file/abc">MEGA</a>`

const challengeResponse = () => ({ ok: false, status: 403 })

let restoreLoad = null

const installStubs = ({ windowHtml = null, cookieHeader = COOKIES } = {}) => {
  const fetchViaWindow = vi.fn(async () => windowHtml)
  const windowStub = {
    isAvailable: () => windowHtml !== null,
    fetchThreadHtmlViaWindow: fetchViaWindow,
    // Mirrors the real tail so the delegation arguments stay asserted here.
    withWindowFallback: async (threadId, cookies, { response, siteLabel, host, onSteer } = {}) => {
      const viaWindow = async () => {
        if (onSteer) onSteer(response.status)
        return fetchViaWindow(threadId, cookies, { host })
      }
      if (!response.ok) {
        if (response.status === 403 && windowHtml !== null) return { html: await viaWindow(), stages: {} }
        throw new Error(`${siteLabel} returned ${response.status} for thread ${threadId}`)
      }
      const body = await response.text()
      if (isCloudflareChallenge(body) && windowHtml !== null) return { html: await viaWindow(), stages: {} }
      return { html: body, stages: {} }
    },
  }
  const accountStub = {
    ensureFreshCookies: vi.fn(async () => true),
    getCookieHeaderForUrl: vi.fn(() => cookieHeader),
    getLcUserTier: vi.fn(() => 'VIP'),
  }
  const electronStub = { ipcMain: { handle: () => {} } }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronStub
    if (String(request).endsWith('accounts/accountStore')) return accountStub
    if (String(request).endsWith('downloads/forumWindowFetch')) return windowStub
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
  return { windowStub }
}

afterEach(() => {
  if (restoreLoad) {
    restoreLoad()
    restoreLoad = null
  }
  vi.unstubAllGlobals()
  vi.resetModules()
})

const fresh = (path) => {
  const resolved = require.resolve(path)
  delete require.cache[resolved]
  return require(path)
}

describe('lc challenge fallback', () => {
  it('loads the thread in a window on lewdcorner.com when the headless fetch 403s', async () => {
    const { windowStub } = installStubs({ windowHtml: lcpage('true', bodyWithMega) })
    const lcLinks = fresh('../electron/ipc/lcLinks.js')
    lcLinks.__testables.setTierLookup(async () => 'Free')
    vi.stubGlobal('fetch', vi.fn(async () => challengeResponse()))

    const result = await lcLinks.__testables.ipcHandler({ lcId: '3272' })

    expect(windowStub.fetchThreadHtmlViaWindow).toHaveBeenCalledWith(
      '3272',
      COOKIES,
      expect.objectContaining({ host: 'lewdcorner.com' }),
    )
    expect(result.ok).toBe(true)
    expect(result.links.length).toBeGreaterThan(0)
    expect(result.links[0].host).toContain('mega')
    expect(result.version).toBe('v21.0.0 wip.7712')
  })

  it('routes a challenge delivered as HTTP 200 into the window instead of parsing it as a guest page', async () => {
    const { windowStub } = installStubs({ windowHtml: lcpage('true', bodyWithMega) })
    const lcLinks = fresh('../electron/ipc/lcLinks.js')
    lcLinks.__testables.setTierLookup(async () => 'Free')
    const challengeBody = '<html><body>Just a moment... Enable JavaScript and cookies to continue.</body></html>'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => challengeBody })))

    const result = await lcLinks.__testables.ipcHandler({ lcId: '3272' })

    expect(windowStub.fetchThreadHtmlViaWindow).toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.links.length).toBeGreaterThan(0)
  })

  it('throws the 403 when no window runtime is available', async () => {
    installStubs({ windowHtml: null })
    const lcLinks = fresh('../electron/ipc/lcLinks.js')
    vi.stubGlobal('fetch', vi.fn(async () => challengeResponse()))

    const result = await lcLinks.__testables.ipcHandler({ lcId: '3272' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('LewdCorner returned 403 for thread 3272')
  })
})
