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

test('catalog precedence falls through to f95 then lewdcorner', async () => {
  await run(`UPDATE atlas_data SET tags = '' WHERE atlas_id = 10`)
  await run(`INSERT INTO f95_zone_data VALUES (10, 'f95-tag')`)
  expect(await tagOverrides.getCatalogTags(1)).toEqual(['f95-tag'])
})

test('a game with no catalog row resolves to an empty list', async () => {
  await run(`INSERT INTO games VALUES (2,'G2')`)
  expect(await tagOverrides.getCatalogTags(2)).toEqual([])
  expect((await tagOverrides.getTagState(2)).overridden).toBe(false)
})
