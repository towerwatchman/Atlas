'use strict'

// ── Full client check ────────────────────────────────────────────────────────
//
// A sectioned health check for the whole client, built for the case where an
// install has been carried forward across many versions and has accumulated
// stale config keys, orphaned database rows, dead file references and a
// fragmented database file.
//
// Design rules, because this touches the user's own data:
//
//   * runClientAudit() is STRICTLY READ-ONLY. It opens no transaction and issues
//     no writes. It is always safe to run, at any time, and reports what it
//     found plus exactly what a repair would change.
//   * Repairs are per-section and explicit. Nothing is applied without the user
//     naming that section, and each section declares `willChange` up front so
//     the confirmation can state the effect in plain terms rather than "fix?".
//   * A repair never deletes a user's own content. Orphan sweeps remove rows
//     whose parent record is already gone; the file checks only ever clear a
//     dangling REFERENCE, never a file on disk. Anything ambiguous is reported
//     and left alone.
//   * Every section is independent. One failing check reports its own error and
//     the rest still run.

const fs = require('fs')
const path = require('path')
const dbModule = require('./index')
const getDb = () => dbModule.db
const { withWriteLock, withTransaction } = require('./writeLock')

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
      else resolve(this)
    })
  })

const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve))

// Child tables keyed on record_id. A row here whose record_id is not in `games`
// is unreachable: record_id is an INTEGER PRIMARY KEY without AUTOINCREMENT, so
// SQLite reuses ids, and a leftover child can bleed into a later game that
// happens to reuse its id.
const RECORD_CHILD_TABLES = [
  'versions', 'atlas_mappings', 'tag_mappings', 'game_metadata_overrides',
  'previews', 'banners', 'media_assets', 'f95_zone_mappings',
  'lewdcorner_mappings', 'steam_mappings', 'gog_mappings', 'game_personal_ratings',
]

const section = (id, label, description) => ({
  id, label, description,
  status: 'ok',
  findings: [],
  count: 0,
  repairable: false,
  repairLabel: null,
  willChange: [],
  error: null,
})

const addFinding = (target, label, count, detail = null, samples = null) => {
  if (!count) return
  target.findings.push({ label, count, detail, samples: samples || null })
  target.count += count
  target.status = 'issues'
}

const tableExists = async (name) => {
  const row = await dbGet(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [name])
  return Boolean(row)
}

// ── 1. configuration ─────────────────────────────────────────────────────────

const auditConfig = async (ctx) => {
  const result = section('config', 'Configuration',
    'Checks config.ini for settings left behind by older versions of Atlas.')
  try {
    const report = ctx?.configSanitizeReport || null
    const { CONFIG_VERSION } = require('../config/configSchema')

    if (!report || !report.ran) {
      result.findings.push({
        label: 'Configuration was not checked this launch', count: 0,
        detail: 'The startup check did not run. Restart Atlas to run it.', samples: null,
      })
      return result
    }

    // The prune already happened at startup (with a .bak). This section reports
    // it rather than offering to redo it, because there is nothing left to do.
    if (report.removedKeys.length > 0) {
      result.findings.push({
        label: 'Stale settings removed at startup',
        count: report.removedKeys.length,
        detail: report.backupPath
          ? `Backed up to ${path.basename(report.backupPath)} before removal.`
          : 'Removed.',
        samples: report.removedKeys.map((k) => `[${k.section}] ${k.key}`),
      })
      result.status = 'issues'
      result.count += report.removedKeys.length
    }
    if (report.removedSections.length > 0) {
      result.findings.push({
        label: 'Obsolete sections removed at startup',
        count: report.removedSections.length,
        detail: 'These sections are no longer used by Atlas.',
        samples: report.removedSections.map((s) => `[${s.section}] (${s.keys} keys)`),
      })
      result.status = 'issues'
      result.count += report.removedSections.length
    }
    if (report.error) {
      result.status = 'error'
      result.error = report.error
    }
    if (result.count === 0 && !report.error) {
      result.findings.push({
        label: `Configuration is current (version ${report.configVersionAfter ?? CONFIG_VERSION})`,
        count: 0, detail: null, samples: null,
      })
    }
  } catch (err) {
    result.status = 'error'
    result.error = err.message
  }
  return result
}

// ── 2. browse index ──────────────────────────────────────────────────────────

const auditBrowseIndex = async () => {
  const result = section('browseIndex', 'Browse mode',
    'Verifies the Browse catalog index exists, matches this version of Atlas, and covers the whole catalog.')
  try {
    const { getCatalogIndexStatus } = require('./catalogIndex')
    const status = await getCatalogIndexStatus()

    if (!status.ready) {
      addFinding(result, 'Browse index needs rebuilding', 1,
        status.version !== status.expectedVersion
          ? `Index format is version ${status.version}, this build expects ${status.expectedVersion}.`
          : status.staleReason
            ? `Marked out of date: ${status.staleReason}`
            : 'The index has not been built yet.')
    } else {
      // A ready index can still under-cover the catalog if a sync landed rows
      // that the incremental refresh missed.
      const drift = Math.abs((status.sourceCount || 0) - (status.rowCount || 0))
      const tolerance = Math.max(50, Math.round((status.sourceCount || 0) * 0.02))
      if (status.sourceCount > 0 && drift > tolerance) {
        addFinding(result, 'Browse index does not cover the whole catalog', drift,
          `${(status.rowCount || 0).toLocaleString()} entries indexed against ` +
          `${(status.sourceCount || 0).toLocaleString()} in the catalog. ` +
          'Browse may be missing titles or sorting them wrongly.')
      } else {
        result.findings.push({
          label: `${(status.rowCount || 0).toLocaleString()} catalog entries indexed`,
          count: 0, detail: null, samples: null,
        })
      }
    }

    if (await tableExists('atlas_external_steam')) {
      const links = await dbGet(`SELECT COUNT(*) AS c FROM atlas_external_steam`)
      const withIds = await dbGet(
        `SELECT COUNT(*) AS c FROM atlas_data
          WHERE external_ids IS NOT NULL AND external_ids != '' AND external_ids LIKE '%steam%'`)
      if ((withIds?.c || 0) > 0 && (links?.c || 0) === 0) {
        addFinding(result, 'Steam links have not been resolved', withIds.c,
          'Steam titles grouped under a catalog entry may appear twice in Browse ' +
          'until the index is rebuilt.')
      }
    }

    if (result.status === 'issues') {
      result.repairable = true
      result.repairLabel = 'Rebuild browse index'
      result.willChange = [
        'Rebuild the Browse catalog index from your existing catalog data.',
        'Re-resolve Steam links from catalog metadata.',
        'Your library, metadata, images and settings are not modified.',
      ]
    }
  } catch (err) {
    result.status = 'error'
    result.error = err.message
  }
  return result
}

// ── 3. database integrity ────────────────────────────────────────────────────

const auditDatabaseIntegrity = async () => {
  const result = section('database', 'Database integrity',
    'Looks for rows left behind by deleted games and for links pointing at catalog entries that no longer exist.')
  try {
    const integrity = await dbGet(`PRAGMA quick_check`)
    const verdict = integrity ? Object.values(integrity)[0] : 'ok'
    if (verdict && String(verdict).toLowerCase() !== 'ok') {
      result.status = 'error'
      result.error = `SQLite reports database corruption: ${verdict}. ` +
        'Do not run repairs; restore a backup of data.db instead.'
      return result
    }

    for (const table of RECORD_CHILD_TABLES) {
      if (!(await tableExists(table))) continue
      const row = await dbGet(
        `SELECT COUNT(*) AS c FROM ${table}
          WHERE record_id IS NOT NULL
            AND record_id NOT IN (SELECT record_id FROM games)`)
      addFinding(result, `Orphaned rows in ${table}`, row?.c || 0,
        'Left behind by a deleted game. Because record ids can be reused, these ' +
        'can attach themselves to an unrelated game later.')
      await yieldToLoop()
    }

    const badAtlas = await dbGet(
      `SELECT COUNT(*) AS c FROM atlas_mappings am
        LEFT JOIN atlas_data ad ON ad.atlas_id = am.atlas_id
        WHERE ad.atlas_id IS NULL`)
    addFinding(result, 'Games mapped to a missing catalog entry', badAtlas?.c || 0,
      'The catalog entry was pruned by an older sync, so these games silently ' +
      'stopped receiving metadata updates. Remap them from the Database Audit above.')

    const dupVersions = await dbGet(
      `SELECT COUNT(*) AS c FROM (
         SELECT record_id, version, COUNT(*) AS n FROM versions
          WHERE version IS NOT NULL AND version != ''
          GROUP BY record_id, version HAVING n > 1)`)
    addFinding(result, 'Duplicate version rows', dupVersions?.c || 0,
      'The same version recorded more than once for one game. Reported only — ' +
      'which copy to keep depends on its install path, so this is not auto-repaired.')

    if (await tableExists('game_metadata_overrides')) {
      const emptyOverrides = await dbGet(
        `SELECT COUNT(*) AS c FROM game_metadata_overrides gmo
          WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.record_id = gmo.record_id)`)
      addFinding(result, 'Custom metadata for deleted games', emptyOverrides?.c || 0,
        'Edits kept for games that no longer exist.')
    }

    const orphanCount = result.findings
      .filter((f) => f.label.startsWith('Orphaned rows') || f.label.startsWith('Custom metadata for deleted'))
      .reduce((sum, f) => sum + f.count, 0)
    if (orphanCount > 0) {
      result.repairable = true
      result.repairLabel = 'Remove orphaned rows'
      result.willChange = [
        `Delete ${orphanCount.toLocaleString()} row(s) whose game no longer exists.`,
        'Only rows with no matching game are removed; nothing you can still see in your library is touched.',
        'Games mapped to a missing catalog entry are NOT deleted — use Run Database Audit to remap those.',
        'Duplicate version rows are reported only and left alone.',
      ]
    }
  } catch (err) {
    result.status = 'error'
    result.error = err.message
  }
  return result
}

// ── 4. library files ─────────────────────────────────────────────────────────

const auditLibraryFiles = async () => {
  const result = section('files', 'Library files',
    'Checks that installed versions still point at folders and launchers that exist on disk.')
  try {
    const rows = await dbAll(
      `SELECT v.rowid AS rowid, v.record_id, v.version, v.game_path, v.exec_path, g.title
         FROM versions v LEFT JOIN games g ON g.record_id = v.record_id
        WHERE v.game_path IS NOT NULL AND v.game_path != ''`)

    const missingPaths = []
    const missingExes = []
    let checked = 0
    for (const row of rows) {
      if (!fs.existsSync(row.game_path)) {
        missingPaths.push(`${row.title || `record ${row.record_id}`} - ${row.version || '(no version)'}`)
      } else if (row.exec_path && !fs.existsSync(row.exec_path)) {
        missingExes.push(`${row.title || `record ${row.record_id}`} - ${row.version || '(no version)'}`)
      }
      checked += 1
      // Yield periodically: existsSync is synchronous, and a large library would
      // otherwise block the main process for the whole sweep.
      if (checked % 200 === 0) await yieldToLoop()
    }

    addFinding(result, 'Installed versions whose folder is missing', missingPaths.length,
      'The folder recorded for these versions no longer exists — moved, renamed, ' +
      'or on a drive that is not connected. Reported only: if a drive is simply ' +
      'offline, clearing these would lose the paths.',
      missingPaths.slice(0, 10))

    addFinding(result, 'Versions whose launcher is missing', missingExes.length,
      'The folder exists but the recorded executable does not. Repair re-scans ' +
      'the folder for a launcher.',
      missingExes.slice(0, 10))

    if (result.count === 0) {
      result.findings.push({
        label: `All ${rows.length.toLocaleString()} installed version path(s) verified`,
        count: 0, detail: null, samples: null,
      })
    }
    if (missingExes.length > 0) {
      result.repairable = true
      result.repairLabel = 'Re-scan for missing launchers'
      result.willChange = [
        `Re-scan ${missingExes.length} version folder(s) for a valid launcher and update the recorded path.`,
        'No files are moved, renamed or deleted.',
        'Versions whose whole folder is missing are left untouched, in case the drive is simply offline.',
      ]
    }
  } catch (err) {
    result.status = 'error'
    result.error = err.message
  }
  return result
}

// ── 5. images and media ──────────────────────────────────────────────────────

const auditMedia = async (ctx) => {
  const result = section('media', 'Images and previews',
    'Verifies that stored banner and preview references still resolve, and finds image files no longer referenced by any game.')
  try {
    const imagesDir = ctx?.imagesDir || (ctx?.dataDir ? path.join(ctx.dataDir, 'images') : null)

    let missingBanners = 0
    const missingBannerSamples = []
    if (await tableExists('banners')) {
      // Only locally-stored art can be verified; streamed art is a remote URL by
      // design and its absence is not a fault.
      const rows = await dbAll(
        `SELECT b.record_id, b.path, g.title FROM banners b
           LEFT JOIN games g ON g.record_id = b.record_id
          WHERE b.path IS NOT NULL AND b.path != ''
            AND b.path NOT LIKE 'http%'`)
      let n = 0
      for (const row of rows) {
        const full = path.isAbsolute(row.path) || !imagesDir
          ? row.path
          : path.join(imagesDir, row.path)
        if (!fs.existsSync(full)) {
          missingBanners += 1
          if (missingBannerSamples.length < 10) {
            missingBannerSamples.push(row.title || `record ${row.record_id}`)
          }
        }
        if ((n += 1) % 200 === 0) await yieldToLoop()
      }
    }
    addFinding(result, 'Banner references with no file on disk', missingBanners,
      'The database points at a banner image that is not there. Repair clears the ' +
      'dead reference so Atlas falls back to streaming or re-downloading.',
      missingBannerSamples)

    let missingAssets = 0
    if (await tableExists('media_assets')) {
      const rows = await dbAll(
        `SELECT path FROM media_assets
          WHERE path IS NOT NULL AND path != '' AND path NOT LIKE 'http%'`)
      let n = 0
      for (const row of rows) {
        const full = path.isAbsolute(row.path) || !imagesDir
          ? row.path
          : path.join(imagesDir, row.path)
        if (!fs.existsSync(full)) missingAssets += 1
        if ((n += 1) % 200 === 0) await yieldToLoop()
      }
    }
    addFinding(result, 'Preview references with no file on disk', missingAssets,
      'Repair clears these dead references.')

    if (await tableExists('media_assets')) {
      const orphanRows = await dbGet(
        `SELECT COUNT(*) AS c FROM media_assets
          WHERE record_id IS NOT NULL
            AND record_id NOT IN (SELECT record_id FROM games)`)
      addFinding(result, 'Media rows for deleted games', orphanRows?.c || 0,
        'Image records kept for games that no longer exist.')
    }

    // Unreferenced files on disk are reported with their total size but never
    // deleted here — matching a file back to a record by filename alone is not
    // reliable enough to justify removing a user's images.
    if (imagesDir && fs.existsSync(imagesDir)) {
      const referenced = new Set()
      for (const table of ['banners', 'media_assets', 'previews']) {
        if (!(await tableExists(table))) continue
        const rows = await dbAll(
          `SELECT path FROM ${table} WHERE path IS NOT NULL AND path != ''`)
        for (const row of rows) referenced.add(path.basename(String(row.path)))
      }
      let orphanFiles = 0
      let orphanBytes = 0
      const walk = async (dir, depth = 0) => {
        if (depth > 4) return
        let entries = []
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) { await walk(full, depth + 1); continue }
          if (!/\.(webp|jpg|jpeg|png|gif|mp4|webm)$/i.test(entry.name)) continue
          if (referenced.has(entry.name)) continue
          orphanFiles += 1
          try { orphanBytes += fs.statSync(full).size } catch { /* vanished */ }
          if (orphanFiles % 200 === 0) await yieldToLoop()
        }
      }
      await walk(imagesDir)
      if (orphanFiles > 0) {
        const mb = (orphanBytes / 1024 / 1024).toFixed(1)
        result.findings.push({
          label: 'Image files not referenced by any game',
          count: orphanFiles,
          detail: `About ${mb} MB in ${path.basename(imagesDir)}. Reported only — ` +
                  'Atlas will not delete image files automatically. Remove them yourself ' +
                  'if you want the space back.',
          samples: null,
        })
        result.status = 'issues'
        result.count += orphanFiles
      }
    }

    if (result.count === 0) {
      result.findings.push({ label: 'All image references resolve', count: 0, detail: null, samples: null })
    }

    const clearable = missingBanners + missingAssets
    if (clearable > 0) {
      result.repairable = true
      result.repairLabel = 'Clear dead image references'
      result.willChange = [
        `Clear ${clearable.toLocaleString()} database reference(s) to image files that do not exist.`,
        'No image files are deleted — only references to files that are already gone.',
        'Affected games fall back to streaming or re-downloading their art.',
        'Unreferenced files on disk are left alone.',
      ]
    }
  } catch (err) {
    result.status = 'error'
    result.error = err.message
  }
  return result
}

// ── 6. database maintenance ──────────────────────────────────────────────────

const auditMaintenance = async () => {
  const result = section('maintenance', 'Database maintenance',
    'Reports wasted space in the database file and whether the query planner has current statistics.')
  try {
    const pageCount = (await dbGet(`PRAGMA page_count`))?.page_count || 0
    const freelist = (await dbGet(`PRAGMA freelist_count`))?.freelist_count || 0
    const pageSize = (await dbGet(`PRAGMA page_size`))?.page_size || 4096
    const totalMb = (pageCount * pageSize) / 1024 / 1024
    const freeMb = (freelist * pageSize) / 1024 / 1024
    const pct = pageCount > 0 ? (freelist / pageCount) * 100 : 0

    if (pct >= 10) {
      addFinding(result, 'Reclaimable space in the database file', freelist,
        `About ${freeMb.toFixed(0)} MB of the ${totalMb.toFixed(0)} MB file ` +
        `(${pct.toFixed(0)}%) is free pages left by past migrations and deletions. ` +
        'Compacting reclaims it.')
    } else {
      result.findings.push({
        label: `Database is ${totalMb.toFixed(0)} MB with ${pct.toFixed(0)}% reclaimable`,
        count: 0, detail: null, samples: null,
      })
    }

    const stats = await dbGet(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'sqlite_stat1'`)
    if (!stats?.c) {
      addFinding(result, 'Query planner has no statistics', 1,
        'Without statistics SQLite can choose a poor plan for the catalog queries.')
    }

    if (result.status === 'issues') {
      result.repairable = true
      result.repairLabel = 'Compact and analyse database'
      result.willChange = [
        freelist > 0
          ? `Compact data.db, reclaiming roughly ${freeMb.toFixed(0)} MB.`
          : 'Compact data.db.',
        'Recalculate query planner statistics.',
        'No games, metadata, images or settings are changed — this only rewrites the file more compactly.',
        'Atlas will be busy while this runs. On a large database it can take a minute or two, and it should not be interrupted.',
      ]
    }
  } catch (err) {
    result.status = 'error'
    result.error = err.message
  }
  return result
}

// ── runner ───────────────────────────────────────────────────────────────────

const runClientAudit = async (ctx = {}) => {
  const startedAt = Date.now()
  const sections = []
  const checks = [
    () => auditConfig(ctx),
    () => auditBrowseIndex(),
    () => auditDatabaseIntegrity(),
    () => auditLibraryFiles(),
    () => auditMedia(ctx),
    () => auditMaintenance(),
  ]
  for (const check of checks) {
    try {
      sections.push(await check())
    } catch (err) {
      const failed = section('unknown', 'Check failed', '')
      failed.status = 'error'
      failed.error = err.message
      sections.push(failed)
    }
    await yieldToLoop()
  }
  return {
    sections,
    durationMs: Date.now() - startedAt,
    totalIssues: sections.reduce((sum, s) => sum + (s.count || 0), 0),
    erroredSections: sections.filter((s) => s.status === 'error').length,
  }
}

// ── repairs ──────────────────────────────────────────────────────────────────

const repairDatabaseSection = async () => {
  const changes = []
  await withTransaction('audit.orphanSweep', dbRun, async () => {
    for (const table of RECORD_CHILD_TABLES) {
      if (!(await tableExists(table))) continue
      const res = await dbRun(
        `DELETE FROM ${table}
          WHERE record_id IS NOT NULL
            AND record_id NOT IN (SELECT record_id FROM games)`)
      if (res?.changes) changes.push(`${table}: removed ${res.changes} orphaned row(s)`)
    }
  })
  return { changes }
}

const repairMediaSection = async (ctx) => {
  const imagesDir = ctx?.imagesDir || (ctx?.dataDir ? path.join(ctx.dataDir, 'images') : null)
  const resolve = (p) => (path.isAbsolute(p) || !imagesDir ? p : path.join(imagesDir, p))
  const changes = []

  const deadIn = async (table) => {
    if (!(await tableExists(table))) return []
    const rows = await dbAll(
      `SELECT rowid, path FROM ${table}
        WHERE path IS NOT NULL AND path != '' AND path NOT LIKE 'http%'`)
    return rows.filter((row) => !fs.existsSync(resolve(row.path))).map((row) => row.rowid)
  }

  const deadBanners = await deadIn('banners')
  const deadAssets = await deadIn('media_assets')
  const deadPreviews = await deadIn('previews')

  await withTransaction('audit.mediaRefs', dbRun, async () => {
    const purge = async (table, ids) => {
      if (!ids.length) return
      for (let i = 0; i < ids.length; i += 400) {
        const slice = ids.slice(i, i + 400)
        await dbRun(
          `DELETE FROM ${table} WHERE rowid IN (${slice.map(() => '?').join(', ')})`, slice)
      }
      changes.push(`${table}: cleared ${ids.length} dead reference(s)`)
    }
    await purge('banners', deadBanners)
    await purge('media_assets', deadAssets)
    await purge('previews', deadPreviews)

    if (await tableExists('media_assets')) {
      const res = await dbRun(
        `DELETE FROM media_assets
          WHERE record_id IS NOT NULL
            AND record_id NOT IN (SELECT record_id FROM games)`)
      if (res?.changes) changes.push(`media_assets: removed ${res.changes} row(s) for deleted games`)
    }
  })
  return { changes }
}

const repairFilesSection = async () => {
  // Reuses the existing stale-executable repair rather than a second
  // implementation of launcher discovery.
  const { repairStaleVersionExecutables } = require('./repair')
  const summary = await repairStaleVersionExecutables()
  const fixed = summary?.fixed ?? summary?.repaired ?? 0
  return {
    changes: fixed
      ? [`versions: re-pointed ${fixed} launcher path(s)`]
      : ['No launcher paths needed changing.'],
  }
}

const repairMaintenanceSection = async () => {
  const changes = []
  return withWriteLock('audit.vacuum', async () => {
  const before = (await dbGet(`PRAGMA page_count`))?.page_count || 0
  const pageSize = (await dbGet(`PRAGMA page_size`))?.page_size || 4096
  // VACUUM cannot run inside a transaction and takes an exclusive lock for its
  // duration, which is why it is a deliberate, user-initiated action rather than
  // something on a boot path.
  await dbRun('VACUUM')
  const after = (await dbGet(`PRAGMA page_count`))?.page_count || 0
  const reclaimedMb = ((before - after) * pageSize) / 1024 / 1024
  changes.push(reclaimedMb > 0
    ? `Compacted data.db, reclaimed ${reclaimedMb.toFixed(0)} MB`
    : 'Compacted data.db')
  await dbRun('ANALYZE')
  changes.push('Recalculated query planner statistics')
  return { changes }
  })
}

const repairBrowseIndexSection = async ({ onProgress } = {}) => {
  const { rebuildCatalogIndex } = require('./catalogIndex')
  const summary = await rebuildCatalogIndex({ onProgress })
  return {
    changes: [
      `Rebuilt the browse index: ${(summary.totalRows || 0).toLocaleString()} entries in ` +
      `${((summary.durationMs || 0) / 1000).toFixed(1)}s`,
      `Resolved ${(summary.steamLinks || 0).toLocaleString()} Steam link(s)`,
    ],
  }
}

const repairClientAuditSection = async (sectionId, ctx = {}, options = {}) => {
  switch (sectionId) {
    case 'database': return repairDatabaseSection()
    case 'media': return repairMediaSection(ctx)
    case 'files': return repairFilesSection()
    case 'maintenance': return repairMaintenanceSection()
    case 'browseIndex': return repairBrowseIndexSection(options)
    case 'config':
      return { changes: ['Configuration is cleaned automatically at startup; nothing to do here.'] }
    default:
      throw new Error(`Unknown audit section: ${sectionId}`)
  }
}

module.exports = { runClientAudit, repairClientAuditSection }
