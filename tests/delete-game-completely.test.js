import { describe, it, expect } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')
const sqlite3 = require('sqlite3').verbose()

const dbIndex = require('../electron/db/index.js')
const { deleteGameCompletely } = require('../electron/db/games.js')
const { runClientAudit, repairClientAuditSection } = require('../electron/db/clientAudit.js')

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-delete-game-'))

const openFreshDatabase = async () => {
  const dataDir = freshDataDir()
  dbIndex.initializeDatabase(dataDir)
  return dataDir
}

const insertGame = async (recordId = 1, title = 'Test Game') => {
  return new Promise((resolve) => {
    dbIndex.db.run(
      `INSERT OR REPLACE INTO games (record_id, title, creator, engine) VALUES (?, ?, ?, ?)`,
      [recordId, title, 'TestCreator', 'TestEngine'],
      (err) => resolve(err ? null : recordId),
    )
  })
}

const getDbAll = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
})

const getDbGet = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
})

describe('deleteGameCompletely purges all tables', () => {
  it('removes rows from the five previously-missed tables', async () => {
    const dataDir = await openFreshDatabase()
    await insertGame(1)

    // Seed rows in the five missed tables.
    await new Promise((resolve) => {
      dbIndex.db.serialize(() => {
        dbIndex.db.run(`INSERT INTO downloads (record_id, title, state) VALUES (?, ?, ?)`, [1, 'dl', 'done'], () => {})
        dbIndex.db.run(`INSERT INTO collection_games (collection_id, record_id) VALUES (?, ?)`, [1, 1], () => {})
        dbIndex.db.run(`INSERT INTO preview_sort (record_id, identifier, position) VALUES (?, ?, ?)`, [1, 'x', 0], () => {})
        dbIndex.db.run(`INSERT INTO gog_mappings (record_id, gog_id) VALUES (?, ?)`, [1, 12345], () => {})
        dbIndex.db.run(`INSERT INTO media_source_cache (record_id, original_url) VALUES (?, ?)`, [1, 'https://example.com/meta'], () => {})
        resolve()
      })
    })

    // Also seed versions and banners to confirm existing cleanup still works.
    await new Promise((resolve) => {
      dbIndex.db.serialize(() => {
        dbIndex.db.run(`INSERT INTO versions (record_id, version, game_path) VALUES (?, ?, ?)`, [1, '1.0', 'C:\\game'], () => {})
        dbIndex.db.run(`INSERT INTO banners (record_id, path, type) VALUES (?, ?, ?)`, [1, 'data/images/1/banner.webp', 0], () => {})
        resolve()
      })
    })

    await deleteGameCompletely(1, dataDir, false)

    // The five missed tables must be clean.
    expect(await getDbAll('SELECT * FROM downloads WHERE record_id = 1')).toHaveLength(0)
    expect(await getDbAll('SELECT * FROM collection_games WHERE record_id = 1')).toHaveLength(0)
    expect(await getDbAll('SELECT * FROM preview_sort WHERE record_id = 1')).toHaveLength(0)
    expect(await getDbGet('SELECT * FROM gog_mappings WHERE record_id = 1')).toBeNull()
    expect(await getDbAll('SELECT * FROM media_source_cache WHERE record_id = 1')).toHaveLength(0)

    // versions and banners must still be cleaned (existing behaviour).
    expect(await getDbAll('SELECT * FROM versions WHERE record_id = 1')).toHaveLength(0)
    expect(await getDbAll('SELECT * FROM banners WHERE record_id = 1')).toHaveLength(0)

    // The game record itself must be gone.
    expect(await getDbGet('SELECT * FROM games WHERE record_id = 1')).toBeNull()
  })

  it('audit detects and repairs orphaned rows in preview_sort, media_source_cache, downloads, collection_games', async () => {
    const dataDir = await openFreshDatabase()
    // Seed orphan rows (record_id = 999, no games row).
    await new Promise((resolve) => {
      dbIndex.db.serialize(() => {
        dbIndex.db.run(`INSERT INTO preview_sort (record_id, identifier, position) VALUES (999, 'x', 0)`, () => {})
        dbIndex.db.run(`INSERT INTO media_source_cache (record_id, original_url) VALUES (999, 'https://example.com')`, () => {})
        dbIndex.db.run(`INSERT INTO downloads (record_id, title, state) VALUES (999, 'dl', 'done')`, () => {})
        dbIndex.db.run(`INSERT INTO collection_games (collection_id, record_id) VALUES (1, 999)`, () => {})
        resolve()
      })
    })

    const result = await runClientAudit()
    const dbSection = result.sections.find((s) => s.id === 'database')
    expect(dbSection).toBeDefined()

    const titles = dbSection.findings.map((f) => f.label)
    expect(titles).toContain('Orphaned rows in preview_sort')
    expect(titles).toContain('Orphaned rows in media_source_cache')
    expect(titles).toContain('Orphaned rows in downloads')
    expect(titles).toContain('Orphaned rows in collection_games')

    for (const f of dbSection.findings) {
      if (['preview_sort', 'media_source_cache', 'downloads', 'collection_games'].includes(
        f.label.replace('Orphaned rows in ', ''))) {
        expect(f.count).toBeGreaterThan(0)
      }
    }

    // Repair — delete the orphans.
    await repairClientAuditSection('database')

    for (const table of ['preview_sort', 'media_source_cache', 'downloads', 'collection_games']) {
      const rows = await getDbAll(`SELECT * FROM ${table} WHERE record_id = 999`)
      expect(rows).toHaveLength(0)
    }
  })

  it('catalog_index stale reference is cleared, and a second game survives', async () => {
    const dataDir = await openFreshDatabase()
    await insertGame(1)
    // Distinct title: games has UNIQUE (title, creator, engine), so a second
    // insert with the same values would REPLACE the first row.
    await insertGame(2, 'Game B')

    // Seed two catalog_index rows.
    await new Promise((resolve) => {
      dbIndex.db.serialize(() => {
        dbIndex.db.run(`INSERT INTO catalog_index (catalog_key, record_id, source, local_record_id, is_installed, title) VALUES ('atlas:1', 'catalog:1', 'atlas', 1, 1, 'Game A')`, () => {})
        dbIndex.db.run(`INSERT INTO catalog_index (catalog_key, record_id, source, local_record_id, is_installed, title) VALUES ('atlas:2', 'catalog:2', 'atlas', 2, 1, 'Game B')`, () => {})
        resolve()
      })
    })

    await deleteGameCompletely(1, dataDir, false)

    // The deleted game's catalog_index row must be cleared.
    const row1 = await getDbGet("SELECT local_record_id, is_installed FROM catalog_index WHERE catalog_key = 'atlas:1'")
    expect(row1.local_record_id).toBeNull()
    expect(row1.is_installed).toBe(0)

    // The second game's row must be UNCHANGED.
    const row2 = await getDbGet("SELECT local_record_id, is_installed FROM catalog_index WHERE catalog_key = 'atlas:2'")
    expect(row2.local_record_id).toBe(2)
    expect(row2.is_installed).toBe(1)
  })

  it('audit detects and repairs orphaned gog_mappings rows', async () => {
    const dataDir = await openFreshDatabase()

    // Seed an orphan: record_id 999 has no games row.
    await new Promise((resolve) => {
      dbIndex.db.run(`INSERT INTO gog_mappings (record_id, gog_id) VALUES (999, 12345)`, () => { resolve() })
    })

    const result = await runClientAudit()
    const dbSection = result.sections.find((s) => s.id === 'database')
    expect(dbSection).toBeDefined()

    const orphans = dbSection.findings.filter((f) => f.label === 'Orphaned rows in gog_mappings')
    expect(orphans.length).toBeGreaterThan(0)
    expect(orphans[0].count).toBeGreaterThan(0)

    // Repair — delete the orphans.
    await repairClientAuditSection('database')

    const rows = await getDbAll("SELECT * FROM gog_mappings WHERE record_id = 999")
    expect(rows).toHaveLength(0)
  })
})
