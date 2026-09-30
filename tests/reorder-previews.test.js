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

  it('returns error for non-array orderedPaths', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)

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
    const result = await handler(null, { recordId: 1, orderedPaths: 'not-an-array' })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('promotes -1 custom items to positive positions when dragged after sorted items', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'a.webp'), 'fake-webp')
    fs.writeFileSync(path.join(imageDir, 'b.webp'), 'fake-webp')
    fs.writeFileSync(path.join(imageDir, 'custom.webp'), 'fake-webp')

    // Insert downloaded previews (no remote_url for custom)
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\a.webp', 'https://example.com/a.jpg', 0],
        (err) => err ? reject(err) : resolve()
      )
    })
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\b.webp', 'https://example.com/b.jpg', 0],
        (err) => err ? reject(err) : resolve()
      )
    })
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\custom.webp', null, 1],
        (err) => err ? reject(err) : resolve()
      )
    })

    // Custom item starts at -1
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO preview_sort (record_id, identifier, position, created_at) VALUES (?, ?, ?, ?)`,
        [1, 'data/images/1/custom.webp', -1, Date.now()],
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
    const displayA = `${dataDir}/data/images/1/a.webp`.replace(/\\/g, '/')
    const displayB = `${dataDir}/data/images/1/b.webp`.replace(/\\/g, '/')
    const displayCustom = `${dataDir}/data/images/1/custom.webp`.replace(/\\/g, '/')

    // User drags: a, custom, b — custom should be promoted from -1 to 1
    const result = await handler(null, {
      recordId: 1,
      orderedPaths: [displayA, displayCustom, displayB],
    })

    expect(result.success).toBe(true)

    const sortRows = await new Promise((resolve, reject) => {
      dbIndex.db.all(
        `SELECT identifier, position FROM preview_sort WHERE record_id = ? ORDER BY position`,
        [1],
        (err, rows) => resolve(err ? reject(err) : rows)
      )
    })

    // Identifiers are normalized to forward slashes, so custom items use
    // forward-slash paths regardless of OS.
    expect(sortRows).toEqual([
      { identifier: 'https://example.com/a.jpg', position: 0 },
      { identifier: 'data/images/1/custom.webp', position: 1 },
      { identifier: 'https://example.com/b.jpg', position: 2 },
    ])
  })

  it('keeps -1 position for custom items when no positive items appear ahead', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'custom_a.webp'), 'fake-webp')
    fs.writeFileSync(path.join(imageDir, 'custom_b.webp'), 'fake-webp')

    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\custom_a.webp', null, 1],
        (err) => err ? reject(err) : resolve()
      )
    })
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\custom_b.webp', null, 1],
        (err) => err ? reject(err) : resolve()
      )
    })

    // Both start at -1
    await new Promise((resolve, reject) => {
      dbIndex.db.serialize(() => {
        dbIndex.db.run(
          `INSERT INTO preview_sort (record_id, identifier, position, created_at) VALUES (?, ?, ?, ?)`,
          [1, 'data/images/1/custom_a.webp', -1, Date.now()]
        )
        dbIndex.db.run(
          `INSERT INTO preview_sort (record_id, identifier, position, created_at) VALUES (?, ?, ?, ?)`,
          [1, 'data/images/1/custom_b.webp', -1, Date.now() + 1],
          (err) => err ? reject(err) : resolve()
        )
      })
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
    const displayA = `${dataDir}/data/images/1/custom_a.webp`.replace(/\\/g, '/')
    const displayB = `${dataDir}/data/images/1/custom_b.webp`.replace(/\\/g, '/')

    // Both items are custom (-1), no positive items — both stay at -1
    const result = await handler(null, {
      recordId: 1,
      orderedPaths: [displayB, displayA],
    })

    expect(result.success).toBe(true)

    const sortRows = await new Promise((resolve, reject) => {
      dbIndex.db.all(
        `SELECT identifier, position FROM preview_sort WHERE record_id = ? ORDER BY position, created_at`,
        [1],
        (err, rows) => resolve(err ? reject(err) : rows)
      )
    })

    // All items should remain at position -1 since no positive items appeared ahead.
    expect(sortRows).toHaveLength(2)
    expect(sortRows[0].position).toBe(-1)
    expect(sortRows[1].position).toBe(-1)
  })

  it('preserves created_at across reorders for stable tiebreaking', async () => {
    const dataDir = freshDataDir()
    await openFreshDatabase(dataDir)

    const imageDir = path.join(dataDir, 'data', 'images', '1')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'a.webp'), 'fake-webp')
    fs.writeFileSync(path.join(imageDir, 'b.webp'), 'fake-webp')

    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\a.webp', 'https://example.com/a.jpg', 0],
        (err) => err ? reject(err) : resolve()
      )
    })
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO previews (record_id, path, remote_url, is_custom) VALUES (?, ?, ?, ?)`,
        [1, 'data\\images\\1\\b.webp', 'https://example.com/b.jpg', 0],
        (err) => err ? reject(err) : resolve()
      )
    })

    const ts1 = 1000000
    const ts2 = 2000000
    await new Promise((resolve, reject) => {
      dbIndex.db.serialize(() => {
        dbIndex.db.run(
          `INSERT INTO preview_sort (record_id, identifier, position, created_at) VALUES (?, ?, ?, ?)`,
          [1, 'https://example.com/a.jpg', 0, ts1]
        )
        dbIndex.db.run(
          `INSERT INTO preview_sort (record_id, identifier, position, created_at) VALUES (?, ?, ?, ?)`,
          [1, 'https://example.com/b.jpg', 1, ts2],
          (err) => err ? reject(err) : resolve()
        )
      })
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
    const displayA = `${dataDir}/data/images/1/a.webp`.replace(/\\/g, '/')
    const displayB = `${dataDir}/data/images/1/b.webp`.replace(/\\/g, '/')

    // Reverse order: b, a
    await handler(null, { recordId: 1, orderedPaths: [displayB, displayA] })

    const sortRows = await new Promise((resolve, reject) => {
      dbIndex.db.all(
        `SELECT identifier, position, created_at FROM preview_sort WHERE record_id = ? ORDER BY position`,
        [1],
        (err, rows) => resolve(err ? reject(err) : rows)
      )
    })

    // created_at should be preserved from the original inserts
    expect(sortRows[0].identifier).toBe('https://example.com/b.jpg')
    expect(sortRows[0].created_at).toBe(ts2)
    expect(sortRows[1].identifier).toBe('https://example.com/a.jpg')
    expect(sortRows[1].created_at).toBe(ts1)
  })
})
