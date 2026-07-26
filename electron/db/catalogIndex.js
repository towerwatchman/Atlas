'use strict'

// ── Browse-mode catalog index ────────────────────────────────────────────────
//
// Browse mode used to build its result set from a four-branch UNION ALL of
// atlas/steam/gog/lewdcorner data, then apply WHERE / ORDER BY / LIMIT to the
// whole thing. Two problems made that unusable on a real catalog:
//
//   1. `steam_branch_base` excluded appids already linked to an atlas entry via
//      atlas_data.external_ids using five CORRELATED `LIKE` patterns against
//      atlas_data. That is O(steam_data x atlas_data x 5) — measured at 94s for
//      3,000 x 32,000 rows, and it grows every time a user lazily fetches Steam
//      metadata. It also silently MISSED the `{"steam_id": "123"}` shape
//      (only the no-space variant was listed for that key while steam_appid had
//      both), so those appids leaked into Browse as duplicate standalone tiles.
//
//   2. Any ORDER BY forced SQLite to materialise all ~32k wide union rows and
//      sort them before taking 250. With no ORDER BY the same query streamed in
//      8ms; with the date sort it took 553ms. Browse always defaults to
//      newest-first, so that cost was paid on every entry.
//
// Both are fixed by projecting one narrow row per browse tile into
// `catalog_index` — only the columns needed to FILTER and SORT — and hydrating
// the surviving page from the source tables afterwards. Measured on a
// 32,000-entry catalog: newest-first with no filters 0.2ms, COUNT 0.0ms,
// hydrate of 250 rows 2.7ms. Table plus all indexes is ~15MB.
//
// Dates are stored pre-parsed as (tier, ms) integer pairs rather than the
// per-row CASE expression the queries used to evaluate three times per row.
// `tier` encodes the ordering rule the old ORDER BY expressed inline — real
// dates first, implausible future dates next, missing dates last — so
// `ORDER BY <x>_tier ASC, <x>_ms DESC` is satisfiable straight from an index
// with early termination instead of a temp b-tree.
//
// Freshness: rebuilt incrementally as catalog updates land (see
// electron/db/updates.js) and when a title's local install state changes.
// A full rebuild is available from Settings -> Database. `catalog_index_meta`
// carries the schema version so a shipped change to the projection forces one
// rebuild rather than silently serving a stale shape.

const dbModule = require('./index')
const getDb = () => dbModule.db
const { withTransaction, isWriteLockBusy } = require('./writeLock')

// Bump when the projection (columns, tier semantics, source precedence)
// changes. A mismatch marks the index stale and triggers one rebuild.
const CATALOG_INDEX_VERSION = 4

const CHUNK_SIZE = 2000

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err)
      else resolve(this)
    })
  })

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  })

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  })

const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve))

// ── date parsing ─────────────────────────────────────────────────────────────

// Faithful JS mirror of the `dateMsExpression` CASE this replaces, so a rebuilt
// index sorts identically to the old inline expression. The catalog carries all
// three shapes in the same column, which is exactly why it could never be
// indexed in SQL:
//   - 'YYYYMMDD'            (8 digits, no separators)
//   - epoch seconds or ms   (all digits; >1e11 is treated as already-ms)
//   - anything strftime()   accepts, e.g. 'YYYY-MM-DD'
// Returns null for empty/unparseable values, matching the SQL's NULL.
const parseDateToMs = (value) => {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (raw === '') return null

  const allDigits = /^[0-9]+$/.test(raw)

  if (allDigits && raw.length === 8) {
    const year = Number(raw.slice(0, 4))
    const month = Number(raw.slice(4, 6))
    const day = Number(raw.slice(6, 8))
    // Matches strftime()'s exact behaviour, verified against SQLite 3.45:
    // month outside 1-12 or day outside 1-31 yields NULL, but a day that is
    // merely too long for its month ROLLS OVER ('20260230' -> 2026-03-02)
    // rather than failing. Date.UTC() normalizes the same way, so the range
    // guards below are the whole of the difference — do not add a round-trip
    // check here, or those rows would fall to the "no date" tier and sort to
    // the end of newest-first instead of keeping their old position.
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const ms = Date.UTC(year, month - 1, day)
    return Number.isFinite(ms) ? ms : null
  }

  if (allDigits) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return n > 100000000000 ? n : n * 1000
  }

  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

// Ordering tier, matching the old ORDER BY's inline CASE: 0 = a real date,
// 1 = a future date (mis-scraped thread_updated values that would otherwise
// pin themselves to the top of newest-first), 2 = no date at all.
//
// Future-ness is evaluated at index-write time, not read time, because a
// read-time comparison against now() is not indexable. A date can therefore sit
// in tier 1 until the next refresh moves it to tier 0; refreshes ride along with
// catalog updates (hourly in practice), and a future timestamp is bad data
// regardless, so the bounded staleness is not worth losing the index over.
const dateTier = (ms, nowMs) => {
  if (ms === null) return 2
  return ms > nowMs ? 1 : 0
}

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const bestOf = (a, b) => {
  const x = toNumberOrNull(a) || 0
  const y = toNumberOrNull(b) || 0
  const best = Math.max(x, y)
  return best > 0 ? best : null
}

const joinText = (...parts) => {
  const seen = new Set()
  for (const part of parts) {
    if (part === null || part === undefined) continue
    const text = String(part).trim().toLowerCase()
    if (text) seen.add(text)
  }
  return seen.size ? Array.from(seen).join(' ') : null
}

// ── external_ids -> steam appid extraction ───────────────────────────────────

// Replaces the five correlated LIKE patterns. Parsing the JSON is immune to the
// whitespace and key-order variation that made the LIKE list miss
// `{"steam_id": "123"}`, and it covers the array form in one place.
const extractSteamAppIds = (rawExternalIds) => {
  if (!rawExternalIds) return []
  let parsed
  try {
    parsed = typeof rawExternalIds === 'object' ? rawExternalIds : JSON.parse(rawExternalIds)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []

  const candidates = []
  for (const key of ['steam_appid', 'steam_id', 'steamAppId', 'steamId']) {
    const value = parsed[key]
    if (value !== null && value !== undefined && value !== '') candidates.push(value)
  }
  for (const key of ['steam_appids', 'steamAppIds']) {
    const list = parsed[key]
    if (Array.isArray(list)) {
      for (const value of list) {
        if (value !== null && value !== undefined && value !== '') candidates.push(value)
      }
    }
  }

  const ids = new Set()
  for (const candidate of candidates) {
    const n = Number.parseInt(String(candidate).trim(), 10)
    if (Number.isInteger(n) && n > 0) ids.add(n)
  }
  return Array.from(ids)
}

// ── schema ───────────────────────────────────────────────────────────────────

const CATALOG_INDEX_DDL = [
  `CREATE TABLE IF NOT EXISTS catalog_index (
     catalog_key      TEXT PRIMARY KEY,
     record_id        TEXT NOT NULL,
     source           TEXT NOT NULL,
     atlas_id         INTEGER,
     steam_id         INTEGER,
     gog_id           INTEGER,
     lc_id            INTEGER,
     f95_id           INTEGER,
     local_record_id  INTEGER,
     is_installed     INTEGER NOT NULL DEFAULT 0,
     title            TEXT,
     short_name       TEXT,
     creator          TEXT,
     engine           TEXT,
     category         TEXT,
     status           TEXT,
     censored         TEXT,
     language         TEXT,
     tags_text        TEXT,
     search_text      TEXT,
     site_url         TEXT,
     rating_best      REAL,
     likes_best       REAL,
     thread_updated_tier INTEGER NOT NULL DEFAULT 2,
     thread_updated_ms   INTEGER,
     thread_publish_tier INTEGER NOT NULL DEFAULT 2,
     thread_publish_ms   INTEGER,
     release_date_tier   INTEGER NOT NULL DEFAULT 2,
     release_date_ms     INTEGER,
     f95_latest_order REAL,
     has_steam_link   INTEGER NOT NULL DEFAULT 0
   );`,

  // (steam_appid -> atlas_id) resolved from atlas_data.external_ids. Replaces
  // the correlated-LIKE NOT EXISTS with a primary-key probe.
  `CREATE TABLE IF NOT EXISTS atlas_external_steam (
     steam_appid INTEGER NOT NULL,
     atlas_id    INTEGER NOT NULL,
     PRIMARY KEY (steam_appid, atlas_id)
   );`,

  `CREATE TABLE IF NOT EXISTS catalog_index_meta (
     key   TEXT PRIMARY KEY,
     value TEXT
   );`,
]

// Composite (tier, ms DESC) indexes are what let the default newest-first sort
// be answered straight from an index with early termination. The trailing
// title/catalog_key columns match the ORDER BY tiebreakers so the index covers
// the whole ordering rather than only its leading terms.
const CATALOG_INDEX_INDEXES = [
  // The trailing title term MUST carry COLLATE NOCASE to match the ORDER BY.
  // Without it the index satisfies only (tier, ms DESC) and SQLite falls back to
  // "USE TEMP B-TREE FOR RIGHT PART OF ORDER BY" to resolve the title
  // tiebreaker — a collation mismatch silently costs the sort.
  //
  // Renamed with a _v2 suffix because CREATE INDEX IF NOT EXISTS will not
  // replace an existing index of the same name, so installs that already built
  // the BINARY-collated version would keep it forever. The old names are dropped
  // just below; both are cheap no-ops after the first launch.
  `DROP INDEX IF EXISTS idx_catalog_index_thread_updated;`,
  `DROP INDEX IF EXISTS idx_catalog_index_thread_publish;`,
  `DROP INDEX IF EXISTS idx_catalog_index_release_date;`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_thread_updated_v2
     ON catalog_index(thread_updated_tier, thread_updated_ms DESC, title COLLATE NOCASE, catalog_key);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_thread_publish_v2
     ON catalog_index(thread_publish_tier, thread_publish_ms DESC, title COLLATE NOCASE, catalog_key);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_release_date_v2
     ON catalog_index(release_date_tier, release_date_ms DESC, title COLLATE NOCASE, catalog_key);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_title
     ON catalog_index(title COLLATE NOCASE, catalog_key);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_creator
     ON catalog_index(creator COLLATE NOCASE, catalog_key);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_rating
     ON catalog_index(rating_best DESC, title);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_likes
     ON catalog_index(likes_best DESC, title);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_f95_order
     ON catalog_index(f95_latest_order DESC, title);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_source ON catalog_index(source);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_installed ON catalog_index(is_installed);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_category ON catalog_index(category COLLATE NOCASE);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_engine ON catalog_index(engine COLLATE NOCASE);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_status ON catalog_index(status COLLATE NOCASE);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_index_local_record ON catalog_index(local_record_id);`,
  `CREATE INDEX IF NOT EXISTS idx_atlas_external_steam_atlas
     ON atlas_external_steam(atlas_id);`,
]

const ensureCatalogIndexSchema = async () => {
  for (const ddl of CATALOG_INDEX_DDL) await dbRun(ddl)
  for (const ddl of CATALOG_INDEX_INDEXES) await dbRun(ddl)
}

// ── meta ─────────────────────────────────────────────────────────────────────

const getMeta = async (key) => {
  try {
    const row = await dbGet(`SELECT value FROM catalog_index_meta WHERE key = ?`, [key])
    return row ? row.value : null
  } catch {
    return null
  }
}

const setMeta = (key, value) =>
  dbRun(`INSERT INTO catalog_index_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value === null || value === undefined ? null : String(value)])

const markCatalogIndexStale = async (reason = 'unspecified') => {
  try {
    await setMeta('stale', '1')
    await setMeta('stale_reason', reason)
  } catch (err) {
    console.warn('Could not mark catalog index stale:', err.message)
  }
}

// `ready` is what Browse gates on. It is deliberately conservative: a version
// mismatch, an explicit stale flag, or an empty table on a non-empty catalog all
// report not-ready so the UI shows build progress rather than an empty grid that
// reads as "no results".
const getCatalogIndexStatus = async () => {
  try {
    await ensureCatalogIndexSchema()
    const [versionRaw, builtAt, staleRaw, staleReason] = await Promise.all([
      getMeta('version'), getMeta('built_at'), getMeta('stale'), getMeta('stale_reason'),
    ])
    const countRow = await dbGet(`SELECT COUNT(*) AS c FROM catalog_index`)
    const sourceRow = await dbGet(`SELECT COUNT(*) AS c FROM atlas_data`)
    const rowCount = countRow?.c || 0
    const sourceCount = sourceRow?.c || 0
    const version = Number(versionRaw) || 0
    const stale = staleRaw === '1'
    const versionMatches = version === CATALOG_INDEX_VERSION
    return {
      ready: versionMatches && !stale && (rowCount > 0 || sourceCount === 0),
      version,
      expectedVersion: CATALOG_INDEX_VERSION,
      rowCount,
      sourceCount,
      builtAt: builtAt ? Number(builtAt) : null,
      stale,
      staleReason: stale ? staleReason : null,
    }
  } catch (err) {
    return {
      ready: false, version: 0, expectedVersion: CATALOG_INDEX_VERSION,
      rowCount: 0, sourceCount: 0, builtAt: null, stale: true,
      staleReason: err.message,
    }
  }
}

// ── steam link resolution ────────────────────────────────────────────────────

const rebuildAtlasExternalSteam = async ({ onProgress } = {}) => {
  await ensureCatalogIndexSchema()
  const rows = await dbAll(
    `SELECT atlas_id, external_ids FROM atlas_data
      WHERE external_ids IS NOT NULL AND external_ids != ''`)

  const pairs = []
  for (const row of rows) {
    for (const appid of extractSteamAppIds(row.external_ids)) {
      pairs.push([appid, row.atlas_id])
    }
  }

  await withTransaction('catalogIndex.steamLinks', dbRun, async () => {
    await dbRun('DELETE FROM atlas_external_steam')
    for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
      const slice = pairs.slice(i, i + CHUNK_SIZE)
      const values = slice.map(() => '(?, ?)').join(', ')
      await dbRun(
        `INSERT OR IGNORE INTO atlas_external_steam (steam_appid, atlas_id) VALUES ${values}`,
        slice.flat())
      if (typeof onProgress === 'function') {
        try { onProgress({ phase: 'steam-links', processed: Math.min(i + CHUNK_SIZE, pairs.length), total: pairs.length }) }
        catch { /* a throwing reporter must never break the rebuild */ }
      }
    }
  })
  return { pairs: pairs.length, scanned: rows.length }
}

// ── projection ───────────────────────────────────────────────────────────────

const CATALOG_INDEX_COLUMNS = [
  'catalog_key', 'record_id', 'source', 'atlas_id', 'steam_id', 'gog_id', 'lc_id',
  'f95_id', 'local_record_id', 'is_installed', 'title', 'short_name', 'creator',
  'engine', 'category', 'status', 'censored', 'language', 'tags_text', 'search_text',
  'site_url', 'rating_best', 'likes_best',
  'thread_updated_tier', 'thread_updated_ms',
  'thread_publish_tier', 'thread_publish_ms',
  'release_date_tier', 'release_date_ms',
  'f95_latest_order', 'has_steam_link',
]

// Mirrors atlas_branch_base's source precedence and COALESCE chains. Kept in one
// place so the projection and the hydrate query cannot drift apart.
const ATLAS_SOURCE_QUERY = `
  SELECT
    a.atlas_id, a.title, a.short_name,
    COALESCE(NULLIF(a.creator, ''), a.developer)               AS creator,
    a.engine, a.status, a.release_date, a.tags AS atlas_tags,
    COALESCE(NULLIF(a.category, ''), MIN(s.category))          AS category,
    COALESCE(NULLIF(a.censored, ''), MIN(s.censored))          AS censored,
    COALESCE(NULLIF(a.language, ''), MIN(s.language))          AS language,
    f.f95_id, f.tags AS f95_tags, f.rating AS f95_rating, f.likes AS f95_likes,
    f.thread_updated, f.thread_publish_date, f.f95_latest_order,
    f.site_url AS f95_site_url,
    l.lc_id, l.tags AS lc_tags, l.prefixes AS lc_prefixes,
    l.rating AS lc_rating, l.likes AS lc_likes,
    l.thread_updated AS lc_thread_updated, l.register_date AS lc_register_date,
    l.site_url AS lc_site_url,
    MIN(s.steam_id) AS steam_id,
    MIN(g.gog_id)   AS gog_id,
    MIN(s.release_date) AS steam_release_date,
    COALESCE(
      (SELECT MIN(am.record_id) FROM atlas_mappings am WHERE am.atlas_id = a.atlas_id),
      (SELECT MIN(fm.record_id) FROM f95_zone_mappings fm WHERE f.f95_id IS NOT NULL AND fm.f95_id = f.f95_id),
      (SELECT MIN(lm.record_id) FROM lewdcorner_mappings lm WHERE l.lc_id IS NOT NULL AND lm.lc_id = l.lc_id),
      (SELECT MIN(sm.record_id) FROM steam_mappings sm
         JOIN steam_data ms ON sm.steam_id = ms.steam_id
        WHERE ms.atlas_id = a.atlas_id)
    ) AS local_record_id
  FROM atlas_data a
  LEFT JOIN f95_zone_data   f ON f.atlas_id = a.atlas_id
  LEFT JOIN lewdcorner_data l ON l.atlas_id = a.atlas_id
  LEFT JOIN steam_data      s ON s.atlas_id = a.atlas_id
  LEFT JOIN gog_data        g ON g.atlas_id = a.atlas_id
`

const projectAtlasRow = (row, nowMs) => {
  const threadUpdatedMs = parseDateToMs(row.thread_updated || row.lc_thread_updated)
  const threadPublishMs = parseDateToMs(row.thread_publish_date || row.lc_register_date)
  const releaseDateMs = parseDateToMs(row.release_date || row.steam_release_date)
  const source = row.f95_id != null
    ? 'f95'
    : row.lc_id != null
      ? 'lewdcorner'
      : row.steam_id != null ? 'steam' : 'atlas'
  const title = row.title == null ? null : String(row.title)
  return [
    `atlas:${row.atlas_id}`,
    `catalog:${row.atlas_id}`,
    source,
    row.atlas_id,
    row.steam_id ?? null,
    row.gog_id ?? null,
    row.lc_id ?? null,
    row.f95_id ?? null,
    row.local_record_id ?? null,
    row.local_record_id != null ? 1 : 0,
    title,
    row.short_name ?? null,
    row.creator ?? null,
    row.engine ?? null,
    row.category ?? null,
    row.status ?? null,
    row.censored ?? null,
    row.language ?? null,
    joinText(row.atlas_tags, row.f95_tags, row.lc_tags, row.lc_prefixes),
    joinText(title, row.short_name, row.creator, row.engine, row.status, row.category),
    row.f95_site_url || row.lc_site_url || null,
    bestOf(row.f95_rating, row.lc_rating),
    bestOf(row.f95_likes, row.lc_likes),
    dateTier(threadUpdatedMs, nowMs), threadUpdatedMs,
    dateTier(threadPublishMs, nowMs), threadPublishMs,
    dateTier(releaseDateMs, nowMs), releaseDateMs,
    toNumberOrNull(row.f95_latest_order),
    row.steam_id != null ? 1 : 0,
  ]
}

const insertProjectedRows = async (rows) => {
  if (rows.length === 0) return
  const cols = CATALOG_INDEX_COLUMNS.join(', ')
  const one = `(${CATALOG_INDEX_COLUMNS.map(() => '?').join(', ')})`
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    await dbRun(
      `INSERT OR REPLACE INTO catalog_index (${cols}) VALUES ${slice.map(() => one).join(', ')}`,
      slice.flat())
  }
}

// ── full rebuild ─────────────────────────────────────────────────────────────

// Chunked on purpose. node-sqlite3 runs statements on a threadpool so the event
// loop stays responsive, but every query shares one connection — a single
// long-running transaction would queue the library's own reads behind it and
// read as a freeze. Committing per chunk and yielding between chunks lets those
// reads interleave, so the app is usable while this runs in the background.
const rebuildCatalogIndex = async ({ onProgress, chunkSize = CHUNK_SIZE } = {}) => {
  const startedAt = Date.now()
  await ensureCatalogIndexSchema()

  const report = (payload) => {
    if (typeof onProgress !== 'function') return
    try { onProgress(payload) } catch { /* never let the reporter break the build */ }
  }

  report({ phase: 'start', processed: 0, total: 0, message: 'Preparing catalog index…' })

  const steam = await rebuildAtlasExternalSteam({ onProgress: report })

  const totalRow = await dbGet(`SELECT COUNT(*) AS c FROM atlas_data`)
  const total = totalRow?.c || 0

  await dbRun('DELETE FROM catalog_index')
  await setMeta('stale', '1')
  await setMeta('stale_reason', 'rebuild in progress')

  const nowMs = Date.now()
  let processed = 0

  for (let offset = 0; offset < total; offset += chunkSize) {
    const rows = await dbAll(
      `${ATLAS_SOURCE_QUERY} GROUP BY a.atlas_id ORDER BY a.atlas_id LIMIT ? OFFSET ?`,
      [chunkSize, offset])
    if (rows.length === 0) break

    const projected = rows.map((row) => projectAtlasRow(row, nowMs))
    // One transaction PER CHUNK, taken under the shared write lock. The lock is
    // released between chunks, so a concurrent catalog sync interleaves at a
    // transaction boundary instead of committing this one out from under us.
    await withTransaction('catalogIndex.chunk', dbRun, () => insertProjectedRows(projected))

    processed += rows.length
    report({
      phase: 'catalog', processed, total,
      message: `Indexing catalog (${processed.toLocaleString()} of ${total.toLocaleString()})…`,
    })
    await yieldToLoop()
  }

  const orphans = await rebuildOrphanBranches({ onProgress: report, chunkSize, nowMs })

  await setMeta('version', CATALOG_INDEX_VERSION)
  await setMeta('built_at', Date.now())
  await setMeta('stale', '0')
  await setMeta('stale_reason', null)

  // The planner has no stats for a table that did not exist a moment ago, and
  // browse mixes an indexed ORDER BY with optional LIKE predicates — exactly
  // where a stats-free plan goes wrong.
  try { await dbRun('ANALYZE catalog_index') }
  catch (err) { console.warn('ANALYZE catalog_index failed:', err.message) }

  const durationMs = Date.now() - startedAt
  const summary = {
    durationMs,
    atlasRows: processed,
    steamLinks: steam.pairs,
    ...orphans,
    totalRows: processed + orphans.steamRows + orphans.gogRows + orphans.lewdcornerRows,
  }
  console.log(
    `catalog_index rebuilt in ${durationMs}ms: ${summary.totalRows} rows ` +
    `(atlas ${processed}, steam ${orphans.steamRows}, gog ${orphans.gogRows}, ` +
    `lewdcorner ${orphans.lewdcornerRows}), ${steam.pairs} external steam links`)
  report({ phase: 'done', processed: summary.totalRows, total: summary.totalRows, message: 'Catalog index ready' })
  return summary
}

// Tiles for provider rows that do NOT roll up under an atlas entry. The steam
// branch's exclusion is now a primary-key probe against atlas_external_steam
// instead of five correlated LIKE patterns over atlas_data.
const rebuildOrphanBranches = async ({ onProgress, chunkSize, nowMs }) => {
  const report = (payload) => {
    if (typeof onProgress !== 'function') return
    try { onProgress(payload) } catch { /* ignore */ }
  }

  const counts = { steamRows: 0, gogRows: 0, lewdcornerRows: 0 }

  const runBranch = async (label, countSql, pageSql, project, key) => {
    const totalRow = await dbGet(countSql)
    const total = totalRow?.c || 0
    let done = 0
    for (let offset = 0; offset < total; offset += chunkSize) {
      const rows = await dbAll(pageSql, [chunkSize, offset])
      if (rows.length === 0) break
      const projected = rows.map((row) => project(row, nowMs))
      await withTransaction(`catalogIndex.${label}`, dbRun, () => insertProjectedRows(projected))
      done += rows.length
      report({ phase: label, processed: done, total, message: `Indexing ${label} entries…` })
      await yieldToLoop()
    }
    counts[key] = done
  }

  const STEAM_WHERE = `
    FROM steam_data sd
    LEFT JOIN atlas_data a ON sd.atlas_id = a.atlas_id
    WHERE (sd.atlas_id IS NULL OR a.atlas_id IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM atlas_external_steam aes WHERE aes.steam_appid = sd.steam_id
      )`

  await runBranch('steam',
    `SELECT COUNT(*) AS c ${STEAM_WHERE}`,
    // steam_data has no `status` or `rating` column: the thread/release status is
    // `release_state` (matching `steam_data.release_state as status` in the union
    // query this mirrors), and there is no rating at all.
    `SELECT sd.steam_id, sd.title, sd.developer, sd.publisher, sd.engine,
            sd.release_state AS status,
            sd.category, sd.censored, sd.language, sd.tags, sd.release_date,
            (SELECT MIN(sm.record_id) FROM steam_mappings sm WHERE sm.steam_id = sd.steam_id) AS local_record_id
     ${STEAM_WHERE} ORDER BY sd.steam_id LIMIT ? OFFSET ?`,
    (row, now) => {
      const releaseMs = parseDateToMs(row.release_date)
      const title = row.title == null ? null : String(row.title)
      const creator = row.developer || row.publisher || null
      return [
        `steam:${row.steam_id}`, `catalog:steam:${row.steam_id}`, 'steam',
        null, row.steam_id, null, null, null,
        row.local_record_id ?? null, row.local_record_id != null ? 1 : 0,
        title, title, creator, row.engine ?? null, row.category ?? null,
        row.status ?? null, row.censored ?? null, row.language ?? null,
        joinText(row.tags), joinText(title, creator, row.engine, row.status, row.category),
        null, null, null,
        2, null, 2, null, dateTier(releaseMs, now), releaseMs, null, 1,
      ]
    }, 'steamRows')

  const GOG_WHERE = `
    FROM gog_data gd
    LEFT JOIN atlas_data a ON gd.atlas_id = a.atlas_id
    WHERE gd.atlas_id IS NULL OR a.atlas_id IS NULL`

  await runBranch('gog',
    `SELECT COUNT(*) AS c ${GOG_WHERE}`,
    // Same as steam: release_state, and no rating column.
    `SELECT gd.gog_id, gd.title, gd.developer, gd.publisher, gd.engine, gd.category,
            gd.release_state AS status,
            gd.censored, gd.language, gd.tags, gd.release_date, gd.store_url,
            (SELECT MIN(gm.record_id) FROM gog_mappings gm WHERE gm.gog_id = gd.gog_id) AS local_record_id
     ${GOG_WHERE} ORDER BY gd.gog_id LIMIT ? OFFSET ?`,
    (row, now) => {
      const releaseMs = parseDateToMs(row.release_date)
      const title = row.title == null ? null : String(row.title)
      const creator = row.developer || row.publisher || null
      return [
        `gog:${row.gog_id}`, `catalog:gog:${row.gog_id}`, 'gog',
        null, null, row.gog_id, null, null,
        row.local_record_id ?? null, row.local_record_id != null ? 1 : 0,
        title, title, creator, row.engine ?? null, row.category ?? null,
        row.status ?? null, row.censored ?? null, row.language ?? null,
        joinText(row.tags), joinText(title, creator, row.engine, row.status, row.category),
        row.store_url ?? null, null, null,
        2, null, 2, null, dateTier(releaseMs, now), releaseMs, null, 0,
      ]
    }, 'gogRows')

  const LC_WHERE = `
    FROM lewdcorner_data ld
    LEFT JOIN atlas_data a ON ld.atlas_id = a.atlas_id
    WHERE ld.atlas_id IS NULL OR a.atlas_id IS NULL`

  await runBranch('lewdcorner',
    `SELECT COUNT(*) AS c ${LC_WHERE}`,
    `SELECT ld.lc_id, ld.tags, ld.prefixes, ld.rating, ld.likes, ld.site_url,
            ld.thread_updated, ld.register_date,
            (SELECT MIN(lm.record_id) FROM lewdcorner_mappings lm WHERE lm.lc_id = ld.lc_id) AS local_record_id
     ${LC_WHERE} ORDER BY ld.lc_id LIMIT ? OFFSET ?`,
    (row, now) => {
      // Matches lewdcorner_branch_base's synthetic display values — these rows
      // carry no title of their own.
      const title = `LewdCorner #${row.lc_id}`
      const tuMs = parseDateToMs(row.thread_updated)
      const tpMs = parseDateToMs(row.register_date)
      return [
        `lewdcorner:${row.lc_id}`, `catalog:lewdcorner:${row.lc_id}`, 'lewdcorner',
        null, null, null, row.lc_id, null,
        row.local_record_id ?? null, row.local_record_id != null ? 1 : 0,
        title, title, 'Unknown', null, null, null, null, null,
        joinText(row.tags, row.prefixes), joinText(title, 'Unknown'),
        row.site_url ?? null, toNumberOrNull(row.rating), toNumberOrNull(row.likes),
        dateTier(tuMs, now), tuMs, dateTier(tpMs, now), tpMs, 2, null, null, 0,
      ]
    }, 'lewdcornerRows')

  return counts
}

// ── incremental refresh ──────────────────────────────────────────────────────

// Re-project specific atlas entries. Called as catalog updates land so a sync
// does not require a full rebuild.
const refreshCatalogIndexForAtlasIds = async (atlasIds = []) => {
  const ids = Array.from(new Set(
    (Array.isArray(atlasIds) ? atlasIds : [atlasIds])
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isInteger(id))))
  if (ids.length === 0) return { refreshed: 0 }

  await ensureCatalogIndexSchema()
  const nowMs = Date.now()
  let refreshed = 0

  for (let i = 0; i < ids.length; i += 400) {
    const slice = ids.slice(i, i + 400)
    const placeholders = slice.map(() => '?').join(', ')
    const rows = await dbAll(
      `${ATLAS_SOURCE_QUERY} WHERE a.atlas_id IN (${placeholders}) GROUP BY a.atlas_id`,
      slice)
    const found = new Set(rows.map((row) => row.atlas_id))
    const missing = slice.filter((id) => !found.has(id))

    await withTransaction('catalogIndex.refresh', dbRun, async () => {
      if (missing.length > 0) {
        await dbRun(
          `DELETE FROM catalog_index WHERE catalog_key IN (${missing.map(() => '?').join(', ')})`,
          missing.map((id) => `atlas:${id}`))
      }
      await insertProjectedRows(rows.map((row) => projectAtlasRow(row, nowMs)))
    })
    refreshed += rows.length
    await yieldToLoop()
  }
  return { refreshed }
}

// A local import/delete changes is_installed and local_record_id for whichever
// tile the record maps to. Cheap targeted update rather than a reprojection.
const refreshCatalogIndexInstallState = async (recordId) => {
  const id = Number.parseInt(recordId, 10)
  if (!Number.isInteger(id)) return { updated: 0 }
  try {
    await ensureCatalogIndexSchema()
    const exists = await dbGet(`SELECT record_id FROM games WHERE record_id = ?`, [id])
    if (!exists) {
      const res = await dbRun(
        `UPDATE catalog_index SET local_record_id = NULL, is_installed = 0
          WHERE local_record_id = ?`, [id])
      return { updated: res?.changes || 0 }
    }
    const rows = await dbAll(
      `SELECT atlas_id FROM atlas_mappings WHERE record_id = ?
        UNION SELECT ad.atlas_id FROM steam_mappings sm
          JOIN steam_data ad ON ad.steam_id = sm.steam_id
         WHERE sm.record_id = ? AND ad.atlas_id IS NOT NULL`, [id, id])
    const atlasIds = rows.map((r) => r.atlas_id).filter((v) => v != null)
    if (atlasIds.length > 0) await refreshCatalogIndexForAtlasIds(atlasIds)
    const res = await dbRun(
      `UPDATE catalog_index SET is_installed = 1
        WHERE local_record_id = ? AND is_installed = 0`, [id])
    return { updated: (res?.changes || 0) + atlasIds.length }
  } catch (err) {
    console.warn(`catalog_index install-state refresh failed for ${recordId}:`, err.message)
    await markCatalogIndexStale('install-state refresh failed')
    return { updated: 0 }
  }
}

module.exports = {
  CATALOG_INDEX_VERSION,
  // Consumed by initializeDatabase() so the tables exist before any Browse
  // query runs — getCatalogGames' steam branch probes atlas_external_steam, and
  // a missing table would error the whole query rather than merely be slow.
  CATALOG_INDEX_DDL,
  CATALOG_INDEX_INDEXES,
  ensureCatalogIndexSchema,
  getCatalogIndexStatus,
  markCatalogIndexStale,
  rebuildCatalogIndex,
  rebuildAtlasExternalSteam,
  refreshCatalogIndexForAtlasIds,
  refreshCatalogIndexInstallState,
  // exported for tests
  parseDateToMs,
  dateTier,
  extractSteamAppIds,
}

// ── query path ───────────────────────────────────────────────────────────────
//
// Resolves a page of browse results to an ordered list of catalog keys plus an
// optional total, filtering and sorting entirely against catalog_index. The
// caller then hydrates just those keys from the source tables.
//
// Local-only concepts (favourite, playstate, personal rating, wishlist) are not
// projected into the index because they change on user action rather than on
// catalog sync; they join in from games / game_personal_ratings /
// wishlist_entries on local_record_id, which is indexed.
const buildIndexWhere = (search = {}, filters = {}) => {
  const parts = []
  const params = []

  const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`)
  const like = (value) => `%${escapeLike(value).toLowerCase()}%`
  const toArray = (value) => {
    if (Array.isArray(value)) {
      return value.filter((v) => v !== undefined && v !== null && String(v).trim() !== '').map(String)
    }
    if (value === undefined || value === null || value === '') return []
    return [String(value)]
  }

  // ── text search ───────────────────────────────────────────────────────────
  let text = String(search.text || '').trim()
  let type = String(search.type || 'all').trim()
  const prefixed = text.match(/^([a-z]+):\s*(.+)$/i)
  if (prefixed) {
    const prefix = prefixed[1].toLowerCase()
    text = prefixed[2].trim()
    if (prefix === 'id') type = 'anyId'
    if (prefix === 'f95') type = 'f95Id'
    if (prefix === 'lc' || prefix === 'lewdcorner') type = 'lewdcornerId'
    if (prefix === 'atlas') type = 'atlasId'
    if (prefix === 'steam') type = 'steamId'
    if (prefix === 'url') type = 'source'
  }
  const terms = text.split(/\s+/).map((t) => t.trim()).filter((t) => t && !t.startsWith('-'))
  if (terms.length > 0) {
    const fieldsFor = {
      title: ['title', 'short_name'],
      creator: ['creator'],
      atlasId: ['atlas_id', 'record_id'],
      f95Id: ['f95_id'],
      lewdcornerId: ['lc_id'],
      steamId: ['steam_id'],
      anyId: ['atlas_id', 'record_id', 'f95_id', 'lc_id', 'steam_id'],
      source: ['site_url', 'source'],
    }
    // The catch-all search matches the precomputed search_text (title, name,
    // creator, engine, status, category) plus tags_text, replacing a ten-column
    // OR across the union.
    const fields = fieldsFor[type] || ['search_text', 'tags_text']
    for (const term of terms) {
      parts.push(`(${fields.map((f) => `LOWER(COALESCE(CAST(ci.${f} AS TEXT), '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`)
      params.push(...fields.map(() => like(term)))
    }
  }

  // ── source ────────────────────────────────────────────────────────────────
  const browseSource = String(filters.browseSource || filters.source || 'all').toLowerCase()
  if (browseSource === 'steam') {
    // "Steam" means any tile that HAS a Steam link, not only tiles whose
    // computed source is steam — has_steam_link captures both.
    parts.push(`(ci.source = 'steam' OR ci.has_steam_link = 1 OR ci.steam_id IS NOT NULL)`)
  } else if (['f95', 'lewdcorner', 'atlas', 'gog'].includes(browseSource)) {
    parts.push('ci.source = ?')
    params.push(browseSource)
  }

  const addIn = (column, values) => {
    const safe = toArray(values)
    if (safe.length === 0) return
    parts.push(`ci.${column} COLLATE NOCASE IN (${safe.map(() => '?').join(', ')})`)
    params.push(...safe)
  }
  const addNotIn = (column, values) => {
    const safe = toArray(values)
    if (safe.length === 0) return
    parts.push(`(ci.${column} IS NULL OR ci.${column} COLLATE NOCASE NOT IN (${safe.map(() => '?').join(', ')}))`)
    params.push(...safe)
  }

  addIn('category', filters.category)
  addNotIn('category', filters.excludedCategories)
  addIn('engine', filters.engine)
  addNotIn('engine', filters.excludedEngines)
  addIn('status', filters.status)
  addNotIn('status', filters.excludedStatuses)
  addIn('censored', filters.censored)

  const languages = toArray(filters.language)
  if (languages.length > 0) {
    parts.push(`(${languages.map(() => `LOWER(COALESCE(ci.language, '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    params.push(...languages.map(like))
  }

  // All four tag sources are concatenated into tags_text at index time, so one
  // LIKE per tag replaces four.
  const addTags = (values, { exclude = false, logic = 'AND' } = {}) => {
    const safe = toArray(values)
    if (safe.length === 0) return
    const clauses = safe.map((value) => {
      params.push(like(value))
      const one = `LOWER(COALESCE(ci.tags_text, '')) LIKE ? ESCAPE '\\'`
      return exclude ? `NOT (${one})` : `(${one})`
    })
    parts.push(`(${clauses.join(exclude || logic === 'AND' ? ' AND ' : ' OR ')})`)
  }
  addTags(filters.tags, { logic: filters.tagLogic === 'OR' ? 'OR' : 'AND' })
  addTags(filters.excludedTags, { exclude: true })

  if (filters.steamMapped === true) {
    parts.push('(ci.steam_id IS NOT NULL OR ci.has_steam_link = 1)')
  }
  if (filters.installState === 'installed') parts.push('ci.is_installed = 1')
  else if (filters.installState === 'uninstalled') parts.push('ci.is_installed = 0')
  if (filters.updateAvailable === true) parts.push('ci.is_installed = 1')
  if (filters.favoritesOnly === true) parts.push('COALESCE(lg.is_favorite, 0) = 1')

  // Effective playstate: an explicit per-title override wins, otherwise it is
  // derived from the versions but only when every version agrees.
  const playstateExpr = `COALESCE(
    lg.playstate,
    (SELECT CASE
              WHEN COUNT(*) > 0
               AND SUM(CASE WHEN v.playstate IS NULL OR v.playstate = '' THEN 1 ELSE 0 END) = 0
               AND COUNT(DISTINCT v.playstate) = 1
              THEN MAX(v.playstate) ELSE NULL END
     FROM versions v WHERE v.record_id = ci.local_record_id)
  )`
  const includePlaystates = toArray(filters.playstates)
  if (includePlaystates.length > 0) {
    parts.push(`(${playstateExpr}) COLLATE NOCASE IN (${includePlaystates.map(() => '?').join(', ')})`)
    params.push(...includePlaystates)
  }
  const excludePlaystates = toArray(filters.excludedPlaystates)
  if (excludePlaystates.length > 0) {
    parts.push(`((${playstateExpr}) IS NULL OR (${playstateExpr}) COLLATE NOCASE NOT IN (${excludePlaystates.map(() => '?').join(', ')}))`)
    params.push(...excludePlaystates, ...excludePlaystates)
  }

  if (filters.wishlistOnly === true) {
    parts.push(`EXISTS (
      SELECT 1 FROM wishlist_entries w
       WHERE (w.atlas_id IS NOT NULL AND w.atlas_id = ci.atlas_id)
          OR (w.f95_id  IS NOT NULL AND w.f95_id  = ci.f95_id)
          OR (w.lc_id   IS NOT NULL AND w.lc_id   = ci.lc_id)
          OR (w.steam_id IS NOT NULL AND w.steam_id = ci.steam_id))`)
  }

  const ratingExpr = `(
    (COALESCE(lr.story,0) + COALESCE(lr.graphics,0) + COALESCE(lr.gameplay,0) + COALESCE(lr.fappability,0)) * 1.0
    / NULLIF(
        (CASE WHEN lr.story IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN lr.graphics IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN lr.gameplay IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN lr.fappability IS NOT NULL THEN 1 ELSE 0 END), 0))`
  const ratingMin = Number(filters.personalRatingMin)
  const ratingStatus = ['rated', 'unrated'].includes(filters.personalRatingStatus)
    ? filters.personalRatingStatus
    : filters.personalRatingRatedOnly === true ? 'rated' : 'any'
  if (ratingStatus === 'unrated') {
    parts.push(`${ratingExpr} IS NULL`)
  } else if (ratingStatus === 'rated' || (Number.isFinite(ratingMin) && ratingMin > 0)) {
    parts.push(`${ratingExpr} IS NOT NULL`)
    if (Number.isFinite(ratingMin) && ratingMin > 0) {
      parts.push(`${ratingExpr} >= ?`)
      params.push(ratingMin)
    }
  }

  const communityMin = Number(filters.communityRatingMin)
  if (Number.isFinite(communityMin) && communityMin > 0) {
    parts.push('COALESCE(ci.rating_best, 0) >= ?')
    params.push(communityMin)
  }

  // Date ranges hit the stored *_ms integers, so these are index-usable rather
  // than a CASE evaluated per row.
  const addDateRange = (column, range) => {
    const now = Date.now()
    let min = null
    let max = now
    if (range === '7d') min = now - 7 * 86400000
    else if (range === '30d') min = now - 30 * 86400000
    else if (range === '90d') min = now - 90 * 86400000
    else if (range === 'year') {
      const year = new Date(now).getFullYear()
      min = new Date(year, 0, 1).getTime()
      max = new Date(year + 1, 0, 1).getTime() - 1
    } else return
    parts.push(`ci.${column} BETWEEN ? AND ?`)
    params.push(min, max)
  }
  const range = filters.dateRange
  if (filters.dateField === 'releaseDate' && range && range !== 'any') addDateRange('release_date_ms', range)
  else if (filters.dateField === 'latestUpdate' && range && range !== 'any') addDateRange('thread_updated_ms', range)
  else if (filters.dateField === 'threadPublished' && range && range !== 'any') addDateRange('thread_publish_ms', range)
  else if (filters.dateField === 'none' && filters.browseDateRange && filters.browseDateRange !== 'any') {
    addDateRange(
      filters.browseDateBasis === 'thread_publish_date' ? 'thread_publish_ms' : 'thread_updated_ms',
      filters.browseDateRange)
  }

  return { where: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params }
}

// (tier ASC, ms DESC, title, catalog_key) matches the composite indexes exactly,
// which is what lets the default newest-first page terminate early instead of
// sorting the whole catalog.
const buildIndexOrderBy = (filters = {}) => {
  const aliases = {
    name: 'titleAsc', nameAsc: 'titleAsc', nameDesc: 'titleDesc',
    newest: 'threadUpdatedDesc', oldest: 'threadUpdatedAsc',
  }
  const raw = String(filters.browseSort || 'threadUpdatedDesc')
  const sort = aliases[raw] || raw
  const dated = (prefix, dir) =>
    `ORDER BY ci.${prefix}_tier ASC, ci.${prefix}_ms ${dir}, ci.title COLLATE NOCASE ASC, ci.catalog_key ASC`
  const nullsLast = (column, dir) =>
    `ORDER BY CASE WHEN ci.${column} IS NULL THEN 1 ELSE 0 END ASC, ci.${column} ${dir}, ci.title COLLATE NOCASE ASC, ci.catalog_key ASC`
  switch (sort) {
    case 'titleDesc': return 'ORDER BY ci.title COLLATE NOCASE DESC, ci.catalog_key DESC'
    case 'titleAsc': return 'ORDER BY ci.title COLLATE NOCASE ASC, ci.catalog_key ASC'
    case 'creatorAsc': return nullsLast('creator', 'ASC')
    case 'creatorDesc': return nullsLast('creator', 'DESC')
    case 'likesDesc': return nullsLast('likes_best', 'DESC')
    case 'likesAsc': return nullsLast('likes_best', 'ASC')
    case 'ratingDesc': return nullsLast('rating_best', 'DESC')
    case 'ratingAsc': return nullsLast('rating_best', 'ASC')
    case 'threadUpdatedAsc': return dated('thread_updated', 'ASC')
    case 'threadPublishedDesc': return dated('thread_publish', 'DESC')
    case 'threadPublishedAsc': return dated('thread_publish', 'ASC')
    case 'releaseDateDesc': return dated('release_date', 'DESC')
    case 'releaseDateAsc': return dated('release_date', 'ASC')
    case 'f95LatestOrderDesc': return nullsLast('f95_latest_order', 'DESC')
    case 'f95LatestOrderAsc': return nullsLast('f95_latest_order', 'ASC')
    default: return dated('thread_updated', 'DESC')
  }
}

const CATALOG_INDEX_JOINS = `
  LEFT JOIN games AS lg ON lg.record_id = ci.local_record_id
  LEFT JOIN game_personal_ratings AS lr ON lr.record_id = ci.local_record_id
`

const queryCatalogIndex = async ({
  search = {}, filters = {}, offset = 0, limit = 250,
  includeTotal = false, countOnly = false,
} = {}) => {
  const { where, params } = buildIndexWhere(search, filters)
  let total = null
  if (includeTotal || countOnly) {
    const row = await dbGet(
      `SELECT COUNT(*) AS total FROM catalog_index ci ${CATALOG_INDEX_JOINS} ${where}`, params)
    total = Number(row?.total || 0)
  }
  if (countOnly) return { keys: [], total }
  const rows = await dbAll(
    `SELECT ci.catalog_key FROM catalog_index ci ${CATALOG_INDEX_JOINS} ${where}
     ${buildIndexOrderBy(filters)} LIMIT ? OFFSET ?`,
    [...params, limit, offset])
  return { keys: rows.map((r) => r.catalog_key), total }
}

module.exports.queryCatalogIndex = queryCatalogIndex
module.exports.buildIndexWhere = buildIndexWhere
module.exports.buildIndexOrderBy = buildIndexOrderBy

module.exports.isWriteLockBusy = isWriteLockBusy
