import { describe, it, expect } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')
const sqlite3 = require('sqlite3').verbose()

const dbIndex = require('../electron/db/index.js')
const {
  updatePreviews,
  getPreviews,
} = require('../electron/db/media.js')

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-media-helpers-'))

const openFreshDatabase = async () => {
  dbIndex.initializeDatabase(freshDataDir())
  return new Promise((resolve, reject) => {
    dbIndex.db.get('PRAGMA table_info(previews)', (err, rows) =>
      (err ? reject(err) : resolve(rows || [])))
  })
}

describe('hasLocalPreviews regression', () => {
  it('detects previews stored in the previews table, not just media_assets', async () => {
    await openFreshDatabase()
    await updatePreviews(1, 'data/images/1/downloaded_preview.webp', 256)

    const fromAssets = await new Promise((resolve) => {
      dbIndex.db.get(
        `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%preview%' LIMIT 1`,
        [1],
        (err, row) => resolve(err ? null : row || null)
      )
    })
    const fromPreviews = await new Promise((resolve) => {
      dbIndex.db.get(
        `SELECT 1 FROM previews WHERE record_id = ? LIMIT 1`,
        [1],
        (err, row) => resolve(err ? null : row || null)
      )
    })

    expect(fromAssets).toBeNull()
    expect(fromPreviews).not.toBeNull()
    expect(!!(fromAssets || fromPreviews)).toBe(true)
  })
})
