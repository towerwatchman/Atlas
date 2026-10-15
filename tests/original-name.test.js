// Contract for issue #365: atlas_data.original_name must reach the client and
// be searchable. Every test below fails on the current code — original_name is
// stored on ingest but no query selects it and no search path looks at it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dbIndex = require('../electron/db/index')
const { addGame } = require('../electron/db/games')
const { getGame, getGames, getCatalogGames } = require('../electron/db/versions')
const { searchAtlas } = require('../electron/db/atlas')
const { buildIndexWhere } = require('../electron/db/catalogIndex')
const {
  indexColumnsForSearchFieldIds,
  unionColumnsForSearchFieldIds,
} = require('../electron/db/searchFields')
const { filterGamesWithState } = require('../src/hooks/useFilters.js')

let tmpDir

// initializeDatabase runs several CREATE TABLE + ALTER statements on the
// callback queue; give them a tick to settle before we use the connection.
const settle = () => new Promise((r) => setTimeout(r, 300))

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    dbIndex.db.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-original-name-'))
  dbIndex.initializeDatabase(tmpDir)
  await settle()
})

afterAll(async () => {
  try { dbIndex.db && dbIndex.db.close() } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// A local record mapped to an atlas row whose title differs from its
// original_name — the Paper Hearts / OurLife shape from the issue.
const seedMappedRecord = async (atlasId, { title, originalName, creator }) => {
  const recordId = await addGame({ title, creator, engine: 'RenPy' })
  await run(
    `INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, original_name)
     VALUES (?, ?, ?, ?)`,
    [atlasId, title, creator, originalName],
  )
  await run('INSERT OR REPLACE INTO atlas_mappings (record_id, atlas_id) VALUES (?, ?)', [recordId, atlasId])
  return recordId
}

describe('original_name reaches the client', () => {
  it('getGame exposes the atlas original_name', async () => {
    const recordId = await seedMappedRecord(88101, {
      title: 'Paper Hearts', originalName: 'Ourlifexq', creator: 'Bite The Rose Studio',
    })
    const game = await getGame(recordId, '/tmp', true)
    expect(game.original_name).toBe('Ourlifexq')
  })

  it('getGames exposes the atlas original_name', async () => {
    const recordId = await seedMappedRecord(88102, {
      title: 'Paper Hearts Gaiden', originalName: 'Ourlifexq Gaiden', creator: 'Bite The Rose Studio',
    })
    const games = await getGames('/tmp', true, 0, 100, { includeUninstalled: true, skipPathValidation: true })
    const game = games.find((g) => g.record_id === recordId)
    expect(game).toBeDefined()
    expect(game.original_name).toBe('Ourlifexq Gaiden')
  })

  it('the union catalog path matches and carries original_name', async () => {
    await run(
      `INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, original_name)
       VALUES (?, ?, ?, ?)`,
      [88103, 'Paper Hearts Catalog', 'SomeDev', 'Ourlifexq Catalog'],
    )
    const { games } = await getCatalogGames('/tmp', true, {
      search: { text: 'ourlifexq catalog', fields: ['title'] },
      limit: 50,
    })
    const hit = (games || []).find((g) => g.atlas_id === 88103)
    expect(hit).toBeDefined()
    expect(hit.original_name).toBe('Ourlifexq Catalog')
  })

  it('searchAtlas (Find Match) matches the original name', async () => {
    await run(
      `INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, original_name)
       VALUES (?, ?, ?, ?)`,
      [88104, 'Paper Hearts Finder', 'FinderDev', 'Ourlifexq Finder'],
    )
    const results = await searchAtlas('Ourlifexq Finder', 'FinderDev')
    expect(results.map((r) => r.atlas_id)).toContain(88104)
  })

  it('searchAtlas finds a reordered multi-word original name via word overlap', async () => {
    await run(
      `INSERT OR REPLACE INTO atlas_data (atlas_id, title, creator, original_name)
       VALUES (?, ?, ?, ?)`,
      [88105, 'Paper Hearts Reorder', 'ReorderDev', 'Ourlifexq Story'],
    )
    const results = await searchAtlas('Story Ourlifexq', 'ReorderDev')
    expect(results.map((r) => r.atlas_id)).toContain(88105)
  })

  it('the exact-match path also carries original_name', async () => {
    await run(
      `INSERT OR REPLACE INTO atlas_data (atlas_id, title, normalized_title, creator, original_name)
       VALUES (?, ?, ?, ?, ?)`,
      [88106, 'Exact Shape Game', 'EXACTSHAPEGAME', 'ShapeDev', 'Former Shape Name'],
    )
    const results = await searchAtlas('Exact Shape Game', 'ShapeDev')
    const hit = results.find((r) => r.atlas_id === 88106)
    expect(hit).toBeDefined()
    expect(hit.original_name).toBe('Former Shape Name')
  })
})

describe('original_name is searchable under the title scope', () => {
  it('the title field covers the catalog_index original_name column', () => {
    expect(indexColumnsForSearchFieldIds(['title'])).toContain('original_name')
  })

  it('the title field covers the union original_name column', () => {
    expect(unionColumnsForSearchFieldIds(['title'])).toContain('catalog.original_name')
  })

  it('the catalog_index WHERE searches original_name for a title query', () => {
    const { where } = buildIndexWhere({ text: 'ourlifexq', fields: ['title'] }, {})
    expect(where).toContain('ci.original_name')
  })

  it('the renderer JS filter matches original_name under title', () => {
    const games = [
      { record_id: 1, title: 'Paper Hearts', short_name: '', creator: 'Dev', f95_id: '', steam_id: '' , original_name: 'Ourlifexq'},
      { record_id: 2, title: 'Other Game', short_name: '', creator: 'Dev', f95_id: '', steam_id: '', original_name: '' },
    ]
    const hits = filterGamesWithState(games, { text: 'ourlifexq', searchFields: ['title'], installState: 'all', includeUninstalled: true })
    expect(hits.map((g) => g.record_id)).toEqual([1])
  })
})
