import { describe, test, expect, beforeAll, afterAll } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')

const dbIndex = require('../electron/db/index.js')
const {
  addBlacklistEntry,
  removeBlacklistEntry,
  getBlacklistEntries,
} = require('../electron/db/blacklist.js')
const { addWishlistEntry, isWishlistEntry } = require('../electron/db/wishlist.js')
const { getCatalogGames } = require('../electron/db/versions.js')
const { getCatalogIndexStatus, rebuildCatalogIndex } = require('../electron/db/catalogIndex.js')

// ── Browse blacklist ─────────────────────────────────────────────────────────
//
// Driven against a real sqlite file because the parts that matter are the
// schema, the upsert, and above all the WHERE clause both Browse query paths
// share. The exclusion has to sit in the SQL rather than on the fetched page,
// or the total that sizes the grid counts rows that never render -- so every
// catalog test here checks the total as well as the rows.

const run = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.run(sql, params, (err) => (err ? reject(err) : resolve()))
})
const all = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
})

// initializeDatabase queues its DDL behind the open callback, so the table is
// not there the instant the call returns.
const waitForBlacklistTable = async () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (dbIndex.db) {
      const rows = await all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blacklist_entries'`)
        .catch(() => [])
      if (rows.length === 1) return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('blacklist_entries was never created')
}

const openDatabase = async (dataDir) => {
  dbIndex.initializeDatabase(dataDir)
  await waitForBlacklistTable()
}

const dataDirs = []
const freshDataDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-blacklist-'))
  dataDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dataDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

describe('blacklist storage', () => {
  beforeAll(async () => {
    await openDatabase(freshDataDir())
  })

  test('an added title is listed, and removing it by the listed row clears it', async () => {
    const result = await addBlacklistEntry({ f95_id: 4101, title: 'Unwanted', creator: 'Someone' })
    expect(result).toMatchObject({ success: true, isBlacklisted: true, identityKey: 'f95:4101' })

    const entries = await getBlacklistEntries()
    const entry = entries.find((row) => row.identity_key === 'f95:4101')
    expect(entry).toMatchObject({ f95_id: 4101, title: 'Unwanted', creator: 'Someone', source: 'f95' })

    const removed = await removeBlacklistEntry(entry)
    expect(removed).toMatchObject({ success: true, removed: true })
    expect((await getBlacklistEntries()).some((row) => row.identity_key === 'f95:4101')).toBe(false)
  })

  test('blacklisting the same title twice keeps one row', async () => {
    await addBlacklistEntry({ atlas_id: 4201, title: 'Twice' })
    await addBlacklistEntry({ atlas_id: 4201, title: 'Twice' })
    const rows = (await getBlacklistEntries()).filter((row) => row.identity_key === 'atlas:4201')
    expect(rows).toHaveLength(1)
  })

  test('a GOG-only row is keyed and matched by its gog id, not by title', async () => {
    // The wishlist key has no gog form; without the id the SQL exclusion could
    // never match a GOG tile.
    const result = await addBlacklistEntry({ source: 'gog', gog_id: 4301, title: 'Store Game' })
    expect(result.identityKey).toBe('gog:4301')
    const row = (await getBlacklistEntries()).find((entry) => entry.identity_key === 'gog:4301')
    expect(row.gog_id).toBe(4301)
  })

  test('blacklisting a wishlisted title takes it off the wishlist', async () => {
    const wishlisted = await addWishlistEntry({ f95_id: 4401, title: 'Was Wanted' })
    expect(wishlisted.success).toBe(true)
    expect(await isWishlistEntry({ f95_id: 4401 })).toBe(true)

    const result = await addBlacklistEntry({ f95_id: 4401, title: 'Was Wanted' })
    expect(result.removedFromWishlist).toBe(true)
    expect(await isWishlistEntry({ f95_id: 4401 })).toBe(false)
  })
})

test('blacklisted titles survive an app restart', async () => {
  const dataDir = freshDataDir()
  await openDatabase(dataDir)
  await addBlacklistEntry({ atlas_id: 4501, title: 'Still Unwanted' })

  // A second initializeDatabase on the same data dir is what a restart does:
  // a new connection to the same file.
  const before = dbIndex.db
  await openDatabase(dataDir)
  expect(dbIndex.db).not.toBe(before)
  const entries = await getBlacklistEntries()
  expect(entries.map((row) => row.identity_key)).toContain('atlas:4501')
})

describe('Browse hides blacklisted titles on both query paths', () => {
  const seedAtlas = (atlasId, title) =>
    run(`INSERT INTO atlas_data (atlas_id, title, creator) VALUES (?, ?, 'Dev')`, [atlasId, title])

  const browse = () => getCatalogGames(os.tmpdir(), false, {
    offset: 0, limit: 250, includeTotal: true, filters: {}, search: {},
  })
  const atlasIds = (result) => result.games.map((game) => Number(game.atlas_id)).sort()

  beforeAll(async () => {
    await openDatabase(freshDataDir())
    await seedAtlas(5001, 'Keep Me')
    await seedAtlas(5002, 'Hide Me')
    await seedAtlas(5003, 'Installed Anyway')
    await addBlacklistEntry({ atlas_id: 5002, title: 'Hide Me' })
    await addBlacklistEntry({ atlas_id: 5003, title: 'Installed Anyway' })
    // A title the user installed after blacklisting it must stay visible.
    await run(`INSERT INTO games (record_id, title, creator) VALUES (9003, 'Installed Anyway', 'Dev')`)
    await run(`INSERT INTO atlas_mappings (record_id, atlas_id) VALUES (9003, 5003)`)
  })

  test('union path (catalog index not built yet)', async () => {
    expect((await getCatalogIndexStatus()).ready).toBe(false)
    const result = await browse()
    expect(atlasIds(result)).toEqual([5001, 5003])
    expect(result.total).toBe(2)
  })

  test('index path', async () => {
    await rebuildCatalogIndex()
    expect((await getCatalogIndexStatus()).ready).toBe(true)
    const result = await browse()
    expect(atlasIds(result)).toEqual([5001, 5003])
    expect(result.total).toBe(2)
  })

  test('removing the entry brings the title back without rebuilding the index', async () => {
    await removeBlacklistEntry('atlas:5002')
    const result = await browse()
    expect(atlasIds(result)).toEqual([5001, 5002, 5003])
    expect(result.total).toBe(3)
  })
})
