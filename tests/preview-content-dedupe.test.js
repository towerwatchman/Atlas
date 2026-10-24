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
const { getPreviews, getBrowsePreviewUrls } = require('../electron/db/media.js')

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

describe('preview season scoping (#301)', () => {
  const S1 = 101
  const S2 = 102
  const S1_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const S2_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const s1Url = (t) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${S1}/ss_${S1_HASH}.1920x1080.jpg?t=${t}`
  const s2Url = (t) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${S2}/ss_${S2_HASH}.1920x1080.jpg?t=${t}`

  // A second season reaches the same record through the shared atlas link:
  // steam_mappings holds one steam_id per record, so S2's steam_data row is
  // atlas-linked instead of mapped.
  const linkAtlasSeason = (appid) =>
    run(`INSERT OR IGNORE INTO steam_data (steam_id, atlas_id) VALUES (?, 1)`, [appid])

  const twoSeasonLibrary = async () => {
    await insertGame(1)
    await linkSteam(1, S1)
    await addSteamScreen(S1, s1Url(111))
    await linkAtlasSeason(S2)
    await addSteamScreen(S2, s2Url(111))
  }

  it('downloaded S1 files stay hidden while S2 is selected', async () => {
    const { dataDir } = await openFreshDatabase()
    await twoSeasonLibrary()
    await saveDownload(1, 'data/images/1/s1.webp', s1Url(222), dataDir)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream', sourceAppId: String(S2) })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe(s2Url(111))
  })

  it('downloaded S1 files collapse with their remote twin while S1 is selected', async () => {
    const { dataDir } = await openFreshDatabase()
    await twoSeasonLibrary()
    await saveDownload(1, 'data/images/1/s1.webp', s1Url(222), dataDir)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream', sourceAppId: String(S1) })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/data\/images\/1\/s1\.webp$/)
  })

  it('no season selected shows every downloaded set', async () => {
    const { dataDir } = await openFreshDatabase()
    await twoSeasonLibrary()
    await saveDownload(1, 'data/images/1/s1.webp', s1Url(222), dataDir)

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream' })

    expect(urls).toHaveLength(2)
    expect(urls[0]).toMatch(/data\/images\/1\/s1\.webp$/)
    expect(urls).toContain(s2Url(111))
  })

  it('selected season shows only its own art when nothing is downloaded', async () => {
    const { dataDir } = await openFreshDatabase()
    await twoSeasonLibrary()

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream', sourceAppId: String(S2) })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe(s2Url(111))
  })

  it('customs and videos pass through the season filter', async () => {
    const { dataDir } = await openFreshDatabase()
    await twoSeasonLibrary()
    saveFile(dataDir, 'data/images/1/custom.webp')
    await run(`INSERT OR REPLACE INTO previews (record_id, path, remote_url, is_custom) VALUES (1, ?, NULL, 1)`, ['data/images/1/custom.webp'])
    const s1Mp4 = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${S1}/movie_1080.mp4`
    saveFile(dataDir, 'data/images/1/s1clip.mp4')
    await run(`INSERT OR REPLACE INTO previews (record_id, path, remote_url, is_custom) VALUES (1, ?, ?, 0)`, ['data/images/1/s1clip.mp4', s1Mp4])

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream', sourceAppId: String(S2) })

    expect(urls).toContain(s2Url(111))
    expect(urls.find((u) => /custom\.webp$/.test(String(u)))).toBeTruthy()
    expect(urls.find((u) => /s1clip\.mp4$/.test(String(u)))).toBeTruthy()
  })
})

describe('preview season linkage without atlas (#301)', () => {
  const S1 = 101
  const S2 = 102
  const s1Shot = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${S1}/ss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.1920x1080.jpg`
  const s2Shot = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${S2}/ss_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.1920x1080.jpg`
  const s2Movie = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${S2}/movie_1080.mp4`

  // Production shape for on-demand rows: fetchAndStoreSteamData is the only
  // steam_data writer and stores atlas_id NULL, steam_mappings holds S1 only,
  // and no atlas_data row links S2. The season exists solely as a version row
  // (source/appid), exactly like an owned-but-uninstalled season.
  const unlinkedSecondSeason = async () => {
    await insertGame(1)
    await linkSteam(1, S1)
    await run(`INSERT OR IGNORE INTO steam_data (steam_id) VALUES (?)`, [S2])
    await addSteamScreen(S1, s1Shot)
    await addSteamScreen(S2, s2Shot)
    const now = Date.now()
    await run(`INSERT INTO versions (record_id, version, game_path, exec_path, in_place, date_added, source, source_app_id)
               VALUES (1, 'Season 1', '', '', 0, ?, 'steam', ?)`, [now, String(S1)])
    await run(`INSERT INTO versions (record_id, version, game_path, exec_path, in_place, date_added, source, source_app_id)
               VALUES (1, 'Season 2', '', '', 0, ?, 'steam', ?)`, [now + 1, String(S2)])
  }

  it('season linked only by its version row shows its own steam art', async () => {
    const { dataDir } = await openFreshDatabase()
    await unlinkedSecondSeason()

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream', sourceAppId: String(S2) })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe(s2Shot)
  })

  it('season linked only by its version row shows its trailers', async () => {
    const { dataDir } = await openFreshDatabase()
    await unlinkedSecondSeason()
    await run(`INSERT INTO steam_movies (steam_id, movie_url, thumbnail) VALUES (?, ?, ?)`, [S2, s2Movie, s2Shot])

    const urls = await getPreviews(1, dataDir, false, { mode: 'stream', sourceAppId: String(S2) })

    expect(urls).toContain(s2Movie)
  })
})

describe('browse season scoping (#301)', () => {
  const S1 = 101
  const S2 = 102
  const S1_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const S2_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const s1Url = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${S1}/ss_${S1_HASH}.1920x1080.jpg`
  const s2Url = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${S2}/ss_${S2_HASH}.1920x1080.jpg`

  // Production shape: the server links several appids to one atlas_id via
  // steam_data.atlas_id, so both seasons are atlas-linked (no steam_mappings
  // involved on the catalog path).
  const twoAtlasLinkedSeasons = async () => {
    await run(`INSERT OR IGNORE INTO steam_data (steam_id, atlas_id) VALUES (?, 1)`, [S1])
    await run(`INSERT OR IGNORE INTO steam_data (steam_id, atlas_id) VALUES (?, 1)`, [S2])
    await addSteamScreen(S1, s1Url)
    await addSteamScreen(S2, s2Url)
  }

  it('picked season hides the other atlas-linked season', async () => {
    await openFreshDatabase()
    await twoAtlasLinkedSeasons()

    const urls = await getBrowsePreviewUrls({ atlasId: 1, steamId: S2 })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe(s2Url)
  })

  it('atlas-only lookup still aggregates when no season is picked', async () => {
    await openFreshDatabase()
    await twoAtlasLinkedSeasons()

    const urls = await getBrowsePreviewUrls({ atlasId: 1 })

    expect(urls).toHaveLength(2)
  })
})
