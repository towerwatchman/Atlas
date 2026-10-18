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

const installStubs = ({ windowHtml = null, withPartition = false, cookieHeader = COOKIES } = {}) => {
  // Records every cookie seeded into the resolver partition's jar (name, value).
  const partitionSeeds = []
  const fakeSes = {
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => f95page('true', bodyWithMega),
    })),
    cookies: {
      set: vi.fn(async ({ name, value }) => {
        partitionSeeds.push([name, value])
      }),
    },
  }
  const windowStub = {
    isAvailable: () => windowHtml !== null,
    fetchThreadHtmlViaWindow: vi.fn(async () => windowHtml),
  }
  const accountStub = {
    ensureFreshCookies: vi.fn(async () => true),
    getCookieHeaderForUrl: vi.fn(() => cookieHeader),
  }
  const electronStub = { ipcMain: { handle: () => {} } }
  if (withPartition) electronStub.session = { fromPartition: () => fakeSes }
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
  return { windowStub, partitionSeeds, fakeSes }
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

  it('seeds the partition jar with forum cookies before ses.fetch — Chromium strips a manual Cookie header', async () => {
    const { partitionSeeds, fakeSes } = installStubs({
      withPartition: true,
      cookieHeader: 'xf_user=1; xf_session=2; cf_clearance=stale-harvest',
    })
    const updateLinks = fresh('../electron/ipc/updateLinks.js')

    const result = await updateLinks.getUpdateLinks('308445', { force: true })

    expect(result.ok).toBe(true)
    expect(result.links.length).toBeGreaterThan(0)
    expect(partitionSeeds).toEqual(
      expect.arrayContaining([
        ['xf_user', '1'],
        ['xf_session', '2'],
      ]),
    )
    // A stale harvested grant must never overwrite a solved one in the jar.
    expect(partitionSeeds.some(([name]) => name === 'cf_clearance')).toBe(false)
    // Seeding must precede the fetch, or the request rides whatever stale
    // cookies happen to sit in the jar for exactly one request.
    expect(Math.max(...fakeSes.cookies.set.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...fakeSes.fetch.mock.invocationCallOrder),
    )
  })

  it('routes a challenge delivered as HTTP 200 into the window instead of parsing it as a guest page', async () => {
    const { windowStub } = installStubs({ windowHtml: f95page('true', bodyWithMega) })
    const updateLinks = fresh('../electron/ipc/updateLinks.js')
    const challengeBody = '<html><body>Just a moment... Enable JavaScript and cookies to continue.</body></html>'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => challengeBody })))

    const result = await updateLinks.getUpdateLinks('308445', { force: true })

    expect(windowStub.fetchThreadHtmlViaWindow).toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.links.length).toBeGreaterThan(0)
  })

  it('passes stripped cookies to the window fallback when the partition session exists', async () => {
    const { windowStub, fakeSes } = installStubs({
      windowHtml: f95page('true', bodyWithMega),
      withPartition: true,
      cookieHeader: 'xf_user=1; xf_session=2; cf_clearance=stale-harvest',
    })
    // Partition present means ses.fetch is the stack under test; it answers
    // the challenge, which must hand the window the stripped forum header.
    fakeSes.fetch = vi.fn(async () => challengeResponse())
    const updateLinks = fresh('../electron/ipc/updateLinks.js')

    const result = await updateLinks.getUpdateLinks('308445', { force: true })

    expect(windowStub.fetchThreadHtmlViaWindow).toHaveBeenCalledWith(
      '308445',
      'xf_user=1; xf_session=2',
    )
    expect(result.ok).toBe(true)
    expect(result.links.length).toBeGreaterThan(0)
  })

  it('throws the parse error when a 200 challenge arrives with no window runtime', async () => {
    installStubs({ windowHtml: null })
    const updateLinks = fresh('../electron/ipc/updateLinks.js')
    const challengeBody = '<html><body>Just a moment... Enable JavaScript and cookies to continue.</body></html>'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => challengeBody })))

    await expect(updateLinks.getUpdateLinks('308445', { force: true })).rejects.toThrow(
      'Could not read the thread',
    )
  })
})