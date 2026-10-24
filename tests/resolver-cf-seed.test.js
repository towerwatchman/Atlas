import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'

// applyCookies' cf-only-if-absent rule: a login-harvested grant may seed the
// jar, but never clobber one already solved inside it — the jar's own grant
// is always fresher than anything in the store.

let restoreLoad = null

const installStubs = ({ jar = [] } = {}) => {
  const setCalls = []
  const fakeSes = {
    cookies: {
      get: vi.fn(async () => jar),
      set: vi.fn(async (spec) => setCalls.push([spec.name, spec.value])),
    },
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return {}
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
  const { applyCookies } = require('../electron/downloads/maskedResolver.js')
  return { applyCookies, fakeSes, setCalls }
}

afterEach(() => {
  if (restoreLoad) {
    restoreLoad()
    restoreLoad = null
  }
  vi.resetModules()
})

describe('applyCookies cf-only-if-absent', () => {
  it('seeds a login-harvested grant into an empty jar', async () => {
    const { applyCookies, fakeSes, setCalls } = installStubs({ jar: [] })
    await applyCookies(fakeSes, 'xf_session=2; cf_clearance=login-minted', 'https://lewdcorner.com/threads/1/')
    expect(setCalls).toEqual(
      expect.arrayContaining([
        ['xf_session', '2'],
        ['cf_clearance', 'login-minted'],
      ]),
    )
  })

  it('never clobbers a grant already solved in the jar', async () => {
    const { applyCookies, fakeSes, setCalls } = installStubs({
      jar: [{ name: 'cf_clearance', value: 'jar-solved' }],
    })
    await applyCookies(fakeSes, 'xf_session=2; cf_clearance=stale-harvest', 'https://lewdcorner.com/threads/1/')
    // URL-based lookup: a host-only grant the browser itself solved also
    // counts as present, unlike a bare domain filter.
    expect(fakeSes.cookies.get).toHaveBeenCalledWith({ url: 'https://lewdcorner.com/threads/1/', name: 'cf_clearance' })
    expect(setCalls.some(([name]) => name === 'cf_clearance')).toBe(false)
    expect(setCalls).toEqual(expect.arrayContaining([['xf_session', '2']]))
  })

  it('logs which cloudflare cookies were seeded versus already in the jar', async () => {
    const { applyCookies, fakeSes } = installStubs({
      jar: [{ name: 'cf_clearance', value: 'jar-solved' }],
    })
    const lines = []
    vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')))
    await applyCookies(fakeSes, 'xf_session=2; cf_clearance=stale-harvest', 'https://lewdcorner.com/threads/1/')
    const cfLine = lines.find((l) => l.includes('[cf-jar]'))
    expect(cfLine).toContain('lewdcorner.com')
    // Values never travel; only names and which side of the jar they landed on.
    expect(cfLine).toContain('"jarHad":["cf_clearance"]')
    expect(cfLine).not.toContain('stale-harvest')
  })
})
