'use strict'

const path = require('path')
const fs = require('fs')
const fsPromises = fs.promises
const dbModule = require('./index')
const getDb = () => dbModule.db
const { toLocalAssetPath, normalizeMediaStorageMode,
        buildBannerJoinClauses, buildBannerSelectFields } = require('./helpers')
const { mapVersionRow, getVersionPathsForRecord } = require('./versions')
const { deleteBanner, deletePreviews } = require('./media')

let cachedFilterOptions = null
const resetCachedFilterOptions = () => { cachedFilterOptions = null }

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(err) {
      if (err) reject(err)
      else resolve(this)
    })
  })

const addGame = (game) => {
  return new Promise((resolve, reject) => {
    const { title, creator, engine } = game;

    // Check if game already exists
    getDb().get(
      `SELECT record_id FROM games WHERE title = ? AND creator = ?`,
      [title, creator],
      (err, row) => {
        if (err) {
          console.error("Error checking existing game:", err);
          reject(err);
          return;
        }
        if (row) {
          // Game exists, return existing record_id
          console.log(
            `Game ${title} by ${creator} already exists with record_id: ${row.record_id}`,
          );
          resolve(row.record_id);
          return;
        }
        // Game doesn't exist, insert new record
        getDb().run(
          `INSERT INTO games (title, creator, engine, last_played_r, total_playtime)
           VALUES (?, ?, ?, 0, 0)`,
          [title, creator, engine],
          function (err) {
            if (err) {
              console.error("Error inserting game:", err);
              reject(err);
              return;
            }
            // Return the new record_id
            console.log(
              `Inserted new game ${title} by ${creator} with record_id: ${this.lastID}`,
            );
            resolve(this.lastID);
          },
        );
      },
    );
  });
};

const updateGame = (game) => {
  return new Promise((resolve, reject) => {
    const { title, creator, engine } = game;
    const description = game.description ?? game.overview ?? null;
    getDb().run(
      `UPDATE games SET title = ?, creator = ?, engine = ?, description = ?
       WHERE record_id = ?`,
      [
        title,
        creator,
        engine,
        description,
        game.record_id,
      ],
      function (err) {
        if (err) {
          console.error("Error updating game:", err);
          reject(err);
          return;
        }
        console.log(`Updated game ${title} with record_id: ${game.record_id}`);
        resolve(game.record_id);
      },
    );
  });
};

const recordGameLaunchStarted = (recordId, version, timestamp) => {
  return new Promise((resolve, reject) => {
    getDb().serialize(() => {
      getDb().run(
        `UPDATE versions SET last_played = ?
         WHERE record_id = ? AND version = ?`,
        [timestamp, recordId, version],
        (err) => {
          if (err) {
            console.error("Error updating version last played:", err);
            reject(err);
          }
        },
      );
      getDb().run(
        `UPDATE games SET last_played_r = ?, last_played_version = ?
         WHERE record_id = ?`,
        [timestamp, version, recordId],
        function (err) {
          if (err) {
            console.error("Error updating game last played:", err);
            reject(err);
            return;
          }
          resolve({ success: true });
        },
      );
    });
  });
};

const recordGamePlaytime = (recordId, version, minutes) => {
  const playMinutes = Math.max(0, parseInt(minutes, 10) || 0);
  if (playMinutes <= 0) return Promise.resolve({ success: true });

  return new Promise((resolve, reject) => {
    getDb().serialize(() => {
      getDb().run(
        `UPDATE versions
         SET version_playtime = COALESCE(version_playtime, 0) + ?
         WHERE record_id = ? AND version = ?`,
        [playMinutes, recordId, version],
        (err) => {
          if (err) {
            console.error("Error updating version playtime:", err);
            reject(err);
          }
        },
      );
      getDb().run(
        `UPDATE games
         SET total_playtime = COALESCE(total_playtime, 0) + ?
         WHERE record_id = ?`,
        [playMinutes, recordId],
        function (err) {
          if (err) {
            console.error("Error updating game total playtime:", err);
            reject(err);
            return;
          }
          resolve({ success: true });
        },
      );
    });
  });
};

const setGameFavorite = (recordId, isFavorite) => {
  const id = Number.parseInt(recordId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.resolve({ success: false, error: "Invalid recordId" });
  }
  const nextFavorite = isFavorite === true ? 1 : 0;
  return new Promise((resolve) => {
    getDb().run(
      `UPDATE games SET is_favorite = ? WHERE record_id = ?`,
      [nextFavorite, id],
      function onRun(err) {
        if (err) {
          console.error("Error updating favorite state:", err);
          resolve({ success: false, error: err.message });
          return;
        }
        if (!this.changes) {
          resolve({ success: false, error: "Game record not found" });
          return;
        }
        resolve({ success: true, recordId: id, isFavorite: nextFavorite === 1 });
      },
    );
  });
};

const getGameRecordIds = () => {
  return new Promise((resolve, reject) => {
    getDb().all(`SELECT record_id FROM games ORDER BY title COLLATE NOCASE`, [], (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []).map((row) => row.record_id));
    });
  });
};

const removeGame = async (record_id) => {
  return new Promise((resolve, reject) => {
    getDb().run("DELETE FROM games WHERE record_id = ?", [record_id], (err) => {
      if (err) reject(err);
      else resolve({ success: true });
    });
  });
};

// Count versions for a game

const countVersions = (recordId) =>
  new Promise((resolve, reject) => {
    getDb().get(
      `SELECT COUNT(*) as count FROM versions WHERE record_id = ?`,
      [recordId],
      (err, row) => (err ? reject(err) : resolve(row?.count || 0)),
    );
  });

// Delete ONE specific version

const deleteVersion = (recordId, version) =>
  new Promise((resolve, reject) => {
    getDb().run(
      `DELETE FROM versions WHERE record_id = ? AND version = ?`,
      [recordId, version],
      function (err) {
        err ? reject(err) : resolve({ changes: this.changes });
      },
    );
  });

// Full cleanup (images + mappings + versions + game record)

const deleteGameCompletely = async (recordId, appPath, isDev) => {
  const warnings = [];

  try {
    await deleteBanner(recordId, appPath, isDev);
  } catch (err) {
    console.warn("deleteGameCompletely banner cleanup warning:", err);
    warnings.push(`Banner cleanup: ${err.message}`);
  }

  try {
    await deletePreviews(recordId, appPath, isDev);
  } catch (err) {
    console.warn("deleteGameCompletely preview cleanup warning:", err);
    warnings.push(`Preview cleanup: ${err.message}`);
  }

  try {
    const tables = [
      "banners",
      "previews",
      "atlas_mappings",
      "steam_mappings",
      "f95_zone_mappings",
      "tag_mappings",
      // add others if you have more
    ];

    await dbRun("BEGIN IMMEDIATE TRANSACTION");
    try {
      for (const tbl of tables) {
        await dbRun(`DELETE FROM ${tbl} WHERE record_id = ?`, [recordId]);
      }

      await dbRun(`DELETE FROM versions WHERE record_id = ?`, [recordId]);
      const gameDelete = await dbRun(`DELETE FROM games WHERE record_id = ?`, [recordId]);
      if (!gameDelete.changes) throw new Error("Game record was not removed");

      await dbRun("COMMIT");
    } catch (err) {
      await dbRun("ROLLBACK").catch(() => {});
      throw err;
    }

    return warnings.length ? { success: true, warnings } : { success: true };
  } catch (err) {
    console.error("deleteGameCompletely failed:", err);
    return { success: false, error: err.message };
  }
};

const getUniqueFilterOptions = () => {
  return new Promise((resolve, reject) => {
    if (cachedFilterOptions) {
      resolve(cachedFilterOptions);
      return;
    }

    const options = {};

    getDb().all(
      "SELECT DISTINCT category FROM atlas_data WHERE category IS NOT NULL",
      [],
      (err, rows) => {
        if (err) return reject(err);
        options.categories = rows.map((r) => r.category);

        getDb().all(
          "SELECT DISTINCT engine FROM atlas_data WHERE engine IS NOT NULL",
          [],
          (err, rows) => {
            if (err) return reject(err);
            options.engines = rows.map((r) => r.engine);

            getDb().all(
              "SELECT DISTINCT status FROM atlas_data WHERE status IS NOT NULL",
              [],
              (err, rows) => {
                if (err) return reject(err);
                options.statuses = rows.map((r) => r.status);

                getDb().all(
                  "SELECT DISTINCT censored FROM atlas_data WHERE censored IS NOT NULL",
                  [],
                  (err, rows) => {
                    if (err) return reject(err);
                    options.censored = rows.map((r) => r.censored);

                    getDb().all(
                      "SELECT DISTINCT language FROM atlas_data WHERE language IS NOT NULL",
                      [],
                      (err, rows) => {
                        if (err) return reject(err);
                        options.languages = rows.map((r) => r.language);

                        // Tags from f95_zone_data
                        getDb().all(
                          "SELECT tags FROM f95_zone_data WHERE tags IS NOT NULL",
                          [],
                          (err, rows) => {
                            if (err) return reject(err);
                            const tagsSet = new Set();
                            rows.forEach((row) => {
                              if (row.tags) {
                                row.tags
                                  .split(",")
                                  .forEach((tag) => tagsSet.add(tag.trim()));
                              }
                            });
                            options.tags = Array.from(tagsSet);
                            cachedFilterOptions = options;
                            resolve(options);
                          },
                        );
                      },
                    );
                  },
                );
              },
            );
          },
        );
      },
    );
  });
};

module.exports = {
  addGame,
  updateGame,
  removeGame,
  countVersions,
  deleteVersion,
  deleteGameCompletely,
  getGameRecordIds,
  recordGameLaunchStarted,
  recordGamePlaytime,
  setGameFavorite,
  getUniqueFilterOptions,
  resetCachedFilterOptions,
}
