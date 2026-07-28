'use strict'

// ── Collections ──────────────────────────────────────────────────────────────
//
// User-defined groupings of local library titles, Steam-style. A title may
// belong to any number of collections; a title belonging to NONE is
// "Uncategorized".
//
// Uncategorized is DERIVED, never stored. There is no row, no id, and no
// implicit collection record — a title is uncategorized precisely when it has
// no rows in collection_games. That is what makes "adding to a collection
// removes it from Uncategorized" free: there is no membership to clean up.
//
// NAMING: the renderer's filter state already has a `category` field, which is
// the atlas_data metadata category (Games/Comics/etc.) surfaced in the filter
// sidebar. That is a completely different concept. Everything here says
// "collection"; only the UI string for the derived bucket says "Uncategorized".

const dbModule = require('./index')
const { withWriteLock } = require('./writeLock')

const getDb = () => dbModule.db

// Sentinel used by the renderer and the filter layer for the derived bucket.
// Deliberately a string that can never collide with a real integer id.
const UNCATEGORIZED_ID = 'uncategorized'

const MAX_NAME_LENGTH = 120

// Tile accent colors handed out to new collections, cycling by position so a
// fresh set of collections looks varied without the user picking anything.
const DEFAULT_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#10b981', '#14b8a6', '#6366f1',
]

const normalizeId = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

const normalizeName = (value) =>
  String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH)

const normalizeColor = (value) => {
  const text = String(value ?? '').trim()
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : null
}

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(err) {
      if (err) reject(err)
      else resolve({ changes: this.changes, lastID: this.lastID })
    })
  })

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows || [])
    })
  })

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err)
      else resolve(row || null)
    })
  })

// DDL is exported rather than run here so initializeDatabase owns creation
// order, matching how catalogIndex.js does it.
const COLLECTIONS_DDL = [
  `CREATE TABLE IF NOT EXISTS collections
   (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     color TEXT,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER,
     updated_at INTEGER
   );`,
  `CREATE TABLE IF NOT EXISTS collection_games
   (
     collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
     record_id INTEGER NOT NULL REFERENCES games(record_id) ON DELETE CASCADE,
     added_at INTEGER,
     PRIMARY KEY (collection_id, record_id)
   );`,
]

const COLLECTIONS_INDEXES = [
  // Case-insensitive uniqueness on the name: two collections called "RPG" and
  // "rpg" would be indistinguishable in the UI.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name_nocase
     ON collections(name COLLATE NOCASE);`,
  // The membership table is read in both directions: "which games are in this
  // collection" (tile art, counts) and "which collections is this game in"
  // (context menu). The PK covers the first; this covers the second.
  `CREATE INDEX IF NOT EXISTS idx_collection_games_record
     ON collection_games(record_id);`,
]

const now = () => Math.floor(Date.now() / 1000)

// Every collection plus its member count, ordered for display.
async function getCollections() {
  const rows = await all(`
    SELECT
      c.id,
      c.name,
      c.color,
      c.sort_order,
      c.created_at,
      c.updated_at,
      COUNT(cg.record_id) AS game_count
    FROM collections c
    LEFT JOIN collection_games cg ON cg.collection_id = c.id
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC
  `)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color || null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    gameCount: row.game_count || 0,
  }))
}

// Flat membership list. Small even for a large library (one row per
// game-in-a-collection), so the renderer can build both lookup directions from
// a single fetch rather than querying per game.
//
// Deliberately NOT joined into getGames: that query already carries a
// GROUP_CONCAT over tag_mappings under a GROUP BY games.record_id, and adding a
// second one-to-many join would cross-multiply the rows and corrupt the tag
// list.
async function getCollectionMemberships() {
  const rows = await all(
    `SELECT cg.collection_id, cg.record_id
       FROM collection_games cg
       JOIN games g ON g.record_id = cg.record_id
      ORDER BY cg.added_at DESC`,
  )
  return rows.map((row) => ({
    collectionId: row.collection_id,
    recordId: row.record_id,
  }))
}

// Up to `limit` record ids per collection, newest membership first — the source
// for the tile mosaic.
async function getCollectionArtRecords(limit = 8) {
  const capped = Math.max(1, Math.min(24, Number(limit) || 8))
  const rows = await all(
    `SELECT collection_id, record_id
       FROM (
         SELECT
           cg.collection_id,
           cg.record_id,
           ROW_NUMBER() OVER (
             PARTITION BY cg.collection_id
             ORDER BY cg.added_at DESC, cg.record_id DESC
           ) AS rn
         FROM collection_games cg
         JOIN games g ON g.record_id = cg.record_id
       )
      WHERE rn <= ?`,
    [capped],
  )
  const byCollection = {}
  for (const row of rows) {
    if (!byCollection[row.collection_id]) byCollection[row.collection_id] = []
    byCollection[row.collection_id].push(row.record_id)
  }
  return byCollection
}

async function createCollection({ name, color = null } = {}) {
  const cleanName = normalizeName(name)
  if (!cleanName) return { success: false, error: 'A collection name is required' }

  const existing = await get(
    `SELECT id FROM collections WHERE name = ? COLLATE NOCASE`,
    [cleanName],
  )
  if (existing) return { success: false, error: `A collection named "${cleanName}" already exists` }

  const timestamp = now()
  const positionRow = await get(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM collections`)
  const sortOrder = positionRow?.next || 0
  const resolvedColor =
    normalizeColor(color) || DEFAULT_COLORS[sortOrder % DEFAULT_COLORS.length]

  try {
    const result = await run(
      `INSERT INTO collections (name, color, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [cleanName, resolvedColor, sortOrder, timestamp, timestamp],
    )
    return { success: true, id: result.lastID, name: cleanName, color: resolvedColor }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

async function renameCollection(collectionId, name) {
  const id = normalizeId(collectionId)
  const cleanName = normalizeName(name)
  if (!id) return { success: false, error: 'Invalid collection' }
  if (!cleanName) return { success: false, error: 'A collection name is required' }

  const clash = await get(
    `SELECT id FROM collections WHERE name = ? COLLATE NOCASE AND id != ?`,
    [cleanName, id],
  )
  if (clash) return { success: false, error: `A collection named "${cleanName}" already exists` }

  const result = await run(
    `UPDATE collections SET name = ?, updated_at = ? WHERE id = ?`,
    [cleanName, now(), id],
  )
  if (!result.changes) return { success: false, error: 'Collection not found' }
  return { success: true, id, name: cleanName }
}

async function setCollectionColor(collectionId, color) {
  const id = normalizeId(collectionId)
  if (!id) return { success: false, error: 'Invalid collection' }
  const result = await run(
    `UPDATE collections SET color = ?, updated_at = ? WHERE id = ?`,
    [normalizeColor(color), now(), id],
  )
  if (!result.changes) return { success: false, error: 'Collection not found' }
  return { success: true, id }
}

// Deleting a collection only removes the grouping. Its titles fall back to
// Uncategorized automatically because membership rows go with it (the FK is
// ON DELETE CASCADE, but foreign_keys pragma state varies, so the child delete
// is explicit).
async function deleteCollection(collectionId) {
  const id = normalizeId(collectionId)
  if (!id) return { success: false, error: 'Invalid collection' }
  return withWriteLock('deleteCollection', async () => {
    await run(`DELETE FROM collection_games WHERE collection_id = ?`, [id])
    const result = await run(`DELETE FROM collections WHERE id = ?`, [id])
    if (!result.changes) return { success: false, error: 'Collection not found' }
    return { success: true, id }
  })
}

async function addGameToCollection(collectionId, recordId) {
  const id = normalizeId(collectionId)
  const record = normalizeId(recordId)
  if (!id || !record) return { success: false, error: 'Invalid collection or game' }

  const collection = await get(`SELECT id FROM collections WHERE id = ?`, [id])
  if (!collection) return { success: false, error: 'Collection not found' }
  const game = await get(`SELECT record_id FROM games WHERE record_id = ?`, [record])
  if (!game) return { success: false, error: 'Game not found' }

  await run(
    `INSERT OR IGNORE INTO collection_games (collection_id, record_id, added_at)
     VALUES (?, ?, ?)`,
    [id, record, now()],
  )
  return { success: true, collectionId: id, recordId: record }
}

async function removeGameFromCollection(collectionId, recordId) {
  const id = normalizeId(collectionId)
  const record = normalizeId(recordId)
  if (!id || !record) return { success: false, error: 'Invalid collection or game' }
  await run(
    `DELETE FROM collection_games WHERE collection_id = ? AND record_id = ?`,
    [id, record],
  )
  return { success: true, collectionId: id, recordId: record }
}

// Collection ids a single title belongs to. Used to build the "Remove from"
// submenu, which only lists collections the game is actually in.
async function getCollectionsForGame(recordId) {
  const record = normalizeId(recordId)
  if (!record) return []
  const rows = await all(
    `SELECT collection_id FROM collection_games WHERE record_id = ?`,
    [record],
  )
  return rows.map((row) => row.collection_id)
}

// Persisted display order for the tile screen.
async function reorderCollections(orderedIds = []) {
  const ids = (Array.isArray(orderedIds) ? orderedIds : [])
    .map(normalizeId)
    .filter(Boolean)
  if (ids.length === 0) return { success: true }
  return withWriteLock('reorderCollections', async () => {
    const timestamp = now()
    for (let index = 0; index < ids.length; index += 1) {
      await run(
        `UPDATE collections SET sort_order = ?, updated_at = ? WHERE id = ?`,
        [index, timestamp, ids[index]],
      )
    }
    return { success: true }
  })
}

module.exports = {
  COLLECTIONS_DDL,
  COLLECTIONS_INDEXES,
  UNCATEGORIZED_ID,
  DEFAULT_COLORS,
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
}
