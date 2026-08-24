import { describe, it, expect } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')
const sqlite3 = require('sqlite3').verbose()

const dbIndex = require('../electron/db/index.js')
const {
  updatePreviews,
  insertPreviewSortRow,
  getPreviews,
  deletePreviews,
  deleteBanner,
  updateBanners,
  nextManualPreviewPosition,
} = require('../electron/db/media.js')

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-media-helpers-'))

const openFreshDatabase = async () => {
  const dataDir = freshDataDir()
  dbIndex.initializeDatabase(dataDir)
  return new Promise((resolve, reject) => {
    dbIndex.db.get('PRAGMA table_info(previews)', (err, rows) => {
      if (err) reject(err)
      else resolve({ dataDir, rows: rows || [] })
    })
  })
}

const insertGame = async (recordId = 1) => {
  return new Promise((resolve) => {
    dbIndex.db.run(
      `INSERT OR REPLACE INTO games (record_id, title, creator, engine) VALUES (?, ?, ?, ?)`,
      [recordId, 'Test Game', 'TestCreator', 'TestEngine'],
      (err) => resolve(err ? null : recordId),
    )
  })
}

const setPreviewSort = (recordId, identifiers) => {
  return new Promise((resolve) => {
    dbIndex.db.serialize(() => {
      dbIndex.db.run(`DELETE FROM preview_sort WHERE record_id = ?`, [recordId])
      const stmt = dbIndex.db.prepare(
        `INSERT INTO preview_sort (record_id, identifier, position) VALUES (?, ?, ?)`
      )
      identifiers.forEach((id, pos) => stmt.run(recordId, id, pos))
      stmt.finalize(() => {
        resolve()
      })
    })
  })
}

const getDbAll = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
})

const getDbGet = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
})

describe('updatePreviews', () => {
  it('stores remote_url when provided', async () => {
    const { dataDir } = await openFreshDatabase()
    await updatePreviews(1, 'data/images/1/preview.webp', 'https://example.com/preview.jpg', false)

    const row = await getDbGet('SELECT * FROM previews WHERE record_id = 1')
    expect(row).not.toBeNull()
    expect(row.path).toBe('data/images/1/preview.webp')
    expect(row.remote_url).toBe('https://example.com/preview.jpg')
    expect(row.is_custom).toBe(0)
  })

  it('defaults remote_url to null when not provided', async () => {
    const { dataDir } = await openFreshDatabase()
    await updatePreviews(1, 'data/images/1/preview.webp', null, false)

    const row = await getDbGet('SELECT * FROM previews WHERE record_id = 1')
    expect(row).not.toBeNull()
    expect(row.remote_url).toBeNull()
    expect(row.is_custom).toBe(0)
  })
})

describe('nextManualPreviewPosition', () => {
  it('returns 0 when no manual previews exist', async () => {
    const { dataDir } = await openFreshDatabase()
    const pos = await nextManualPreviewPosition(1)
    expect(pos).toBe(0)
  })

  it('fills the first gap in manual positions', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertPreviewSortRow(1, 'custom_0', 0)
    await insertPreviewSortRow(1, 'custom_2', 2)
    const pos = await nextManualPreviewPosition(1)
    expect(pos).toBe(1)
  })

  it('appends after the highest manual position when no gaps', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertPreviewSortRow(1, 'custom_0', 0)
    await insertPreviewSortRow(1, 'custom_1', 1)
    const pos = await nextManualPreviewPosition(1)
    expect(pos).toBe(2)
  })
})

describe('deletePreviews hard-delete', () => {
  it('hard-deletes downloaded rows and keeps custom rows', async () => {
    const { dataDir } = await openFreshDatabase()

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    const downloadedFile = path.join(imageDir, 'preview_downloaded.webp')
    const customFile = path.join(imageDir, 'preview_custom.webp')
    fs.writeFileSync(downloadedFile, 'fake-webp-data')
    fs.writeFileSync(customFile, 'fake-webp-data')

    await updatePreviews(1, 'data/images/1/preview_downloaded.webp', null, false)
    await updatePreviews(1, 'data/images/1/preview_custom.webp', null, true)

    expect(fs.existsSync(downloadedFile)).toBe(true)
    expect(fs.existsSync(customFile)).toBe(true)

    await deletePreviews(1, dataDir, false)

    // Downloaded file deleted from disk and row gone from DB (hard delete).
    expect(fs.existsSync(downloadedFile)).toBe(false)
    const downloadedRow = await getDbGet('SELECT * FROM previews WHERE record_id = 1 AND is_custom = 0')
    expect(downloadedRow).toBeNull()

    // Custom file and row untouched.
    expect(fs.existsSync(customFile)).toBe(true)
    const customRow = await getDbGet('SELECT * FROM previews WHERE record_id = 1 AND is_custom = 1')
    expect(customRow).not.toBeNull()
  })
})

describe('hasLocalPreviews regression', () => {
  it('detects previews stored in the previews table, not just media_assets', async () => {
    await openFreshDatabase()
    await updatePreviews(1, 'data/images/1/downloaded_preview.webp')

    const fromAssets = await getDbGet(
      `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%preview%' LIMIT 1`,
      [1]
    )
    // Mirrors hasLocalPreviews: downloaded (is_custom = 0) rows count, custom do not.
    const fromPreviews = await getDbGet(
      `SELECT 1 FROM previews WHERE record_id = ? AND is_custom = 0 LIMIT 1`,
      [1]
    )

    expect(fromAssets).toBeNull()
    expect(fromPreviews).not.toBeNull()
    expect(!!(fromAssets || fromPreviews)).toBe(true)
  })

  it('ignores custom-only previews (is_custom = 1) so missingOnly refresh still runs', async () => {
    await openFreshDatabase()
    // A purely custom preview must NOT satisfy hasLocalPreviews, which is what
    // gates the missingOnly media refresh from re-downloading over a manual image.
    await updatePreviews(1, 'data/images/1/custom_preview.webp', null, true)

    const fromAssets = await getDbGet(
      `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%preview%' LIMIT 1`,
      [1]
    )
    const fromPreviews = await getDbGet(
      `SELECT 1 FROM previews WHERE record_id = ? AND is_custom = 0 LIMIT 1`,
      [1]
    )

    expect(fromAssets).toBeNull()
    expect(fromPreviews).toBeNull()
    expect(!!(fromAssets || fromPreviews)).toBe(false)
  })
})

describe('hasLocalBanner regression', () => {
  it('detects banners stored in the banners table, not just media_assets', async () => {
    await openFreshDatabase()
    await updateBanners(1, 'data/images/1/downloaded_banner.webp', 'f95')

    const fromAssets = await getDbGet(
      `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%banner%' LIMIT 1`,
      [1]
    )
    const fromBanners = await getDbGet(
      `SELECT 1 FROM banners WHERE record_id = ? LIMIT 1`,
      [1]
    )

    expect(fromAssets).toBeNull()
    expect(fromBanners).not.toBeNull()
    expect(!!(fromAssets || fromBanners)).toBe(true)
  })
})

describe('deleteBanner', () => {
  it('deletes banner files from disk and clears both banners and media_assets tables', async () => {
    const { dataDir } = await openFreshDatabase()

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    const bannerFile = path.join(imageDir, 'banner_f95.webp')
    fs.writeFileSync(bannerFile, 'fake-webp-data')

    await updateBanners(1, 'data/images/1/banner_f95.webp', 'f95')

    expect(fs.existsSync(bannerFile)).toBe(true)
    let bannerRows = await getDbAll('SELECT * FROM banners WHERE record_id = 1')
    expect(bannerRows).toHaveLength(1)

    await deleteBanner(1, dataDir, false)

    expect(fs.existsSync(bannerFile)).toBe(false)

    bannerRows = await getDbAll('SELECT * FROM banners WHERE record_id = 1')
    expect(bannerRows).toHaveLength(0)

    const assetRows = await getDbAll(
      "SELECT * FROM media_assets WHERE record_id = 1 AND asset_type LIKE '%banner%'"
    )
    expect(assetRows).toHaveLength(0)
  })
})

// ── preview_sort ordering tests ──────────────────────────────────────────────

describe('preview_sort ordering in getPreviews', () => {
  it('respects preview_sort positions for screenshots', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    // Insert preview rows with remote_url but no local files on disk, so the
    // display URL falls back to remote_url (which is also the identifier).
    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)
    await updatePreviews(1, 'data/images/1/c.webp', 'https://example.com/c.jpg', false)

    // Set custom sort order: c, a, b
    await setPreviewSort(1, [
      'https://example.com/c.jpg',
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ])

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toEqual([
      'https://example.com/c.jpg',
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ])
  })

  it('keeps natural order when no preview_sort rows exist', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)
    await updatePreviews(1, 'data/images/1/c.webp', 'https://example.com/c.jpg', false)

    // No preview_sort rows — items should appear in natural (insertion) order.
    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
      'https://example.com/c.jpg',
    ])
  })

  it('pins custom preview (-1) to front while downloaded previews keep natural order (no sort rows)', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'a.webp'), 'fake-webp-data')
    fs.writeFileSync(path.join(imageDir, 'b.webp'), 'fake-webp-data')
    fs.writeFileSync(path.join(imageDir, 'custom.webp'), 'fake-webp-data')

    // Downloaded previews get NO preview_sort rows (plain download path).
    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)
    // Custom upload: add-custom-previews writes a -1 preview_sort row; downloads do not.
    await updatePreviews(1, 'data/images/1/custom.webp', null, true)
    await insertPreviewSortRow(1, 'data/images/1/custom.webp', -1)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })
    // Custom (-1) leads; downloaded trail in natural (insertion) order.
    expect(urls[0]).toMatch(/custom\.webp$/)
    expect(urls[1]).toMatch(/a\.webp$/)
    expect(urls[2]).toMatch(/b\.webp$/)
  })

  it('persists order across simulation of re-download (delete + re-insert)', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    // Initial download + reorder.
    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)

    await setPreviewSort(1, ['https://example.com/b.jpg', 'https://example.com/a.jpg'])

    // Simulate delete (hard-delete non-custom) then re-download.
    await deletePreviews(1, dataDir, false)
    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)

    // preview_sort should still have the old order since deletePreviews
    // hard-deletes from previews but leaves preview_sort untouched.
    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toEqual([
      'https://example.com/b.jpg',
      'https://example.com/a.jpg',
    ])
  })

  it('splits local video files into trailer bucket (locked to front)', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    // Create a local video file.
    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'trailer.mp4'), 'fake-video-data')

    await updatePreviews(1, 'data/images/1/trailer.mp4', 'https://example.com/trailer.mp4', false)
    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)

    // Sort screenshots: b, a. Trailer should remain at front.
    await setPreviewSort(1, [
      'https://example.com/trailer.mp4',
      'https://example.com/b.jpg',
      'https://example.com/a.jpg',
    ])

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    // Trailer (local file path) comes first, then sorted screenshots.
    expect(urls[0]).toMatch(/trailer\.mp4$/)
    expect(urls).toEqual([
      expect.stringMatching(/trailer\.mp4$/),
      'https://example.com/b.jpg',
      'https://example.com/a.jpg',
    ])
  })
})

describe('preview_sort stream-mode sorting', () => {
  // In stream mode (no local preview rows in the previews table), getPreviews
  // must still sort remote URLs from getRemotePreviewUrls by preview_sort.
  // Uses f95_zone_screens (source 'f95', which is in the default source order).
  const insertRemotePreviews = async (recordId, urls) => {
    await new Promise((resolve) => {
      dbIndex.db.serialize(() => {
        dbIndex.db.run(`INSERT OR IGNORE INTO atlas_data (atlas_id) VALUES (1)`)
        dbIndex.db.run(`INSERT OR IGNORE INTO atlas_mappings (record_id, atlas_id) VALUES (?, 1)`, [recordId])
        dbIndex.db.run(`INSERT OR IGNORE INTO f95_zone_data (f95_id, atlas_id) VALUES (1, 1)`)
        const stmt = dbIndex.db.prepare(`INSERT INTO f95_zone_screens (f95_id, screen_url) VALUES (?, ?)`)
        for (const url of urls) stmt.run(1, url)
        stmt.finalize(() => resolve())
      })
    })
  }

  it('respects preview_sort for remote-only URLs when no local rows exist', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    await insertRemotePreviews(1, [
      'https://attachments.f95zone.to/2023/07/2774371_a.png',
      'https://attachments.f95zone.to/2023/07/2774372_b.png',
      'https://attachments.f95zone.to/2023/07/2774373_c.png',
      'https://attachments.f95zone.to/2023/07/2774375_d.png',
    ])

    // Set custom sort order: c, a, d, b
    await setPreviewSort(1, [
      'https://attachments.f95zone.to/2023/07/2774373_c.png',
      'https://attachments.f95zone.to/2023/07/2774371_a.png',
      'https://attachments.f95zone.to/2023/07/2774375_d.png',
      'https://attachments.f95zone.to/2023/07/2774372_b.png',
    ])

    // No rows in previews table → rows.length === 0 → stream mode path.
    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toEqual([
      'https://attachments.f95zone.to/2023/07/2774373_c.png',
      'https://attachments.f95zone.to/2023/07/2774371_a.png',
      'https://attachments.f95zone.to/2023/07/2774375_d.png',
      'https://attachments.f95zone.to/2023/07/2774372_b.png',
    ])
  })

  it('falls back to natural order when no preview_sort entries exist (stream mode)', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    await insertRemotePreviews(1, [
      'https://attachments.f95zone.to/2023/07/2774371_a.png',
      'https://attachments.f95zone.to/2023/07/2774372_b.png',
      'https://attachments.f95zone.to/2023/07/2774373_c.png',
    ])

    // No preview_sort entries → natural order (preserves getRemotePreviewUrls order).
    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toHaveLength(3)
    expect(urls).toContain('https://attachments.f95zone.to/2023/07/2774371_a.png')
    expect(urls).toContain('https://attachments.f95zone.to/2023/07/2774372_b.png')
    expect(urls).toContain('https://attachments.f95zone.to/2023/07/2774373_c.png')
  })
})

describe('preview_sort clear', () => {
  it('clearing preview_sort returns to natural order', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)
    await updatePreviews(1, 'data/images/1/c.webp', 'https://example.com/c.jpg', false)

    // Set custom order: c, a, b
    await setPreviewSort(1, [
      'https://example.com/c.jpg',
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ])

    const sorted = await getPreviews(1, dataDir, false, { mode: 'stream' })
    expect(sorted).toEqual([
      'https://example.com/c.jpg',
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ])

    // Clear sort order.
    await new Promise((resolve) => {
      dbIndex.db.run(`DELETE FROM preview_sort WHERE record_id = ?`, [1], (err) => resolve())
    })

    const natural = await getPreviews(1, dataDir, false, { mode: 'stream' })
    expect(natural).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
      'https://example.com/c.jpg',
    ])
  })
})

describe('insertPreviewSortRow', () => {
  it('inserts with created_at timestamp', async () => {
    const { dataDir } = await openFreshDatabase()
    const before = Date.now()
    await insertPreviewSortRow(1, 'custom_0', -1)
    const after = Date.now()

    const row = await getDbGet(
      'SELECT position, created_at FROM preview_sort WHERE record_id = 1 AND identifier = ?',
      ['custom_0']
    )
    expect(row).not.toBeNull()
    expect(row.position).toBe(-1)
    // created_at is epoch microseconds (now*1000 + sub-ms counter), so compare
    // against the microsecond bounds of the wall-clock window.
    expect(row.created_at).toBeGreaterThanOrEqual(before * 1000)
    expect(row.created_at).toBeLessThanOrEqual(after * 1000 + 999)
  })

  it('assigns distinct, ordered created_at to same-millisecond inserts', async () => {
    await openFreshDatabase()
    // Two inserts in the same event-loop tick land in the same millisecond.
    await insertPreviewSortRow(1, 'custom_0', -1)
    await insertPreviewSortRow(1, 'custom_1', -1)

    const rows = await getDbAll(
      'SELECT identifier, created_at FROM preview_sort WHERE record_id = 1 ORDER BY identifier'
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].identifier).toBe('custom_0')
    expect(rows[1].identifier).toBe('custom_1')
    // Distinct, strictly increasing: earlier insert gets the smaller timestamp.
    expect(rows[0].created_at).toBeLessThan(rows[1].created_at)
  })
})

describe('preview_sort -1 custom zone and tiebreaking', () => {
  it('sorts -1 custom items before positive-position items', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'a.webp'), 'fake-webp-data')
    fs.writeFileSync(path.join(imageDir, 'b.webp'), 'fake-webp-data')
    fs.writeFileSync(path.join(imageDir, 'custom.webp'), 'fake-webp-data')

    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)
    await updatePreviews(1, 'data/images/1/custom.webp', null, true)

    // Set positions: a at 0, b at 1, custom at -1
    await insertPreviewSortRow(1, 'https://example.com/a.jpg', 0)
    await insertPreviewSortRow(1, 'https://example.com/b.jpg', 1)
    await insertPreviewSortRow(1, 'data/images/1/custom.webp', -1)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })
    // Custom (-1) should come before sorted (0, 1); local files resolve to absolute paths
    expect(urls[0]).toMatch(/custom\.webp$/)
    expect(urls[1]).toMatch(/a\.webp$/)
    expect(urls[2]).toMatch(/b\.webp$/)
  })

  it('tiebreaks same position by created_at ASC', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)

    const now = Date.now()
    await new Promise((resolve) => {
      dbIndex.db.serialize(() => {
        dbIndex.db.run(`DELETE FROM preview_sort WHERE record_id = ?`, [1])
        const stmt = dbIndex.db.prepare(
          `INSERT INTO preview_sort (record_id, identifier, position, created_at) VALUES (?, ?, ?, ?)`
        )
        stmt.run(1, 'https://example.com/b.jpg', 0, now + 2)
        stmt.run(1, 'https://example.com/a.jpg', 0, now + 1)
        stmt.finalize(() => resolve())
      })
    })

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })
    // a was created first (now+1), so it should come before b (now+2)
    expect(urls).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ])
  })

  it('simulates reorder-previews -1 promotion: custom items move to sorted zone when positive items appear ahead', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'a.webp'), 'fake-webp-data')
    fs.writeFileSync(path.join(imageDir, 'b.webp'), 'fake-webp-data')
    fs.writeFileSync(path.join(imageDir, 'custom.webp'), 'fake-webp-data')

    await updatePreviews(1, 'data/images/1/a.webp', 'https://example.com/a.jpg', false)
    await updatePreviews(1, 'data/images/1/b.webp', 'https://example.com/b.jpg', false)
    await updatePreviews(1, 'data/images/1/custom.webp', null, true)

    // Simulate what reorder-previews would produce after promotion:
    // Old order was [custom(-1), a(0), b(1)]; user drags a and b ahead of custom.
    // After promotion: custom moves to position 2 (after a=0, b=1).
    await insertPreviewSortRow(1, 'https://example.com/a.jpg', 0)
    await insertPreviewSortRow(1, 'https://example.com/b.jpg', 1)
    await insertPreviewSortRow(1, 'data/images/1/custom.webp', 2)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })
    // After promotion: a=0, b=1, custom=2; local files resolve to absolute paths
    expect(urls[0]).toMatch(/a\.webp$/)
    expect(urls[1]).toMatch(/b\.webp$/)
    expect(urls[2]).toMatch(/custom\.webp$/)
  })
})
