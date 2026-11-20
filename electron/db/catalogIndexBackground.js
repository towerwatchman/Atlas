'use strict'

const { BrowserWindow } = require('electron')
const catalogIndex = require('./catalogIndex.js')
const { activeWriteLockLabel } = require('./writeLock.js')

// Lifted out of main.js's startup so updates.js can rebuild after a snapshot
// without reaching into the main-process entry point. deps exist for tests.

const buildCatalogIndex = async (deps = {}) => {
  const getCatalogIndexStatus = deps.getCatalogIndexStatus || catalogIndex.getCatalogIndexStatus
  const rebuildCatalogIndex = deps.rebuildCatalogIndex || catalogIndex.rebuildCatalogIndex
  const isWriteLockBusy = deps.isWriteLockBusy || catalogIndex.isWriteLockBusy
  const getWindows = deps.getWindows || (() => BrowserWindow.getAllWindows())

  // Queueing index chunks behind a long sync reads as a freeze, so wait for the
  // writer to finish, capped so a stuck sync cannot hold the build open forever.
  for (let waited = 0; isWriteLockBusy() && waited < 120000; waited += 1000) {
    if (waited === 0) {
      console.log(`catalog_index build waiting for ${activeWriteLockLabel() || 'another writer'}…`)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  const status = await getCatalogIndexStatus()
  if (status.ready) {
    console.log(`catalog_index ready: ${status.rowCount} entries`)
    return
  }
  console.log(
    `catalog_index needs building (version ${status.version} -> ${status.expectedVersion}` +
    `${status.stale ? `, stale: ${status.staleReason}` : ''}); building in background`,
  )
  try {
    // queue waits for a build already in flight instead of dropping: startup and
    // the post-snapshot path can both want a build while one runs.
    await rebuildCatalogIndex({
      queue: true,
      onProgress: (payload) => {
        getWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send('catalog-index-progress', payload)
        })
      },
    })
  } catch (err) {
    // The index stays stale; the next launch rebuilds. Clear the UI so Browse
    // doesn't sit on "building" forever.
    console.error('Background catalog index build failed:', err?.message || err)
    getWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('catalog-index-progress', { phase: 'error', message: err?.message || String(err) })
    })
  }
}

// The single-flight guard now lives in rebuildCatalogIndex, so this is a thin
// entry point the post-snapshot path (updates.js) can call without a restart.
const runBackgroundCatalogIndexRebuild = (deps = {}) => {
  return buildCatalogIndex(deps)
}

module.exports = { runBackgroundCatalogIndexRebuild }
