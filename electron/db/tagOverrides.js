'use strict'

// ── User tag overrides ───────────────────────────────────────────────────────
//
// Tags shown for a game come from the catalog: delimited text on
// atlas_data.tags / f95_zone_data.tags / lewdcorner_data.tags. A user can add
// tags to that list and remove tags from it. Their edited list is stored as a
// SNAPSHOT in game_metadata_overrides.tags and wins until they reset the field,
// at which point the catalog list returns.
//
// The catalog tables are never written to. Resetting reads them back exactly as
// the scraper left them.
//
// tag_mappings stays the effective list — it is what the library query
// GROUP_CONCATs and what the filter sidebar matches on — so every write here
// also rebuilds it. Storing the override separately is what makes "reset"
// possible and what tells a later catalog refresh to leave a user's list alone.
//
// NULL and empty string mean different things:
//   NULL  -> not overridden, inherit the catalog list
//   ''    -> overridden to no tags at all
// Collapsing those two is why tags could not previously be cleared: an empty
// list fell straight back to the catalog and the edit looked ignored.

const dbModule = require('./index')

const getDb = () => dbModule.db

// Mirrors the catalog precedence used by the library queries in versions.js.
const CATALOG_TAGS_SQL = `
  SELECT COALESCE(
           NULLIF(atlas_data.tags, ''),
           NULLIF(f95_zone_data.tags, ''),
           NULLIF(direct_lewdcorner_data.tags, ''),
           lewdcorner_data.tags
         ) AS tags
    FROM games
    LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
    LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
    LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
    LEFT JOIN lewdcorner_mappings ON games.record_id = lewdcorner_mappings.record_id
    LEFT JOIN lewdcorner_data direct_lewdcorner_data
      ON lewdcorner_mappings.lc_id = direct_lewdcorner_data.lc_id
    LEFT JOIN lewdcorner_data
      ON direct_lewdcorner_data.lc_id IS NULL
     AND atlas_mappings.atlas_id = lewdcorner_data.atlas_id
   WHERE games.record_id = ?
`

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)))
  })

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(err) {
      if (err) reject(err)
      else resolve({ changes: this.changes })
    })
  })

/** Split a delimited tag list, trimming and de-duplicating case-insensitively. */
function parseTags(value) {
  if (Array.isArray(value)) return dedupe(value.map((t) => String(t).trim()).filter(Boolean))
  const text = String(value ?? '')
  if (!text.trim()) return []
  return dedupe(
    text
      .split(/[,;|]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  )
}

function dedupe(tags) {
  const seen = new Set()
  const out = []
  for (const tag of tags) {
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

const serializeTags = (tags) => parseTags(tags).join(', ')

/** The catalog list for a record, untouched by any override. */
async function getCatalogTags(recordId) {
  const row = await get(CATALOG_TAGS_SQL, [recordId])
  return parseTags(row?.tags)
}

/** The stored override, or null when the field is not overridden. */
async function getTagOverride(recordId) {
  const row = await get(
    `SELECT tags FROM game_metadata_overrides WHERE record_id = ?`,
    [recordId],
  )
  if (!row || row.tags === null || row.tags === undefined) return null
  return parseTags(row.tags)
}

/**
 * Everything the UI needs to render the field: the effective list, the catalog
 * list to reset back to, and whether an override is in force.
 */
async function getTagState(recordId) {
  const [catalog, override] = await Promise.all([
    getCatalogTags(recordId),
    getTagOverride(recordId),
  ])
  const overridden = override !== null
  return {
    recordId: Number(recordId),
    tags: overridden ? override : catalog,
    catalogTags: catalog,
    overridden,
    added: overridden
      ? override.filter((t) => !catalog.some((c) => c.toLowerCase() === t.toLowerCase()))
      : [],
    removed: overridden
      ? catalog.filter((c) => !override.some((t) => t.toLowerCase() === c.toLowerCase()))
      : [],
  }
}

/**
 * Store a user's tag list. Written even when it matches the catalog exactly:
 * the row records intent, so a later catalog refresh knows not to overwrite it.
 */
async function setTagOverride(recordId, tags) {
  const list = parseTags(tags)
  await run(
    `INSERT INTO game_metadata_overrides (record_id, tags, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(record_id) DO UPDATE SET tags = excluded.tags, updated_at = excluded.updated_at`,
    [recordId, serializeTags(list), Math.floor(Date.now() / 1000)],
  )
  return list
}

/** Drop the override so the catalog list applies again. */
async function clearTagOverride(recordId) {
  await run(
    `UPDATE game_metadata_overrides SET tags = NULL, updated_at = ? WHERE record_id = ?`,
    [Math.floor(Date.now() / 1000), recordId],
  )
  return getCatalogTags(recordId)
}

module.exports = {
  CATALOG_TAGS_SQL,
  parseTags,
  serializeTags,
  getCatalogTags,
  getTagOverride,
  getTagState,
  setTagOverride,
  clearTagOverride,
}
