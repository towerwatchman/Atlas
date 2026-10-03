import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Module from 'module'
import fs from 'fs'
import path from 'path'

// LC links live beside the F95 ones in separate module Maps (`f95:{id}` /
// `lc:{id}`), so same-numbered threads never share a key. The tier gate
// mirrors Browse: VIP users and exactly-'Free' threads pass; unknown
// thread tier blocks, and guests get nothing (links withheld server-side).

const ipcHandlers = new Map()
let restoreLoad = null

const electronStub = () => ({
  ipcMain: {
    handle: (channel, fn) => ipcHandlers.set(channel, fn),
  },
})

const installStubs = ({ userTier = 'Free', threadTier = 'Free', cookie = 'xf_session=test' } = {}) => {
  ipcHandlers.clear()
  const stub = electronStub()
  const accountStub = {
    ensureFreshCookies: vi.fn(async () => true),
    getCookieHeaderForUrl: vi.fn(() => cookie),
    getLcUserTier: vi.fn(() => userTier),
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return stub
    if (request.endsWith('accounts/accountStore')) return accountStub
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
  return { accountStub }
}

afterEach(() => {
  if (restoreLoad) {
    restoreLoad()
    restoreLoad = null
  }
  vi.unstubAllGlobals()
  vi.resetModules()
})

// Fresh require: without this every test shares the first test's stubbed
// accountStore and a warm cache, so per-test user tiers never take effect.
const fresh = (path) => {
  const resolved = require.resolve(path)
  delete require.cache[resolved]
  return require(path)
}

const htmlResponse = (html) => ({ ok: true, text: async () => html })

const page = (loggedIn, body, contentKey = 'thread-3272') =>
  `<html id="XF" data-content-key="${contentKey}" data-logged-in="${loggedIn}">` +
  `<div class="message-userContent">${body}</div></html>`

const bodyWithMega = `<b>DOWNLOAD</b><br><a href="https://mega.nz/file/abc">MEGA</a>`

describe('lc/f95 cache separation', () => {
  it('updateLinks keys on f95: and lcLinks keys on lc:', () => {
    const updateSrc = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'ipc', 'updateLinks.js'),
      'utf8',
    )
    expect(updateSrc).toContain('f95:')
    const lcSrc = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'ipc', 'lcLinks.js'),
      'utf8',
    )
    expect(lcSrc).toContain('lc:')
  })

  it('f95 and lc caches do not collide on the same numeric id', async () => {
    installStubs({ userTier: 'VIP', threadTier: 'Free' })
    const updateLinks = fresh('../electron/ipc/updateLinks.js')
    const lcLinks = fresh('../electron/ipc/lcLinks.js')
    lcLinks.__testables.setTierLookup(async () => 'Free')
    const fetchMock = vi.fn(async () => htmlResponse(page('true', bodyWithMega)))
    vi.stubGlobal('fetch', fetchMock)

    await updateLinks.getUpdateLinks('123', { force: true }).catch(() => null)
    await lcLinks.getLcLinks('123', { force: true })
    expect(updateLinks.clearUpdateLinkCache).toBeTypeOf('function')
    expect(lcLinks.cacheHas('lc:123')).toBe(true)
    // The F95 module must not expose or hit the lc: key, and vice versa.
    expect(lcLinks.cacheHas('f95:123')).toBe(false)
  })
})

describe('lc tier gate (mirrors Browse)', () => {
  beforeEach(() => {
    installStubs()
  })

  it('blocks a VIP thread for a Free user with TIER_RESTRICTED + Member+ copy', async () => {
    installStubs({ userTier: 'Free', threadTier: 'VIP' })
    const lcLinks = fresh('../electron/ipc/lcLinks.js')
    lcLinks.__testables.setTierLookup(async () => 'VIP')
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(page('true', bodyWithMega))))
    const result = await lcLinks.__testables.ipcHandler({ lcId: '3272' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('TIER_RESTRICTED')
    expect(result.error).toMatch(/Member\+/)
    expect(result.error).not.toMatch(/VIP/)
  })

  it('lets a VIP user past a VIP thread, and a Free user past a Free thread', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(page('true', bodyWithMega))))

    installStubs({ userTier: 'VIP', threadTier: 'VIP' })
    const vipLinks = fresh('../electron/ipc/lcLinks.js')
    vipLinks.__testables.setTierLookup(async () => 'VIP')
    expect((await vipLinks.__testables.ipcHandler({ lcId: '1' })).ok).toBe(true)

    installStubs({ userTier: 'Free', threadTier: 'Free' })
    const freeLinks = fresh('../electron/ipc/lcLinks.js')
    freeLinks.__testables.setTierLookup(async () => 'Free')
    expect((await freeLinks.__testables.ipcHandler({ lcId: '2' })).ok).toBe(true)
  })

  it('null thread tier blocks; null user tier passes Free threads only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(page('true', bodyWithMega))))

    installStubs({ userTier: 'Free' })
    const nullThread = fresh('../electron/ipc/lcLinks.js')
    nullThread.__testables.setTierLookup(async () => null)
    expect((await nullThread.__testables.ipcHandler({ lcId: '3' })).code).toBe(
      'TIER_RESTRICTED',
    )

    installStubs({ userTier: null })
    const nullUserFree = fresh('../electron/ipc/lcLinks.js')
    nullUserFree.__testables.setTierLookup(async () => 'Free')
    expect((await nullUserFree.__testables.ipcHandler({ lcId: '4' })).ok).toBe(true)

    installStubs({ userTier: null })
    const nullUserVip = fresh('../electron/ipc/lcLinks.js')
    nullUserVip.__testables.setTierLookup(async () => 'VIP')
    expect((await nullUserVip.__testables.ipcHandler({ lcId: '5' })).code).toBe(
      'TIER_RESTRICTED',
    )
  })

  it('returns NOT_LOGGED_IN on a guest render', async () => {
    installStubs({ userTier: 'VIP' })
    const lcLinks = fresh('../electron/ipc/lcLinks.js')
    lcLinks.__testables.setTierLookup(async () => 'Free')
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(page('false', bodyWithMega))))
    const result = await lcLinks.__testables.ipcHandler({ lcId: '3272' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_LOGGED_IN')
  })

  it('returns NO_SESSION without fetching when no cookies are stored', async () => {
    installStubs({ cookie: '' })
    const lcLinks = fresh('../electron/ipc/lcLinks.js')
    const fetchMock = vi.fn(async () => htmlResponse(page('true', bodyWithMega)))
    vi.stubGlobal('fetch', fetchMock)
    const result = await lcLinks.__testables.ipcHandler({ lcId: '3272' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SESSION')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
