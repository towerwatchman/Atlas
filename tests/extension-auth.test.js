// Regression tests for the RPC server's pairing token.
//
// Before this existed, the server answered every request with
// Access-Control-Allow-Origin: '*' and no authentication, so any page the user
// happened to visit could read GET /api/games -- their entire library -- and
// POST to /api/games/add. These tests fail against that version.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import {
  startExtensionServer,
  stopExtensionServer,
} from '../electron/rpc/extensionServer'

const PORT = 57431
const TOKEN = 'a'.repeat(64)
const EXTENSION_ORIGIN = 'chrome-extension://eeejnjabpobbeoklajpekhfofnokoboe'

function request(path, { headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method, headers },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('extension RPC authentication', () => {
  beforeAll(async () => {
    startExtensionServer({
      port: PORT,
      getConfig: () => ({ Extension: { rpcToken: TOKEN } }),
    })
    // Give the listener a moment to bind.
    await new Promise((r) => setTimeout(r, 150))
  })

  afterAll(() => stopExtensionServer())

  it('rejects a request with no token', async () => {
    const res = await request('/api/games')
    expect(res.status).toBe(401)
  })

  it('rejects a wrong token of the same length', async () => {
    const res = await request('/api/games', { headers: { 'X-Atlas-Token': 'b'.repeat(64) } })
    expect(res.status).toBe(401)
  })

  it('rejects a token of the wrong length', async () => {
    const res = await request('/api/games', { headers: { 'X-Atlas-Token': 'a'.repeat(63) } })
    expect(res.status).toBe(401)
  })

  it('does not leak library data in the rejection body', async () => {
    const res = await request('/api/games')
    expect(res.body).not.toMatch(/title|record_id|version/i)
  })

  it('accepts the correct token', async () => {
    const res = await request('/api/games', { headers: { 'X-Atlas-Token': TOKEN } })
    expect(res.status).toBe(200)
  })

  it('answers /api/ping without a token so the popup can tell offline from unpaired', async () => {
    const res = await request('/api/ping')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })

  it('never echoes Allow-Origin back to an arbitrary website', async () => {
    const res = await request('/api/ping', { headers: { Origin: 'https://evil.example' } })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('echoes Allow-Origin only for the pinned extension id', async () => {
    const res = await request('/api/ping', { headers: { Origin: EXTENSION_ORIGIN } })
    expect(res.headers['access-control-allow-origin']).toBe(EXTENSION_ORIGIN)
  })

  it('does not answer a preflight from an arbitrary website', async () => {
    const res = await request('/api/games', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('fails closed when no token is configured', async () => {
    stopExtensionServer()
    startExtensionServer({ port: PORT, getConfig: () => ({ Extension: {} }) })
    await new Promise((r) => setTimeout(r, 150))
    const res = await request('/api/games', { headers: { 'X-Atlas-Token': TOKEN } })
    expect(res.status).toBe(401)
  })
})
