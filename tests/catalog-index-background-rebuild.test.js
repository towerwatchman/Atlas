import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const { runBackgroundCatalogIndexRebuild } = require('../electron/db/catalogIndexBackground.js')

// The single-flight guard now lives inside rebuildCatalogIndex (catalogIndex.js), so
// it has to be exercised against the real function, not the deps mock (which replaces
// rebuildCatalogIndex wholesale and bypasses the guard). The guard fires before the
// build touches the database, but the build body does, so these tests run against a
// real database the same way catalog-db-lifecycle does — a stub would have to fake
// every statement the rebuild issues, which is more coupling than it is worth.
const dbIndex = require('../electron/db/index.js')
const { rebuildCatalogIndex, isRebuildInFlight } = require('../electron/db/catalogIndex.js')

// Background catalog-index rebuild (electron/db/catalogIndexBackground.js).
//
// The startup build that used to be inlined in main.js: waits for the write lock
// so a chunked index build never queues behind the boot-time catalog sync, does
// nothing when the index is already ready, and otherwise rebuilds while streaming
// progress to every window. The real catalogIndex.js and Electron are swapped for
// spies through the routine's deps argument — a live DB and BrowserWindow are out
// of scope. This covers the routine's logic, not the main.js wiring that calls it.

const makeWindow = () => ({
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
})

describe('runBackgroundCatalogIndexRebuild', () => {
  it('does nothing when the index is already ready', async () => {
    const rebuildCatalogIndex = vi.fn()
    const deps = {
      isWriteLockBusy: vi.fn(() => false),
      getCatalogIndexStatus: vi.fn(async () => ({ ready: true, rowCount: 42 })),
      rebuildCatalogIndex,
    }

    await runBackgroundCatalogIndexRebuild(deps)

    expect(rebuildCatalogIndex).not.toHaveBeenCalled()
  })

  it('rebuilds when the index is not ready, streaming progress to every window', async () => {
    const payload = { phase: 'chunks', done: 3, total: 10 }
    const rebuildCatalogIndex = vi.fn(async ({ onProgress }) => { onProgress(payload) })
    const a = makeWindow()
    const b = makeWindow()
    const deps = {
      isWriteLockBusy: vi.fn(() => false),
      getCatalogIndexStatus: vi.fn(async () => ({
        ready: false, version: 5, expectedVersion: 6, stale: false,
      })),
      rebuildCatalogIndex,
      getWindows: () => [a, b],
    }

    await runBackgroundCatalogIndexRebuild(deps)

    expect(rebuildCatalogIndex).toHaveBeenCalledTimes(1)
    expect(a.webContents.send).toHaveBeenCalledWith('catalog-index-progress', payload)
    expect(b.webContents.send).toHaveBeenCalledWith('catalog-index-progress', payload)
  })

  it('waits for the write lock to clear before checking status', async () => {
    // Busy on the first poll, clear on the next: the loop must move on rather than
    // spin forever, then find the index ready. The wait sleeps in real seconds, so
    // drive it with fake timers rather than blocking the suite for a second.
    vi.useFakeTimers()
    try {
      const isWriteLockBusy = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
      const getCatalogIndexStatus = vi.fn(async () => ({ ready: true, rowCount: 1 }))
      const rebuildCatalogIndex = vi.fn()

      const pending = runBackgroundCatalogIndexRebuild({
        isWriteLockBusy, getCatalogIndexStatus, rebuildCatalogIndex,
      })
      // Release the first sleep so the loop re-checks the lock and proceeds.
      await vi.advanceTimersByTimeAsync(1000)
      await pending

      // Busy on the first poll, clear on the next: pin that the loop retried.
      expect(isWriteLockBusy.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(getCatalogIndexStatus).toHaveBeenCalled()
      expect(rebuildCatalogIndex).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // The guard fires before the build touches the database. Because rebuildCatalogIndex
  // is async, each call returns a freshly-wrapped promise, so promise identity cannot
  // pin the guard. Each rebuild body opens with a `DELETE FROM catalog_index`, so
  // counting that statement proves how many builds actually started: one for a
  // second unqueued call (the guard handed back the running build), two for a queued
  // call (the follow-up ran after the first).
  let dataDir
  let deleteCount
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-rebuild-guard-'))
    dbIndex.initializeDatabase(dataDir)
    deleteCount = 0
    const db = dbIndex.db
    const origRun = db.run.bind(db)
    db.run = function (sql, ...rest) {
      if (typeof sql === 'string' && /^DELETE FROM catalog_index\b/.test(sql.trim())) deleteCount++
      return origRun(sql, ...rest)
    }
  })

  afterEach(async () => {
    // initializeDatabase queues its DDL and a fresh database keeps all of it in
    // the -wal, so the connection has to be drained before its files are removed.
    // close() is queued behind those statements, which is what makes that safe.
    await new Promise((resolve) => {
      const db = dbIndex.db
      if (!db) return resolve()
      db.close(() => resolve())
    })
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {}
  })

  it('rebuildCatalogIndex hands a second unqueued call the running build', async () => {
    const first = rebuildCatalogIndex({ chunkSize: 1 })
    expect(isRebuildInFlight()).toBe(true)
    await rebuildCatalogIndex({ chunkSize: 1 })
    await first
    expect(deleteCount).toBe(1)
    expect(isRebuildInFlight()).toBe(false)
  })

  it('rebuildCatalogIndex with queue runs a follow-up after the build in flight', async () => {
    const first = rebuildCatalogIndex({ chunkSize: 1 })
    const queued = rebuildCatalogIndex({ chunkSize: 1, queue: true })
    await Promise.all([first, queued])
    expect(deleteCount).toBe(2)
    expect(isRebuildInFlight()).toBe(false)
  })
})
