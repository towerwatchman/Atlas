import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import fs from 'fs'
import path from 'path'

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
    const TEST_TOKEN = 'c'.repeat(64)
    const AUTH = { 'X-Atlas-Token': TEST_TOKEN }
    const EXT_ORIGIN = 'chrome-extension://eeejnjabpobbeoklajpekhfofnokoboe'

    beforeAll(() => {
      startExtensionServer({
        port: TEST_PORT,
        getConfig: () => ({
          Extension: {
            rpcEnabled: true,
            rpcPort: TEST_PORT,
            // The server refuses every authenticated route without this.
            rpcToken: TEST_TOKEN,
            iconGlow: true,
            highlightTags: false,
          },
        }),
      })
    })

    afterAll(() => {
      stopExtensionServer()
    })

    // isExtensionServerRunning is async, so without `await` this compared a
    // Promise against `true` and always failed -- the "is the server up?"
    // contract was never actually asserted.
    it('reports server running status', async () => {
      await expect(isExtensionServerRunning()).resolves.toBe(true)
    })

    it('responds to GET /api/status with ok status', async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`, { headers: AUTH })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('ok')
      expect(data.app).toBe('Atlas')
    })

    it('responds to GET /api/settings with configured options', async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/settings`, { headers: AUTH })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.rpc_port).toBe(TEST_PORT)
      expect(data.icon_glow).toBe(true)
    })

    // Was asserting Allow-Origin '*', which is the behaviour that let any site
    // the user visited read /api/games. The preflight now answers only the
    // pinned extension origin.
    it('answers a preflight from the extension origin', async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/games`, {
        method: 'OPTIONS',
        headers: { Origin: EXT_ORIGIN },
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe(EXT_ORIGIN)
      expect(res.headers.get('access-control-allow-private-network')).toBe('true')
    })

    it('does not answer a preflight from an unrelated website', async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/games`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })

    // The extension add-wishlist path broadcasts wishlist-updated with a
    // source tag so the renderer can decide whether to refetch the catalog.
    // The extension has no optimistic UI, so it keeps the full Browse refresh.
    it('broadcasts wishlist-updated with source extension', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '..', 'electron', 'rpc', 'extensionServer.js'), 'utf8')
      expect(src).toContain("win.webContents.send('wishlist-updated', { source: 'extension' })")
    })
  })

  describe('ensureExtensionFiles', () => {
    it('syncs extension files to target appDataRoot', () => {
      const fs = require('fs')
      const os = require('os')
      const path = require('path')
      const { ensureExtensionFiles } = require('../electron/ipc/extension')

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ext-test-'))
      const result = ensureExtensionFiles({ appDataRoot: tempDir })

      expect(result.ok).toBe(true)
      expect(fs.existsSync(result.extensionPath)).toBe(true)
      expect(fs.existsSync(path.join(result.extensionPath, 'manifest.json'))).toBe(true)
    })
  })
})
