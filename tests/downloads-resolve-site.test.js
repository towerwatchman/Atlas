import { describe, it, expect, vi, beforeEach } from 'vitest'
import Module from 'node:module'

// The masked-resolve handler hardcoded the F95 session, so LC masked:true
// fallbacks (undecodable /masked/* URLs the parser emits for the resolver)
// could never resolve under LC cookies. The handler takes a site param and
// routes the cookie refresh plus the resolver base URL through it; F95 stays
// the default so today's renderer payloads keep working.

const handlers = new Map()

const accountMock = {
  ensureFreshCookies: vi.fn(async () => true),
  getCookieHeaderForUrl: vi.fn(() => 'xf_session=test'),
  // Same domain-to-site mapping as the real accountStore, so the
  // URL-inference path is exercised honestly rather than stubbed true.
  siteForUrl: vi.fn((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase()
      if (host === 'lewdcorner.com' || host.endsWith('.lewdcorner.com')) return 'lewdcorner'
      if (host === 'f95zone.to' || host.endsWith('.f95zone.to')) return 'f95'
    } catch { /* unparseable: no site */ }
    return null
  }),
}

const resolveMock = vi.fn(async () => ({
  ok: true,
  url: 'https://mega.nz/file/abc#key',
  host: 'mega.nz',
}))

const electronStub = {
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  shell: {},
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: () => null,
  },
  app: { getPath: () => 'C:\\tmp\\atlas-test' },
  dialog: {},
}

const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub
  if (String(request).endsWith('accounts/accountStore')) return accountMock
  if (String(request).endsWith('downloads/maskedResolver')) {
    return { resolveMaskedLink: resolveMock }
  }
  return originalLoad.call(this, request, ...rest)
}
require('../electron/ipc/downloads.js')({})
Module._load = originalLoad

const resolveMasked = (args) =>
  handlers.get('downloads-resolve-masked')({ sender: {} }, args)

beforeEach(() => {
  accountMock.ensureFreshCookies.mockClear()
  accountMock.getCookieHeaderForUrl.mockClear()
  accountMock.siteForUrl.mockClear()
  resolveMock.mockClear()
})

describe('downloads-resolve-masked site', () => {
  it('is registered on the real ipc module', () => {
    expect(handlers.has('downloads-resolve-masked')).toBe(true)
  })

  it("refreshes LewdCorner cookies when site is 'lewdcorner'", async () => {
    const result = await resolveMasked({
      url: 'https://lewdcorner.com/masked/out?t=abc',
      title: 'game',
      site: 'lewdcorner',
    })
    expect(result.ok).toBe(true)
    expect(accountMock.ensureFreshCookies).toHaveBeenCalledWith('lewdcorner')
  })

  it('defaults to the F95 session when site is omitted', async () => {
    await resolveMasked({ url: 'https://f95zone.to/masked/xyz', title: 'game' })
    expect(accountMock.ensureFreshCookies).toHaveBeenCalledWith('f95')
  })

  it("infers lewdcorner from the URL when site is omitted (today's renderer)", async () => {
    const result = await resolveMasked({
      url: 'https://lewdcorner.com/masked/out?t=abc',
      title: 'game',
    })
    expect(result.ok).toBe(true)
    expect(accountMock.ensureFreshCookies).toHaveBeenCalledWith('lewdcorner')
    expect(resolveMock.mock.calls[0][1].baseUrl).toContain('lewdcorner.com')
  })

  it('lets an explicit site override the URL inference', async () => {
    await resolveMasked({
      url: 'https://lewdcorner.com/masked/out?t=abc',
      title: 'game',
      site: 'f95',
    })
    expect(accountMock.ensureFreshCookies).toHaveBeenCalledWith('f95')
  })

  it('forwards the LC base URL and gate host to the resolver', async () => {
    await resolveMasked({
      url: 'https://lewdcorner.com/masked/out?t=abc',
      title: 'game',
      site: 'lewdcorner',
    })
    const options = resolveMock.mock.calls[0][1]
    expect(options?.baseUrl || '').toContain('lewdcorner.com')
    expect(options?.gateHosts || []).toContain('lewdcorner.com')
  })
})
