'use strict'

const { ipcMain, BrowserWindow } = require('electron')
const {
  getCollections,
  getCollectionMemberships,
  getCollectionArtRecords,
  getCollectionsForGame,
  createCollection,
  renameCollection,
  setCollectionColor,
  deleteCollection,
  addGameToCollection,
  removeGameFromCollection,
  reorderCollections,
} = require('../db/collections')

// How many titles feed a collection tile's mosaic. The tile deliberately crops
// the top and bottom rows, so it always asks for a full set and lets the
// renderer decide how much is visible.
const TILE_ART_LIMIT = 8

// Collections are shown in several windows at once (library grid, tree, the
// collections screen) and are mutated from native context menus that belong to
// no window in particular, so every change fans out rather than returning to a
// single caller.
function broadcastCollectionsChanged() {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('collections-changed')
  })
}

// One round trip for everything the renderer needs to render collections:
// the collections themselves, the full membership list (both lookup
// directions are built from it client-side), and the record ids backing each
// tile's art.
async function readCollectionState() {
  const [collections, memberships, artRecordIds] = await Promise.all([
    getCollections(),
    getCollectionMemberships(),
    getCollectionArtRecords(TILE_ART_LIMIT),
  ])
  return { collections, memberships, artRecordIds }
}

function registerCollectionsHandlers() {
  ipcMain.handle('get-collections', async () => {
    try {
      return await readCollectionState()
    } catch (err) {
      console.error('get-collections failed:', err)
      return { collections: [], memberships: [], artRecordIds: {}, error: err.message }
    }
  })

  ipcMain.handle('get-collections-for-game', async (event, recordId) => {
    try {
      return await getCollectionsForGame(recordId)
    } catch (err) {
      console.error('get-collections-for-game failed:', err)
      return []
    }
  })

  ipcMain.handle('create-collection', async (event, payload = {}) => {
    try {
      const result = await createCollection({
        name: payload?.name,
        color: payload?.color,
      })
      if (result.success) broadcastCollectionsChanged()
      return result
    } catch (err) {
      console.error('create-collection failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('rename-collection', async (event, { collectionId, name } = {}) => {
    try {
      const result = await renameCollection(collectionId, name)
      if (result.success) broadcastCollectionsChanged()
      return result
    } catch (err) {
      console.error('rename-collection failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('set-collection-color', async (event, { collectionId, color } = {}) => {
    try {
      const result = await setCollectionColor(collectionId, color)
      if (result.success) broadcastCollectionsChanged()
      return result
    } catch (err) {
      console.error('set-collection-color failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('delete-collection', async (event, collectionId) => {
    try {
      const result = await deleteCollection(collectionId)
      if (result.success) broadcastCollectionsChanged()
      return result
    } catch (err) {
      console.error('delete-collection failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('add-game-to-collection', async (event, { collectionId, recordId } = {}) => {
    try {
      const result = await addGameToCollection(collectionId, recordId)
      if (result.success) broadcastCollectionsChanged()
      return result
    } catch (err) {
      console.error('add-game-to-collection failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('remove-game-from-collection', async (event, { collectionId, recordId } = {}) => {
    try {
      const result = await removeGameFromCollection(collectionId, recordId)
      if (result.success) broadcastCollectionsChanged()
      return result
    } catch (err) {
      console.error('remove-game-from-collection failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('reorder-collections', async (event, orderedIds) => {
    try {
      const result = await reorderCollections(orderedIds)
      if (result.success) broadcastCollectionsChanged()
      return result
    } catch (err) {
      console.error('reorder-collections failed:', err)
      return { success: false, error: err.message }
    }
  })
}

module.exports = registerCollectionsHandlers
module.exports.broadcastCollectionsChanged = broadcastCollectionsChanged
