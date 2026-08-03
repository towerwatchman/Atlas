import { describe, it, expect } from 'vitest'
import {
  normalizeCatalogIdentity,
  resolveCatalogRecord,
  ensureCatalogRecord,
} from '../electron/library/catalogRecord.js'

// ── Catalog -> library record ────────────────────────────────────────────────
//
// This module decides which record a download or an import attaches to, and it
// can CREATE a record. Both are things a wrong answer makes very visible:
// a version appearing under the wrong game, or a duplicate tile.
//
// It is tested with fake deps rather than a database because the property that
// matters is the ORDER, and the implementation it replaced could not be tested
// at all — it was one UNION whose row selection was up to the query planner.

// Minimal stand-in for the database. `mappings` maps "table:column:id" to a
// record id; `games` is a list of { record_id, title, creator }.
const makeDeps = ({ mappings = {}, games = [], lookups = {} } = {}) => {
  const calls = { dbGet: [], addGame: [], updateGame: [], mappings: [], dbRun: [] }
  let nextRecordId = 900

  return {
    calls,
    deps: {
      dbGet: async (sql, params) => {
        calls.dbGet.push({ sql, params })
        const mappingMatch = sql.match(/FROM (\w+) WHERE (\w+) = \?/)
        if (mappingMatch && sql.includes('MIN(record_id)')) {
          const key = `${mappingMatch[1]}:${mappingMatch[2]}:${params[0]}`
          return { record_id: mappings[key] ?? null }
        }
        if (sql.includes('FROM games WHERE title = ? AND creator = ?')) {
          const [title, creator] = params
          const hit = games.find((g) => g.title === title && g.creator === creator)
          return hit ? { record_id: hit.record_id } : null
        }
        return null
      },
      addGame: async (game) => {
        calls.addGame.push(game)
        // Mirrors the real addGame: it returns the EXISTING record_id when
        // title+creator already match, rather than inserting.
        const hit = games.find((g) => g.title === game.title && g.creator === game.creator)
        if (hit) return hit.record_id
        const id = (nextRecordId += 1)
        games.push({ record_id: id, title: game.title, creator: game.creator })
        return id
      },
      updateGame: async (game) => { calls.updateGame.push(game) },
      addAtlasMapping: async (recordId, id) => { calls.mappings.push(['atlas', recordId, id]) },
      addLewdCornerMapping: async (recordId, id) => { calls.mappings.push(['lc', recordId, id]) },
      addSteamMapping: async (recordId, id) => { calls.mappings.push(['steam', recordId, id]) },
      addGogMapping: async (recordId, id) => { calls.mappings.push(['gog', recordId, id]) },
      dbRun: async (sql, params) => { calls.dbRun.push({ sql, params }) },
      findRecordByLewdCornerId: async (id) => lookups.lc?.[id] ?? null,
      findRecordBySteamId: async (id) => lookups.steam?.[id] ?? null,
      findRecordByGogId: async (id) => lookups.gog?.[id] ?? null,
    },
  }
}

const entry = (over = {}) => ({
  atlasId: 30956,
  f95Id: 12345,
  lcId: null,
  steamId: null,
  gogId: null,
  title: 'Some Game',
  creator: 'Some Dev',
  engine: 'Ren\'Py',
  description: 'An overview',
  ...over,
})

describe('normalizeCatalogIdentity', () => {
  it('accepts both key casings, since the importer and the hydrator differ', () => {
    const fromHydrator = normalizeCatalogIdentity({ atlasId: 1, f95Id: 2, lcId: 3, steamId: 4, gogId: 5 })
    const fromRenderer = normalizeCatalogIdentity({ atlas_id: 1, f95_id: 2, lc_id: 3, steam_id: 4, gog_id: 5 })
    expect(fromRenderer).toMatchObject({ atlasId: 1, f95Id: 2, lcId: 3, steamId: 4, gogId: 5 })
    expect(fromHydrator.atlasId).toBe(fromRenderer.atlasId)
    expect(fromHydrator.gogId).toBe(fromRenderer.gogId)
  })

  it('applies the Untitled/Unknown fallbacks at the database boundary', () => {
    // Scan rows show blanks deliberately; the DB must never store one.
    const identity = normalizeCatalogIdentity({ title: '  ', creator: '', engine: null })
    expect(identity.title).toBe('Untitled')
    expect(identity.creator).toBe('Unknown')
    expect(identity.engine).toBe('Unknown')
  })

  it('rejects non-positive ids rather than passing them to a query', () => {
    const identity = normalizeCatalogIdentity({ atlas_id: 0, f95_id: -3, steam_id: 'abc' })
    expect(identity.atlasId).toBeNull()
    expect(identity.f95Id).toBeNull()
    expect(identity.steamId).toBeNull()
  })
})

describe('resolveCatalogRecord order', () => {
  it('prefers the atlas mapping, matching the browse query COALESCE order', async () => {
    // The order has to agree with local_record_id in db/versions.js, because
    // that is what the Browse tile shows as "in your library". Disagreeing would
    // mean the UI and the importer name different records for one game.
    const { deps } = makeDeps({
      mappings: {
        'atlas_mappings:atlas_id:30956': 412,
        'f95_zone_mappings:f95_id:12345': 999,
      },
    })
    expect(await resolveCatalogRecord(deps, entry())).toEqual({
      recordId: 412,
      via: 'atlas-mapping',
    })
  })

  it('falls through the mapping tables in order', async () => {
    const { deps } = makeDeps({
      mappings: {
        'f95_zone_mappings:f95_id:12345': 500,
        'lewdcorner_mappings:lc_id:77': 600,
      },
    })
    expect(await resolveCatalogRecord(deps, entry({ lcId: 77 }))).toEqual({
      recordId: 500,
      via: 'f95-mapping',
    })
  })

  it('skips a mapping table when the entry has no id for it', async () => {
    const { deps, calls } = makeDeps({ mappings: { 'steam_mappings:steam_id:480': 42 } })
    const result = await resolveCatalogRecord(deps, entry({ atlasId: null, f95Id: null, steamId: 480 }))
    expect(result).toEqual({ recordId: 42, via: 'steam-mapping' })
    // No pointless queries for ids that do not exist on the entry.
    const tablesQueried = calls.dbGet.map((c) => c.sql.match(/FROM (\w+)/)?.[1])
    expect(tablesQueried).not.toContain('atlas_mappings')
    expect(tablesQueried).not.toContain('f95_zone_mappings')
  })

  it('uses the provider lookups, which see more than their mapping table', async () => {
    // findRecordBySteamId also matches external_ids and atlas grouping, so it
    // ranks above the title fallback but below the direct mappings.
    const { deps } = makeDeps({ lookups: { steam: { 480: 77 } } })
    expect(await resolveCatalogRecord(deps, entry({ atlasId: null, f95Id: null, steamId: 480 })))
      .toEqual({ recordId: 77, via: 'steam-lookup' })
  })

  it('falls back to title+creator last, and reports it as such', async () => {
    const { deps } = makeDeps({ games: [{ record_id: 55, title: 'Some Game', creator: 'Some Dev' }] })
    expect(await resolveCatalogRecord(deps, entry())).toEqual({ recordId: 55, via: 'title' })
  })

  it('does not consult the title when allowTitleMatch is false', async () => {
    const { deps, calls } = makeDeps({
      games: [{ record_id: 55, title: 'Some Game', creator: 'Some Dev' }],
    })
    const result = await resolveCatalogRecord(deps, entry(), { allowTitleMatch: false })
    expect(result).toEqual({ recordId: null, via: null })
    expect(calls.dbGet.some((c) => c.sql.includes('FROM games'))).toBe(false)
  })

  it('resolves nothing for an entry with no ids and no name match', async () => {
    const { deps } = makeDeps()
    expect(await resolveCatalogRecord(deps, entry())).toEqual({ recordId: null, via: null })
  })
})

describe('ensureCatalogRecord', () => {
  it('creates the record and writes every mapping the entry carries', async () => {
    const { deps, calls } = makeDeps()
    const result = await ensureCatalogRecord(
      deps,
      entry({ lcId: 77, steamId: 480, gogId: 1207 }),
    )
    expect(result.created).toBe(true)
    expect(result.via).toBe('created')
    expect(result.recordId).toBeGreaterThan(0)
    expect(calls.mappings).toEqual([
      ['atlas', result.recordId, 30956],
      ['lc', result.recordId, 77],
      ['steam', result.recordId, 480],
      ['gog', result.recordId, 1207],
    ])
    // f95 has no helper, so it goes through dbRun.
    expect(calls.dbRun).toHaveLength(1)
    expect(calls.dbRun[0].sql).toContain('f95_zone_mappings')
  })

  it('writes the description through updateGame, as addGame does not store it', async () => {
    const { deps, calls } = makeDeps()
    await ensureCatalogRecord(deps, entry())
    expect(calls.updateGame).toHaveLength(1)
    expect(calls.updateGame[0].description).toBe('An overview')
  })

  it('does not call updateGame when there is no description', async () => {
    const { deps, calls } = makeDeps()
    await ensureCatalogRecord(deps, entry({ description: '' }))
    expect(calls.updateGame).toHaveLength(0)
  })

  it('backfills mappings onto a record that already existed', async () => {
    // A record found by title has no atlas mapping until something adds one, and
    // without it no banner or metadata hydrates. The existing importer wrote
    // mappings unconditionally for exactly this reason.
    const { deps, calls } = makeDeps({
      games: [{ record_id: 55, title: 'Some Game', creator: 'Some Dev' }],
    })
    const result = await ensureCatalogRecord(deps, entry())
    expect(result).toMatchObject({ recordId: 55, created: false, via: 'title' })
    expect(calls.addGame).toHaveLength(0)
    expect(calls.mappings).toEqual([['atlas', 55, 30956]])
  })

  it('reports a title collision instead of absorbing it', async () => {
    // games has UNIQUE (title, creator, engine) and addGame returns the existing
    // record on a title hit, so a separate row cannot be created. With
    // allowTitleMatch off the caller still needs to KNOW that is what happened,
    // which is what titleCollision is for — a download landing on a record
    // matched by name alone is the one outcome worth telling the user about.
    const { deps, calls } = makeDeps({
      games: [{ record_id: 55, title: 'Some Game', creator: 'Some Dev' }],
    })
    const result = await ensureCatalogRecord(deps, entry(), { allowTitleMatch: false })
    expect(result.recordId).toBe(55)
    expect(result.created).toBe(false)
    expect(result.titleCollision).toBe(true)
    expect(result.via).toBe('title')
    // Crucially it did NOT call addGame and quietly receive 55 back.
    expect(calls.addGame).toHaveLength(0)
  })

  it('does not report a collision when the record was linked by an id', async () => {
    const { deps } = makeDeps({ mappings: { 'atlas_mappings:atlas_id:30956': 412 } })
    const result = await ensureCatalogRecord(deps, entry(), { allowTitleMatch: false })
    expect(result).toMatchObject({ recordId: 412, created: false, titleCollision: false })
    expect(result.via).toBe('atlas-mapping')
  })

  it('is idempotent: a second call resolves rather than creating again', async () => {
    const shared = makeDeps()
    const first = await ensureCatalogRecord(shared.deps, entry())
    // The mapping now exists, so the second call resolves through it.
    shared.deps.dbGet = async (sql, params) => {
      if (sql.includes('atlas_mappings')) return { record_id: first.recordId }
      return null
    }
    const second = await ensureCatalogRecord(shared.deps, entry())
    expect(second.recordId).toBe(first.recordId)
    expect(second.created).toBe(false)
  })

  it('creates a record for an entry with no ids at all', async () => {
    // A LewdCorner-only row carries nothing but an lc_id; a hydration that lost
    // even that must still produce a usable record rather than throwing.
    const { deps, calls } = makeDeps()
    const result = await ensureCatalogRecord(
      deps,
      { title: 'LewdCorner #12345', creator: 'Unknown' },
    )
    expect(result.created).toBe(true)
    expect(calls.mappings).toEqual([])
    expect(calls.addGame[0]).toMatchObject({
      title: 'LewdCorner #12345',
      creator: 'Unknown',
      engine: 'Unknown',
    })
  })
})
