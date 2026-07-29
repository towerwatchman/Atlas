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

// Every catalog tag source for a record, returned separately so they can be
// UNIONED rather than ranked.
//
// This used to COALESCE them — first non-empty source wins — which meant a game
// matched on both F95 and LewdCorner showed only the F95 list and silently
// dropped LewdCorner-only tags. It also disagreed with the read-only display in
// GameDetailPage (getDetailTags), which was already merging all three, so the
// same game showed different tags depending on whether it was being viewed or
// edited.
//
// atlas_data is included even though the request was about lc and f95: dropping
// it would lose every tag on atlas-only records.
const CATALOG_TAGS_SQL = `
  SELECT
    atlas_data.tags AS atlas_tags,
    f95_zone_data.tags AS f95_tags,
    direct_lewdcorner_data.tags AS direct_lc_tags,
    lewdcorner_data.tags AS lc_tags
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

/**
 * The catalog list for a record, untouched by any override: the union of every
 * source, de-duplicated case-insensitively.
 *
 * Source order is kept stable (atlas, then f95, then lewdcorner) rather than
 * sorted, so the chip order does not shuffle between reads and the added/removed
 * diff in getTagState stays comparable.
 */
async function getCatalogTags(recordId) {
  const row = await get(CATALOG_TAGS_SQL, [recordId])
  if (!row) return []
  return dedupe([
    ...parseTags(row.atlas_tags),
    ...parseTags(row.f95_tags),
    // Only one of these two is ever populated — direct_lewdcorner_data is the
    // record's own LC mapping, lewdcorner_data the one reached via atlas_id.
    ...parseTags(row.direct_lc_tags),
    ...parseTags(row.lc_tags),
  ])
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

/**
 * Every tag known to the library, for autocomplete. Drawn from the same four
 * sources as the filter sidebar so the two agree: catalog tables, the user tags
 * table, and any override snapshot.
 *
 * Returned in descending use order, so the tags a user actually applies surface
 * before one-off catalog noise.
 */
async function getKnownTags() {
  const rows = await new Promise((resolve, reject) => {
    getDb().all(
      `SELECT tags FROM f95_zone_data WHERE tags IS NOT NULL
       UNION ALL
       SELECT tags FROM atlas_data WHERE tags IS NOT NULL
       UNION ALL
       SELECT tags FROM lewdcorner_data WHERE tags IS NOT NULL
       UNION ALL
       SELECT tags FROM game_metadata_overrides WHERE tags IS NOT NULL`,
      [],
      (err, result) => (err ? reject(err) : resolve(result || [])),
    )
  })
  // Count occurrences so the ordering means something. Keyed case-insensitively
  // but the first spelling seen is kept, so "3DCG" does not become "3dcg".
  const counts = new Map()
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) {
      const key = tag.toLowerCase()
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { tag, count: 1 })
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((entry) => entry.tag)
}

/**
 * Apply tag changes to many records at once. `add` and `remove` are applied on
 * top of each record's CURRENT resolved list, not as a shared snapshot — bulk
 * tagging a collection must not flatten every game onto one tag list.
 */
async function bulkEditTags(recordIds = [], { add = [], remove = [] } = {}) {
  const toAdd = parseTags(add)
  const toRemove = parseTags(remove).map((t) => t.toLowerCase())
  if (toAdd.length === 0 && toRemove.length === 0) {
    return { success: false, error: 'No tag changes supplied' }
  }
  const results = []
  for (const recordId of recordIds) {
    try {
      const state = await getTagState(recordId)
      let next = state.tags.filter((tag) => !toRemove.includes(tag.toLowerCase()))
      for (const tag of toAdd) {
        if (!next.some((entry) => entry.toLowerCase() === tag.toLowerCase())) next.push(tag)
      }
      // Skip the write when nothing actually changed, so bulk tagging does not
      // create overrides on records it did not affect — an override suppresses
      // future catalog refreshes, so creating one needlessly has a real cost.
      const unchanged =
        next.length === state.tags.length &&
        next.every((tag, i) => tag.toLowerCase() === state.tags[i].toLowerCase())
      if (unchanged && state.overridden) {
        results.push({ recordId, changed: false })
        continue
      }
      if (unchanged && !state.overridden) {
        results.push({ recordId, changed: false })
        continue
      }
      await setTagOverride(recordId, next)
      results.push({ recordId, changed: true, tags: next })
    } catch (err) {
      results.push({ recordId, changed: false, error: err.message })
    }
  }
  return {
    success: true,
    changed: results.filter((r) => r.changed).length,
    skipped: results.filter((r) => !r.changed && !r.error).length,
    failed: results.filter((r) => r.error),
    results,
  }
}

module.exports = {
  getKnownTags,
  bulkEditTags,
  CATALOG_TAGS_SQL,
  parseTags,
  serializeTags,
  getCatalogTags,
  getTagOverride,
  getTagState,
  setTagOverride,
  clearTagOverride,
}
