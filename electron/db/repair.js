'use strict'

const dbModule = require('./index')
const getDb = () => dbModule.db
const fs = require('fs')
const fsPromises = require('fs').promises
const path = require('path')
const { DEFAULT_LAUNCHABLE_EXTENSIONS, normalizeExtensions,
        isLaunchableFile, findLaunchablesInFolder,
        chooseLaunchableForRepair, chooseLaunchableForRepairAsync,
        getUniqueVersionName } = require('./versions')

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

// ── Stale executable repair ─────────────────────────────────────────────────
//
// Rewrites versions.exec_path when the recorded executable no longer exists but
// the game folder does (renamed/updated build, e.g. Game-1.2.exe -> Game-1.3.exe).
//
// PERFORMANCE HISTORY — this was the single worst thing Atlas did at boot.
// The original version ran unconditionally, before createWindow(), and did a
// synchronous fs.existsSync() on EVERY non-Steam version row with a game_path,
// plus a synchronous RECURSIVE readdir of the game folder for every row whose
// exec_path had gone stale. On a 6,000-title library with games on a mechanical
// drive that is ~6,000+ blocking metadata lookups, each of which is a real head
// seek (and a fresh Defender scan) when the OS file cache is cold after a
// reboot. Measured: ~3.4 minutes with nothing on screen. Every launch after
// that was 2-5 seconds, because the cache was then warm — which is exactly the
// signature of a cold-cache metadata storm rather than a code hot spot.
//
// Four changes keep it off the boot path:
//
//   1. It no longer runs before the window. main.js schedules it after
//      createWindow(), so the UI is interactive while it works.
//   2. Async fs.promises.access with bounded concurrency instead of
//      existsSync, so the main process event loop keeps turning. Concurrency
//      is deliberately low: a mechanical drive gets slower, not faster, when
//      you queue hundreds of seeks at once.
//   3. Drive roots are probed ONCE and cached. A library on a drive that is
//      spun down, unplugged or offline used to cost one timeout per row; it now
//      costs one per root.
//   4. Two modes plus a wall-clock budget. 'quick' (the default, and what runs
//      when Library.validatePathsOnStartup is off) only looks at rows whose
//      exec_path is already blank — the ones that cannot be launched at all, so
//      the check is worth its cost. 'full' does the whole sweep and is only
//      reached when the user has opted into startup path validation.
//
// Writes are collected and applied in ONE transaction at the end rather than
// auto-committing (and fsyncing) per row.
//
// Options:
//   mode        — 'quick' (blank exec_path rows only) | 'full' (all rows).
//   concurrency — parallel path checks. Default 8.
//   budgetMs    — wall-clock cap for the scan. Default 30s; 0/Infinity = none.
//   walkLimits  — { maxDepth, maxEntries, budgetMs } for the folder walk done
//                 per repairable row. Bounded so one enormous folder can't
//                 consume the whole budget.
//   onProgress  — ({ processed, total, repaired }) for callers that want to
//                 report it. Never allowed to throw into the repair.
const DEFAULT_EXEC_WALK_LIMITS = { maxDepth: 6, maxEntries: 40000, budgetMs: 4000 };

const pathExists = async (value) => {
  if (!value) return false;
  try {
    await fsPromises.access(value);
    return true;
  } catch {
    return false;
  }
};

// Runs `worker` over `items` with at most `limit` in flight. Stops early when
// shouldStop() goes true so the wall-clock budget is respected mid-flight.
const runWithConcurrency = async (items, limit, worker, shouldStop = () => false) => {
  let cursor = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        if (shouldStop()) return;
        const index = cursor;
        cursor += 1;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(lanes);
};

const repairStaleVersionExecutables = async (
  extensions = DEFAULT_LAUNCHABLE_EXTENSIONS,
  {
    mode = "quick",
    concurrency = 8,
    budgetMs = 30000,
    walkLimits = DEFAULT_EXEC_WALK_LIMITS,
    onProgress = null,
  } = {},
) => {
  const summary = {
    mode,
    checked: 0,
    repaired: 0,
    skippedOfflineRoots: 0,
    offlineRoots: [],
    timedOut: false,
    durationMs: 0,
  };
  if (!getDb()) return summary;

  const startedAt = Date.now();
  const hasBudget = Number.isFinite(budgetMs) && budgetMs > 0;
  const outOfBudget = () => hasBudget && Date.now() - startedAt > budgetMs;

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().run(sql, params, function onRun(err) {
        if (err) reject(err);
        else resolve(this.changes || 0);
      });
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

  const report = (payload) => {
    if (typeof onProgress !== "function") return;
    try {
      onProgress(payload);
    } catch (err) {
      console.warn("Exec repair progress handler failed:", err.message);
    }
  };

  try {
    // Steam-managed titles are excluded: Steam owns their install paths, and a
    // not-currently-installed Steam game is not a stale row to repair.
    const execFilter = mode === "full"
      ? ""
      : "AND (v.exec_path IS NULL OR TRIM(v.exec_path) = '')";
    const rows = await all(
      `SELECT v.rowid, v.record_id, v.version, v.game_path, v.exec_path
         FROM versions v
         LEFT JOIN steam_mappings sm ON v.record_id = sm.record_id
        WHERE v.game_path IS NOT NULL AND TRIM(v.game_path) != ''
          AND sm.steam_id IS NULL
          ${execFilter}`,
    );

    if (rows.length === 0) {
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }

    // One probe per distinct drive root instead of one per row. This is what
    // makes an offline or spun-down library drive cheap rather than catastrophic.
    const rootCache = new Map();
    const rootAvailable = async (value) => {
      let root = "";
      try {
        root = path.parse(String(value)).root || "";
      } catch {
        root = "";
      }
      if (!root) return true;
      const key = root.toLowerCase();
      if (!rootCache.has(key)) rootCache.set(key, pathExists(root));
      return rootCache.get(key);
    };

    const pending = [];

    await runWithConcurrency(
      rows,
      concurrency,
      async (row) => {
        const gamePath = String(row.game_path || "");
        const execPath = String(row.exec_path || "");

        if (!(await rootAvailable(gamePath))) {
          summary.skippedOfflineRoots += 1;
          const root = path.parse(gamePath).root;
          if (root && !summary.offlineRoots.includes(root)) summary.offlineRoots.push(root);
          return;
        }

        summary.checked += 1;
        if (summary.checked % 250 === 0) {
          report({ processed: summary.checked, total: rows.length, repaired: pending.length });
        }

        if (!(await pathExists(gamePath))) return;
        if (execPath && (await pathExists(execPath))) return;

        const launchable = await chooseLaunchableForRepairAsync(
          gamePath,
          execPath,
          extensions,
          walkLimits,
        );
        if (!launchable) return;

        pending.push({ rowid: row.rowid, record_id: row.record_id, version: row.version,
                       nextExecPath: path.join(gamePath, launchable) });
      },
      outOfBudget,
    );

    if (outOfBudget()) summary.timedOut = true;

    if (pending.length > 0) {
      await run("BEGIN IMMEDIATE");
      try {
        for (const item of pending) {
          await run(`UPDATE versions SET exec_path = ? WHERE rowid = ?`, [item.nextExecPath, item.rowid]);
          summary.repaired += 1;
          console.log(
            `Repaired stale executable for record ${item.record_id} ${item.version}: ${item.nextExecPath}`,
          );
        }
        await run("COMMIT");
      } catch (err) {
        try { await run("ROLLBACK"); } catch { /* ignore */ }
        throw err;
      }
    }

    summary.durationMs = Date.now() - startedAt;
    if (summary.repaired > 0 || summary.timedOut || summary.skippedOfflineRoots > 0) {
      console.log(
        `Exec repair (${mode}): checked ${summary.checked}/${rows.length}, ` +
        `repaired ${summary.repaired}, skipped ${summary.skippedOfflineRoots} on offline root(s)` +
        `${summary.offlineRoots.length ? ` [${summary.offlineRoots.join(", ")}]` : ""}` +
        `${summary.timedOut ? ", stopped at time budget" : ""} in ${summary.durationMs}ms`,
      );
    }
    return summary;
  } catch (err) {
    console.error("Error repairing stale executable paths:", err);
    summary.durationMs = Date.now() - startedAt;
    summary.error = err.message;
    return summary;
  }
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
