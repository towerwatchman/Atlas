import { describe, it, expect, afterEach } from 'vitest'
import Module from 'node:module'
import path from 'node:path'

const gofile = require('../electron/downloads/hosts/gofile.js')

// The list-folder handler is thin glue, but it owns the modal's whole
// contract: choices for the picker vs a single-file directUrl that skips a
// second probe. Tested through the real registered handler: electron is
// stubbed, the plugin registry is real, only fetch is faked.
//
// Rotation pauses 4s before trying candidates (guest-budget discipline);
// tests exercise logic, not timing.
process.env.ATLAS_GOFILE_PAUSE_MS = '0'

const handlers = new Map()
const electronStub = {
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => 'C:\\tmp\\atlas-test' },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(String(s)),
    decryptString: (b) => String(b),
  },
}

const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub
  return originalLoad.call(this, request, ...rest)
}
require('../electron/ipc/downloads.js')({})
Module._load = originalLoad

const listFolder = (args) => handlers.get('downloads-list-folder')({}, args)

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.ATLAS_USER_DATA
  gofile.saltStore.resetGuest()
})

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})
const guestAccount = () => json({ status: 'ok', data: { token: 'guest-token', id: 'account-1' } })
const child = (over = {}) => ({
  id: 'u1', type: 'file', name: 'game.zip', size: 42,
  link: 'https://store1.gofile.io/download/web/u1/game.zip',
  ...over,
})
const folder = (children) => json({ status: 'ok', data: { children } })

function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const text = String(url)
    if (text.includes('wt.obf.js')) {
      return { ok: true, status: 200, text: async () => 'salt="bb22cc33dd44ee"' }
    }
    const ordered = [...routes].sort((a, b) => b[0].length - a[0].length)
    for (const [match, response] of ordered) {
      if (text.includes(match)) return response
    }
    throw new Error(`unstubbed fetch: ${text}`)
  }
}

describe('downloads-list-folder', () => {
  it('is registered on the real ipc module', () => {
    expect(handlers.has('downloads-list-folder')).toBe(true)
  })

  it('refuses a missing url without touching the network', async () => {
    let fetched = false
    globalThis.fetch = async () => { fetched = true; throw new Error('must not fetch') }
    expect(await listFolder()).toEqual({ ok: false, error: 'No URL supplied' })
    expect(await listFolder({})).toEqual({ ok: false, error: 'No URL supplied' })
    expect(fetched).toBe(false)
  })

  it('names the missing plugin instead of probing blindly', async () => {
    expect(await listFolder({ url: 'https://example.com/file.zip' }))
      .toEqual({ ok: false, error: 'No plugin for this host' })
  })

  it('passes a probe failure through with its message', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', json({ status: 'error-notFound' }, 404)],
    ])
    const result = await listFolder({ url: 'https://gofile.io/d/deadbeef' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('error-notFound')
  })

  it('returns choices for a multi-file folder', async () => {
    stubFetch([
      ['/accounts', guestAccount()],
      ['/contents/', folder({
        a: child({ name: 'part1.zip', size: 10, link: 'https://store1.gofile.io/1' }),
        b: child({ id: 'u2', name: 'part2.zip', size: 20, link: 'https://store1.gofile.io/2' }),
      })],
    ])
    const result = await listFolder({ url: 'https://gofile.io/d/AbCdEfGh' })
    expect(result.ok).toBe(true)
    expect(result.choices).toHaveLength(2)
    expect(result.directUrl).toBeUndefined()
  })

  it('passes a single file through with one listing call, not two', async () => {
    // The modal queues this directUrl without re-probing: every extra
    // listing spends from the 20/min guest budget.
    let listings = 0
    globalThis.fetch = async (url) => {
      const text = String(url)
      if (text.includes('wt.obf.js')) {
        return { ok: true, status: 200, text: async () => 'salt="bb22cc33dd44ee"' }
      }
      if (text.includes('/accounts')) return guestAccount()
      if (text.includes('/contents/')) {
        listings += 1
        return folder({ a: child() })
      }
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const result = await listFolder({ url: 'https://gofile.io/d/AbCdEfGh' })
    expect(result).toEqual({
      ok: true,
      directUrl: 'https://store1.gofile.io/download/web/u1/game.zip',
      fileName: 'game.zip',
      fileSize: 42,
    })
    expect(listings).toBe(1)
  })
})
