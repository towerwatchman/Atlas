'use strict'

const dbModule = require('./index')
const getDb = () => dbModule.db
const fs = require('fs')
const fsPromises = require('fs').promises
const path = require('path')
const { DEFAULT_LAUNCHABLE_EXTENSIONS, normalizeExtensions,
        isLaunchableFile, findLaunchablesInFolder,
        chooseLaunchableForRepair } = require('./versions')

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

module.exports = {
  repairDoubledApostropheRows,
  repairStaleVersionExecutables,
}

module.exports = {
  repairDoubledApostropheRows,
  repairStaleVersionExecutables,
}
