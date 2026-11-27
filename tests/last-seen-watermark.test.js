import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const dbIndex = require_('../electron/db/index.js')
const {
  ensureCatalogIndexSchema, rebuildCatalogIndex,
  LAST_SEEN_ATLAS_ID_KEY, LAST_TRACKED_ATLAS_ID_KEY, readWatermark, advanceWatermark,
  bootstrapLastSeenWatermarks,
} = require_('../electron/db/catalogIndex.js')

let dataDir, secondDataDir
beforeAll(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-watermark-')) })
afterAll(() => {
  for (const dir of [dataDir, secondDataDir]) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
})
const raw = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.all(sql, params, (e, r) => (e ? rej(e) : res(r))))
const rawGet = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.get(sql, params, (e, r) => (e ? rej(e) : res(r))))

// Seeds atlas_data, the table the watermark now reads its maximum from;
// catalog_index is derived, so a rebuild rebuilds it from these rows.
const insertAtlasRow = (atlasId) =>
  raw(`INSERT OR REPLACE INTO atlas_data (atlas_id, title, category) VALUES (?, ?, 'Games')`,
    [atlasId, `Game ${atlasId}`])

describe('last-seen watermark', () => {
  it('reads as null on a fresh database', async () => {
    dbIndex.initializeDatabase(dataDir)
    await ensureCatalogIndexSchema()
    expect(await readWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(null)
  })

  it('advance on a fresh catalog returns null and never writes 0', async () => {
    dbIndex.initializeDatabase(dataDir)
    await ensureCatalogIndexSchema()
    expect(await advanceWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(null)
    const row = await rawGet(`SELECT value FROM catalog_index_meta WHERE key = ?`, [LAST_SEEN_ATLAS_ID_KEY])
    expect(row).toBeUndefined()
  })

  it('advance raises to the catalog maximum', async () => {
    await insertAtlasRow(10)
    await insertAtlasRow(20)
    expect(await advanceWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(20)
    expect(await readWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(20)
  })

  it('never lowers the watermark when the maximum drops', async () => {
    await raw(`DELETE FROM atlas_data WHERE atlas_id = 20`)
    expect(await advanceWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(20)
    expect(await readWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(20)
  })

  it('a rebuild against a lower-max catalog cannot reset it', async () => {
    await raw(`DELETE FROM atlas_data`)
    await raw(`INSERT OR REPLACE INTO atlas_data (atlas_id, title, category) VALUES (10, 'Lower', 'Games')`)
    await rebuildCatalogIndex()
    expect(await readWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(20)
  })

  // The watermark takes its maximum from atlas_data, which a rebuild never
  // empties, not catalog_index, which it deletes and refills. A high row with no
  // index row yet must still lift the watermark; pointing the read at the index
  // makes this a no-op and leaves the watermark behind.
  it('reads the maximum from atlas_data even with no matching index row', async () => {
    await raw(`DELETE FROM catalog_index`)
    await raw(`DELETE FROM atlas_data`)
    await raw(`DELETE FROM catalog_index_meta WHERE key = ?`, [LAST_SEEN_ATLAS_ID_KEY])
    await raw(`INSERT INTO atlas_data (atlas_id, title, category) VALUES (?, 'High', 'Games')`, [999])
    expect(await advanceWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(999)
    expect(await readWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(999)
  })

  it('reads a non-numeric or empty stored value as null', async () => {
    await raw(`INSERT OR REPLACE INTO catalog_index_meta (key, value) VALUES (?, 'not-a-number')`,
      [LAST_TRACKED_ATLAS_ID_KEY])
    expect(await readWatermark(LAST_TRACKED_ATLAS_ID_KEY)).toBe(null)
    await raw(`INSERT OR REPLACE INTO catalog_index_meta (key, value) VALUES (?, '')`,
      [LAST_TRACKED_ATLAS_ID_KEY])
    expect(await readWatermark(LAST_TRACKED_ATLAS_ID_KEY)).toBe(null)
  })

  // bootstrapLastSeenWatermarks cases start from an explicit state, since the
  // cases above left the shared database carrying keys and rows.
  const resetWatermarkState = async () => {
    await ensureCatalogIndexSchema()
    await raw(`DELETE FROM catalog_index`)
    await raw(`DELETE FROM atlas_data`)
    await raw(`DELETE FROM catalog_index_meta WHERE key IN (?, ?)`, [LAST_SEEN_ATLAS_ID_KEY, LAST_TRACKED_ATLAS_ID_KEY])
  }
  it('bootstrap: empty catalog leaves both null and writes no keys', async () => {
    await resetWatermarkState()
    const res = await bootstrapLastSeenWatermarks()
    expect(res).toEqual({ seen: null, tracked: null })
    expect(await rawGet(`SELECT value FROM catalog_index_meta WHERE key = ?`, [LAST_SEEN_ATLAS_ID_KEY])).toBeUndefined()
    expect(await rawGet(`SELECT value FROM catalog_index_meta WHERE key = ?`, [LAST_TRACKED_ATLAS_ID_KEY])).toBeUndefined()
  })

  it('bootstrap: catalog max 20 with no keys raises both to 20', async () => {
    await resetWatermarkState()
    await insertAtlasRow(20)
    expect(await bootstrapLastSeenWatermarks()).toEqual({ seen: 20, tracked: 20 })
  })

  it('bootstrap: a relaunch lifts seen but never moves an already-set tracked', async () => {
    await resetWatermarkState()
    await insertAtlasRow(20)
    await bootstrapLastSeenWatermarks()
    await insertAtlasRow(30)
    expect(await bootstrapLastSeenWatermarks()).toEqual({ seen: 30, tracked: 20 })
  })

  // Pins the transaction wrapper: RAISE(FAIL) leaves the row the failing
  // statement wrote, so without it the watermark survives the failure.
  it('rolls the watermark back when a write fails mid-transaction', async () => {
    await raw(`DELETE FROM catalog_index_meta WHERE key = ?`, [LAST_SEEN_ATLAS_ID_KEY])
    await raw(`DELETE FROM atlas_data`)
    await raw(`INSERT INTO atlas_data (atlas_id, title, category) VALUES (?, 'Boom', 'Games')`, [424])
    await raw(`CREATE TRIGGER wm_boom AFTER INSERT ON catalog_index_meta
               BEGIN SELECT RAISE(FAIL, 'boom'); END`)
    let failed = false
    try {
      const result = await advanceWatermark(LAST_SEEN_ATLAS_ID_KEY)
      failed = !result
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(await rawGet(`SELECT value FROM catalog_index_meta WHERE key = ?`,
      [LAST_SEEN_ATLAS_ID_KEY])).toBeUndefined()
    await raw(`DROP TRIGGER wm_boom`)
  })

  // Last: repoints the shared connection at a fresh database, so nothing using
  // dataDir may run after it. Boot creates the catalog tables itself, so the
  // schema is dropped first to measure only what a read rebuilds on its own;
  // the removed schema build recreated catalog_index on every read.
  it('a plain read never creates the index schema', async () => {
    secondDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-watermark-bare-'))
    dbIndex.initializeDatabase(secondDataDir)
    expect(await readWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(null)
    await raw(`DROP TABLE IF EXISTS catalog_index`)
    await raw(`DROP TABLE IF EXISTS catalog_index_meta`)
    expect(await readWatermark(LAST_SEEN_ATLAS_ID_KEY)).toBe(null)
    const table = await rawGet(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catalog_index'`)
    expect(table).toBeUndefined()
  })
})

// The smoke test never resolves whenReady, so nothing in the ready body runs
// there; pin the call site the cheap way instead — the watermark bootstrap must
// be wired into startup ahead of the main window.
test('main.js boots the watermarks before creating the window', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const boot = source.indexOf('bootstrapLastSeenWatermarks()')
  const readyWindow = source.indexOf('createWindow()\n  // The main window exists')
  expect(boot).toBeGreaterThan(-1)
  expect(readyWindow).toBeGreaterThan(boot)
})
