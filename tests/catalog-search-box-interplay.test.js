import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'os'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const { buildIndexWhere, queryCatalogIndex, ensureCatalogIndexSchema } = require_('../electron/db/catalogIndex.js')
const dbIndex = require_('../electron/db/index.js')

describe('Search Box vs. Tag Filter Isolation', () => {
  it('free-text search and sidebar exclude coexist; exclude is exact-token', () => {
    const { where, params } = buildIndexWhere(
      { text: 'proto', fields: ['tags'] },
      { excludedTags: ['male protagonist'] },
    )
    expect(where).toContain('ci.tags_text')
    expect(where).toContain('catalog_index_tags')
    expect(where).toContain('cit.tag')
    expect(where).toContain('NOT EXISTS')
    expect(params).toContain('male protagonist')
  })

  it('field-specific prefix f95: still reaches the id column', () => {
    const { where } = buildIndexWhere({ text: 'f95:99999' }, {})
    expect(where).toContain('f95_id')
  })

  it('free-text "protagonist" on tags still returns both Male/Female Protagonist (behavioural)', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-interplay-'))
    dbIndex.initializeDatabase(dataDir)
    await ensureCatalogIndexSchema()
    const raw = (sql, p = []) => new Promise((res, rej) => dbIndex.db.all(sql, p, (e, r) => (e ? rej(e) : res(r))))
    await raw(`DELETE FROM catalog_index`)
    await raw(`DELETE FROM catalog_index_tags`)
    await raw(`INSERT INTO catalog_index (catalog_key, record_id, source, title, tags_text, tags_filter, thread_updated_tier, thread_updated_ms, thread_publish_tier, thread_publish_ms, release_date_tier, release_date_ms) VALUES ('catalog:10','10','atlas','Game A','male protagonist','male protagonist',2,NULL,2,NULL,2,NULL)`)
    await raw(`INSERT INTO catalog_index_tags (catalog_key, tag) VALUES ('catalog:10', 'male protagonist')`)
    await raw(`INSERT INTO catalog_index (catalog_key, record_id, source, title, tags_text, tags_filter, thread_updated_tier, thread_updated_ms, thread_publish_tier, thread_publish_ms, release_date_tier, release_date_ms) VALUES ('catalog:11','11','atlas','Game B','female protagonist','female protagonist',2,NULL,2,NULL,2,NULL)`)
    await raw(`INSERT INTO catalog_index_tags (catalog_key, tag) VALUES ('catalog:11', 'female protagonist')`)
    await raw(`INSERT INTO catalog_index (catalog_key, record_id, source, title, tags_text, tags_filter, thread_updated_tier, thread_updated_ms, thread_publish_tier, thread_publish_ms, release_date_tier, release_date_ms) VALUES ('catalog:12','12','atlas','Game C','other','other',2,NULL,2,NULL,2,NULL)`)
    await raw(`INSERT INTO catalog_index_tags (catalog_key, tag) VALUES ('catalog:12', 'other')`)
    const res = await queryCatalogIndex({ search: { text: 'protagonist', fields: ['tags'] }, filters: {}, limit: 10 })
    expect(res.keys).toContain('catalog:10')
    expect(res.keys).toContain('catalog:11')
    expect(res.keys).not.toContain('catalog:12')
    // exact-token exclude keeps the non-matching protagonist
    const excl = await queryCatalogIndex({ search: { text: 'protagonist', fields: ['tags'] }, filters: { excludedTags: ['male protagonist'] }, limit: 10 })
    expect(excl.keys).not.toContain('catalog:10')
    expect(excl.keys).toContain('catalog:11')
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {}
  })
})
