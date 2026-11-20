import { describe, it, test, expect, beforeAll, afterAll } from 'vitest'

const fs = require('fs')
const os = require('os')
const path = require('path')

const dbIndex = require('../electron/db/index.js')
const { getCatalogGames } = require('../electron/db/versions.js')
const {
  buildIndexWhere,
  getCatalogIndexStatus,
  rebuildCatalogIndex,
} = require('../electron/db/catalogIndex.js')

// Browse "last seen" narrowing: filters.lastSeen of 'startup'/'tracked' limits a
// query to ATLAS ids above a watermark Main resolves and hands down as
// lastSeenFloor. Both query paths (catalog index + union fallback) must apply the
// same predicate. A floor that is absent or null means "unfiltered", never a
// false clause that empties the page.

describe('buildIndexWhere lastSeenFloor', () => {
  it('adds ci.atlas_id > ? with the floor as a bound param', () => {
    const { where, params } = buildIndexWhere({}, { lastSeen: 'startup', lastSeenFloor: 12345 })
    expect(where).toContain('ci.atlas_id > ?')
    expect(params).toContain(12345)
  })

  it('adds no clause when lastSeenFloor is absent', () => {
    const { where } = buildIndexWhere({}, { lastSeen: 'startup' })
    expect(where).not.toContain('ci.atlas_id > ?')
  })

  it('adds no clause when lastSeenFloor is null (no watermark means unfiltered)', () => {
    const { where } = buildIndexWhere({}, { lastSeen: 'startup', lastSeenFloor: null })
    expect(where).not.toContain('ci.atlas_id > ?')
  })

  it('adds no clause for a non-numeric lastSeenFloor', () => {
    const { where } = buildIndexWhere({}, { lastSeen: 'startup', lastSeenFloor: 'bogus' })
    expect(where).not.toContain('ci.atlas_id > ?')
  })
})

// getCatalogGamesFromUnion is not exported, so keep a text guard like the one in
// search-fields.test.js: the predicate must be driven by lastSeenFloor, not by an
// assumed name. It filters on the id each union row exposes (atlas rows carry it,
// steam/gog/lewdcorner rows are NULL and a plain > drops them).
test('the union path narrows the last-seen floor from catalog.atlas_id', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'db', 'versions.js'), 'utf8')
  expect(source).toContain('catalog.atlas_id > ?')
  expect(source).toContain('filters.lastSeenFloor')
})

// Shared fixture helpers. Each case opens its own empty data dir so a query path
// can be driven against a freshly seeded catalog, and every assertion checks the
// count that sizes the grid as well as the rows that render.
const dataDirs = []
const freshDataDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lastseen-'))
  dataDirs.push(dir)
  return dir
}
const run = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.run(sql, params, (err) => (err ? reject(err) : resolve()))
})
const all = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
})

// initializeDatabase queues its DDL behind the open callback, so the table is
// not there the instant the call returns.
const waitForCatalogIndex = async () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (dbIndex.db) {
      const rows = await all(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catalog_index'`).catch(() => [])
      if (rows.length === 1) return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('catalog_index was never created')
}

// The watermark lives under the key the mode resolves to, so the key is an
// argument: laying down different floors per mode catches a swapped key.
const setWatermark = (value, key = 'last_seen_atlas_id') => run(
  `INSERT INTO catalog_index_meta (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)])
const clearWatermark = (key = 'last_seen_atlas_id') =>
  run(`DELETE FROM catalog_index_meta WHERE key = ?`, [key])
const markStale = () => run(`INSERT INTO catalog_index_meta (key, value) VALUES ('stale', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`)

const browse = (lastSeen = 'startup') => getCatalogGames(os.tmpdir(), false, {
  offset: 0, limit: 250, includeTotal: true, filters: { lastSeen }, search: {},
})
const browseWith = (filters) => getCatalogGames(os.tmpdir(), false, {
  offset: 0, limit: 250, includeTotal: true, filters, search: {},
})
const atlasIds = (result) => result.games.map((game) => Number(game.atlas_id)).sort((a, b) => a - b)
// The atlas ids among rows that carry one; a source-only row has a null atlas_id,
// which atlasIds folds to 0, so this is what the unfiltered cases compare against.
const atlasPresentIds = (result) => result.games
  .filter((game) => game.atlas_id != null)
  .map((game) => Number(game.atlas_id)).sort((a, b) => a - b)
const nullAtlasRows = (result) => result.games.filter((game) => game.atlas_id == null)

afterAll(() => {
  for (const dir of dataDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

describe('getCatalogGames applies the resolved watermark to both paths', () => {
  beforeAll(async () => {
    dbIndex.initializeDatabase(freshDataDir())
    await waitForCatalogIndex()
    await run(`INSERT INTO atlas_data (atlas_id, title, creator) VALUES (10, 'Old', 'Dev')`)
    await run(`INSERT INTO atlas_data (atlas_id, title, creator) VALUES (20, 'New', 'Dev')`)
    await rebuildCatalogIndex()
  })

  test('a floor of 15 keeps only the row above it', async () => {
    expect((await getCatalogIndexStatus()).ready).toBe(true)
    await setWatermark(15)
    const result = await browse()
    expect(atlasIds(result)).toEqual([20])
    expect(result.total).toBe(1)
  })

  test('a floor above every id empties the page', async () => {
    await setWatermark(25)
    const result = await browse()
    expect(atlasIds(result)).toEqual([])
    expect(result.total).toBe(0)
  })

  test('no watermark means unfiltered: both rows come back', async () => {
    await clearWatermark()
    const result = await browse()
    expect(atlasIds(result)).toEqual([10, 20])
    expect(result.total).toBe(2)
  })

  // The two modes must read different keys: a floor of 15 under last_seen and 25
  // under last_tracked gives 'startup' the higher id and 'tracked' nothing. If the
  // mode resolved the wrong key both floors would come back identical.
  test("'startup' and 'tracked' resolve different watermark keys", async () => {
    await setWatermark(15, 'last_seen_atlas_id')
    await setWatermark(25, 'last_tracked_atlas_id')
    const seen = await browse('startup')
    expect(atlasIds(seen)).toEqual([20])
    expect(seen.total).toBe(1)
    const tracked = await browse('tracked')
    expect(atlasIds(tracked)).toEqual([])
    expect(tracked.total).toBe(0)
  })

  // Main narrows only for the two known modes. The renderer's normaliser is a
  // different process, so a stray string must not be mistaken for a floor.
  test('an unknown mode is unfiltered', async () => {
    const result = await browse('nonsense')
    expect(atlasIds(result)).toEqual([10, 20])
    expect(result.total).toBe(2)
  })
})

// The union fallback runs until the index is built; the index path runs after a
// rebuild. Driving the same seeded catalog through each and asserting identical
// results proves the predicate was appended to both statements, not just the one
// that happens to execute. Order matters: the rebuild cannot be undone in place.
describe('the union and index paths narrow the last-seen floor identically', () => {
  beforeAll(async () => {
    dbIndex.initializeDatabase(freshDataDir())
    await waitForCatalogIndex()
    await run(`INSERT INTO atlas_data (atlas_id, title, creator) VALUES (10, 'Old', 'Dev')`)
    await run(`INSERT INTO atlas_data (atlas_id, title, creator) VALUES (20, 'New', 'Dev')`)
    // A provider row with no atlas entry carries a null atlas id in both the index
    // projection and the union. With no floor it must show up, or its absence
    // under a floor would pass by omission rather than because > floor drops it.
    await run(`INSERT INTO steam_data (steam_id, title) VALUES (9001, 'Steam Only')`)
  })

  test('union path: a floor drops the low id and the source-only row', async () => {
    expect((await getCatalogIndexStatus()).ready).toBe(false)
    await setWatermark(15)
    const result = await browse()
    expect(atlasIds(result)).toEqual([20])
    expect(nullAtlasRows(result)).toEqual([])
    expect(result.total).toBe(1)
  })

  test('index path: identical rows and total after a rebuild', async () => {
    await rebuildCatalogIndex()
    expect((await getCatalogIndexStatus()).ready).toBe(true)
    const result = await browse()
    expect(atlasIds(result)).toEqual([20])
    expect(nullAtlasRows(result)).toEqual([])
    expect(result.total).toBe(1)
  })

  test('union path: with no floor the source-only row shows', async () => {
    await clearWatermark()
    await rebuildCatalogIndex()
    // Start from a not-ready index again so the unfiltered case is exercised on
    // the union too: mark it stale, which flips ready without rebuilding.
    await run(`INSERT INTO catalog_index_meta (key, value) VALUES ('stale', '1')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    expect((await getCatalogIndexStatus()).ready).toBe(false)
    const union = await browse()
    expect(atlasPresentIds(union)).toEqual([10, 20])
    expect(nullAtlasRows(union).length).toBe(1)
    expect(union.total).toBe(3)
  })

  test('index path: identical unfiltered result', async () => {
    await run(`DELETE FROM catalog_index_meta WHERE key = 'stale'`)
    expect((await getCatalogIndexStatus()).ready).toBe(true)
    const result = await browse()
    expect(atlasPresentIds(result)).toEqual([10, 20])
    expect(nullAtlasRows(result).length).toBe(1)
    expect(result.total).toBe(3)
  })

  // A lastSeenFloor that reaches main without a mode (only a hand-built filters
  // object can carry one) must not narrow the query, so it is dropped here.
  test('index path: a stray floor with no mode is unfiltered', async () => {
    const result = await browseWith({ lastSeenFloor: 15 })
    expect(atlasPresentIds(result)).toEqual([10, 20])
    expect(nullAtlasRows(result).length).toBe(1)
    expect(result.total).toBe(3)
  })

  test('union path: a stray floor with no mode is unfiltered', async () => {
    await markStale()
    expect((await getCatalogIndexStatus()).ready).toBe(false)
    const result = await browseWith({ lastSeenFloor: 15 })
    expect(atlasPresentIds(result)).toEqual([10, 20])
    expect(nullAtlasRows(result).length).toBe(1)
    expect(result.total).toBe(3)
    await run(`DELETE FROM catalog_index_meta WHERE key = 'stale'`)
  })
})
