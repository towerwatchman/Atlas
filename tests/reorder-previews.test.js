import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import Module from 'module'
import fs from 'fs'
import os from 'os'

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

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-reorder-'))

const openFreshDatabase = (dataDir) => {
  dbIndex.initializeDatabase(dataDir)
  return new Promise((resolve) => {
    dbIndex.db.get('PRAGMA table_info(previews)', (err, rows) => {
      resolve(err ? null : { dataDir, rows: rows || [] })
    })
  })
}

describe('reorder-previews IPC handler', () => {
  it('maps display URLs to remote_url identifiers when previews.path has Windows backslashes', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'preview_a.webp'), 'fake-webp')
    fs.writeFileSync(path.join(imageDir, 'preview_b.webp'), 'fake-webp')

    // Simulate Windows path.join producing backslashes in previews.path
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\preview_a.webp', 'https://example.com/a.jpg', 0],
        (err) => err ? reject(err) : resolve()
      )
    })
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\preview_b.webp', 'https://example.com/b.jpg', 0],
        (err) => err ? reject(err) : resolve()
      )
    })

    const registerMediaHandlers = require('../electron/ipc/media.js')
    registerMediaHandlers({
      getAssetBasePath: () => dataDir,
      dataDir,
      templatesDir: path.join(dataDir, 'templates'),
      getMediaStorageMode: () => 'stream',
      appConfig: {},
      configPath: path.join(dataDir, 'config.ini'),
      readActiveBannerLayout: () => null,
    })

    const handler = ipcHandlers.get('reorder-previews')
    expect(handler).toBeDefined()

    const displayUrlA = `${dataDir}/data/images/1/preview_a.webp`.replace(/\\/g, '/')
    const displayUrlB = `${dataDir}/data/images/1/preview_b.webp`.replace(/\\/g, '/')

    const result = await handler(null, {
      recordId: 1,
      orderedPaths: [displayUrlB, displayUrlA],
    })

    expect(result.success).toBe(true)

    const sortRows = await new Promise((resolve, reject) => {
      dbIndex.db.all(
        `SELECT identifier, position FROM preview_sort WHERE record_id = ? ORDER BY position`,
        [1],
        (err, rows) => resolve(err ? reject(err) : rows)
      )
    })

    expect(sortRows).toEqual([
      { identifier: 'https://example.com/b.jpg', position: 0 },
      { identifier: 'https://example.com/a.jpg', position: 1 },
    ])
  })
})
