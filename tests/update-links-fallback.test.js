import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'

// Covers the F95 403-challenge handoff: headless fetch answers
// cf-mitigated=challenge, so the thread loads in a real window instead.
// The window module is stubbed (no BrowserWindow under test); what is
// verified is the delegation, its arguments, and that the returned HTML
// flows through the existing parser into offerable links.

const COOKIES = 'xf_user=1; xf_session=2'

const f95page = (loggedIn, body, contentKey = 'thread-308445') =>
  `<html data-content-key="${contentKey}" data-logged-in="${loggedIn}">` +
  `<div class="bbWrapper">${body}</div></html>`

const bodyWithMega = `<b>DOWNLOAD</b><br><a href="https://mega.nz/file/abc">MEGA</a>`

const challengeResponse = () => ({
  ok: false,
  status: 403,
  headers: { get: (name) => (String(name).toLowerCase() === 'cf-mitigated' ? 'challenge' : null) },
})

let restoreLoad = null

const installStubs = ({ windowHtml = null } = {}) => {
  const windowStub = {
    isAvailable: () => windowHtml !== null,
    fetchThreadHtmlViaWindow: vi.fn(async () => windowHtml),
  }
  const accountStub = {
    ensureFreshCookies: vi.fn(async () => true),
    getCookieHeaderForUrl: vi.fn(() => COOKIES),
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return { ipcMain: { handle: () => {} } }
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

describe('f95 challenge fallback', () => {
  it('loads the thread in a window when the headless fetch is challenged', async () => {
    const { windowStub } = installStubs({ windowHtml: f95page('true', bodyWithMega) })
    const updateLinks = fresh('../electron/ipc/updateLinks.js')
    vi.stubGlobal('fetch', vi.fn(async () => challengeResponse()))

    const result = await updateLinks.getUpdateLinks('308445', { force: true })
    expect(windowStub.fetchThreadHtmlViaWindow).toHaveBeenCalledWith('308445', COOKIES)
    expect(result.ok).toBe(true)
    expect(result.links.length).toBeGreaterThan(0)
    expect(result.links[0].host).toContain('mega')
  })

  it('throws the 403 when no window runtime is available', async () => {
    installStubs({ windowHtml: null })
    const updateLinks = fresh('../electron/ipc/updateLinks.js')
    vi.stubGlobal('fetch', vi.fn(async () => challengeResponse()))

    await expect(updateLinks.getUpdateLinks('308445', { force: true })).rejects.toThrow(
      'F95zone returned 403 for thread 308445',
    )
  })
})
