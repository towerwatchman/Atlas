import { describe, it, expect } from 'vitest'
const pd = require('../electron/downloads/hosts/pixeldrain.js')

describe('filesystem paths', () => {
  it('extracts a bare filesystem path', () => {
    expect(pd.filesystemPathFrom('https://pixeldrain.com/d/SnRizccJ')).toBe('SnRizccJ')
  })
  it('keeps nested paths whole', () => {
    // A /d/ node can be a directory, so a link may address a file inside it.
    expect(pd.filesystemPathFrom('https://pixeldrain.com/d/Bucket7/builds/game.zip'))
      .toBe('Bucket7/builds/game.zip')
  })
  it('drops query and fragment', () => {
    expect(pd.filesystemPathFrom('https://pixeldrain.com/d/SnRizccJ?x=1#y')).toBe('SnRizccJ')
  })
  it('is not confused by /u/', () => {
    expect(pd.filesystemPathFrom('https://pixeldrain.com/u/UPND8Ncr')).toBeNull()
  })
})

describe('probe on a /d/ filesystem link', () => {
  const realFetch = globalThis.fetch
  const stubHead = (status, headers) => {
    globalThis.fetch = async (requested, opts) => ({
      ok: status >= 200 && status < 300,
      status,
      method: opts?.method,
      requested,
      headers: new Map(Object.entries(headers)),
      json: async () => ({}),
      text: async () => '',
    })
  }
  const restore = () => { globalThis.fetch = realFetch }

  it('resolves the real file from the modal', async () => {
    stubHead(200, {
      'content-type': 'application/zip',
      'content-length': '1248623077',
      'content-disposition': 'attachment; filename="TheLastTowerStanding_0.1.5_Win64.zip"',
    })
    const r = await pd.probe('https://pixeldrain.com/d/SnRizccJ')
    restore()
    expect(r.ok).toBe(true)
    // The URL the share page labels "Direct link".
    expect(r.directUrl).toBe('https://pixeldrain.com/api/filesystem/SnRizccJ')
    expect(r.fileName).toBe('TheLastTowerStanding_0.1.5_Win64.zip')
    expect(r.fileSize).toBe(1248623077)
  })

  it('falls back to the last path segment when there is no disposition', async () => {
    stubHead(200, { 'content-type': 'application/zip', 'content-length': '10' })
    const r = await pd.probe('https://pixeldrain.com/d/Bucket7/builds/game.zip')
    restore()
    expect(r.fileName).toBe('game.zip')
  })

  it('refuses a shared folder instead of downloading a listing', async () => {
    // A /d/ node can be a directory; the queue models one item as one file.
    stubHead(200, { 'content-type': 'application/json' })
    const r = await pd.probe('https://pixeldrain.com/d/SomeFolder')
    restore()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/shared folder/i)
  })

  it('does not send /d/ to the file API any more', async () => {
    let seen = ''
    globalThis.fetch = async (requested) => {
      seen = requested
      return { ok: true, status: 200, headers: new Map([['content-type', 'application/zip']]), json: async () => ({}), text: async () => '' }
    }
    await pd.probe('https://pixeldrain.com/d/SnRizccJ')
    restore()
    expect(seen).not.toMatch(/\/api\/file\//)
    expect(seen).toMatch(/\/api\/filesystem\//)
  })
})
