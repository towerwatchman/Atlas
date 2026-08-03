// Database audit: find games whose Atlas mapping is no longer valid.
//
// Three cases are reported (see the union below):
//   1. 'removed'    — the game is mapped, the atlas_data row still exists, but
//                     it was flagged removed_from_server during a snapshot sync
//                     (the remote no longer has it). This is the primary case:
//                     the metadata is stale/orphaned on the remote side.
//   2. 'orphaned'   — the game has an atlas_mappings row whose atlas_id no
//                     longer exists in atlas_data at all (e.g. pruned by an
//                     older sync). The JOIN yields nulls, so the game silently
//                     lost its metadata.
//   3. 'unmapped'   — the game has no atlas_mappings row at all (imported but
//                     never matched to a catalog entry).
//
// This is a pure SELECT — it never mutates the database — so it is safe to run
// at any time, including automatically after a sync.
const dbModule = require('./index')
const getDb = () => dbModule.db

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  })

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  })

// Lightweight count for the passive "N games need remapping" badge. Counts the
// primary case (remote-removed) only, matching what the sync itself flags, so
// the badge reflects "something changed on the remote" rather than pre-existing
// unmapped imports the user may already know about.
const getInvalidMappingCount = async () => {
  const row = await dbGet(
    `SELECT COUNT(*) AS c
       FROM atlas_mappings am
       JOIN atlas_data ad ON ad.atlas_id = am.atlas_id
      WHERE ad.removed_from_server != 0`,
  )
  return row?.c || 0
}

// Full audit list. Returns one row per affected game with a machine-readable
// `reason` plus enough context to display and to drive a remap.
// ── Catalog-side orphans ─────────────────────────────────────────────────────
//
// The counterpart to the `orphaned` reason above, measured from the CATALOG side
// instead of the games side.
//
// The browse union has one canonical atlas branch plus three orphan branches
// (steam, gog, lewdcorner) that each match only rows with no atlas parent, so
// nothing is shown twice. Those branches are normally EMPTY -- a healthy catalog
// has an atlas row behind every provider row -- and when they are not, the rows
// they surface have degraded identity: steam/gog fall back to their own title,
// and f95/lewdcorner have no title anywhere and render a placeholder.
//
// This was asked twice as "why do some LewdCorner games have no name", and
// answering it both times meant hand-writing SQL against data.db, because
// nothing in the app reported it. Now it does. Two distinct causes are counted
// separately because they need opposite responses:
//
//   noAtlasId  the provider row has no atlas_id at all. Nothing local can fix
//              this; the thread is uncurated upstream.
//   dangling   the provider row HAS an atlas_id but no atlas_data row matches.
//              A local gap -- the atlas table is behind, or an update package
//              was partially ingested. Fixing the ingest restores the name.
//
// f95_zone_data is included even though nothing surfaces it in Browse: there is
// no f95 orphan branch, so those rows are invisible rather than badly named, and
// a rising count there is worth seeing before someone adds one.
const CATALOG_ORPHAN_SOURCES = [
  { provider: 'lewdcorner', table: 'lewdcorner_data', carriesOwnTitle: false, shownInBrowse: true },
  { provider: 'f95', table: 'f95_zone_data', carriesOwnTitle: false, shownInBrowse: false },
  { provider: 'steam', table: 'steam_data', carriesOwnTitle: true, shownInBrowse: true },
  { provider: 'gog', table: 'gog_data', carriesOwnTitle: true, shownInBrowse: true },
]

const auditCatalogOrphans = async () => {
  const results = []
  for (const source of CATALOG_ORPHAN_SOURCES) {
    // Table names come from the frozen list above, never from input.
    const row = await dbGet(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN t.atlas_id IS NULL THEN 1 ELSE 0 END) AS noAtlasId,
              SUM(CASE WHEN t.atlas_id IS NOT NULL AND a.atlas_id IS NULL
                       THEN 1 ELSE 0 END) AS dangling
         FROM ${source.table} t
         LEFT JOIN atlas_data a ON a.atlas_id = t.atlas_id`,
    ).catch(() => null)
    // A missing table is not a failure: a fresh install may not have ingested
    // every provider yet, and an audit that throws tells the user nothing.
    results.push({
      ...source,
      total: Number(row?.total) || 0,
      noAtlasId: Number(row?.noAtlasId) || 0,
      dangling: Number(row?.dangling) || 0,
      unavailable: row === null,
    })
  }
  return {
    sources: results,
    // One number for the summary line. Only counts what a user can actually
    // encounter: an invisible f95 orphan is not a naming problem today.
    withoutIdentity: results
      .filter((r) => r.shownInBrowse && !r.carriesOwnTitle)
      .reduce((sum, r) => sum + r.noAtlasId + r.dangling, 0),
    dangling: results.reduce((sum, r) => sum + r.dangling, 0),
  }
}

const runDatabaseAudit = async () => {
  const rows = await dbAll(
    `
    -- 1. Mapped but flagged removed on the remote
    SELECT g.record_id            AS recordId,
           g.title                AS title,
           g.creator              AS creator,
           'removed'              AS reason,
           am.atlas_id            AS atlasId,
           ad.removed_from_server AS removedDate
      FROM games g
      JOIN atlas_mappings am ON am.record_id = g.record_id
      JOIN atlas_data ad     ON ad.atlas_id = am.atlas_id
     WHERE ad.removed_from_server != 0

    UNION ALL

    -- 2. Mapped to an atlas_id that no longer exists at all
    SELECT g.record_id AS recordId,
           g.title     AS title,
           g.creator   AS creator,
           'orphaned'  AS reason,
           am.atlas_id AS atlasId,
           NULL        AS removedDate
      FROM games g
      JOIN atlas_mappings am ON am.record_id = g.record_id
      LEFT JOIN atlas_data ad ON ad.atlas_id = am.atlas_id
     WHERE ad.atlas_id IS NULL

    UNION ALL

    -- 3. Never mapped to a catalog entry
    SELECT g.record_id AS recordId,
           g.title     AS title,
           g.creator   AS creator,
           'unmapped'  AS reason,
           NULL        AS atlasId,
           NULL        AS removedDate
      FROM games g
      LEFT JOIN atlas_mappings am ON am.record_id = g.record_id
     WHERE am.record_id IS NULL

    ORDER BY reason, title COLLATE NOCASE
    `,
  )

  const summary = { removed: 0, orphaned: 0, unmapped: 0 }
  for (const r of rows) {
    if (summary[r.reason] !== undefined) summary[r.reason] += 1
  }
  return { items: rows, summary, total: rows.length, catalogOrphans: await auditCatalogOrphans() }
}

module.exports = { runDatabaseAudit, getInvalidMappingCount, auditCatalogOrphans, CATALOG_ORPHAN_SOURCES }
