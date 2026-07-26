'use strict'

const dbModule = require('./index')
const getDb = () => dbModule.db
const fs = require('fs')
const fsPromises = require('fs').promises
const path = require('path')
const { DEFAULT_LAUNCHABLE_EXTENSIONS, normalizeExtensions,
        isLaunchableFile, findLaunchablesInFolder,
        chooseLaunchableForRepair, getUniqueVersionName } = require('./versions')

function normalizeDoubledApostrophes(value) {
  return typeof value === "string" ? value.replace(/''/g, "'") : value;
}

function shouldRepairPath(value) {
  if (!value || typeof value !== "string" || !value.includes("''")) {
    return false;
  }
  const repaired = normalizeDoubledApostrophes(value);
  return !fs.existsSync(value) || fs.existsSync(repaired);
}

const repairDoubledApostropheRows = () => {
  if (!getDb()) return Promise.resolve();

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

  return new Promise((resolve, reject) => {
    getDb().serialize(async () => {
      try {
        const gameRows = await all(
          `SELECT record_id, title, creator, engine
           FROM games
           WHERE title LIKE ? OR creator LIKE ? OR engine LIKE ?`,
          ["%''%", "%''%", "%''%"],
        );
        for (const row of gameRows) {
          await run(
            `UPDATE games SET title = ?, creator = ?, engine = ? WHERE record_id = ?`,
            [
              normalizeDoubledApostrophes(row.title),
              normalizeDoubledApostrophes(row.creator),
              normalizeDoubledApostrophes(row.engine),
              row.record_id,
            ],
          );
        }

        const versionRows = await all(
          `SELECT rowid, version, game_path, exec_path
           FROM versions
           WHERE version LIKE ? OR game_path LIKE ? OR exec_path LIKE ?`,
          ["%''%", "%''%", "%''%"],
        );
        for (const row of versionRows) {
          const repairedGamePath = shouldRepairPath(row.game_path)
            ? normalizeDoubledApostrophes(row.game_path)
            : row.game_path;
          const repairedExecPath = shouldRepairPath(row.exec_path)
            ? normalizeDoubledApostrophes(row.exec_path)
            : row.exec_path;
          await run(
            `UPDATE versions SET version = ?, game_path = ?, exec_path = ? WHERE rowid = ?`,
            [
              normalizeDoubledApostrophes(row.version),
              repairedGamePath,
              repairedExecPath,
              row.rowid,
            ],
          );
        }

        resolve();
      } catch (err) {
        console.error("Error repairing doubled apostrophe rows:", err);
        reject(err);
      }
    });
  });
};

const repairStaleVersionExecutables = (
  extensions = DEFAULT_LAUNCHABLE_EXTENSIONS,
) => {
  if (!getDb()) return Promise.resolve();

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this.changes || 0);
      });
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

  return new Promise((resolve, reject) => {
    getDb().serialize(async () => {
      try {
        const rows = await all(
          `SELECT v.rowid, v.record_id, v.version, v.game_path, v.exec_path
           FROM versions v
           LEFT JOIN steam_mappings sm ON v.record_id = sm.record_id
           WHERE v.game_path IS NOT NULL AND TRIM(v.game_path) != ''
             AND sm.steam_id IS NULL`,
        );
        let repaired = 0;

        for (const row of rows) {
          const gamePath = String(row.game_path || "");
          const execPath = String(row.exec_path || "");
          if (!fs.existsSync(gamePath)) continue;
          if (execPath && fs.existsSync(execPath)) continue;

          const launchable = chooseLaunchableForRepair(
            gamePath,
            execPath,
            extensions,
          );
          if (!launchable) continue;

          const nextExecPath = path.join(gamePath, launchable);
          await run(`UPDATE versions SET exec_path = ? WHERE rowid = ?`, [
            nextExecPath,
            row.rowid,
          ]);
          repaired += 1;
          console.log(
            `Repaired stale executable for record ${row.record_id} ${row.version}: ${nextExecPath}`,
          );
        }

        resolve(repaired);
      } catch (err) {
        console.error("Error repairing stale executable paths:", err);
        reject(err);
      }
    });
  });
};

const repairBlankVersionNames = () => {
  if (!getDb()) return Promise.resolve(0);

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this.changes || 0);
      });
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

  return new Promise((resolve, reject) => {
    getDb().serialize(async () => {
      try {
        const rows = await all(
          `SELECT rowid, record_id
           FROM versions
           WHERE version IS NULL OR TRIM(version) = ''
           ORDER BY record_id, rowid`,
        );
        let repaired = 0;

        for (const row of rows) {
          const nextVersion = await getUniqueVersionName(row.record_id, "Unknown", {
            excludeRowId: row.rowid,
          });
          repaired += await run(
            `UPDATE versions SET version = ? WHERE rowid = ?`,
            [nextVersion, row.rowid],
          );
        }

        if (repaired > 0) {
          console.log(`Repaired ${repaired} blank version name${repaired === 1 ? "" : "s"}`);
        }
        resolve(repaired);
      } catch (err) {
        console.error("Error repairing blank version names:", err);
        reject(err);
      }
    });
  });
};

const repairMissingTotalPlaytime = () => {
  if (!getDb()) return Promise.resolve(0);

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this.changes || 0);
      });
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

  return new Promise((resolve, reject) => {
    getDb().serialize(async () => {
      try {
        const rows = await all(
          `SELECT
             g.record_id,
             COALESCE(g.total_playtime, 0) AS total_playtime,
             COALESCE(SUM(
               CASE
                 WHEN v.version_playtime > 0 THEN v.version_playtime
                 ELSE 0
               END
             ), 0) AS version_playtime_sum
           FROM games g
           LEFT JOIN versions v ON g.record_id = v.record_id
           GROUP BY g.record_id`,
        );
        let repaired = 0;

        for (const row of rows) {
          const titleTotal = Number(row.total_playtime);
          const versionTotal = Number(row.version_playtime_sum);
          const safeTitleTotal = Number.isFinite(titleTotal) && titleTotal > 0 ? titleTotal : 0;
          const safeVersionTotal = Number.isFinite(versionTotal) && versionTotal > 0 ? versionTotal : 0;
          if (safeVersionTotal <= safeTitleTotal) continue;
          repaired += await run(
            `UPDATE games SET total_playtime = ? WHERE record_id = ?`,
            [safeVersionTotal, row.record_id],
          );
        }

        if (repaired > 0) {
          console.log(`Repaired total playtime for ${repaired} game${repaired === 1 ? "" : "s"}`);
        }
        resolve(repaired);
      } catch (err) {
        console.error("Error repairing total playtime:", err);
        reject(err);
      }
    });
  });
};

// Validates game_metadata_overrides and repairs the damage left by the old
// write-everything updateGame().
//
// Three classes of bad data, all produced by the same root cause:
//
//   1. BLANKING overrides — a column holding '' (or whitespace). Because the
//      merge is COALESCE(override.x, <sources>), '' is not null and therefore
//      wins, so the field renders empty even though Atlas/Steam/GOG have a
//      value. Converted to NULL.
//   2. REDUNDANT overrides — a custom value identical (trimmed,
//      case-insensitive) to the value the field would inherit anyway. These are
//      the fields that got copied back from the merged record when the user
//      edited some *other* field. Cleared, because the effective value does not
//      change and keeping them would keep the field pinned against future
//      source updates.
//   3. EMPTY rows — a row whose every override column is now NULL and which
//      carries no manual_external_ids. Deleted so that the existence of a row
//      is a truthful "this title has custom data" signal.
//
// Performance matters here because this runs during boot. Three things keep it
// off the critical path:
//
//   * An early exit when game_metadata_overrides is empty, so a fresh install
//     pays a single COUNT.
//   * Class (1) is repaired with one set-based UPDATE per column — no join and
//     no row loop — which clears the bulk of the damage in 13 statements.
//   * Every write runs inside ONE transaction. Without it, SQLite
//     auto-commits (and fsyncs) per statement, which on a library where every
//     imported title got an override row meant thousands of disk syncs and a
//     multi-minute boot with no window on screen.
//
// Idempotent: once repaired, the override table only holds genuinely custom
// rows, so subsequent runs scan almost nothing.
//
// Options:
//   dryRun     — report what would change without writing.
//   onProgress — called with { phase, processed, total, message } so a caller
//                can show boot progress. Never throws into the sweep.
const validateGameMetadataOverrides = ({ dryRun = false, onProgress = null } = {}) => {
  if (!getDb()) return Promise.resolve(null);

  const {
    OVERRIDE_COLUMNS, OVERRIDE_FIELDS, inheritedSelect, INHERITED_JOINS, sameValue,
  } = require("./overrides");

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().run(sql, params, function onRun(err) {
        err ? reject(err) : resolve(this);
      });
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });

  const labelFor = new Map(OVERRIDE_FIELDS.map((f) => [f.column, f.label]));
  const report = (phase, processed, total, message) => {
    if (typeof onProgress !== "function") return;
    try {
      onProgress({ phase, processed, total, message });
    } catch (err) {
      // Progress reporting must never break the repair.
      console.warn("Override validation progress handler failed:", err.message);
    }
  };

  return new Promise((resolve, reject) => {
    getDb().serialize(async () => {
      const summary = {
        dryRun,
        scannedRows: 0,
        blankedFields: 0,
        redundantFields: 0,
        deletedRows: 0,
        byField: {},
        affectedTitles: [],
        durationMs: 0,
        skipped: false,
      };
      const startedAt = Date.now();
      const emptyCheck = OVERRIDE_COLUMNS.map((col) => `${col} IS NULL`).join(" AND ");
      const noManualIds = "(manual_external_ids IS NULL OR TRIM(manual_external_ids) IN ('', '{}'))";
      let inTransaction = false;

      const bump = (column, kind, n = 1) => {
        const entry = (summary.byField[column] ||= { label: labelFor.get(column) || column, blanked: 0, redundant: 0 });
        entry[kind] += n;
      };

      try {
        // ── Early exit ────────────────────────────────────────────────────────
        // Nothing to validate if no title has custom data. Keeps boot free on a
        // fresh install and on any library that has never been edited.
        const rowCount = (await get(`SELECT COUNT(*) AS n FROM game_metadata_overrides`))?.n || 0;
        summary.scannedRows = rowCount;
        if (rowCount === 0) {
          summary.skipped = true;
          summary.durationMs = Date.now() - startedAt;
          return resolve(summary);
        }

        report("start", 0, rowCount, `Checking custom data on ${rowCount} title${rowCount === 1 ? "" : "s"}`);

        if (!dryRun) {
          await run("BEGIN IMMEDIATE");
          inTransaction = true;
        }

        // ── (1) Blanking overrides, set-based ─────────────────────────────────
        for (let i = 0; i < OVERRIDE_COLUMNS.length; i += 1) {
          const column = OVERRIDE_COLUMNS[i];
          if (dryRun) {
            const n = (await get(
              `SELECT COUNT(*) AS n FROM game_metadata_overrides WHERE ${column} IS NOT NULL AND TRIM(${column}) = ''`,
            ))?.n || 0;
            if (n > 0) { summary.blankedFields += n; bump(column, "blanked", n); }
          } else {
            const result = await run(
              `UPDATE game_metadata_overrides SET ${column} = NULL
               WHERE ${column} IS NOT NULL AND TRIM(${column}) = ''`,
            );
            const n = result.changes || 0;
            if (n > 0) { summary.blankedFields += n; bump(column, "blanked", n); }
          }
          report("blanking", i + 1, OVERRIDE_COLUMNS.length, "Restoring blanked fields");
        }

        // ── (2) Redundant overrides ───────────────────────────────────────────
        // Needs the source chains, so this is the one pass that joins. It only
        // looks at rows that still hold at least one non-null override.
        const overrideSelect = OVERRIDE_COLUMNS
          .map((col) => `game_metadata_overrides.${col} AS override_${col}`)
          .join(",\n            ");

        const rows = await all(
          `SELECT
            games.record_id,
            games.title,
            ${overrideSelect},
            ${inheritedSelect()}
          FROM game_metadata_overrides
          JOIN games ON games.record_id = game_metadata_overrides.record_id
${INHERITED_JOINS}
          WHERE NOT (${OVERRIDE_COLUMNS.map((col) => `game_metadata_overrides.${col} IS NULL`).join(" AND ")})
          GROUP BY games.record_id`,
        );

        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          const clearColumns = [];
          const detail = [];

          for (const column of OVERRIDE_COLUMNS) {
            const custom = row[`override_${column}`];
            if (custom === null || custom === undefined) continue;
            if (String(custom).trim() === "") continue; // already handled in (1)
            if (sameValue(custom, row[`inherited_${column}`])) {
              clearColumns.push(column);
              summary.redundantFields += 1;
              bump(column, "redundant");
              detail.push({ field: column, reason: "redundant", value: String(custom) });
            }
          }

          if (clearColumns.length > 0) {
            summary.affectedTitles.push({ record_id: row.record_id, title: row.title, fields: detail });
            if (!dryRun) {
              await run(
                `UPDATE game_metadata_overrides
                 SET ${clearColumns.map((col) => `${col} = NULL`).join(", ")}
                 WHERE record_id = ?`,
                [row.record_id],
              );
            }
          }

          // Throttled so a large library does not spam the boot window.
          if (i % 50 === 0 || i === rows.length - 1) {
            report("redundant", i + 1, rows.length, "Checking custom values against sources");
          }
        }

        // ── (3) Rows with nothing left in them ────────────────────────────────
        if (dryRun) {
          summary.deletedRows = (await get(
            `SELECT COUNT(*) AS n FROM game_metadata_overrides WHERE ${emptyCheck} AND ${noManualIds}`,
          ))?.n || 0;
        } else {
          const deleted = await run(
            `DELETE FROM game_metadata_overrides WHERE ${emptyCheck} AND ${noManualIds}`,
          );
          summary.deletedRows = deleted.changes || 0;
        }
        report("cleanup", 1, 1, "Cleaning up");

        if (inTransaction) {
          await run("COMMIT");
          inTransaction = false;
        }

        summary.durationMs = Date.now() - startedAt;
        const touched = summary.blankedFields + summary.redundantFields + summary.deletedRows;
        if (touched > 0) {
          console.log(
            `${dryRun ? "Would repair" : "Repaired"} custom metadata in ${summary.durationMs}ms: ` +
            `${summary.blankedFields} blanking, ${summary.redundantFields} redundant field(s) ` +
            `across ${summary.affectedTitles.length} title(s); ${summary.deletedRows} empty row(s) removed`,
          );
        }
        report("done", 1, 1, "Custom data check complete");

        resolve(summary);
      } catch (err) {
        if (inTransaction) {
          try { await run("ROLLBACK"); } catch {}
        }
        console.error("Error validating game metadata overrides:", err);
        reject(err);
      }
    });
  });
};

// Cheap "is there anything to do" probe, so a caller can decide whether to put
// a progress window on screen before committing to the full sweep. Counts
// override rows only — no joins.
const countGameMetadataOverrideRows = () =>
  new Promise((resolve) => {
    if (!getDb()) return resolve(0);
    getDb().get(`SELECT COUNT(*) AS n FROM game_metadata_overrides`, [], (err, row) =>
      resolve(err ? 0 : row?.n || 0),
    );
  });

module.exports = {
  repairDoubledApostropheRows,
  repairStaleVersionExecutables,
  repairBlankVersionNames,
  repairMissingTotalPlaytime,
  validateGameMetadataOverrides,
  countGameMetadataOverrideRows,
}
