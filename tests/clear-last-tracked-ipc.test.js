import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import Module from 'module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const dbIndex = require_('../electron/db/index.js')
const {
  ensureCatalogIndexSchema, LAST_SEEN_ATLAS_ID_KEY, LAST_TRACKED_ATLAS_ID_KEY,
  readWatermark,
} = require_('../electron/db/catalogIndex.js')

// Harness copied from delete-game-broadcast.test.js / clear-resolver-session.test.js:
// stub electron so ipcMain.handle captures the channel's body, then drive that
// body against a real temp DB so the monotonic and empty-catalog behaviour is
// exercised through the same path the renderer invokes.

let dataDir
let restoreLoad = null
const ipcHandlers = new Map()
// Record every main-to-renderer push so a case can assert the clear broadcast.
const sentMessages = []
const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: (channel, payload) => sentMessages.push({ channel, payload }) },
}

const installStub = () => {
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) },
        BrowserWindow: { getAllWindows: () => [fakeWindow] },
        shell: {}, app: {}, dialog: {},
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => { Module._load = originalLoad }
}

beforeAll(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cleartracked-')) })
afterAll(() => {
  if (restoreLoad) restoreLoad()
  try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {}
})
beforeEach(() => { sentMessages.length = 0; installStub() })
afterEach(() => { if (restoreLoad) { restoreLoad(); restoreLoad = null } })

const raw = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.all(sql, params, (e, r) => (e ? rej(e) : res(r))))
const rawGet = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.get(sql, params, (e, r) => (e ? rej(e) : res(r))))

const clearLastTracked = async () => {
  const handler = ipcHandlers.get('clear-last-tracked')
  return await handler()
}

const insertAtlasRow = (atlasId) =>
  raw(`INSERT OR REPLACE INTO atlas_data (atlas_id, title, category) VALUES (?, ?, 'Games')`,
    [atlasId, `Game ${atlasId}`])

describe('clear-last-tracked handler', () => {
  let handlerRegistered = false

  const ensureLoaded = async () => {
    if (!handlerRegistered) {
      dbIndex.initializeDatabase(dataDir)
      await ensureCatalogIndexSchema()
      const { registerGamesHandlers } = require_('../electron/ipc/games.js')
      registerGamesHandlers({})
      handlerRegistered = true
    }
    await raw(`DELETE FROM catalog_index`)
    await raw(`DELETE FROM atlas_data`)
    await raw(`DELETE FROM catalog_index_meta`)
  }

  it('returns the catalog maximum it pinned', async () => {
    await ensureLoaded()
    await insertAtlasRow(10)
    await insertAtlasRow(20)
    expect(await clearLastTracked()).toEqual({ cleared: true, watermark: 20 })
    expect(await readWatermark(LAST_TRACKED_ATLAS_ID_KEY)).toBe(20)
  })

  it('moves upward on a second call after the catalog grows', async () => {
    await ensureLoaded()
    await insertAtlasRow(20)
    expect(await clearLastTracked()).toEqual({ cleared: true, watermark: 20 })
    await insertAtlasRow(30)
    expect(await clearLastTracked()).toEqual({ cleared: true, watermark: 30 })
    expect(await readWatermark(LAST_TRACKED_ATLAS_ID_KEY)).toBe(30)
  })

  it('returns a null watermark and writes nothing on an empty catalog', async () => {
    await ensureLoaded()
    expect(await clearLastTracked()).toEqual({ cleared: true, watermark: null })
    const row = await rawGet(
      `SELECT value FROM catalog_index_meta WHERE key = ?`, [LAST_TRACKED_ATLAS_ID_KEY])
    expect(row).toBeUndefined()
  })

  it('leaves last_seen untouched even when it is higher', async () => {
    await ensureLoaded()
    await raw(`INSERT OR REPLACE INTO catalog_index_meta (key, value) VALUES (?, '999')`,
      [LAST_SEEN_ATLAS_ID_KEY])
    await insertAtlasRow(50)
    expect(await clearLastTracked()).toEqual({ cleared: true, watermark: 50 })
    expect(await readWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(999)
  })

  it('broadcasts last-tracked-cleared with the watermark it returns', async () => {
    await ensureLoaded()
    await insertAtlasRow(40)
    const returned = await clearLastTracked()
    const push = sentMessages.find((m) => m.channel === 'last-tracked-cleared')
    expect(push).toBeDefined()
    expect(push.payload).toBe(returned.watermark)
    expect(push.payload).toBe(40)
  })

  it('resolves { cleared: false } and sends no broadcast when the write fails', async () => {
    await ensureLoaded()
    // Seed atlas_data so advanceWatermark computes a non-null max and reaches setMeta.
    await raw(`INSERT OR IGNORE INTO atlas_data (atlas_id, title) VALUES (10, 'x')`)
    // Pre-seed the meta key so setMeta's ON CONFLICT DO UPDATE fires the trigger.
    await raw(`INSERT OR IGNORE INTO catalog_index_meta (key, value) VALUES (?, '0')`,
      [LAST_TRACKED_ATLAS_ID_KEY])
    // AFTER UPDATE on catalog_index_meta, the table setMeta actually writes to via
    // INSERT ... ON CONFLICT DO UPDATE; a trigger on atlas_data would never fire
    // because the handler only SELECTs from it.
    await raw(
      `CREATE TRIGGER IF NOT EXISTS boom AFTER UPDATE ON catalog_index_meta
       BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    )
    try {
      await expect(clearLastTracked()).resolves.toEqual({ cleared: false })
      expect(sentMessages.find((m) => m.channel === 'last-tracked-cleared')).toBeUndefined()
    } finally {
      await raw('DROP TRIGGER IF EXISTS boom')
    }
  })
})

// Text guards (search-fields.test.js:240-245 style): check-ipc-channels.js only
// counts a channel as handled when its name appears in electron/ outside
// preload, so the handler and the preload binding must spell it exactly.
describe('channel and preload names', () => {
  it('the handler registers the clear-last-tracked channel', () => {
    const src = fs.readFileSync(path.join('electron', 'ipc', 'games.js'), 'utf8')
    expect(src).toContain("ipcMain.handle('clear-last-tracked'")
  })

  it('the preload exposes clearLastTracked over that channel', () => {
    const src = fs.readFileSync(path.join('electron', 'preload.js'), 'utf8')
    expect(src).toContain('clearLastTracked: () => ipcRenderer.invoke("clear-last-tracked")')
  })
})