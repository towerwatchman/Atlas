// Contract for issue #365: catalog_index must store original_name so the
// Library fast path can search it. Fails until the column, its migration and
// its projection exist.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'os'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const dbIndex = require_('../electron/db/index.js')
const {
  ensureCatalogIndexSchema, rebuildCatalogIndex,
} = require_('../electron/db/catalogIndex.js')

let dataDir
beforeAll(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-orig-name-idx-')) })
afterAll(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {} })
const raw = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.all(sql, params, (e, r) => (e ? rej(e) : res(r))))
const rawGet = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.get(sql, params, (e, r) => (e ? rej(e) : res(r))))

describe('catalog_index carries original_name', () => {
  it('the schema has an original_name column', async () => {
    dbIndex.initializeDatabase(dataDir)
    await ensureCatalogIndexSchema()
    const cols = (await raw(`PRAGMA table_info(catalog_index)`)).map((c) => c.name)
    expect(cols).toContain('original_name')
  })

  it('original_name is added by the ADD-COLUMN migration on an older install', async () => {
    dbIndex.initializeDatabase(dataDir)
    await raw(`DROP TABLE IF EXISTS catalog_index`)
    // Shape of catalog_index before this change (no original_name).
    await raw(`CREATE TABLE catalog_index (catalog_key TEXT PRIMARY KEY, record_id TEXT, source TEXT, atlas_id INTEGER, steam_id INTEGER, gog_id INTEGER, lc_id INTEGER, f95_id INTEGER, local_record_id INTEGER, is_installed INTEGER, title TEXT, short_name TEXT, creator TEXT, engine TEXT, category TEXT, status TEXT, censored TEXT, language TEXT, tags_text TEXT, tags_filter TEXT, search_text TEXT, site_url TEXT, rating_best REAL, likes_best REAL, thread_updated_tier INTEGER, thread_updated_ms INTEGER, thread_publish_tier INTEGER, thread_publish_ms INTEGER, release_date_tier INTEGER, release_date_ms INTEGER, f95_latest_order REAL, has_steam_link INTEGER)`)
    await ensureCatalogIndexSchema()
    const cols = (await raw(`PRAGMA table_info(catalog_index)`)).map((c) => c.name)
    expect(cols).toContain('original_name')
  })

  it('a rebuild projects the atlas original_name into the index', async () => {
    dbIndex.initializeDatabase(dataDir)
    await raw(
      `INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, original_name)
       VALUES (?, ?, ?, ?)`,
      [88201, 'Paper Hearts Index', 'IndexDev', 'Ourlifexq Index'],
    )
    await rebuildCatalogIndex()
    const row = await rawGet(
      `SELECT original_name FROM catalog_index WHERE catalog_key = 'atlas:88201'`)
    expect(row).toBeDefined()
    expect(row.original_name).toBe('Ourlifexq Index')
  })
})
