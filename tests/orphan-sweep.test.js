import { describe, it, expect, beforeAll, afterAll } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')
const dbIndex = require('../electron/db/index.js')

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-orphan-sweep-'))

const runAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    dbIndex.db.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })

const allAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    dbIndex.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  })

describe('sweepOrphanedRecords — downloads + media_source_cache', () => {
  let dataDir

  beforeAll(() => {
    dataDir = freshDataDir()
    dbIndex.initializeDatabase(dataDir)
  })

  afterAll(() => {
    // Close the DB connection so the temp dir can be cleaned up.
    if (dbIndex.db) {
      dbIndex.db.close()
    }
  })

  it('removes orphaned downloads and media_source_cache rows but keeps NULL record_id', async () => {
    // 1. Insert an orphan downloads row (record_id 999 — no game).
    await runAsync(
      `INSERT INTO downloads (record_id, title, state) VALUES (?, ?, ?)`,
      [999, 'Orphaned Game', 'done']
    )

    // 2. Insert an orphan media_source_cache row (record_id 999).
    await runAsync(
      `INSERT INTO media_source_cache (record_id, original_url) VALUES (?, ?)`,
      [999, 'https://example.com/cache']
    )

    // 3. Insert a downloads row with record_id NULL (catalog_ref style — must survive).
    await runAsync(
      `INSERT INTO downloads (record_id, title, catalog_ref, state) VALUES (?, ?, ?, ?)`,
      [null, 'Catalog Ref Game', 'f95:12345', 'queued']
    )

    // Verify pre-sweep state.
    let rows = await allAsync('SELECT * FROM downloads WHERE record_id = 999')
    expect(rows).toHaveLength(1)

    rows = await allAsync('SELECT * FROM media_source_cache WHERE record_id = 999')
    expect(rows).toHaveLength(1)

    rows = await allAsync('SELECT * FROM downloads WHERE record_id IS NULL')
    expect(rows).toHaveLength(1)

    // 4. Run the sweep.
    const { sweepOrphanedRecords } = dbIndex
    sweepOrphanedRecords()

    // 5. Verify post-sweep: orphans gone, NULL row survives.
    rows = await allAsync('SELECT * FROM downloads WHERE record_id = 999')
    expect(rows).toHaveLength(0)

    rows = await allAsync('SELECT * FROM media_source_cache WHERE record_id = 999')
    expect(rows).toHaveLength(0)

    rows = await allAsync('SELECT * FROM downloads WHERE record_id IS NULL')
    expect(rows).toHaveLength(1)
  })
})
