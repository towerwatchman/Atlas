// Season/version merge: fold multiple library records that share one atlas_id
// into a single record whose versions carry per-source identity.
//
// Why this exists
// ---------------
// On F95 a single game holds multiple *versions* (Season 1, Season 2) under one
// atlas entry. On Steam those seasons are separate store appids, and the client
// historically imported each appid as its OWN games record -> two tiles for what
// is really one game. The server already supports mapping several Steam appids
// to one atlas_id; the client just never grouped them.
//
// The versions table already carries per-version `source` / `source_app_id`
// (the Steam appid for a steam version), and launch/install already act on the
// selected version's source. So the fix is: one games record per atlas_id, each
// appid as a versions row. This module migrates EXISTING split records into that
// shape. New imports are handled separately (import layer).
//
// Safety
// ------
// - `auditSeasonMerges` is a pure SELECT; it never mutates. It reports each
//   atlas_id that currently owns 2+ local records, with enough context to show
//   the user what would merge.
// - `applySeasonMerge` runs inside a transaction and is idempotent: merging an
//   already-merged group is a no-op. Per-version playtime is preserved exactly
//   (rows are moved, not summed). Nothing runs without explicit user action.
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

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err)
      else resolve(this) // { lastID, changes }
    })
  })

// ---------------------------------------------------------------- audit

// Every atlas_id that maps to 2+ local records. Grouping is by atlas_id ONLY
// (server-linked), never by title heuristics -- that is the safe rule the user
// chose. Includes per-record context (title, version count, most-recent play)
// so the UI can show what will merge and so applySeasonMerge can pick a
// survivor deterministically.
const auditSeasonMerges = async () => {
  const groups = await dbAll(
    `SELECT am.atlas_id AS atlasId,
            COUNT(DISTINCT am.record_id) AS recordCount
       FROM atlas_mappings am
       JOIN games g ON g.record_id = am.record_id
      GROUP BY am.atlas_id
     HAVING COUNT(DISTINCT am.record_id) > 1
      ORDER BY am.atlas_id`,
  )

  const items = []
  for (const grp of groups) {
    const records = await dbAll(
      `SELECT g.record_id AS recordId,
              g.title      AS title,
              g.creator    AS creator,
              (SELECT COUNT(*) FROM versions v WHERE v.record_id = g.record_id) AS versionCount,
              (SELECT MAX(v.last_played) FROM versions v WHERE v.record_id = g.record_id) AS lastPlayed,
              (SELECT COUNT(*) FROM versions v
                WHERE v.record_id = g.record_id AND v.source = 'steam') AS steamVersionCount
         FROM games g
         JOIN atlas_mappings am ON am.record_id = g.record_id
        WHERE am.atlas_id = ?
        ORDER BY g.record_id`,
      [grp.atlasId],
    )

    // Metadata title for the group (what the merged tile will show).
    const meta = await dbGet(
      `SELECT title FROM atlas_data WHERE atlas_id = ? LIMIT 1`,
      [grp.atlasId],
    )

    const survivorId = pickSurvivor(records)
    items.push({
      atlasId: grp.atlasId,
      groupTitle: meta?.title || records[0]?.title || `Atlas #${grp.atlasId}`,
      recordCount: grp.recordCount,
      survivorRecordId: survivorId,
      records: records.map((r) => ({ ...r, isSurvivor: r.recordId === survivorId })),
    })
  }

  return { items, total: items.length }
}

// Survivor = the record most worth keeping as the canonical tile:
//   1. most-recently-played (highest MAX(last_played))
//   2. tie-break: most versions
//   3. tie-break: lowest record_id (oldest / most stable)
const pickSurvivor = (records) => {
  const norm = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const sorted = [...records].sort((a, b) => {
    const lp = norm(b.lastPlayed) - norm(a.lastPlayed)
    if (lp !== 0) return lp
    const vc = norm(b.versionCount) - norm(a.versionCount)
    if (vc !== 0) return vc
    return norm(a.recordId) - norm(b.recordId)
  })
  return sorted[0]?.recordId ?? null
}

// ---------------------------------------------------------------- apply

// Version-name collisions: two records being merged may both have e.g. a
// "Season 1" version. versions has UNIQUE(record_id, version), so on move we
// rename a colliding incoming version by suffixing until unique.
const uniqueVersionName = async (recordId, desired) => {
  const base = desired == null || desired === '' ? 'Version' : String(desired)
  let candidate = base
  let n = 2
  while (true) {
    const clash = await dbGet(
      `SELECT 1 FROM versions WHERE record_id = ? AND version = ? LIMIT 1`,
      [recordId, candidate],
    )
    if (!clash) return candidate
    candidate = `${base} (${n})`
    n += 1
  }
}

// Merge one atlas group into its survivor. Optional survivorRecordId lets the
// caller override the auto-picked survivor (the UI may expose this later; today
// it defaults to pickSurvivor). Returns a summary of what changed.
const applySeasonMerge = async (atlasId, survivorRecordId = null) => {
  const records = await dbAll(
    `SELECT g.record_id AS recordId,
            (SELECT COUNT(*) FROM versions v WHERE v.record_id = g.record_id) AS versionCount,
            (SELECT MAX(v.last_played) FROM versions v WHERE v.record_id = g.record_id) AS lastPlayed
       FROM games g
       JOIN atlas_mappings am ON am.record_id = g.record_id
      WHERE am.atlas_id = ?`,
    [atlasId],
  )

  if (records.length <= 1) {
    return { atlasId, merged: false, reason: 'nothing-to-merge', survivorRecordId: records[0]?.recordId ?? null }
  }

  const survivor = survivorRecordId && records.some((r) => r.recordId === survivorRecordId)
    ? survivorRecordId
    : pickSurvivor(records)
  const losers = records.filter((r) => r.recordId !== survivor).map((r) => r.recordId)

  let movedVersions = 0

  await dbRun('BEGIN IMMEDIATE TRANSACTION')
  try {
    for (const loser of losers) {
      const versions = await dbAll(
        `SELECT rowid AS rowId, version FROM versions WHERE record_id = ?`,
        [loser],
      )
      for (const v of versions) {
        const newName = await uniqueVersionName(survivor, v.version)
        await dbRun(
          `UPDATE versions SET record_id = ?, version = ? WHERE rowid = ?`,
          [survivor, newName, v.rowId],
        )
        movedVersions += 1
      }

      // Point any steam_mapping for the loser at the survivor (back-compat:
      // versions.source_app_id is now the source of truth, but we keep the
      // legacy title-level mapping consistent). steam_mappings.record_id is the
      // PK, so move it only if the survivor doesn't already have one.
      const survivorHasSteam = await dbGet(
        `SELECT 1 FROM steam_mappings WHERE record_id = ? LIMIT 1`,
        [survivor],
      )
      if (survivorHasSteam) {
        await dbRun(`DELETE FROM steam_mappings WHERE record_id = ?`, [loser])
      } else {
        await dbRun(
          `UPDATE steam_mappings SET record_id = ? WHERE record_id = ?`,
          [survivor, loser],
        )
      }

      // Drop the loser's own atlas mapping and the empty games row. Personal
      // data keyed to the loser record_id (ratings, overrides) is removed with
      // the record; versions/playtime were already moved above.
      await dbRun(`DELETE FROM atlas_mappings WHERE record_id = ?`, [loser])
      await dbRun(`DELETE FROM games WHERE record_id = ?`, [loser])
      await cleanupOrphanRecord(loser)
    }

    // Make sure the survivor's selected_version_id still points at one of ITS
    // versions (it always should, but repair defensively after the moves).
    const sel = await dbGet(
      `SELECT selected_version_id FROM games WHERE record_id = ?`,
      [survivor],
    )
    if (sel?.selected_version_id) {
      const stillValid = await dbGet(
        `SELECT 1 FROM versions WHERE rowid = ? AND record_id = ? LIMIT 1`,
        [sel.selected_version_id, survivor],
      )
      if (!stillValid) {
        const first = await dbGet(
          `SELECT rowid FROM versions WHERE record_id = ? ORDER BY rowid LIMIT 1`,
          [survivor],
        )
        await dbRun(
          `UPDATE games SET selected_version_id = ? WHERE record_id = ?`,
          [first?.rowid ?? null, survivor],
        )
      }
    }

    await dbRun('COMMIT')
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {})
    throw err
  }

  return {
    atlasId,
    merged: true,
    survivorRecordId: survivor,
    mergedRecordIds: losers,
    movedVersions,
  }
}

// Remove per-record personal data that would otherwise dangle after the games
// row is gone. Best-effort: tables may not all exist in older DBs, so each
// delete is guarded. NOTE: only record_id-keyed tables belong here. Anything
// keyed by atlas_id (e.g. atlas_previews) is shared with the survivor and must
// NOT be touched.
const cleanupOrphanRecord = async (recordId) => {
  const tables = [
    'game_metadata_overrides',
    'game_personal_ratings',
  ]
  for (const t of tables) {
    await dbRun(`DELETE FROM ${t} WHERE record_id = ?`, [recordId]).catch(() => {})
  }
}

// Convenience: merge every group the audit finds. Returns per-group results.
const applyAllSeasonMerges = async () => {
  const { items } = await auditSeasonMerges()
  const results = []
  for (const item of items) {
    try {
      results.push(await applySeasonMerge(item.atlasId, item.survivorRecordId))
    } catch (err) {
      results.push({ atlasId: item.atlasId, merged: false, error: err.message })
    }
  }
  return { results, total: results.length }
}

module.exports = {
  auditSeasonMerges,
  applySeasonMerge,
  applyAllSeasonMerges,
  pickSurvivor,
}
