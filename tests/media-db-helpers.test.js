import { describe, it, expect } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')
const sqlite3 = require('sqlite3').verbose()

const dbIndex = require('../electron/db/index.js')
const {
  updatePreviews,
  getPreviews,
  deletePreviews,
  deleteBanner,
  updateBanners,
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

describe('deletePreviews', () => {
  it('deletes preview files from disk and clears both previews and media_assets tables', async () => {
    const { dataDir } = await openFreshDatabase()

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    const previewFile = path.join(imageDir, 'preview_f95_001_pr.webp')
    fs.writeFileSync(previewFile, 'fake-webp-data')

    await updatePreviews(1, 'data/images/1/preview_f95_001_pr.webp', 256)

    expect(fs.existsSync(previewFile)).toBe(true)
    let previewRows = await new Promise((resolve) => {
      dbIndex.db.all('SELECT * FROM previews WHERE record_id = 1', (e, r) => resolve(e ? [] : r))
    })
    expect(previewRows).toHaveLength(1)

    await deletePreviews(1, dataDir, false)

    expect(fs.existsSync(previewFile)).toBe(false)

    previewRows = await new Promise((resolve) => {
      dbIndex.db.all('SELECT * FROM previews WHERE record_id = 1', (e, r) => resolve(e ? [] : r))
    })
    expect(previewRows).toHaveLength(0)

    const assetRows = await new Promise((resolve) => {
      dbIndex.db.all(
        "SELECT * FROM media_assets WHERE record_id = 1 AND asset_type LIKE '%preview%'",
        (e, r) => resolve(e ? [] : r)
      )
    })
    expect(assetRows).toHaveLength(0)
  })
})

describe('hasLocalBanner regression', () => {
  it('detects banners stored in the banners table, not just media_assets', async () => {
    await openFreshDatabase()
    await updateBanners(1, 'data/images/1/downloaded_banner.webp', 'f95')

    const fromAssets = await new Promise((resolve) => {
      dbIndex.db.get(
        `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%banner%' LIMIT 1`,
        [1],
        (err, row) => resolve(err ? null : row || null)
      )
    })
    const fromBanners = await new Promise((resolve) => {
      dbIndex.db.get(
        `SELECT 1 FROM banners WHERE record_id = ? LIMIT 1`,
        [1],
        (err, row) => resolve(err ? null : row || null)
      )
    })

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
    let bannerRows = await new Promise((resolve) => {
      dbIndex.db.all('SELECT * FROM banners WHERE record_id = 1', (e, r) => resolve(e ? [] : r))
    })
    expect(bannerRows).toHaveLength(1)

    await deleteBanner(1, dataDir, false)

    expect(fs.existsSync(bannerFile)).toBe(false)

    bannerRows = await new Promise((resolve) => {
      dbIndex.db.all('SELECT * FROM banners WHERE record_id = 1', (e, r) => resolve(e ? [] : r))
    })
    expect(bannerRows).toHaveLength(0)

    const assetRows = await new Promise((resolve) => {
      dbIndex.db.all(
        "SELECT * FROM media_assets WHERE record_id = 1 AND asset_type LIKE '%banner%'",
        (e, r) => resolve(e ? [] : r)
      )
    })
    expect(assetRows).toHaveLength(0)
  })
})
