const path = require('path')
const fs = require('fs')
const os = require('os')
const Module = require('module')

const ipcHandlers = new Map()
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
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return stub
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
const { getPreviewsWithMeta } = require('../electron/db/media.js')

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-previews-meta-'))

const openFreshDatabase = (dataDir) => {
  dbIndex.initializeDatabase(dataDir)
  return new Promise((resolve) => {
    dbIndex.db.get('PRAGMA table_info(previews)', (err, rows) => {
      resolve(err ? null : { dataDir, rows: rows || [] })
    })
  })
}

describe('get-previews-meta IPC handler', () => {
  it('returns enriched preview objects (url/source/location), not plain URLs', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    const f95Path = path.join(imageDir, 'preview_f95_a.webp')
    const customPath = path.join(imageDir, 'preview_custom_a.webp')
    fs.writeFileSync(f95Path, 'fake-webp')
    fs.writeFileSync(customPath, 'fake-webp')

    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\preview_f95_a.webp', 'https://f95zone.to/thread/x.jpg', 0],
        (err) => err ? reject(err) : resolve(),
      )
    })
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\preview_custom_a.webp', null, 1],
        (err) => err ? reject(err) : resolve(),
      )
    })

    require('../electron/ipc/media.js')({
      getAssetBasePath: () => dataDir,
      getMediaStorageMode: () => 'stream',
      getMetadataSourceOrder: () => ['f95', 'lewdcorner', 'steam', 'gog'],
      getPreviewsWithMeta,
      dataDir,
      templatesDir: path.join(dataDir, 'templates'),
      configPath: path.join(dataDir, 'config.ini'),
    })

    const handler = ipcHandlers.get('get-previews-meta')
    expect(handler).toBeDefined()

    const result = await handler(null, { recordId: 1 })

    expect(Array.isArray(result)).toBe(true)
    // Enriched objects, not strings
    expect(result.every((i) => typeof i === 'object' && 'url' in i && 'source' in i && 'location' in i)).toBe(true)

    const f95 = result.find((i) => i.source === 'f95')
    expect(f95).toBeDefined()
    expect(f95.location).toBe('local')

    const custom = result.find((i) => i.source === 'custom')
    expect(custom).toBeDefined()
    expect(custom.location).toBe('custom')
  })
})
