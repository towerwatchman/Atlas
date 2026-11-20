import { describe, test, expect, beforeAll, afterAll } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')

const dbIndex = require('../electron/db/index.js')
const { getCatalogGames } = require('../electron/db/versions.js')

//
// The union path's tpExpr is COALESCE(thread_publish_date,
// lewdcornerRegisterDate): a game gets its F95 date whenever one exists, and
// its LewdCorner register date only as a fallback. The catalog projection and
// the renderer (useFilters) do the same, so both sides of a Thread Published
// range agree. Driven against a real sqlite file because the whole point is the
// SQL expression the date-range filter uses.

const run = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.run(sql, params, (err) => (err ? reject(err) : resolve()))
})
const all = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
})

// initializeDatabase queues its DDL behind the open callback, so the table is
// not there the instant the call returns.
const waitForAtlasTable = async () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (dbIndex.db) {
      const rows = await all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atlas_data'`)
        .catch(() => [])
      if (rows.length === 1) return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('atlas_data was never created')
}

const openDatabase = async (dataDir) => {
  dbIndex.initializeDatabase(dataDir)
  await waitForAtlasTable()
}

const dataDirs = []
const freshDataDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-tp-min-'))
  dataDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dataDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

describe('Browse thread-published ranks by the F95 date, LewdCorner register date as fallback', () => {
  const seedAtlas = (atlasId, title) =>
    run(`INSERT INTO atlas_data (atlas_id, title, creator) VALUES (?, ?, 'Dev')`, [atlasId, title])
  const seedF95 = (atlasId, f95Id, threadPublishDate) =>
    run(`INSERT INTO f95_zone_data (f95_id, atlas_id, thread_publish_date) VALUES (?, ?, ?)`, [f95Id, atlasId, threadPublishDate])
  // tier 'Free' so the row survives the LewdCorner free-tier gate; a NULL tier
  // is treated as members-only and hidden.
  const seedLc = (atlasId, lcId, registerDate) =>
    run(`INSERT INTO lewdcorner_data (lc_id, atlas_id, register_date, tier) VALUES (?, ?, ?, 'Free')`, [lcId, atlasId, registerDate])

  const browse = (filters) => getCatalogGames(os.tmpdir(), false, {
    offset: 0, limit: 250, includeTotal: true, filters: filters || {}, search: {},
  })
  const atlasIds = (result) => result.games.map((game) => Number(game.atlas_id))

  beforeAll(async () => {
    await openDatabase(freshDataDir())
    // The year range the filter uses comes from the clock. Dates that must land
    // inside it come from the clock too; a hardcoded year goes stale the moment
    // the clock passes it.
    const year = new Date().getFullYear()
    // X: has both dates; the F95 date (2024) wins over the LewdCorner
    // registration (2023), so it projects to the 2024 date.
    await seedAtlas(99001, 'X Both Sources')
    await seedF95(99001, 70001, '2024-03-15')
    await seedLc(99001, 80001, '2023-01-20')
    // Y: only an F95 thread, which projects straight to that date.
    await seedAtlas(99002, 'Y F95 Only')
    await seedF95(99002, 70002, '2023-06-01')
    // Z: F95 date is in the current year and its LewdCorner registration is
    // years older; the F95 date wins, so a current-year filter keeps it.
    await seedAtlas(99003, 'Z Recent F95 Old LC')
    await seedF95(99003, 70003, `${year}-06-01`)
    await seedLc(99003, 80003, '2020-01-01')
    // W: control for the filter. Both its dates fall in the current year, so it
    // stays inside a year range no matter how the two are combined.
    await seedAtlas(99004, 'W Both Current Year')
    await seedF95(99004, 70004, `${year}-07-01`)
    await seedLc(99004, 80004, `${year}-02-01`)
    // V: its F95 date is years old (outside a current-year range) but its
    // LewdCorner registration is recent. The F95 date wins, so it is excluded
    // even though its register date would have matched.
    await seedAtlas(99005, 'V Old F95 Recent LC')
    await seedF95(99005, 70005, '2015-05-05')
    await seedLc(99005, 80005, `${year}-03-03`)
    // LC: a LewdCorner-only game (no F95 thread) with a recent register date,
    // matched by that register date.
    await seedAtlas(99006, 'LC Only Recent')
    await seedLc(99006, 80006, `${year}-04-04`)
  })

  test('newReleaseDesc returns games newest-first by atlas_id', async () => {
    // atlas_id is the auto-increment identity, so a higher id is the row added
    // later; descending puts the newest-seeded game (99004) ahead of the first (99001).
    const result = await browse({ browseSort: 'newReleaseDesc' })
    const ids = atlasIds(result)
    expect(ids.indexOf(99004)).toBeLessThan(ids.indexOf(99001))
    expect(ids.indexOf(99002)).toBeLessThan(ids.indexOf(99001))
  })

  test('a year filter keys on the F95 date, with the LewdCorner register date only as a fallback', async () => {
    // browseDateBasis thread_publish_date routes the saved-filter date range
    // through the same tpExpr the sort uses.
    const result = await browse({
      dateField: 'none',
      browseDateRange: 'year',
      browseDateBasis: 'thread_publish_date',
    })
    const ids = atlasIds(result)
    // W and Z both carry an in-range F95 date, so each matches on it; Z's
    // LewdCorner register date is older, but the F95 date decides.
    expect(ids).toContain(99004)
    expect(ids).toContain(99003)
    // V's F95 date is out of range, so it is excluded even though its LewdCorner
    // register date falls in the current year.
    expect(ids).not.toContain(99005)
    // A LewdCorner-only game has no F95 date, so its register date decides; 99006
    // is in range and matches.
    expect(ids).toContain(99006)
  })
})
