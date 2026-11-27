import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Module from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Completed rows created before the queue-order feature were stored in id order.
// On the first launch after upgrade they must be numbered newest-first, once.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-completed-norm-'))

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

Module._load = originalLoad

afterAll(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // Best-effort temp cleanup only.
  }
})

const rawRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    dbIndex.db.run(sql, params, function (err) {
      if (err) reject(err)
      else resolve({ lastID: this.lastID, changes: this.changes })
    })
  })

const rawAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    dbIndex.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  })

const seedRow = (title, state, completedAt, updatedAt, queueOrder) =>
  rawRun(
    `INSERT INTO downloads (title, state, completed_at, updated_at, queue_order)
     VALUES (?, ?, ?, ?, ?)`,
    [title, state, completedAt, updatedAt, queueOrder],
  )

describe('completed download order migration', () => {
  beforeAll(async () => {
    dbIndex.initializeDatabase(dataDir)
    // Create the table without initializeDownloads so no marker exists yet.
    await rawRun(downloadsDb.DOWNLOADS_DDL)
    await rawRun(`ALTER TABLE downloads ADD COLUMN build_label TEXT`)

    await seedRow('old-done', 'done', 1000, 1000, 90)
    await seedRow('new-done', 'done', 2000, 2000, 91)
    await seedRow('mid-canceled', 'canceled', 3000, 3000, 92)
    // No completed_at: the fallback to updated_at puts this between the others.
    await seedRow('fallback-done', 'done', null, 2500, 93)
    await seedRow('still-queued', 'queued', null, 4000, -5)
  })

  it('numbers existing completed rows newest-first and leaves active rows untouched', async () => {
    await downloadsDb.initializeDownloads()

    const rows = await rawAll(`SELECT title, state, queue_order FROM downloads`)
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row]))

    expect(byTitle['mid-canceled'].queue_order).toBe(0)
    expect(byTitle['fallback-done'].queue_order).toBe(1)
    expect(byTitle['new-done'].queue_order).toBe(2)
    expect(byTitle['old-done'].queue_order).toBe(3)
    expect(byTitle['still-queued'].queue_order).toBe(-5)

    const markers = await rawAll(`SELECT value FROM downloads_meta WHERE key = ?`, ['completed_order_v1'])
    expect(markers).toHaveLength(1)
    expect(markers[0].value).toBe('1')
  })

  it('does not renumber completed rows on later launches', async () => {
    // Settle the one-time migration first so this run only checks idempotence.
    await downloadsDb.initializeDownloads()

    const scrambled = {
      'mid-canceled': 7,
      'fallback-done': 3,
      'new-done': 9,
      'old-done': 1,
    }
    for (const [title, order] of Object.entries(scrambled)) {
      await rawRun(`UPDATE downloads SET queue_order = ? WHERE title = ?`, [order, title])
    }

    await downloadsDb.initializeDownloads()

    const rows = await rawAll(`SELECT title, queue_order FROM downloads`)
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row]))
    for (const [title, order] of Object.entries(scrambled)) {
      expect(byTitle[title].queue_order).toBe(order)
    }
  })
})
