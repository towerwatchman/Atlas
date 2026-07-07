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
  return { items: rows, summary, total: rows.length }
}

module.exports = { runDatabaseAudit, getInvalidMappingCount }
