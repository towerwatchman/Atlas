'use strict'

const path = require('path')
const fs = require('fs')
const dbModule = require('./index')
const getDb = () => dbModule.db
const { insertJsonData } = require('./atlas')
const { isNewerVersion } = require('../utils/versionUtils')

const withF95LatestOrder = (rows, updateDate) =>
  rows.map((row, index) => ({
    ...row,
    f95_latest_order: (Number(updateDate) * 100000) + (100000 - index),
  }))

const backfillF95LatestOrderFromUpdateFiles = async (updatesDir) => {
  const lz4 = require("lz4js");
  if (!fs.existsSync(updatesDir)) return 0;

  const files = fs.readdirSync(updatesDir)
    .filter((name) => /^\d+\.update$/.test(name))
    .sort((a, b) => Number(a.replace(".update", "")) - Number(b.replace(".update", "")));
  if (files.length === 0) return 0;

  return new Promise((resolve) => {
    const db = getDb();
    db.all(`PRAGMA table_info(f95_zone_data)`, [], (columnErr, columns = []) => {
      if (
        columnErr ||
        !Array.isArray(columns) ||
        !columns.some((column) => column.name === "f95_latest_order")
      ) {
        resolve(0);
        return;
      }

      db.serialize(() => {
        let updated = 0;
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(
          `UPDATE f95_zone_data SET f95_latest_order = ? WHERE f95_id = ?`,
        );

        for (const name of files) {
          try {
            const updateDate = Number(name.replace(".update", ""));
            const compressedData = fs.readFileSync(path.join(updatesDir, name));
            const data = JSON.parse(Buffer.from(lz4.decompress(compressedData)).toString("utf8"));
            if (!Array.isArray(data.f95_zone)) continue;
            for (const row of withF95LatestOrder(data.f95_zone, updateDate)) {
              if (!row.f95_id) continue;
              stmt.run([row.f95_latest_order, row.f95_id]);
              updated++;
            }
          } catch (err) {
            console.warn(`Unable to backfill F95 latest order from ${name}:`, err.message);
          }
        }

        stmt.finalize(() => {
          db.run("COMMIT", () => resolve(updated));
        });
      });
    });
  });
}


// ── Full-snapshot pruning ────────────────────────────────────────────────────
// Promisified sqlite helpers (the db uses node-sqlite style callbacks).
const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const toBoolFlag = (value) => {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return Boolean(value);
};

// A package is treated as a full snapshot when it carries an explicit truthy
// "full"/"snapshot" flag, checked across the given sources in order (manifest
// entry first, then the package payload). When no flag is present anywhere we
// assume snapshot (per spec), but only act on it when it passes the
// completeness guard in applyFullSnapshotPrune.
const readSnapshotFlag = (...sources) => {
  for (const source of sources) {
    const explicit = source?.is_full ?? source?.full ?? source?.snapshot ?? source?.isFull ?? source?.is_snapshot;
    if (explicit !== undefined && explicit !== null) {
      return { isSnapshot: toBoolFlag(explicit), trusted: true };
    }
  }
  return { isSnapshot: true, trusted: false };
};

// Load a list of ids into a temp table so prune queries avoid huge IN (...) lists.
const loadIdsIntoTemp = async (db, tempName, ids) => {
  await dbRun(db, `CREATE TEMP TABLE IF NOT EXISTS ${tempName} (id INTEGER PRIMARY KEY)`);
  await dbRun(db, `DELETE FROM ${tempName}`);
  const unique = [...new Set(ids.filter((id) => id !== null && id !== undefined && id !== ""))];
  if (unique.length === 0) return 0;

  const CHUNK = 1000;
  const insertSql = `INSERT OR IGNORE INTO ${tempName} (id) VALUES (?)`;
  for (let start = 0; start < unique.length; start += CHUNK) {
    const chunk = unique.slice(start, start + CHUNK);
    await dbRun(db, "BEGIN");
    const stmt = db.prepare(insertSql);
    for (const id of chunk) stmt.run(id);
    await new Promise((resolve, reject) => stmt.finalize((err) => (err ? reject(err) : resolve())));
    await dbRun(db, "COMMIT");
    // Yield between batches so reads on the shared connection can run.
    await new Promise((resolve) => setImmediate(resolve));
  }
  return unique.length;
};

// Reconcile the local metadata tables against a full snapshot:
//  - rows missing from the snapshot but still referenced by the user (library
//    via atlas_mappings, or wishlist) are KEPT and flagged removed_from_server
//  - rows missing from the snapshot and not referenced are DELETED, along with
//    their orphaned remote child rows
//  - rows that reappear in the snapshot have their flag cleared
// User-owned tables (games, versions, media, tags, overrides, mappings,
// wishlist, ...) are never touched.
const applyFullSnapshotPrune = async (db, data, snapshotDate, trusted) => {
  const summary = { atlasDeleted: 0, atlasFlagged: 0, atlasRestored: 0, f95Deleted: 0, lcDeleted: 0, skipped: [] };
  const ownedAtlas =
    "(atlas_id IN (SELECT atlas_id FROM atlas_mappings) " +
    "OR atlas_id IN (SELECT atlas_id FROM wishlist_entries WHERE atlas_id IS NOT NULL))";

  // ATLAS ----------------------------------------------------------------------
  const atlasRows = Array.isArray(data.atlas) ? data.atlas : [];
  if (atlasRows.length > 0) {
    const localAtlas = (await dbGet(db, "SELECT COUNT(*) AS c FROM atlas_data"))?.c || 0;
    // Completeness guard: an untrusted (unflagged) package must be at least as
    // large as what we already have, otherwise it's almost certainly a delta
    // and pruning would be destructive.
    if (trusted || atlasRows.length >= localAtlas) {
      await loadIdsIntoTemp(db, "_snap_atlas", atlasRows.map((r) => r.atlas_id));
      await dbRun(db, "BEGIN");
      try {
        const flagged = await dbRun(
          db,
          `UPDATE atlas_data SET removed_from_server = ?
             WHERE atlas_id NOT IN (SELECT id FROM _snap_atlas)
               AND ${ownedAtlas}
               AND removed_from_server = 0`,
          [snapshotDate],
        );
        summary.atlasFlagged = flagged.changes || 0;

        const restored = await dbRun(
          db,
          `UPDATE atlas_data SET removed_from_server = 0
             WHERE atlas_id IN (SELECT id FROM _snap_atlas)
               AND removed_from_server != 0`,
        );
        summary.atlasRestored = restored.changes || 0;

        const deleted = await dbRun(
          db,
          `DELETE FROM atlas_data
             WHERE atlas_id NOT IN (SELECT id FROM _snap_atlas)
               AND NOT ${ownedAtlas}`,
        );
        summary.atlasDeleted = deleted.changes || 0;

        // Orphaned remote children of removed atlas rows.
        await dbRun(db, "DELETE FROM atlas_previews WHERE atlas_id NOT IN (SELECT atlas_id FROM atlas_data)");
        await dbRun(db, "DELETE FROM atlas_tags WHERE atlas_id NOT IN (SELECT atlas_id FROM atlas_data)");
        await dbRun(db, "COMMIT");
      } catch (err) {
        await dbRun(db, "ROLLBACK").catch(() => {});
        throw err;
      }
    } else {
      summary.skipped.push("atlas (package smaller than local; treated as delta)");
    }
  }

  // F95 ------------------------------------------------------------------------
  const f95Rows = Array.isArray(data.f95_zone) ? data.f95_zone : [];
  if (f95Rows.length > 0) {
    const localF95 = (await dbGet(db, "SELECT COUNT(*) AS c FROM f95_zone_data"))?.c || 0;
    if (trusted || f95Rows.length >= localF95) {
      await loadIdsIntoTemp(db, "_snap_f95", f95Rows.map((r) => r.f95_id));
      await dbRun(db, "BEGIN");
      try {
        const deleted = await dbRun(
          db,
          `DELETE FROM f95_zone_data
             WHERE f95_id NOT IN (SELECT id FROM _snap_f95)
               AND (atlas_id IS NULL OR NOT ${ownedAtlas})`,
        );
        summary.f95Deleted = deleted.changes || 0;
        await dbRun(db, "DELETE FROM f95_zone_screens WHERE f95_id NOT IN (SELECT f95_id FROM f95_zone_data)");
        await dbRun(db, "DELETE FROM f95_zone_tags WHERE f95_id NOT IN (SELECT f95_id FROM f95_zone_data)");
        await dbRun(db, "COMMIT");
      } catch (err) {
        await dbRun(db, "ROLLBACK").catch(() => {});
        throw err;
      }
    } else {
      summary.skipped.push("f95_zone (package smaller than local; treated as delta)");
    }
  }

  // LEWDCORNER -----------------------------------------------------------------
  const lcRows = Array.isArray(data.lewdcorner) ? data.lewdcorner : [];
  if (lcRows.length > 0) {
    const localLc = (await dbGet(db, "SELECT COUNT(*) AS c FROM lewdcorner_data"))?.c || 0;
    if (trusted || lcRows.length >= localLc) {
      await loadIdsIntoTemp(db, "_snap_lc", lcRows.map((r) => r.lc_id));
      await dbRun(db, "BEGIN");
      try {
        const deleted = await dbRun(
          db,
          `DELETE FROM lewdcorner_data
             WHERE lc_id NOT IN (SELECT id FROM _snap_lc)
               AND (atlas_id IS NULL OR NOT ${ownedAtlas})`,
        );
        summary.lcDeleted = deleted.changes || 0;
        await dbRun(db, "COMMIT");
      } catch (err) {
        await dbRun(db, "ROLLBACK").catch(() => {});
        throw err;
      }
    } else {
      summary.skipped.push("lewdcorner (package smaller than local; treated as delta)");
    }
  }

  return summary;
};

const checkDbUpdates = async (updatesDir, mainWindow) => {
  const axios = require("axios");
  const fs = require("fs");
  const lz4 = require("lz4js");
  const http = require("http");
  const https = require("https");

  // Reuse a single keep-alive connection for the manifest and every package
  // download. Without this, axios opens a fresh TCP + TLS connection per
  // request; on high-latency links (users far from the US-hosted server) the
  // handshake overhead — several round trips each — dominates and makes many
  // sequential downloads very slow. Keep-alive plus the bounded parallel
  // prefetch below is the main fix for "slow outside the US".
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });
  const client = axios.create({
    httpAgent,
    httpsAgent,
    timeout: 60000,
    headers: { "Accept-Encoding": "gzip, deflate, br" },
  });

  try {
    const url = "https://atlas-gamesdb.com/api/updates";
    const response = await client.get(url);
    const updates = response.data;
    if (!Array.isArray(updates)) throw new Error("Invalid updates data");

    // Get last update version
    const lastUpdateVersion = await new Promise((resolve, reject) => {
      getDb().get(
        "SELECT MAX(update_time) as last_update FROM updates",
        [],
        (err, row) => {
          if (err) reject(err);
          else resolve(row.last_update ? parseInt(row.last_update) : 0);
        },
      );
    });

    // Filter updates newer than lastUpdateVersion
    const newUpdates = updates.filter(
      (update) =>
        parseInt(update.date) > lastUpdateVersion || lastUpdateVersion === 0,
    );
    const total = newUpdates.length;

    if (total === 0) {
      await backfillF95LatestOrderFromUpdateFiles(updatesDir);
      return {
        success: true,
        message: "No new updates available",
        total: 0,
        processed: 0,
      };
    }

    const ordered = newUpdates.reverse();
    let processed = 0;
    let skipped = 0;

    // Bounded parallel prefetch: download up to PREFETCH packages ahead while
    // the current one is decompressed and inserted. The slow part abroad is the
    // network transfer, so overlapping it with CPU/DB work (instead of running
    // strictly one-at-a-time) is where most of the speedup comes from.
    // Insertion stays strictly sequential to preserve ordering guarantees
    // (f95_latest_order, snapshot pruning, and the updates ledger).
    const PREFETCH = 4;
    const downloadPackage = async (update) => {
      try {
        const downloadUrl = `https://atlas-gamesdb.com/packages/${update.name}`;
        const outputPath = path.join(updatesDir, update.name);
        const res = await client.get(downloadUrl, { responseType: "arraybuffer" });
        const buffer = Buffer.from(res.data);
        fs.writeFileSync(outputPath, buffer);
        return { ok: true, buffer };
      } catch (error) {
        // Resolve (never reject) so a prefetched failure can't trigger an
        // unhandled rejection before we reach its turn; it's rethrown then and
        // handled by the per-update skip logic below.
        return { ok: false, error };
      }
    };

    const downloads = new Array(ordered.length);
    const startDownload = (i) => {
      if (i < ordered.length && !downloads[i]) downloads[i] = downloadPackage(ordered[i]);
    };
    for (let i = 0; i < Math.min(PREFETCH, ordered.length); i += 1) startDownload(i);

    for (let i = 0; i < ordered.length; i += 1) {
      const update = ordered[i];
      const { date, name, md5 } = update;
      try {
      // Keep the prefetch window full by starting the next download as soon as
      // this slot opens up.
      startDownload(i + PREFETCH);

      mainWindow.webContents.send("db-update-progress", {
        text: `Downloading Database Update ${processed + 1}/${total}`,
        progress: processed,
        total,
      });
      const result = await downloads[i];
      if (!result.ok) throw result.error;

      // Decompress LZ4 straight from the downloaded buffer (no write-then-read
      // round trip; the file is already persisted for later backfill).
      const decompressedData = Buffer.from(lz4.decompress(result.buffer));
      const data = JSON.parse(decompressedData.toString("utf8"));
      // Process atlas_data
      mainWindow.webContents.send("db-update-progress", {
        text: `Processing Atlas Metadata ${processed + 1}/${total}`,
        progress: processed,
        total,
      });
      if (data.atlas && data.atlas.length > 0) {
        await insertJsonData(data.atlas, "atlas_data");
      }

      // Process f95_zone_data
      mainWindow.webContents.send("db-update-progress", {
        text: `Processing F95 Metadata ${processed + 1}/${total}`,
        progress: processed,
        total,
      });
      if (data.f95_zone && data.f95_zone.length > 0) {
        await insertJsonData(withF95LatestOrder(data.f95_zone, date), "f95_zone_data");
      }

      // Process lewdcorner_data
      mainWindow.webContents.send("db-update-progress", {
        text: `Processing LewdCorner Metadata ${processed + 1}/${total}`,
        progress: processed,
        total,
      });
      if (data.lewdcorner && data.lewdcorner.length > 0) {
        await insertJsonData(data.lewdcorner, "lewdcorner_data");
      }

      // Full snapshot reconciliation: remove games that no longer exist on the
      // server (keeping/flagging any the user still owns or has wishlisted).
      // Only runs for snapshot packages; deltas are never pruned.
      const { isSnapshot, trusted } = readSnapshotFlag(update, data);
      if (isSnapshot) {
        mainWindow.webContents.send("db-update-progress", {
          text: `Reconciling removed games ${processed + 1}/${total}`,
          progress: processed,
          total,
        });
        try {
          const pruneSummary = await applyFullSnapshotPrune(getDb(), data, Number(date), trusted);
          console.log(`Snapshot prune summary (${date}):`, JSON.stringify(pruneSummary));
        } catch (pruneErr) {
          // A prune failure must not abort the update; it will be retried on the
          // next snapshot.
          console.error(`Snapshot prune failed for ${date} (continuing):`, pruneErr.message);
        }
      }

      // Insert update record
      const processedTime = Math.floor(Date.now() / 1000);
      await new Promise((resolve, reject) => {
        getDb().run(
          "INSERT INTO updates (update_time, processed_time, md5) VALUES (?, ?, ?)",
          [date, processedTime, md5],
          (err) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });

      processed++;
      mainWindow.webContents.send("db-update-progress", {
        text: `Processed Update ${processed}/${total}`,
        progress: processed,
        total,
      });
      } catch (updateErr) {
        // A single bad package (e.g. a manifest entry whose file is missing /
        // returns 404, a corrupt download, or a decompress/parse failure) must
        // not abort the whole update run — skip it and continue. It isn't
        // recorded in `updates`, so it will be retried on the next check once
        // the server publishes it.
        skipped += 1;
        const status = updateErr?.response?.status;
        console.warn(
          `Skipping database update ${name}${status ? ` (HTTP ${status})` : ""}: ${updateErr.message}`,
        );
        mainWindow.webContents.send("db-update-progress", {
          text: `Skipped update ${name}${status === 404 ? " (not found)" : ""}`,
          progress: processed,
          total,
        });
        continue;
      }
    }

    return {
      success: true,
      message: `Processed ${processed} updates${skipped > 0 ? `, skipped ${skipped}` : ""}`,
      total,
      processed,
      skipped,
    };
  } catch (err) {
    console.error("Error checking database updates:", err.message);
    return { success: false, error: err.message, total: 0, processed: 0 };
  } finally {
    // Release the keep-alive sockets once the run is done.
    try { httpAgent.destroy(); } catch { /* ignore */ }
    try { httpsAgent.destroy(); } catch { /* ignore */ }
  }
};

module.exports = {
  checkDbUpdates,
}