import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// The server exports a game's DLC appids under their own keys while
// steam_appids keeps its old meaning (every appid for the game). Before that,
// a base game and its DLC arrived as one flat array and this client could not
// tell them apart -- so a pasted DLC store URL matched nothing even though the
// game was in the library, and any attempt to filter DLC out of Browse could
// only work by guessing.
const require_ = createRequire(import.meta.url)
const { extractSteamAppIds, buildIndexWhere, CATALOG_INDEX_VERSION } =
  require_('../electron/db/catalogIndex.js')

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

const blob = (o) => JSON.stringify(o)

describe('extractSteamAppIds', () => {
  it('types DLC ids and resolves their parent', () => {
    expect(extractSteamAppIds(blob({
      steam_appid: '1000',
      steam_appids: ['1000', '2001', '2002'],
      steam_dlc_appids: ['2001', '2002'],
      steam_dlc_parents: { steam: { 1000: ['2001', '2002'] } },
    }))).toEqual([
      { appid: 1000, isDlc: false, parentAppId: null },
      { appid: 2001, isDlc: true, parentAppId: 1000 },
      { appid: 2002, isDlc: true, parentAppId: 1000 },
    ])
  })

  // The whole point of keeping steam_appids unchanged server-side: a package
  // built before the DLC keys existed must behave exactly as it used to.
  it('treats a package with no DLC keys as all games', () => {
    expect(extractSteamAppIds(blob({ steam_appid: '55' })))
      .toEqual([{ appid: 55, isDlc: false, parentAppId: null }])
    expect(extractSteamAppIds(blob({ steam_appids: ['1', '2'] })))
      .toEqual([
        { appid: 1, isDlc: false, parentAppId: null },
        { appid: 2, isDlc: false, parentAppId: null },
      ])
  })

  it('keeps a DLC that is missing from steam_appids', () => {
    // A hand-edited or partially-migrated blob. Dropping the id would lose the
    // link entirely, which is worse than trusting the DLC key.
    expect(extractSteamAppIds(blob({
      steam_appid: '10', steam_dlc_appids: ['20'],
    }))).toEqual([
      { appid: 10, isDlc: false, parentAppId: null },
      { appid: 20, isDlc: true, parentAppId: null },
    ])
  })

  it('leaves a DLC parented to a non-steam entry with no parent appid', () => {
    // manualLinks.js permits parenting across kinds, so the parent may be a GOG
    // or itch link. Still a DLC -- there is just no steam appid to point at.
    expect(extractSteamAppIds(blob({
      steam_appids: ['30'],
      steam_dlc_appids: ['30'],
      steam_dlc_parents: { gog: { some_gog: ['30'] } },
    }))).toEqual([{ appid: 30, isDlc: true, parentAppId: null }])
  })

  it('does not mistake a numeric non-steam parent id for an appid', () => {
    // The map is keyed by the PARENT's kind, and an f95_zone parent id is a
    // thread id -- numeric, like an appid, and nothing to do with Steam.
    // Reading the first group rather than the steam one would store 12345 as
    // this DLC's parent appid.
    expect(extractSteamAppIds(blob({
      steam_appids: ['40'],
      steam_dlc_appids: ['40'],
      steam_dlc_parents: { f95_zone: { 12345: ['40'] } },
    }))).toEqual([{ appid: 40, isDlc: true, parentAppId: null }])
  })

  it('reads the steam group when several kinds are present', () => {
    expect(extractSteamAppIds(blob({
      steam_appids: ['50', '51'],
      steam_dlc_appids: ['50', '51'],
      steam_dlc_parents: { f95_zone: { 999: ['50'] }, steam: { 51: ['51'] } },
    }))).toEqual([
      { appid: 50, isDlc: true, parentAppId: null },
      { appid: 51, isDlc: true, parentAppId: 51 },
    ])
  })

  it('survives malformed input without throwing', () => {
    for (const bad of [null, '', '{not json', '[]', blob({ steam_appids: 'nope' }),
      blob({ steam_dlc_parents: { steam: 'nope' } }),
      blob({ steam_appid: 'abc' }), blob({ steam_appid: '-5' }), blob({ steam_appid: '0' })]) {
      expect(Array.isArray(extractSteamAppIds(bad)), String(bad)).toBe(true)
    }
    expect(extractSteamAppIds(blob({ steam_appid: 'abc' }))).toEqual([])
  })

  it('yields one entry per appid even when a key repeats it', () => {
    expect(extractSteamAppIds(blob({
      steam_appid: '7', steam_id: '7', steam_appids: ['7', '7'],
    }))).toEqual([{ appid: 7, isDlc: false, parentAppId: null }])
  })
})

describe('searching a steam appid', () => {
  const paramsFor = (text, fields = ['steamId']) =>
    buildIndexWhere({ text, fields }, {}).params
  const whereFor = (text, fields = ['steamId']) =>
    buildIndexWhere({ text, fields }, {}).where

  it('reaches through atlas_external_steam so a DLC id finds its game', () => {
    expect(whereFor('2001')).toContain('atlas_external_steam')
    // Bound twice: once for ci.steam_id, once for the EXISTS.
    expect(paramsFor('2001')).toEqual(['%2001%', '%2001%'])
  })

  it('does not touch atlas_external_steam for a non-steam search', () => {
    expect(whereFor('something', ['title'])).not.toContain('atlas_external_steam')
    expect(whereFor('310615', ['f95Id'])).not.toContain('atlas_external_steam')
  })

  // A LEFT JOIN against a table with several appids per atlas_id repeats the
  // tile once per appid, which then needs DISTINCT on both the page query and
  // the count query -- miss the latter and the grid sizes its scrollbar for
  // rows it never shows. EXISTS cannot fan out, so neither is needed.
  it('uses EXISTS rather than a join, so no DISTINCT is required', () => {
    const source = read('electron', 'db', 'catalogIndex.js')
    expect(whereFor('2001')).toContain('EXISTS (')
    expect(whereFor('2001')).not.toMatch(/JOIN\s+atlas_external_steam/i)
    expect(source).not.toContain('SELECT DISTINCT ci.catalog_key')
    expect(source).not.toContain('COUNT(DISTINCT ci.catalog_key)')
  })
})

describe('schema', () => {
  it('carries is_dlc and parent_appid on atlas_external_steam', () => {
    const source = read('electron', 'db', 'catalogIndex.js')
    const ddl = source.slice(source.indexOf('CREATE TABLE IF NOT EXISTS atlas_external_steam'))
    expect(ddl.slice(0, 400)).toContain('is_dlc')
    expect(ddl.slice(0, 400)).toContain('parent_appid')
  })

  // The table is rebuilt from external_ids, so without a bump an existing
  // install keeps a schema-4 table in which every appid is typed as a game.
  it('bumps the index version so existing installs rebuild', () => {
    expect(CATALOG_INDEX_VERSION).toBeGreaterThanOrEqual(5)
  })

  it('persists the typing rather than discarding it on insert', () => {
    const source = read('electron', 'db', 'catalogIndex.js')
    expect(source).toContain('(steam_appid, atlas_id, is_dlc, parent_appid)')
    expect(source).toContain('entry.isDlc ? 1 : 0')
  })
})

// Library (catalog_index) and Browse (union) resolve a search independently.
// If only one learns to reach through the link table, the same appid returns
// different rows depending on whether the index happens to be ready.
it('the union fallback reaches through atlas_external_steam too', () => {
  const source = read('electron', 'db', 'versions.js')
  expect(source).toContain('FROM atlas_external_steam aes')
  expect(source).toContain('aes.atlas_id = catalog.atlas_id')
  expect(source).toContain("searchFields.includes('steamId')")
  expect(source).not.toMatch(/JOIN\s+atlas_external_steam/i)
})

// A DLC must never get a tile of its own; only the game it belongs to is
// browsable. This already held -- both orphan-branch builders skip any
// steam_data row whose appid is linked to an atlas entry -- and these pin it,
// because the exclusion lives in two places that have to agree.
describe('DLC never become separate tiles', () => {
  it('the index orphan branch skips any appid linked to an atlas row', () => {
    const source = read('electron', 'db', 'catalogIndex.js')
    const steamWhere = source.slice(source.indexOf('const STEAM_WHERE'),
      source.indexOf('await runBranch(\'steam\''))
    expect(steamWhere).toContain('NOT EXISTS')
    expect(steamWhere).toContain('atlas_external_steam')
    expect(steamWhere).toContain('aes.steam_appid = sd.steam_id')
  })

  it('the union fallback applies the same exclusion', () => {
    const source = read('electron', 'db', 'versions.js')
    const branch = source.slice(source.indexOf('steam_branch_base'))
    expect(branch).toContain('atlas_external_steam')
    expect(branch).toContain('NOT EXISTS')
  })

  // The behaviour itself, not just its source text.
  it('excludes DLC rows and keeps unrelated games', async () => {
    const sqlite3 = require_('sqlite3')
    const db = new sqlite3.Database(':memory:')
    const run = (sql, params = []) => new Promise((resolve, reject) =>
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))
    await run(`CREATE TABLE steam_data (steam_id INT PRIMARY KEY, atlas_id INT, title TEXT)`)
    await run(`CREATE TABLE atlas_data (atlas_id INT PRIMARY KEY)`)
    await run(`CREATE TABLE atlas_external_steam (steam_appid INT, atlas_id INT, is_dlc INT, parent_appid INT)`)
    await run(`INSERT INTO atlas_data VALUES (10)`)
    await run(`INSERT INTO steam_data VALUES (1000,10,'Base'),(2001,NULL,'DLC 1'),(2002,NULL,'DLC 2'),(7777,NULL,'Unrelated')`)
    await run(`INSERT INTO atlas_external_steam VALUES (1000,10,0,NULL),(2001,10,1,1000),(2002,10,1,1000)`)
    const rows = await run(`
      SELECT sd.steam_id FROM steam_data sd
      LEFT JOIN atlas_data a ON sd.atlas_id = a.atlas_id
      WHERE (sd.atlas_id IS NULL OR a.atlas_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM atlas_external_steam aes
                         WHERE aes.steam_appid = sd.steam_id)`)
    db.close()
    expect(rows.map((r) => r.steam_id)).toEqual([7777])
  })
})
