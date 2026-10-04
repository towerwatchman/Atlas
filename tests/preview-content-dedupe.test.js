// Phase 1 (#301): cross-representation preview dedupe.
//
// The same picture can arrive as a downloaded disk file (keyed by its stored
// remote_url) and as a remote URL with a rotated ?t= cache-buster, a swapped
// CDN host, or a different source host (devs re-upload identical files to
// Steam and F95 — same embedded hash). getPreviews must list it once, with
// the disk file winning.
import { describe, it, expect } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')

const dbIndex = require('../electron/db/index.js')
const { getPreviews } = require('../electron/db/media.js')

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-preview-dedupe-'))

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

const run = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.run(sql, params, (err) => (err ? reject(err) : resolve()))
})

const saveFile = (dataDir, relPath) => {
  const full = path.join(dataDir, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, 'fake-image-bytes')
}

const insertGame = async (recordId = 1) => {
  await run(`INSERT OR REPLACE INTO games (record_id, title, creator, engine) VALUES (?, ?, ?, ?)`, [recordId, 'Test Game', 'TestCreator', 'TestEngine'])
  await run(`INSERT OR IGNORE INTO atlas_mappings (record_id, atlas_id) VALUES (?, 1)`, [recordId])
}

const linkSteam = async (recordId = 1, appid = 100) => {
  await run(`INSERT OR IGNORE INTO steam_mappings (record_id, steam_id) VALUES (?, ?)`, [recordId, appid])
  await run(`INSERT OR IGNORE INTO steam_data (steam_id) VALUES (?)`, [appid])
}

const addSteamScreen = async (appid, url) => {
  await run(`INSERT OR IGNORE INTO steam_screens (steam_id, screen_url) VALUES (?, ?)`, [appid, url])
}

const linkF95Screen = async (url) => {
  await run(`INSERT OR IGNORE INTO f95_zone_data (f95_id, atlas_id) VALUES (1, 1)`)
  await run(`INSERT INTO f95_zone_screens (f95_id, screen_url) VALUES (?, ?)`, [1, url])
}

const saveDownload = async (recordId, relPath, remoteUrl, dataDir) => {
  saveFile(dataDir, relPath)
  await run(`INSERT OR REPLACE INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, 0)`, [recordId, relPath, remoteUrl])
}

const HASH = '1c9404709062641ab14d795cf3c627cedf83a8f7'
const steamUrl = (t) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/100/ss_${HASH}.1920x1080.jpg?t=${t}`
const F95_TWIN = `https://attachments.f95zone.to/2023/07/2779350_ss_${HASH}.1920x1080.jpg`
const F95_OTHER = 'https://attachments.f95zone.to/2023/07/2779390_brianna_3_8.png'

describe('preview cross-representation dedupe (#301)', () => {
  it('rotated ?t= collapses to the downloaded file', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)
    await linkSteam(1, 100)
    await addSteamScreen(100, steamUrl(222))
    await saveDownload(1, 'data/images/1/s.webp', steamUrl(111), dataDir)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/data\/images\/1\/s\.webp$/)
  })

  it('shared-hash F95 twin collapses to the downloaded file', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)
    await linkF95Screen(F95_TWIN)
    await saveDownload(1, 'data/images/1/s.webp', steamUrl(111), dataDir)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/data\/images\/1\/s\.webp$/)
  })

  it('distinct pictures are all kept (no over-dedupe)', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)
    await linkF95Screen(F95_OTHER)
    await saveDownload(1, 'data/images/1/s.webp', steamUrl(111), dataDir)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toHaveLength(2)
    expect(urls[0]).toMatch(/data\/images\/1\/s\.webp$/)
    expect(urls).toContain(F95_OTHER)
  })

  it('remote-only ?t= variants collapse to one', async () => {
    const { dataDir } = await openFreshDatabase()
    await insertGame(1)
    await linkSteam(1, 100)
    await addSteamScreen(100, steamUrl(111))
    await addSteamScreen(100, steamUrl(222))

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toHaveLength(1)
  })
})
