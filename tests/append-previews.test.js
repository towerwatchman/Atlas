import { describe, it, expect, vi, afterEach } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')
const axios = require('axios')
const sharp = require('sharp')

const dbIndex = require('../electron/db/index.js')
const { updatePreviews } = require('../electron/db/media.js')
const { downloadImages } = require('../electron/imageUtils.js')

afterEach(() => {
  vi.restoreAllMocks()
})

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-append-previews-'))

// Seeds and expects use the same form because downloadImages builds row
// paths with path.join. On Windows that means backslashes in the previews
// table.
const rp = (name) => path.join('data', 'images', '1', name)

const openFreshDatabase = async () => {
  const dataDir = freshDataDir()
  dbIndex.initializeDatabase(dataDir)
  await new Promise((resolve) => {
    dbIndex.db.get('PRAGMA table_info(previews)', () => resolve())
  })
  return dataDir
}

const realPngBytes = () => sharp({
  create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
}).png().toBuffer()

const stubNetwork = async () => {
  const bytes = await realPngBytes()
  vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: bytes, headers: {} })
}

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
})

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.run(sql, params, (err) => (err ? reject(err) : resolve()))
})

const seedPreviewFile = (dataDir, name, bytes = 'seed-bytes') => {
  const dir = path.join(dataDir, 'images', '1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), bytes)
}

const downloadNew = (dataDir, screenUrls) => downloadImages(
  1, 1, () => {}, false, true, 'Unlimited', false, dataDir,
  async () => null,
  async () => screenUrls,
  async () => {},
  updatePreviews,
  { source: 'f95', appendPreviews: true },
)

describe('append-only preview downloads', () => {
  it('puts one newcomer on the next free suffix and leaves stored rows, files, and sort positions alone', async () => {
    const dataDir = await openFreshDatabase()
    await stubNetwork()
    await updatePreviews(1, rp('preview_f95_001_pr.webp'), 'https://example.com/a.jpg')
    await updatePreviews(1, rp('preview_f95_002_pr.webp'), 'https://example.com/b.jpg')
    seedPreviewFile(dataDir, 'preview_f95_001_pr.webp')
    seedPreviewFile(dataDir, 'preview_f95_002_pr.webp')
    await dbRun(`DELETE FROM preview_sort WHERE record_id = 1`)
    await dbRun(
      `INSERT INTO preview_sort (record_id, identifier, position) VALUES (1, ?, 0), (1, ?, 1)`,
      ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    )

    await downloadNew(dataDir, ['https://example.com/c.jpg'])

    const rows = await dbAll(
      `SELECT path, remote_url FROM previews WHERE record_id = 1 ORDER BY path`,
    )
    expect(rows).toEqual([
      { path: rp('preview_f95_001_pr.webp'), remote_url: 'https://example.com/a.jpg' },
      { path: rp('preview_f95_002_pr.webp'), remote_url: 'https://example.com/b.jpg' },
      { path: rp('preview_f95_003_pr.webp'), remote_url: 'https://example.com/c.jpg' },
    ])

    const sort = await dbAll(
      `SELECT identifier, position FROM preview_sort WHERE record_id = 1 ORDER BY position`,
    )
    expect(sort).toEqual([
      { identifier: 'https://example.com/a.jpg', position: 0 },
      { identifier: 'https://example.com/b.jpg', position: 1 },
    ])
  })

  it('never reuses a freed suffix: a gap at 002 still appends at 004', async () => {
    const dataDir = await openFreshDatabase()
    await stubNetwork()
    await updatePreviews(1, rp('preview_f95_001_pr.webp'), 'https://example.com/a.jpg')
    await updatePreviews(1, rp('preview_f95_003_pr.webp'), 'https://example.com/c.jpg')
    seedPreviewFile(dataDir, 'preview_f95_001_pr.webp')
    seedPreviewFile(dataDir, 'preview_f95_003_pr.webp')

    await downloadNew(dataDir, ['https://example.com/d.jpg'])

    const rows = await dbAll(
      `SELECT path, remote_url FROM previews WHERE record_id = 1 ORDER BY path`,
    )
    expect(rows.map((r) => r.path)).toEqual([
      rp('preview_f95_001_pr.webp'),
      rp('preview_f95_003_pr.webp'),
      rp('preview_f95_004_pr.webp'),
    ])
  })

  it('421 regression: a shifted fresh list [B, A] over stored 001 = A never puts B under slot 001', async () => {
    const dataDir = await openFreshDatabase()
    await stubNetwork()
    await updatePreviews(1, rp('preview_f95_001_pr.webp'), 'https://example.com/a.jpg')
    seedPreviewFile(dataDir, 'preview_f95_001_pr.webp', 'original-bytes-A')

    await downloadNew(dataDir, ['https://example.com/b.jpg', 'https://example.com/a.jpg'])

    // Slot 001 keeps A's bytes and A's row: old bytes under a fresh URL is the bug.
    const slotBytes = fs.readFileSync(
      path.join(dataDir, 'images', '1', 'preview_f95_001_pr.webp'),
      'utf8',
    )
    expect(slotBytes).toBe('original-bytes-A')
    const slotRow = await dbAll(
      `SELECT remote_url FROM previews WHERE record_id = 1 AND path = ?`,
      [rp('preview_f95_001_pr.webp')],
    )
    expect(slotRow).toHaveLength(1)
    expect(slotRow[0].remote_url).toBe('https://example.com/a.jpg')
  })
})
