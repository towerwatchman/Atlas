import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import {
  extractThreadInfo,
  startExtensionServer,
  stopExtensionServer,
  isExtensionServerRunning,
} from '../electron/rpc/extensionServer'

describe('Extension Server & Thread Parser', () => {
  it('correctly extracts F95Zone thread IDs and title slugs', () => {
    const res1 = extractThreadInfo('https://f95zone.to/threads/re-lord-1-the-witch-of-hertfort.12345/')
    expect(res1).not.toBeNull()
    expect(res1.forum).toBe('f95')
    expect(res1.id).toBe('12345')
    expect(res1.numericId).toBe(12345)
    expect(res1.slugTitle).toBe('re lord 1 the witch of hertfort')

    const res2 = extractThreadInfo('f95zone.to/threads/998877/')
    expect(res2).not.toBeNull()
    expect(res2.forum).toBe('f95')
    expect(res2.id).toBe('998877')
    expect(res2.slugTitle).toBe('')
  })

  it('correctly extracts LewdCorner thread IDs', () => {
    const res = extractThreadInfo('https://lewdcorner.com/threads/some-game-title.54321/page-2')
    expect(res).not.toBeNull()
    expect(res.forum).toBe('lewdcorner')
    expect(res.id).toBe('54321')
    expect(res.slugTitle).toBe('some game title')
  })

  it('returns null for non-thread URLs', () => {
    expect(extractThreadInfo('https://google.com')).toBeNull()
    expect(extractThreadInfo('https://f95zone.to/sam/latest-updates/')).toBeNull()
  })

  describe('HTTP RPC Server Endpoints', () => {
    const TEST_PORT = 57099

    beforeAll(() => {
      startExtensionServer({
        port: TEST_PORT,
        getConfig: () => ({
          Extension: {
            rpcEnabled: true,
            rpcPort: TEST_PORT,
            iconGlow: true,
            highlightTags: false,
          },
        }),
      })
    })

    afterAll(() => {
      stopExtensionServer()
    })

    it('reports server running status', () => {
      expect(isExtensionServerRunning()).toBe(true)
    })

    it('responds to GET /api/status with ok status', async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('ok')
      expect(data.app).toBe('Atlas')
    })

    it('responds to GET /api/settings with configured options', async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/settings`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.rpc_port).toBe(TEST_PORT)
      expect(data.icon_glow).toBe(true)
    })

    it('handles OPTIONS preflight request with CORS headers', async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/games`, {
        method: 'OPTIONS',
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      expect(res.headers.get('access-control-allow-private-network')).toBe('true')
    })
  })
})
