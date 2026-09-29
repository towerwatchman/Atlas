import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import Module from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The queue's safety net for a folder URL that reaches it unpicked: fail
// fatal with "pick one", never silently first-file. Runs the real manager
// against a temp database with fetch stubbed (electron stubbed too).

process.env.ATLAS_GOFILE_PAUSE_MS = '0'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-dm-folders-'))

const electronStub = {
  ipcMain: { handle: () => {} },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => dataDir },
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

const dbIndex = require('../electron/db/index.js')
const downloadsDb = require('../electron/db/downloads.js')
const manager = require('../electron/downloads/downloadManager.js')
const gofile = require('../electron/downloads/hosts/gofile.js')

Module._load = originalLoad

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.ATLAS_USER_DATA
  gofile.saltStore.resetGuest()
})
afterAll(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // Best-effort temp cleanup only.
  }
})

const waitForState = async (id, want, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    const item = await downloadsDb.getDownload(id)
    if (item?.state === want) return item
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`download ${id} never reached ${want}`)
}

describe('download manager folder guard', () => {
  beforeAll(async () => {
    dbIndex.initializeDatabase(dataDir)
    await downloadsDb.initializeDownloads()
    manager.configure({
      onEvent: () => {},
      resolveDownloadsDir: () => dataDir,
      resolveHostCredentials: () => ({}),
    })
  })

  it('fails a multi-file folder with a pick-one message, never first-files it', async () => {
    globalThis.fetch = async (url) => {
      const text = String(url)
      if (text.includes('wt.obf.js')) {
        return { ok: true, status: 200, text: async () => 'salt="bb22cc33dd44ee"' }
      }
      if (text.includes('/accounts')) {
        return json({ status: 'ok', data: { token: 'guest-token', id: 'account-1' } })
      }
      if (text.includes('/contents/')) {
        return json({
          status: 'ok',
          data: {
            children: {
              a: { id: 'u1', type: 'file', name: 'part1.zip', size: 10, link: 'https://store1.gofile.io/1' },
              b: { id: 'u2', type: 'file', name: 'part2.zip', size: 20, link: 'https://store1.gofile.io/2' },
            },
          },
        })
      }
      throw new Error(`unstubbed fetch: ${text}`)
    }
    const queued = await manager.enqueue({
      title: 'Season 2',
      url: 'https://gofile.io/d/AbCdEfGh',
      host: 'gofile',
    })
    expect(queued.success).toBe(true)
    const item = await waitForState(queued.id, 'failed')
    expect(item.error).toMatch(/2 files\. Pick one/i)
  })
})
