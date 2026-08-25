import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import Module from 'module'
import fs from 'fs'
import os from 'os'
import { Readable } from 'stream'
import sharp from 'sharp'

const ipcHandlers = new Map()

const validImageBuffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer()
let restoreLoad

const electronStub = () => ({
  ipcMain: {
    handle: (channel, fn) => ipcHandlers.set(channel, fn),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
})

beforeEach(() => {
  ipcHandlers.clear()
  const stub = electronStub()
  const axiosStub = {
    get: vi.fn(async (url, config = {}) => {
      if (config.responseType === 'arraybuffer') {
        return {
          headers: { 'content-length': String(validImageBuffer.length) },
          data: validImageBuffer,
        }
      }
      return {
        headers: { 'content-length': String(validImageBuffer.length) },
        data: new Readable({
          read() {
            this.push(validImageBuffer)
            this.push(null)
          },
        }),
      }
    }),
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return stub
    if (request === 'axios') return axiosStub
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
})

afterEach(() => {
  if (restoreLoad) restoreLoad()
})

const dbIndex = require('../electron/db/index.js')

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-custom-media-'))

const openFreshDatabase = (dataDir) => {
  dbIndex.initializeDatabase(dataDir)
  return new Promise((resolve) => {
    dbIndex.db.get('PRAGMA table_info(previews)', (err, rows) => {
      resolve(err ? null : { dataDir, rows: rows || [] })
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

const getDbAll = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
})

const getDbGet = (sql, params = []) => new Promise((resolve, reject) => {
  dbIndex.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
})

const updatePreviews = (recordId, previewPath, remoteUrl = null, isCustom = false) => {
  return new Promise((resolve, reject) => {
    dbIndex.db.run(
      `INSERT OR REPLACE INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
      [recordId, previewPath, remoteUrl, isCustom ? 1 : 0],
      (err) => err ? reject(err) : resolve()
    )
  })
}

const insertPreviewSortRow = (recordId, identifier, position) => {
  return new Promise((resolve, reject) => {
    dbIndex.db.run(
      `INSERT OR REPLACE INTO preview_sort (record_id, identifier, position, created_at) VALUES (?, ?, ?, ?)`,
      [recordId, identifier, position, Date.now()],
      (err) => err ? reject(err) : resolve()
    )
  })
}

const updateBanners = (recordId, bannerPath, type) => {
  return new Promise((resolve, reject) => {
    dbIndex.db.run(
      `INSERT OR REPLACE INTO banners (record_id, path, type) VALUES (?, ?, ?)`,
      [recordId, bannerPath, type],
      (err) => err ? reject(err) : resolve()
    )
  })
}

describe('add-custom-previews IPC handler', () => {
  it('copies local files into data/images and inserts preview + sort rows', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)

    const srcImage = path.join(dataDir, 'source_img.png')
    fs.writeFileSync(srcImage, 'fake-png-data')

    const registerMediaHandlers = require('../electron/ipc/media.js')
    registerMediaHandlers({
      getAssetBasePath: () => dataDir,
      dataDir,
      templatesDir: path.join(dataDir, 'templates'),
      getMediaStorageMode: () => 'stream',
      appConfig: {},
      configPath: path.join(dataDir, 'config.ini'),
      readActiveBannerLayout: () => null,
      firstMediaPath: (v) => Array.isArray(v) ? v[0] || '' : v || '',
      getBanner: () => Promise.resolve([]),
      updatePreviews,
      insertPreviewSortRow,
      updateBanners,
      deleteBanner: () => Promise.resolve(),
      deletePreviews: () => Promise.resolve(),
    })

    const handler = ipcHandlers.get('add-custom-previews')
    expect(handler).toBeDefined()

    const result = await handler(null, {
      recordId: 1,
      items: [{ id: 'test-1', srcPath: srcImage }],
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('test-1')
    expect(result[0].url).toContain('atlas-media://local/')

    const previewRows = await getDbAll('SELECT * FROM previews WHERE record_id = 1')
    expect(previewRows).toHaveLength(1)
    expect(previewRows[0].is_custom).toBe(1)
    expect(previewRows[0].remote_url).toBeNull()

    const sortRows = await getDbAll('SELECT * FROM preview_sort WHERE record_id = 1')
    expect(sortRows).toHaveLength(1)
    expect(sortRows[0].position).toBe(-1)
    expect(sortRows[0].identifier).toBe(previewRows[0].path)
  })
})

describe('add-custom-preview-from-url IPC handler', () => {
  it('downloads bytes and inserts preview + sort rows with progress events', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)

    const registerMediaHandlers = require('../electron/ipc/media.js')
    registerMediaHandlers({
      getAssetBasePath: () => dataDir,
      dataDir,
      templatesDir: path.join(dataDir, 'templates'),
      getMediaStorageMode: () => 'stream',
      appConfig: {},
      configPath: path.join(dataDir, 'config.ini'),
      readActiveBannerLayout: () => null,
      firstMediaPath: (v) => Array.isArray(v) ? v[0] || '' : v || '',
      getBanner: () => Promise.resolve([]),
      updatePreviews,
      insertPreviewSortRow,
      updateBanners,
      deleteBanner: () => Promise.resolve(),
      deletePreviews: () => Promise.resolve(),
    })

    const handler = ipcHandlers.get('add-custom-preview-from-url')
    expect(handler).toBeDefined()

    const result = await handler(null, {
      recordId: 1,
      id: 'url-1',
      url: 'https://example.com/test.png',
    })

    expect(result.id).toBe('url-1')
    expect(result.url).toContain('atlas-media://local/')

    const previewRows = await getDbAll('SELECT * FROM previews WHERE record_id = 1')
    expect(previewRows).toHaveLength(1)
    expect(previewRows[0].is_custom).toBe(1)
    expect(previewRows[0].remote_url).toBe('https://example.com/test.png')

    const sortRows = await getDbAll('SELECT * FROM preview_sort WHERE record_id = 1')
    expect(sortRows).toHaveLength(1)
    expect(sortRows[0].position).toBe(-1)
  })
})

describe('convert-and-save-banner-from-url IPC handler', () => {
  it('downloads bytes, converts banner, and emits progress', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)

    const registerMediaHandlers = require('../electron/ipc/media.js')
    registerMediaHandlers({
      getAssetBasePath: () => dataDir,
      dataDir,
      templatesDir: path.join(dataDir, 'templates'),
      getMediaStorageMode: () => 'stream',
      appConfig: {},
      configPath: path.join(dataDir, 'config.ini'),
      readActiveBannerLayout: () => null,
      firstMediaPath: (v) => Array.isArray(v) ? v[0] || '' : v || '',
      getBanner: () => Promise.resolve(['fake-banner-path']),
      updatePreviews,
      insertPreviewSortRow,
      updateBanners,
      deleteBanner: () => Promise.resolve(),
      deletePreviews: () => Promise.resolve(),
    })

    const handler = ipcHandlers.get('convert-and-save-banner-from-url')
    expect(handler).toBeDefined()

    const result = await handler(null, {
      recordId: 1,
      id: 'banner-1',
      url: 'https://example.com/banner.jpg',
    })

    expect(result.id).toBe('banner-1')
    expect(result.url).toBe('fake-banner-path')

    const bannerRows = await getDbAll('SELECT * FROM banners WHERE record_id = 1')
    expect(bannerRows.length).toBeGreaterThan(0)
  })
})

describe('convert-and-save-banner backward compatibility', () => {
  it('still accepts the two-arg form without progressId', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)

    const srcImage = path.join(dataDir, 'banner_src.jpg')
    fs.writeFileSync(srcImage, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x37, 0xff, 0xd9]))

    const registerMediaHandlers = require('../electron/ipc/media.js')
    registerMediaHandlers({
      getAssetBasePath: () => dataDir,
      dataDir,
      templatesDir: path.join(dataDir, 'templates'),
      getMediaStorageMode: () => 'stream',
      appConfig: {},
      configPath: path.join(dataDir, 'config.ini'),
      readActiveBannerLayout: () => null,
      firstMediaPath: (v) => Array.isArray(v) ? v[0] || '' : v || '',
      getBanner: () => Promise.resolve(['fake-banner']),
      updatePreviews,
      insertPreviewSortRow,
      updateBanners,
      deleteBanner: () => Promise.resolve(),
      deletePreviews: () => Promise.resolve(),
    })

    const handler = ipcHandlers.get('convert-and-save-banner')
    expect(handler).toBeDefined()

    const result = await handler(null, { recordId: 1, filePath: srcImage })
    expect(result).toBe('fake-banner')
  })
})

// ── Custom upload input validation ───────────────────────────────────────────
//
// The custom-preview paths write user-chosen files into data/images and register
// them as previews. The file dialog's filter and the drop zone's check are both
// advisory: the dialog lets a determined user type any name, and a dropped path
// arrives straight from the renderer. So the main process re-checks, and these
// pin that check.
//
// A file that is not an image still copies fine and still gets a previews row --
// it just renders as a permanently broken tile that atlas-media:// cannot draw
// and the user has to hunt down by hand.

const registerWithDataDir = (dataDir) => {
  const registerMediaHandlers = require('../electron/ipc/media.js')
  registerMediaHandlers({
    getAssetBasePath: () => dataDir,
    dataDir,
    templatesDir: path.join(dataDir, 'templates'),
    getMediaStorageMode: () => 'stream',
    appConfig: {},
    configPath: path.join(dataDir, 'config.ini'),
    readActiveBannerLayout: () => null,
    firstMediaPath: (v) => Array.isArray(v) ? v[0] || '' : v || '',
    getBanner: () => Promise.resolve([]),
    updatePreviews,
    insertPreviewSortRow,
    updateBanners,
    deleteBanner: () => Promise.resolve(),
    deletePreviews: () => Promise.resolve(),
  })
}

describe('custom preview upload rejects non-images', () => {
  it('refuses a local file whose extension is not an image', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)

    const srcExe = path.join(dataDir, 'installer.exe')
    fs.writeFileSync(srcExe, 'MZ-not-an-image')
    registerWithDataDir(dataDir)

    const handler = ipcHandlers.get('add-custom-previews')
    const result = await handler({ sender: null }, {
      recordId: 1,
      items: [{ id: 'exe-1', srcPath: srcExe }],
    })

    // Skipped, not copied: no result row and no previews row.
    expect(result).toHaveLength(0)
    const rows = await getDbAll('SELECT * FROM previews WHERE record_id = 1')
    expect(rows).toHaveLength(0)
    // ...and nothing landed in the image folder.
    const imageDir = path.join(dataDir, 'images', '1')
    const written = fs.existsSync(imageDir) ? fs.readdirSync(imageDir) : []
    expect(written).toHaveLength(0)
  })

  it('still accepts the image extensions it should', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)

    const accepted = ['a.png', 'b.JPG', 'c.jpeg', 'd.webp', 'e.gif', 'f.avif']
    const items = accepted.map((name, i) => {
      const p = path.join(dataDir, name)
      fs.writeFileSync(p, 'image-bytes')
      return { id: `ok-${i}`, srcPath: p }
    })
    registerWithDataDir(dataDir)

    const result = await ipcHandlers.get('add-custom-previews')({ sender: null }, {
      recordId: 1, items,
    })
    // Case-insensitive: .JPG counts.
    expect(result).toHaveLength(accepted.length)
  })

  it('refuses a non-http(s) URL rather than letting axios read it', async () => {
    // file:// would turn the paste box into a way to copy arbitrary local
    // files into the library.
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)
    registerWithDataDir(dataDir)

    await expect(
      ipcHandlers.get('add-custom-preview-from-url')({ sender: null }, {
        recordId: 1, id: 'u1', url: 'file:///etc/passwd',
      }),
    ).rejects.toThrow(/http and https/i)
  })

  it('refuses a URL that does not point at an image', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)
    registerWithDataDir(dataDir)

    await expect(
      ipcHandlers.get('add-custom-preview-from-url')({ sender: null }, {
        recordId: 1, id: 'u2', url: 'https://example.com/payload.exe',
      }),
    ).rejects.toThrow(/does not point at an image/i)
  })

  it('leaves no partial file behind when a fetch fails', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)
    await insertGame(1)
    registerWithDataDir(dataDir)

    await expect(
      ipcHandlers.get('add-custom-preview-from-url')({ sender: null }, {
        recordId: 1, id: 'u3', url: 'https://example.com/nope.txt',
      }),
    ).rejects.toThrow()

    const imageDir = path.join(dataDir, 'images', '1')
    const written = fs.existsSync(imageDir) ? fs.readdirSync(imageDir) : []
    expect(written).toHaveLength(0)
  })
})
