import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const gofile = require('../electron/downloads/hosts/gofile.js')

// Rotation pauses 4s before trying candidates (guest-budget discipline);
// tests exercise logic, not timing.
process.env.ATLAS_GOFILE_PAUSE_MS = '0'

// Gofile shares are folders, and folders need a listing before anything can be
// queued. These pin the listing contract with fetch stubbed: which URLs the
// plugin claims, what a one-file folder resolves to, and what a multi-file
// folder returns for the modal picker.

const realFetch = globalThis.fetch
const tempDirs = []
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.ATLAS_USER_DATA
  gofile.saltStore.resetGuest()
  while (tempDirs.length) {
    try {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
    } catch {
      // Best-effort temp cleanup only.
    }
  }
})

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const text = String(url)
    // Seedless probes fetch the live top seed first; answer it deterministically.
    if (text.includes('wt.obf.js')) {
      return { ok: true, status: 200, text: async () => 'salt="bb22cc33dd44ee"' }
    }
    // Longest match wins, so '/accounts' can't shadow '/accounts/account-1'
    // regardless of route order.
    const ordered = [...routes].sort((a, b) => b[0].length - a[0].length)
    for (const [match, response] of ordered) {
      if (text.includes(match)) return response
    }
    throw new Error(`unstubbed fetch: ${text}`)
  }
}

const guestAccount = () => json({ status: 'ok', data: { token: 'guest-token', id: 'account-1' } })
const child = (over = {}) => ({
  id: 'u1', type: 'file', name: 'game.zip', size: 42,
  link: 'https://store1.gofile.io/download/web/u1/game.zip',
  ...over,
})
const folder = (children) => json({ status: 'ok', data: { children } })

describe('matches', () => {
  it('claims share pages', () => {
    expect(gofile.matches('https://gofile.io/d/AbCdEfGh')).toBe(true)
    expect(gofile.matches('https://www.gofile.io/d/AbCdEfGh')).toBe(true)
  })

  it('claims store hosts so picked files re-probe with a cookie', () => {
    expect(gofile.matches('https://store1.gofile.io/download/web/u1/game.zip')).toBe(true)
    expect(gofile.matches('https://srv-store2.gofile.io/download/web/u1/game.zip')).toBe(true)
  })

  it('does not claim other hosts or garbage', () => {
    expect(gofile.matches('https://pixeldrain.com/u/x')).toBe(false)
    expect(gofile.matches('not a url')).toBe(false)
  })
})

describe('fileIdFrom', () => {
  it('reads the share code', () => {
    expect(gofile.fileIdFrom('https://gofile.io/d/AbCdEfGh')).toBe('AbCdEfGh')
    expect(gofile.fileIdFrom('https://gofile.io/?c=AbCd12')).toBe('AbCd12')
  })

  it('returns null when there is no code', () => {
    expect(gofile.fileIdFrom('https://gofile.io/')).toBeNull()
  })
})

describe('websiteToken', () => {
  it('is deterministic for the same input', () => {
    const now = 1725897600000
    expect(gofile.websiteToken('tok', now)).toBe(gofile.websiteToken('tok', now))
    expect(gofile.websiteToken('tok', now)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes across windows', () => {
    const now = 1725897600000
    expect(gofile.websiteToken('tok', now)).not.toBe(gofile.websiteToken('tok', now + 14400 * 1000))
  })
})

describe('classifyError', () => {
  it('treats a bare 404 as fatal', () => {
    expect(gofile.classifyError(null, { status: 404, body: null })).toBe('fatal')
  })

  it('treats a rejected token as auth', () => {
    expect(gofile.classifyError(null, { body: { status: 'error-wrongToken' } })).toBe('auth')
  })

  it('treats a rejected signature as transient', () => {
    expect(gofile.classifyError(null, { status: 401, body: { status: 'error-notPremium' } })).toBe('transient')
  })

  it('treats throttling as quota, never fatal', () => {
    // Load-bearing for the rotation stop: a quota verdict ends the loop,
    // anything else keeps burning budget.
    expect(gofile.classifyError(null, { status: 429, body: null })).toBe('quota')
    expect(gofile.classifyError(null, { body: { status: 'error-rateLimit' } })).toBe('quota')
    expect(gofile.classifyError(null, { body: { status: 'error-limits' } })).toBe('quota')
  })
})

describe('extractSalts', () => {
  it('ranks the live \\x-escaped salt first among obfuscator junk', () => {
    const { extractSalts } = gofile.saltStore
    const script = 'a="W71SCxpdL8kLFmklW34eF" k=\'\\x48\\x77\\x45\\x6e\\x6b\':\'\\x31\\x32\\x61\\x66\\x30'
      + '\\x35\\x36\\x64\\x61\\x63\\x65\\x61\\x30\\x62\' b="junk0000000001" c="junk0000000002"'
    expect(extractSalts(script)[0]).toBe('12af056dacea0b')
  })
})

describe('probe', () => {
  it('resolves a one-file folder to a direct url', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', folder({ a: child() })],
    ])
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(true)
    expect(result.directUrl).toBe('https://store1.gofile.io/download/web/u1/game.zip')
    expect(result.fileName).toBe('game.zip')
    expect(result.fileSize).toBe(42)
    expect(result.headers.cookie).toBe('accountToken=guest-token')
  })

  it('probes a store file link with a fresh guest cookie', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
    ])
    const result = await gofile.probe('https://store1.gofile.io/download/web/u1/game.zip')
    expect(result.ok).toBe(true)
    expect(result.directUrl).toBe('https://store1.gofile.io/download/web/u1/game.zip')
    expect(result.headers.cookie).toBe('accountToken=guest-token')
  })

  it('returns choices for a multi-file folder, not a direct url', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', folder({
        a: child({ name: 'part1.zip', size: 10, link: 'https://store1.gofile.io/1' }),
        b: child({ id: 'u2', name: 'part2.zip', size: 20, link: 'https://store1.gofile.io/2' }),
      })],
    ])
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(true)
    expect(result.directUrl).toBeUndefined()
    expect(result.choices).toHaveLength(2)
    expect(result.choices[0]).toEqual({ name: 'part1.zip', size: 10, directUrl: 'https://store1.gofile.io/1' })
  })

  it('fails a missing folder without retrying', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', json({ status: 'error-notFound' }, 404)],
    ])
    const result = await gofile.probe('https://gofile.io/d/deadbeef')
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('fatal')
    expect(result.error).toContain('error-notFound')
  })

  it('pairs a throttled verdict with wait advice when recovery finds nothing', async () => {
    // Stored salt rejected, script unreachable: the original 429 surfaces
    // with its meaning attached, not bare.
    const dir = useTempStore()
    fs.writeFileSync(path.join(dir, 'gofile-salt.json'), JSON.stringify({ salt: 'bogus00000000' }))
    globalThis.fetch = async (url) => {
      const text = String(url)
      if (text.includes('/accounts')) return guestAccount()
      if (text.includes('/contents/')) return json({ status: 'error-rateLimit' }, 429)
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('error-rateLimit')
    expect(result.error).toMatch(/wait 1-2 mins/i)
  })

  it('passes unknown API codes through with no invented advice', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', json({ status: 'error-teapot' }, 400)],
    ])
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Gofile returned error-teapot')
  })

  it('refuses password-protected folders', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', json({ status: 'error-passwordRequired' }, 403)],
    ])
    const result = await gofile.probe('https://gofile.io/d/locked12')
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('fatal')
    expect(result.error).toMatch(/password/i)
  })

  it('names Atlas as the limitation on an unrecognised link', async () => {
    const result = await gofile.probe('https://gofile.io/pricing')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/atlas/i)
  })

  it('calls an empty folder empty or expired, not a failure', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', folder({})],
    ])
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('fatal')
    expect(result.error).toMatch(/empty or expired/i)
  })

  it('refuses a subfolders-only folder instead of first-filing it', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', folder({ a: { id: 'u1', type: 'folder', name: 'sub', link: 'https://gofile.io/d/subfold1' } })],
    ])
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('fatal')
    expect(result.error).toMatch(/only subfolders/i)
  })

  it('reports a store link it cannot mint a guest session for', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/accounts')) throw new Error('connection reset')
      throw new Error(`unstubbed fetch: ${url}`)
    }
    const result = await gofile.probe('https://store1.gofile.io/download/web/u1/game.zip')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/could not reach gofile/i)
  })

  it('reports seed failure as transient when the script is unreachable', async () => {
    // Fresh install, no stored salt, script host down: nothing validated,
    // nothing saved, retryable.
    const dir = useTempStore()
    globalThis.fetch = async (url) => {
      if (String(url).includes('/accounts')) return guestAccount()
      throw new Error('connection reset')
    }
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('transient')
    expect(result.error).toMatch(/changed something|report/i)
    expect(fs.existsSync(path.join(dir, 'gofile-salt.json'))).toBe(false)
  })
})

const useTempStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-gofile-'))
  tempDirs.push(dir)
  process.env.ATLAS_USER_DATA = dir
  return dir
}

const storedSalt = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, 'gofile-salt.json'), 'utf8')).salt

// Probe against a contents stub that only accepts one salt, so the wrong
// salt deterministically yields error-notPremium.
const stubSaltedListing = (goodSalt, scriptText) => {
  globalThis.fetch = async (url, init) => {
    const text = String(url)
    if (text.includes('wt.obf.js')) {
      if (scriptText == null) throw new Error('script must not be fetched')
      return { ok: true, status: 200, text: async () => scriptText }
    }
    if (text.includes('/accounts')) return guestAccount()
    if (text.includes('/contents/')) {
      const sent = init?.headers?.['x-website-token']
      const now = Date.now()
      const good = [
        gofile.websiteToken('guest-token', now, goodSalt),
        gofile.websiteToken('guest-token', now - 14400 * 1000, goodSalt),
      ]
      if (good.includes(sent)) return folder({ a: child() })
      return json({ status: 'error-notPremium' }, 401)
    }
    throw new Error(`unstubbed fetch: ${text}`)
  }
}

describe('salt persistence', () => {
  it('uses the stored salt first without fetching the script', async () => {
    const dir = useTempStore()
    const STORED = 'bb22cc33dd44ee'
    fs.writeFileSync(path.join(dir, 'gofile-salt.json'), JSON.stringify({ salt: STORED }))
    stubSaltedListing(STORED, null)
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(true)
    expect(result.directUrl).toBe('https://store1.gofile.io/download/web/u1/game.zip')
  })

  it('replaces the stored salt after a rotation', async () => {
    const dir = useTempStore()
    fs.writeFileSync(path.join(dir, 'gofile-salt.json'), JSON.stringify({ salt: 'oldSalt00000000' }))
    const NEW_SALT = 'cc33dd44ee55ff'
    stubSaltedListing(NEW_SALT, `salt="${NEW_SALT}"`)
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(true)
    expect(storedSalt(dir)).toBe(NEW_SALT)
  })

  it('recovers when a bad hash surfaces as rateLimit, not notPremium', async () => {
    // A bogus seed must self-heal: rateLimit triggers the live refetch too.
    const dir = useTempStore()
    fs.writeFileSync(path.join(dir, 'gofile-salt.json'), JSON.stringify({ salt: 'bogus00000000' }))
    const REAL = 'aa11bb22cc33dd'
    let scriptFetched = false
    globalThis.fetch = async (url, init) => {
      const text = String(url)
      if (text.includes('wt.obf.js')) {
        scriptFetched = true
        return { ok: true, status: 200, text: async () => `salt="${REAL}"` }
      }
      if (text.includes('/accounts')) return guestAccount()
      if (text.includes('/contents/')) {
        const sent = init?.headers?.['x-website-token']
        const now = Date.now()
        if (sent === gofile.websiteToken('guest-token', now, REAL)) return folder({ a: child() })
        return json({ status: 'error-rateLimit' }, 429)
      }
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(scriptFetched).toBe(true)
    expect(result.ok).toBe(true)
    expect(storedSalt(dir)).toBe(REAL)
  })

  it('recovers from a bare HTTP 429 with no JSON body', async () => {
    // Gofile sometimes answers a bad hash with a bodiless 429 rather than a
    // status string. That must trigger the live refetch, not surface as-is.
    const dir = useTempStore()
    fs.writeFileSync(path.join(dir, 'gofile-salt.json'), JSON.stringify({ salt: 'bogus00000000' }))
    const REAL = 'aa11bb22cc33dd'
    globalThis.fetch = async (url, init) => {
      const text = String(url)
      if (text.includes('wt.obf.js')) {
        return { ok: true, status: 200, text: async () => `salt="${REAL}"` }
      }
      if (text.includes('/accounts')) return guestAccount()
      if (text.includes('/contents/')) {
        const sent = init?.headers?.['x-website-token']
        const now = Date.now()
        if (sent === gofile.websiteToken('guest-token', now, REAL)) return folder({ a: child() })
        return { ok: false, status: 429, json: async () => null }
      }
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(true)
    expect(storedSalt(dir)).toBe(REAL)
  })
  it('stops rotation at the first throttle instead of burning budget', async () => {
    // A throttled candidate means the guest budget is gone: every further
    // try extends the wall, so the loop ends, nothing is saved, and the
    // original verdict is returned. Total contents calls: stored + prev +
    // one candidate.
    const dir = useTempStore()
    fs.writeFileSync(path.join(dir, 'gofile-salt.json'), JSON.stringify({ salt: 'bogus00000000' }))
    const JUNK = 'ff11ee22dd33cc'
    const REAL = 'aa11bb22cc33dd'
    let calls = 0
    globalThis.fetch = async (url, init) => {
      const text = String(url)
      if (text.includes('wt.obf.js')) {
        return { ok: true, status: 200, text: async () => `a="${JUNK}" b="${REAL}"` }
      }
      if (text.includes('/accounts')) return guestAccount()
      if (text.includes('/contents/')) {
        calls += 1
        const sent = init?.headers?.['x-website-token']
        const now = Date.now()
        if (sent === gofile.websiteToken('guest-token', now, REAL)) return folder({ a: child() })
        if (sent === gofile.websiteToken('guest-token', now, JUNK)) return json({ status: 'error-rateLimit' }, 429)
        return json({ status: 'error-notPremium' }, 401)
      }
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(false)
    expect(calls).toBe(3)
    expect(storedSalt(dir)).toBe('bogus00000000')
  })

  it('leaves no stored salt when live recovery fails', async () => {
    const dir = useTempStore()
    globalThis.fetch = async (url) => {
      const text = String(url)
      if (text.includes('/accounts')) return guestAccount()
      if (text.includes('/contents/')) return json({ status: 'error-notPremium' }, 401)
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(false)
    expect(fs.existsSync(path.join(dir, 'gofile-salt.json'))).toBe(false)
  })

  it('tolerates a corrupt store file', async () => {
    const dir = useTempStore()
    fs.writeFileSync(path.join(dir, 'gofile-salt.json'), 'not json{{{')
    const NEW_SALT = 'dd44ee55ff66gg'
    stubSaltedListing(NEW_SALT, `salt="${NEW_SALT}"`)
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(true)
    expect(storedSalt(dir)).toBe(NEW_SALT)
  })

  it('spends one listing call per junk candidate, not two', async () => {
    // Seedless probe: live top seed first (hex-ranked, so the real salt),
    // then one listing call. The old per-candidate double-window retry
    // spent two per junk entry.
    useTempStore()
    const REAL = 'ee55ff66aa77bb'
    let listings = 0
    globalThis.fetch = async (url, init) => {
      const text = String(url)
      if (text.includes('wt.obf.js')) {
        return { ok: true, status: 200, text: async () => 'a="junk0000000001" b="junk0000000002" c="ee55ff66aa77bb"' }
      }
      if (text.includes('/accounts')) return guestAccount()
      if (text.includes('/contents/')) {
        listings += 1
        const sent = init?.headers?.['x-website-token']
        const now = Date.now()
        const good = [
          gofile.websiteToken('guest-token', now, REAL),
          gofile.websiteToken('guest-token', now - 14400 * 1000, REAL),
        ]
        if (good.includes(sent)) return folder({ a: child() })
        return json({ status: 'error-notPremium' }, 401)
      }
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(true)
    // Seed fetch (script, uncounted) + one listing with the top seed.
    // No second-window pass: the hit landed on the current window.
    expect(listings).toBe(1)
  })

  it('mints a fresh token when the cached one is rejected', async () => {
    // Session token cache: a wrongToken verdict (IP change, expiry) drops
    // it, mints once, and retries — then succeeds instead of staying dead.
    const dir = useTempStore()
    gofile.saltStore.resetGuest()
    const GOOD = 'aa11bb22cc33dd'
    let accounts = 0
    globalThis.fetch = async (url, init) => {
      const text = String(url)
      if (text.includes('wt.obf.js')) {
        return { ok: true, status: 200, text: async () => `salt="${GOOD}"` }
      }
      if (text.includes('/accounts')) {
        accounts += 1
        return json({ status: 'ok', data: { token: accounts === 1 ? 'stale-1' : 'fresh-2', id: 'account-1' } })
      }
      if (text.includes('/contents/')) {
        // Rotation point is the token, not the hash (covered elsewhere).
        if (init?.headers?.authorization === 'Bearer fresh-2') return folder({ a: child() })
        return json({ status: 'error-wrongToken' }, 401)
      }
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const result = await gofile.probe('https://gofile.io/d/AbCdEfGh')
    expect(result.ok).toBe(true)
    expect(accounts).toBe(2)
    expect(storedSalt(dir)).toBe(GOOD)
  })

  it('shares one script fetch across concurrent refreshes', async () => {
    const saltStore = gofile.saltStore
    let scripts = 0
    globalThis.fetch = async () => {
      scripts += 1
      return { ok: true, status: 200, text: async () => 'salt="ee55ff66aa77bb"' }
    }
    const [a, b] = await Promise.all([saltStore.refresh(), saltStore.refresh()])
    expect(scripts).toBe(1)
    expect(a).toEqual(b)
  })
})

describe('validate', () => {
  it('is always anonymous', async () => {
    expect(await gofile.validate({})).toEqual({ ok: true, anonymous: true })
  })
})

describe('getQuota', () => {
  const details = (data) => json({ status: 'ok', data: { id: 'account-1', tier: 'guest', ...data } })
  const quotaRoutes = (detailResp) => [
    ['/accounts/account-1', detailResp],
    ['/accounts', guestAccount()],
  ]

  it('sums recent usage against the free allowance', async () => {
    const d = new Date()
    stubFetch(quotaRoutes(details({ ipTraffic: {
      2020: { 1: { 1: 999 } },
      [d.getUTCFullYear()]: { [d.getUTCMonth() + 1]: { [d.getUTCDate()]: 100 } },
    } })))
    const quota = await gofile.getQuota()
    expect(quota.ok).toBe(true)
    expect(quota.used).toBe(100)
    expect(quota.cap).toBe(1000000000000)
  })

  it('reports no cap for non-guest tiers', async () => {
    stubFetch(quotaRoutes(details({ tier: 'premium', ipTraffic: {} })))
    const quota = await gofile.getQuota()
    expect(quota.ok).toBe(true)
    expect(quota.used).toBe(0)
    expect(quota.cap).toBeNull()
  })

  it('fails instead of guessing when usage is missing', async () => {
    stubFetch(quotaRoutes(details({})))
    expect((await gofile.getQuota()).ok).toBe(false)
  })

  it('reads string usage buckets instead of reporting zero', async () => {
    const d = new Date()
    stubFetch(quotaRoutes(details({ ipTraffic: {
      [d.getUTCFullYear()]: { [d.getUTCMonth() + 1]: { [d.getUTCDate()]: '100' } },
    } })))
    const quota = await gofile.getQuota()
    expect(quota.ok).toBe(true)
    expect(quota.used).toBe(100)
  })

  it('sums nested hourly leaves instead of skipping them', async () => {
    const d = new Date()
    stubFetch(quotaRoutes(details({ ipTraffic: {
      [d.getUTCFullYear()]: { [d.getUTCMonth() + 1]: { [d.getUTCDate()]: { 0: 40, 12: 60 } } },
    } })))
    const quota = await gofile.getQuota()
    expect(quota.ok).toBe(true)
    expect(quota.used).toBe(100)
  })
})
