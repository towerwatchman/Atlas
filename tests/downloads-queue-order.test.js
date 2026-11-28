import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import Module from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A new download must run before the current front, including after a manual reorder.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-dl-order-'))

const electronStub = {
  ipcMain: { handle: () => {} },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => dataDir },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(String(s)),
    decryptString: (b) => String(b),
  },
}

const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub
  return originalLoad.call(this, request, ...rest)
}

const dbIndex = require('../electron/db/index.js')
const downloadsDb = require('../electron/db/downloads.js')
const manager = require('../electron/downloads/downloadManager.js')

Module._load = originalLoad

const clearDownloads = () => new Promise((resolve, reject) => {
  dbIndex.db.run('DELETE FROM downloads', (err) => (err ? reject(err) : resolve()))
})

describe('download queue order', () => {
  beforeAll(async () => {
    dbIndex.initializeDatabase(dataDir)
    await downloadsDb.initializeDownloads()
  })

  beforeEach(async () => {
    await clearDownloads()
  })

  afterAll(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // Best-effort temp cleanup only.
    }
  })

  it('puts a new download ahead of the front and skips a row that cannot run', async () => {
    const a = await downloadsDb.enqueueDownload({ title: 'A', state: 'queued' })
    const b = await downloadsDb.enqueueDownload({ title: 'B', state: 'queued' })
    const c = await downloadsDb.enqueueDownload({ title: 'C', state: 'queued' })

    expect(a.item.queueOrder).toBeGreaterThan(b.item.queueOrder)
    expect(b.item.queueOrder).toBeGreaterThan(c.item.queueOrder)
    expect((await downloadsDb.claimNextQueued())?.id).toBe(c.id)

    await downloadsDb.updateDownload(c.id, { state: 'paused' })
    expect((await downloadsDb.claimNextQueued())?.id).toBe(b.id)
  })

  it('puts a new download ahead of a reordered queue', async () => {
    const a = await downloadsDb.enqueueDownload({ title: 'A', state: 'queued' })
    const b = await downloadsDb.enqueueDownload({ title: 'B', state: 'queued' })
    const c = await downloadsDb.enqueueDownload({ title: 'C', state: 'queued' })
    await downloadsDb.reorderDownloads([a.id, b.id, c.id])
    const earlier = await downloadsDb.listDownloads()
    const d = await downloadsDb.enqueueDownload({ title: 'D', state: 'queued' })

    expect(d.item.queueOrder).toBeLessThan(Math.min(...earlier.map((item) => item.queueOrder)))
    expect((await downloadsDb.claimNextQueued())?.id).toBe(d.id)
  })

  it('honours reordered ids as the runner order', async () => {
    const a = await downloadsDb.enqueueDownload({ title: 'A', state: 'queued' })
    const b = await downloadsDb.enqueueDownload({ title: 'B', state: 'queued' })
    const c = await downloadsDb.enqueueDownload({ title: 'C', state: 'queued' })
    await downloadsDb.reorderDownloads([c.id, a.id, b.id])

    const queued = (await downloadsDb.listDownloads()).filter((item) => item.state === 'queued')
    expect(queued.map((item) => item.id)).toEqual([c.id, a.id, b.id])
    expect((await downloadsDb.claimNextQueued())?.id).toBe(c.id)
  })

  it('puts the last finished download at the front of Completed', async () => {
    const a = await downloadsDb.enqueueDownload({ title: 'A', state: 'queued' })
    const b = await downloadsDb.enqueueDownload({ title: 'B', state: 'queued' })
    const c = await downloadsDb.enqueueDownload({ title: 'C', state: 'queued' })

    await manager.setItemState(c.id, 'done', { completedAt: 100 })
    await manager.setItemState(a.id, 'done', { completedAt: 200 })

    const finished = await downloadsDb.listDownloads({ includeFinished: true })
    const done = finished.filter((item) => item.state === 'done')
    expect(done.map((item) => item.id)).toEqual([a.id, c.id])
    expect((await downloadsDb.claimNextQueued())?.id).toBe(b.id)

    await manager.setItemState(b.id, 'canceled')
    const afterCancel = await downloadsDb.listDownloads({ includeFinished: true })
    expect(afterCancel.map((item) => item.id)).toEqual([a.id, c.id, b.id])
    const byId = Object.fromEntries(afterCancel.map((item) => [item.id, item]))
    expect(byId[b.id].queueOrder).toBeGreaterThan(byId[a.id].queueOrder)
    expect(byId[b.id].queueOrder).toBeGreaterThan(byId[c.id].queueOrder)
    expect(await downloadsDb.claimNextQueued()).toBeNull()
  })

  it('puts the last finished download first even after a reorder', async () => {
    const a = await downloadsDb.enqueueDownload({ title: 'A', state: 'queued' })
    const b = await downloadsDb.enqueueDownload({ title: 'B', state: 'queued' })
    const c = await downloadsDb.enqueueDownload({ title: 'C', state: 'queued' })
    await downloadsDb.reorderDownloads([a.id, b.id, c.id])

    await manager.setItemState(a.id, 'done', { completedAt: 100 })
    await manager.setItemState(b.id, 'done', { completedAt: 200 })

    const finished = await downloadsDb.listDownloads({ includeFinished: true })
    const done = finished.filter((item) => item.state === 'done')
    expect(done.map((item) => item.id)).toEqual([b.id, a.id])
  })
})
