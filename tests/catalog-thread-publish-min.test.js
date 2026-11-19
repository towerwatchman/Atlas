// thread_publish_ms is the F95 thread_publish_date, falling back to the LC
// register_date only when the game has no F95 date. The renderer (useFilters)
// does the same, so both sides of a Thread Published range agree.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const dbIndex = require_('../electron/db/index.js')
const {
  ensureCatalogIndexSchema, rebuildCatalogIndex,
  buildIndexOrderBy, parseDateToMs, CATALOG_INDEX_INDEXES,
} = require_('../electron/db/catalogIndex.js')

let dataDir
beforeAll(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-tp-min-')) })
afterAll(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {} })
const raw = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.all(sql, params, (e, r) => (e ? rej(e) : res(r))))
const rawGet = (sql, params = []) => new Promise((res, rej) =>
  dbIndex.db.get(sql, params, (e, r) => (e ? rej(e) : res(r))))

describe('catalog_index thread_publish_ms = F95 date, LC register date as fallback', () => {
  it('both dates present: the F95 date wins, not the older LC register date', async () => {
    dbIndex.initializeDatabase(dataDir)
    await ensureCatalogIndexSchema()
    await raw(`INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, engine)
               VALUES (?, ?, ?, ?)`, [99001, 'Cross Board', 'DualDev', 'RenPy'])
    await raw(`INSERT OR REPLACE INTO f95_zone_data
               (f95_id, atlas_id, thread_publish_date, thread_updated)
               VALUES (?, ?, ?, ?)`, [50001, 99001, '2024-03-15', '2025-06-01'])
    await raw(`INSERT OR REPLACE INTO lewdcorner_data
               (lc_id, atlas_id, register_date, thread_updated)
               VALUES (?, ?, ?, ?)`, [60001, 99001, '2023-01-20', '2024-11-10'])
    await rebuildCatalogIndex()
    const row = await rawGet(
      `SELECT thread_publish_ms FROM catalog_index WHERE catalog_key = 'atlas:99001'`)
    expect(row).toBeDefined()
    expect(row.thread_publish_ms).toBe(parseDateToMs('2024-03-15'))
  })

  it('only F95 present: use the F95 date', async () => {
    await raw(`INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, engine)
               VALUES (?, ?, ?, ?)`, [99002, 'F95 Only', 'SoloDev', 'RenPy'])
    await raw(`INSERT OR REPLACE INTO f95_zone_data
               (f95_id, atlas_id, thread_publish_date, thread_updated)
               VALUES (?, ?, ?, ?)`, [50002, 99002, '2024-07-04', '2025-01-01'])
    await rebuildCatalogIndex()
    const row = await rawGet(
      `SELECT thread_publish_ms FROM catalog_index WHERE catalog_key = 'atlas:99002'`)
    expect(row).toBeDefined()
    expect(row.thread_publish_ms).toBe(parseDateToMs('2024-07-04'))
  })

  it('only LC present (F95 row with NULL date): use the LC date', async () => {
    await raw(`INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, engine)
               VALUES (?, ?, ?, ?)`, [99003, 'LC Only', 'SoloDev', 'RenPy'])
    await raw(`INSERT OR REPLACE INTO f95_zone_data
               (f95_id, atlas_id, thread_publish_date, thread_updated)
               VALUES (?, ?, ?, ?)`, [50003, 99003, null, '2024-11-10'])
    await raw(`INSERT OR REPLACE INTO lewdcorner_data
               (lc_id, atlas_id, register_date, thread_updated)
               VALUES (?, ?, ?, ?)`, [60003, 99003, '2022-09-08', '2024-11-10'])
    await rebuildCatalogIndex()
    const row = await rawGet(
      `SELECT thread_publish_ms FROM catalog_index WHERE catalog_key = 'atlas:99003'`)
    expect(row).toBeDefined()
    expect(row.thread_publish_ms).toBe(parseDateToMs('2022-09-08'))
  })

  it('neither date: ms is NULL and tier is 2', async () => {
    await raw(`INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, engine)
               VALUES (?, ?, ?, ?)`, [99004, 'No Dates', 'SoloDev', 'RenPy'])
    await rebuildCatalogIndex()
    const row = await rawGet(
      `SELECT thread_publish_ms, thread_publish_tier FROM catalog_index WHERE catalog_key = 'atlas:99004'`)
    expect(row).toBeDefined()
    expect(row.thread_publish_ms).toBeNull()
    expect(row.thread_publish_tier).toBe(2)
  })

  it('New Releases DESC orders by atlas_id, ASC pushes NULLs last', () => {
    expect(buildIndexOrderBy({ browseSort: 'newReleaseDesc' }))
      .toMatch(/^ORDER BY ci\.atlas_id DESC, ci\.title COLLATE NOCASE ASC, ci\.catalog_key ASC$/)
    expect(buildIndexOrderBy({ browseSort: 'newReleaseAsc' }))
      .toMatch(/CASE WHEN ci\.atlas_id IS NULL THEN 1 ELSE 0 END ASC, ci\.atlas_id ASC/)
    expect(buildIndexOrderBy({ browseSort: 'threadUpdatedDesc' }))
      .toMatch(/ci\.title COLLATE NOCASE ASC, ci\.catalog_key ASC$/)
  })

  it('retired releaseDate aliases resolve to the same ORDER BY as newRelease', () => {
    expect(buildIndexOrderBy({ browseSort: 'releaseDateDesc' }))
      .toBe(buildIndexOrderBy({ browseSort: 'newReleaseDesc' }))
    expect(buildIndexOrderBy({ browseSort: 'releaseDateAsc' }))
      .toBe(buildIndexOrderBy({ browseSort: 'newReleaseAsc' }))
  })

  it('New Releases DESC plan reads straight from the atlas_id index, no temp sort', async () => {
    await rebuildCatalogIndex()
    const plan = await raw(
      `EXPLAIN QUERY PLAN SELECT * FROM catalog_index
       ORDER BY atlas_id DESC, title COLLATE NOCASE ASC, catalog_key ASC
       LIMIT 60`)
    const details = plan.map((r) => r.detail).join('\n')
    // eslint-disable-next-line no-console
    console.log('DESC plan:\n' + details)
    expect(details).toMatch(/idx_catalog_index_atlas_id/)
    expect(details).not.toMatch(/TEMP B-TREE/)
  })

  it('New Releases ASC falls back to a temp sort (DESC index cannot serve it)', async () => {
    const plan = await raw(
      `EXPLAIN QUERY PLAN SELECT * FROM catalog_index
       ORDER BY CASE WHEN atlas_id IS NULL THEN 1 ELSE 0 END ASC, atlas_id ASC, title COLLATE NOCASE ASC, catalog_key ASC
       LIMIT 60`)
    const details = plan.map((r) => r.detail).join('\n')
    // eslint-disable-next-line no-console
    console.log('ASC plan:\n' + details)
    // shortcut: ascending New Releases sorts the whole table in a temp B-tree.
    // Add a (atlas_id ASC, ...) index once ascending pages get slow; this
    // assertion is meant to flip when that happens.
    expect(details).toMatch(/USE TEMP B-TREE FOR ORDER BY/)
  })

  it('index list has thread_publish_v2 over title/catalog_key, plus the atlas_id index', () => {
    const create = CATALOG_INDEX_INDEXES.find(
      (sql) => /CREATE INDEX IF NOT EXISTS idx_catalog_index_thread_publish_v2\b/.test(sql)
        && /title COLLATE NOCASE, catalog_key/.test(sql))
    expect(create).toBeDefined()
    const atlasId = CATALOG_INDEX_INDEXES.find(
      (sql) => /CREATE INDEX IF NOT EXISTS idx_catalog_index_atlas_id/.test(sql))
    expect(atlasId).toBeDefined()
  })
})
