import { test, expect, beforeEach } from 'vitest'
const sqlite3 = require('sqlite3').verbose()
const dbIndex = require('../electron/db/index.js')
const tagOverrides = require('../electron/db/tagOverrides.js')

let db
const run = (sql) => new Promise((res, rej) => db.run(sql, (e) => (e ? rej(e) : res())))
const one = (sql) => new Promise((res) => db.get(sql, (e, row) => res(row)))

beforeEach(async () => {
  db = new sqlite3.Database(':memory:')
  Object.defineProperty(dbIndex, 'db', { get: () => db, configurable: true })
  await run(`CREATE TABLE games (record_id INTEGER PRIMARY KEY, title TEXT)`)
  await run(`CREATE TABLE game_metadata_overrides (record_id INTEGER PRIMARY KEY, tags TEXT, updated_at INTEGER)`)
  await run(`CREATE TABLE atlas_mappings (record_id INTEGER, atlas_id INTEGER)`)
  await run(`CREATE TABLE atlas_data (atlas_id INTEGER, tags TEXT)`)
  await run(`CREATE TABLE f95_zone_data (atlas_id INTEGER, tags TEXT)`)
  await run(`CREATE TABLE lewdcorner_mappings (record_id INTEGER, lc_id INTEGER)`)
  await run(`CREATE TABLE lewdcorner_data (lc_id INTEGER, atlas_id INTEGER, tags TEXT)`)
  await run(`INSERT INTO games VALUES (1,'G1')`)
  await run(`INSERT INTO atlas_mappings VALUES (1, 10)`)
  await run(`INSERT INTO atlas_data VALUES (10, '3dcg, adventure, fantasy')`)
})

test('an un-overridden game inherits the catalog tags', async () => {
  const state = await tagOverrides.getTagState(1)
  expect(state.overridden).toBe(false)
  expect(state.tags).toEqual(['3dcg', 'adventure', 'fantasy'])
})

test('a user can add and remove tags in one edit', async () => {
  await tagOverrides.setTagOverride(1, '3dcg, fantasy, my-custom-tag')
  const state = await tagOverrides.getTagState(1)
  expect(state.overridden).toBe(true)
  expect(state.tags).toEqual(['3dcg', 'fantasy', 'my-custom-tag'])
  expect(state.added).toEqual(['my-custom-tag'])
  expect(state.removed).toEqual(['adventure'])
})

test('the catalog table is never written to', async () => {
  await tagOverrides.setTagOverride(1, 'nothing, like, the, original')
  const row = await one('SELECT tags FROM atlas_data WHERE atlas_id = 10')
  expect(row.tags).toBe('3dcg, adventure, fantasy')
})

// NULL and '' must stay distinct. Collapsing them means an empty list falls
// back to the catalog and clearing every tag looks like the edit was ignored.
test('clearing every tag is distinct from not being overridden', async () => {
  await tagOverrides.setTagOverride(1, '')
  const state = await tagOverrides.getTagState(1)
  expect(state.overridden).toBe(true)
  expect(state.tags).toEqual([])
  expect(state.removed).toEqual(['3dcg', 'adventure', 'fantasy'])
})

test('reset restores the catalog list exactly', async () => {
  await tagOverrides.setTagOverride(1, 'only-mine')
  await tagOverrides.clearTagOverride(1)
  const state = await tagOverrides.getTagState(1)
  expect(state.overridden).toBe(false)
  expect(state.tags).toEqual(['3dcg', 'adventure', 'fantasy'])
})

test('tags are split on , ; and | and de-duplicated case-insensitively', async () => {
  await tagOverrides.setTagOverride(1, 'A, a ,B;C|D,,B')
  expect((await tagOverrides.getTagState(1)).tags).toEqual(['A', 'B', 'C', 'D'])
})

// Sources are UNIONED, not ranked. Previously a COALESCE returned only the
// first non-empty source, so a game matched on both F95 and LewdCorner showed
// only the F95 list and dropped LewdCorner-only tags — and disagreed with the
// read-only display in GameDetailPage, which was already merging all three.
test('every catalog source is merged, not ranked', async () => {
  await run(`INSERT INTO f95_zone_data VALUES (10, 'f95-only')`)
  await run(`INSERT INTO lewdcorner_data VALUES (99, 10, 'lc-only')`)
  const tags = await tagOverrides.getCatalogTags(1)
  expect(tags).toContain('3dcg')      // atlas
  expect(tags).toContain('f95-only')
  expect(tags).toContain('lc-only')
})

test('overlapping tags across sources collapse case-insensitively', async () => {
  await run(`INSERT INTO f95_zone_data VALUES (10, 'ADVENTURE, f95-only')`)
  await run(`INSERT INTO lewdcorner_data VALUES (99, 10, 'Adventure')`)
  const tags = await tagOverrides.getCatalogTags(1)
  // 'adventure' is already on atlas_data for this record.
  expect(tags.filter((t) => t.toLowerCase() === 'adventure')).toHaveLength(1)
})

test("a record's own LewdCorner mapping is included", async () => {
  await run(`INSERT INTO games VALUES (3,'LC direct')`)
  await run(`INSERT INTO lewdcorner_mappings VALUES (3, 55)`)
  await run(`INSERT INTO lewdcorner_data VALUES (55, NULL, 'lc-direct')`)
  expect(await tagOverrides.getCatalogTags(3)).toEqual(['lc-direct'])
})

// Unioning must not drop the sole source on records that only match atlas.
test('atlas-only records keep their tags', async () => {
  expect(await tagOverrides.getCatalogTags(1)).toEqual(['3dcg', 'adventure', 'fantasy'])
})

test('reset restores the merged list, not just one source', async () => {
  await run(`INSERT INTO f95_zone_data VALUES (10, 'f95-only')`)
  await tagOverrides.setTagOverride(1, 'mine')
  const restored = await tagOverrides.clearTagOverride(1)
  expect(restored).toContain('3dcg')
  expect(restored).toContain('f95-only')
})

test('a game with no catalog row resolves to an empty list', async () => {
  await run(`INSERT INTO games VALUES (2,'G2')`)
  expect(await tagOverrides.getCatalogTags(2)).toEqual([])
  expect((await tagOverrides.getTagState(2)).overridden).toBe(false)
})

// ── Autocomplete source and bulk editing ────────────────────────────────────

test('known tags come from catalog, overrides and user tags, in use order', async () => {
  await run(`INSERT INTO games VALUES (2,'G2')`)
  await run(`INSERT INTO atlas_mappings VALUES (2, 20)`)
  await run(`INSERT INTO atlas_data VALUES (20, '3dcg, fantasy')`)
  await tagOverrides.setTagOverride(1, '3dcg, my-own-tag')

  const known = await tagOverrides.getKnownTags()
  // 3dcg appears in two catalog rows plus an override, so it leads.
  expect(known[0]).toBe('3dcg')
  expect(known).toContain('my-own-tag')
  expect(known).toContain('fantasy')
  // Case-insensitive keying, first spelling wins — no '3DCG' duplicate.
  expect(known.filter((t) => t.toLowerCase() === '3dcg')).toHaveLength(1)
})

// Bulk editing must apply add/remove to each record's OWN list. Sharing one
// snapshot across a collection would flatten every game onto identical tags.
test('bulk editing preserves each record its own list', async () => {
  await run(`INSERT INTO games VALUES (2,'G2')`)
  await run(`INSERT INTO atlas_mappings VALUES (2, 20)`)
  await run(`INSERT INTO atlas_data VALUES (20, '2dcg, fantasy')`)

  const result = await tagOverrides.bulkEditTags([1, 2], { add: ['starred'], remove: ['3dcg'] })
  expect(result.success).toBe(true)
  expect(result.changed).toBe(2)

  expect((await tagOverrides.getTagState(1)).tags).toEqual(['adventure', 'fantasy', 'starred'])
  expect((await tagOverrides.getTagState(2)).tags).toEqual(['2dcg', 'fantasy', 'starred'])
})

test('re-running the same bulk edit changes nothing', async () => {
  await tagOverrides.bulkEditTags([1], { add: ['starred'] })
  const second = await tagOverrides.bulkEditTags([1], { add: ['starred'] })
  expect(second.changed).toBe(0)
  expect(second.skipped).toBe(1)
})

// An override suppresses future catalog refreshes, so bulk editing must not
// create one on a record it did not actually change.
test('a no-op bulk edit does not create an override', async () => {
  const result = await tagOverrides.bulkEditTags([1], { remove: ['not-present-anywhere'] })
  expect(result.changed).toBe(0)
  expect((await tagOverrides.getTagState(1)).overridden).toBe(false)
})

test('an empty bulk edit is rejected', async () => {
  expect((await tagOverrides.bulkEditTags([1], {})).success).toBe(false)
})
