import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'os'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const dbIndex = require_('../electron/db/index.js')
const {
  CATALOG_INDEX_VERSION, ensureCatalogIndexSchema, getCatalogIndexStatus,
  rebuildCatalogIndex, queryCatalogIndex, refreshCatalogIndexForAtlasIds,
} = require_('../electron/db/catalogIndex.js')
const { indexColumnsForSearchFieldIds } = require_('../electron/db/searchFields.js')

let dataDir
beforeAll(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-tag-filter-')) })
afterAll(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {} })
const raw = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.all(sql, params, (e, r) => (e ? rej(e) : res(r))))
const rawGet = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.get(sql, params, (e, r) => (e ? rej(e) : res(r))))

describe('Database Lifecycle & Migration Suite', () => {
  it('tags_filter is added by the ADD-COLUMN migration on an existing v5 install', async () => {
    dbIndex.initializeDatabase(dataDir)
    await raw(`DROP TABLE IF EXISTS catalog_index`)
    await raw(`CREATE TABLE catalog_index (catalog_key TEXT PRIMARY KEY, record_id TEXT, source TEXT, atlas_id INTEGER, steam_id INTEGER, gog_id INTEGER, lc_id INTEGER, f95_id INTEGER, local_record_id INTEGER, is_installed INTEGER, title TEXT, short_name TEXT, creator TEXT, engine TEXT, category TEXT, status TEXT, censored TEXT, language TEXT, tags_text TEXT, search_text TEXT, site_url TEXT, rating_best REAL, likes_best REAL, thread_updated_tier INTEGER, thread_updated_ms INTEGER, thread_publish_tier INTEGER, thread_publish_ms INTEGER, release_date_tier INTEGER, release_date_ms INTEGER, f95_latest_order REAL, has_steam_link INTEGER)`)
    await raw(`DROP TABLE IF EXISTS catalog_index_meta`)
    await raw(`CREATE TABLE catalog_index_meta (key TEXT PRIMARY KEY, value TEXT)`)
    await raw(`INSERT INTO catalog_index_meta (key, value) VALUES ('version', '5')`)
    await raw(`INSERT OR REPLACE INTO catalog_index_meta (key, value) VALUES ('stale', '0')`)
    await ensureCatalogIndexSchema()
    const cols = (await raw(`PRAGMA table_info(catalog_index)`)).map((c) => c.name)
    expect(cols).toContain('tags_filter')
    const tagTables = await raw(`SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_index_tags'`)
    expect(tagTables.length).toBe(1)
    const tagIdx = await raw(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_catalog_index_tags_tag'`)
    expect(tagIdx.length).toBe(1)
  })

  it('rebuild sets ready and bumps version 5 -> current', async () => {
    dbIndex.initializeDatabase(dataDir)
    await raw(`UPDATE catalog_index_meta SET value = '5' WHERE key = 'version'`)
    expect((await getCatalogIndexStatus()).ready).toBe(false)
    await rebuildCatalogIndex()
    const status = await getCatalogIndexStatus()
    expect(status.ready).toBe(true)
    const meta = await rawGet(`SELECT value FROM catalog_index_meta WHERE key = 'version'`)
    expect(meta.value).toBe(String(CATALOG_INDEX_VERSION))
  })

  it('queryCatalogIndex returns key strings only — tags_filter cannot leak', async () => {
    dbIndex.initializeDatabase(dataDir)
    await ensureCatalogIndexSchema()
    await raw(`INSERT INTO catalog_index (catalog_key, tags_filter, tags_text)
                VALUES ('catalog:1', 'female protagonist', 'female protagonist')`)
    await raw(`INSERT OR IGNORE INTO catalog_index_tags (catalog_key, tag) VALUES ('catalog:1', 'female protagonist')`)
    const res = await queryCatalogIndex({ limit: 1 })
    expect(Array.isArray(res.keys)).toBe(true)
    expect(res.keys).toContain('catalog:1')
    expect(res).not.toHaveProperty('tags_filter')
    expect(res).not.toHaveProperty('tags_text')
  })

  it('tags_text is still built by joinText (byte-identical contract)', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'db', 'catalogIndex.js'), 'utf8')
    expect(source).toMatch(/joinText\([^)]*atlas_tags[^)]*f95_tags[^)]*lc_tags[^)]*lc_prefixes[^)]*\)/)
    expect(source).toMatch(/buildTagsFilterValue\(/)
  })

  it('tags_filter is filter-only — not in searchFields registry (AC4)', () => {
    expect(indexColumnsForSearchFieldIds(['tags'])).not.toContain('tags_filter')
    expect(indexColumnsForSearchFieldIds(['tags'])).toEqual(['tags_text'])
  })

  it('refreshCatalogIndexForAtlasIds populates tags_filter and tags table for incremental refresh', async () => {
    dbIndex.initializeDatabase(dataDir)
    await ensureCatalogIndexSchema()
    // Seed minimal atlas_data row
    await raw(`INSERT OR REPLACE INTO atlas_data (atlas_id, title, tags, category) VALUES (99991, 'Refresh Test', 'alpha, beta', 'Games')`)
    await raw(`DELETE FROM catalog_index WHERE catalog_key = 'atlas:99991'`)
    await raw(`DELETE FROM catalog_index_tags WHERE catalog_key = 'atlas:99991'`)
    const before = await raw(`SELECT catalog_key FROM catalog_index WHERE catalog_key = 'atlas:99991'`)
    expect(before.length).toBe(0)
    const res = await refreshCatalogIndexForAtlasIds([99991])
    expect(res.refreshed).toBe(1)
    const row = await rawGet(`SELECT tags_filter, tags_text FROM catalog_index WHERE catalog_key = 'atlas:99991'`)
    expect(row).toBeDefined()
    expect(row.tags_filter).toBe('alpha,beta')
    expect(row.tags_text).toBeDefined()
    const tags = await raw(`SELECT tag FROM catalog_index_tags WHERE catalog_key='atlas:99991' ORDER BY tag`)
    expect(tags.map(r=>r.tag)).toEqual(['alpha','beta'])
  })
})
