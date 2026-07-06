'use strict'

const path = require('path')
const fs = require('fs')
const fsPromises = fs.promises
const dbModule = require('./index')
const getDb = () => dbModule.db
const { toLocalAssetPath, normalizeMediaStorageMode,
        buildBannerJoinClauses, buildBannerSelectFields } = require('./helpers')
const { mapVersionRow, getVersionPathsForRecord } = require('./versions')
const { deleteBanner, deletePreviews, deleteMediaAssets } = require('./media')

let cachedFilterOptions = null
const resetCachedFilterOptions = () => { cachedFilterOptions = null }

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(err) {
      if (err) reject(err)
      else resolve(this)
    })
  })

const normalizeText = (value) => value === undefined || value === null ? "" : String(value)

const parseTagList = (value) => {
  if (Array.isArray(value)) return value.map(normalizeText).map((tag) => tag.trim()).filter(Boolean)
  return normalizeText(value)
    .split(/[,;\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

const replaceGameTags = (recordId, tags) => {
  const db = getDb()
  const uniqueTags = Array.from(new Set(parseTagList(tags)))
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION")
      db.run("DELETE FROM tag_mappings WHERE record_id = ?", [recordId], (deleteErr) => {
        if (deleteErr) {
          db.run("ROLLBACK", () => reject(deleteErr))
          return
        }
        const insertNext = (index) => {
          if (index >= uniqueTags.length) {
            db.run("COMMIT", (commitErr) => {
              if (commitErr) reject(commitErr)
              else resolve()
            })
            return
          }
          const tag = uniqueTags[index]
          db.run("INSERT OR IGNORE INTO tags (tag) VALUES (?)", [tag], (tagErr) => {
            if (tagErr) {
              db.run("ROLLBACK", () => reject(tagErr))
              return
            }
            db.run(
              `INSERT OR IGNORE INTO tag_mappings (record_id, tag_id)
               SELECT ?, tag_id FROM tags WHERE tag = ?`,
              [recordId, tag],
              (mappingErr) => {
                if (mappingErr) {
                  db.run("ROLLBACK", () => reject(mappingErr))
                  return
                }
                insertNext(index + 1)
              },
            )
          })
        }
        insertNext(0)
      })
    })
  })
}

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

const updateGame = async (game) => {
  const { title, creator, engine } = game;
  const recordId = game.record_id;
  const description = game.description ?? game.overview ?? "";

  try {
    await dbRun(
      `UPDATE games SET title = ?, creator = ?, engine = ?, description = ?
       WHERE record_id = ?`,
      [title, creator, engine, description, recordId],
    );
    await dbRun(
      `INSERT INTO game_metadata_overrides
       (record_id, os, publisher, release_date, status, category, latest_version, censored,
        language, translations, genre, voice, rating, overview, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(record_id) DO UPDATE SET
         os = excluded.os,
         publisher = excluded.publisher,
         release_date = excluded.release_date,
         status = excluded.status,
         category = excluded.category,
         latest_version = excluded.latest_version,
         censored = excluded.censored,
         language = excluded.language,
         translations = excluded.translations,
         genre = excluded.genre,
         voice = excluded.voice,
         rating = excluded.rating,
         overview = excluded.overview,
         updated_at = excluded.updated_at`,
      [
        recordId,
        normalizeText(game.os),
        normalizeText(game.publisher),
        normalizeText(game.release_date),
        normalizeText(game.status),
        normalizeText(game.category),
        normalizeText(game.latest_version ?? game.latestVersion),
        normalizeText(game.censored),
        normalizeText(game.language),
        normalizeText(game.translations),
        normalizeText(game.genre),
        normalizeText(game.voice),
        normalizeText(game.rating),
        normalizeText(game.overview ?? game.description),
        Math.floor(Date.now() / 1000),
      ],
    );
    await replaceGameTags(recordId, game.tags ?? game.f95_tags ?? "");
    resetCachedFilterOptions();
    console.log(`Updated game ${title} with record_id: ${recordId}`);
    return recordId;
  } catch (err) {
    console.error("Error updating game:", err);
    throw err;
  }
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

const normalizePersonalRatingValue = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(10, Math.round(number)));
};

const computePersonalRatingOverall = (ratings) => {
  const values = [
    ratings.story,
    ratings.graphics,
    ratings.gameplay,
    ratings.fappability,
  ].filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(average * 10) / 10;
};

const buildPersonalRatingPayload = (recordId, ratings, updatedAt = Math.floor(Date.now() / 1000)) => {
  const normalized = {
    story: normalizePersonalRatingValue(ratings?.story),
    graphics: normalizePersonalRatingValue(ratings?.graphics),
    gameplay: normalizePersonalRatingValue(ratings?.gameplay),
    fappability: normalizePersonalRatingValue(ratings?.fappability),
  };
  return {
    recordId,
    personalRatingStory: normalized.story,
    personalRatingGraphics: normalized.graphics,
    personalRatingGameplay: normalized.gameplay,
    personalRatingFappability: normalized.fappability,
    personalRatingOverall: computePersonalRatingOverall(normalized),
    personalRatingUpdatedAt: updatedAt,
  };
};

const setGamePersonalRatings = (recordId, ratings = {}) => {
  const id = Number.parseInt(recordId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.resolve({ success: false, error: "Invalid recordId" });
  }

  const updatedAt = Math.floor(Date.now() / 1000);
  const payload = buildPersonalRatingPayload(id, ratings, updatedAt);

  return new Promise((resolve) => {
    getDb().get(`SELECT record_id FROM games WHERE record_id = ?`, [id], (selectErr, row) => {
      if (selectErr) {
        console.error("Error checking game before rating update:", selectErr);
        resolve({ success: false, error: selectErr.message });
        return;
      }
      if (!row) {
        resolve({ success: false, error: "Game record not found" });
        return;
      }

      getDb().run(
        `INSERT INTO game_personal_ratings
          (record_id, story, graphics, gameplay, fappability, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(record_id) DO UPDATE SET
          story = excluded.story,
          graphics = excluded.graphics,
          gameplay = excluded.gameplay,
          fappability = excluded.fappability,
          updated_at = excluded.updated_at`,
        [
          id,
          payload.personalRatingStory,
          payload.personalRatingGraphics,
          payload.personalRatingGameplay,
          payload.personalRatingFappability,
          updatedAt,
        ],
        (err) => {
          if (err) {
            console.error("Error updating personal ratings:", err);
            resolve({ success: false, error: err.message });
            return;
          }
          resolve({ success: true, ...payload });
        },
      );
    });
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
    // Version deletion intentionally leaves games.total_playtime untouched.
    // Title playtime is a lifetime total and can outlive individual version rows.
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
    await deleteMediaAssets(recordId, appPath, isDev);
  } catch (err) {
    console.warn("deleteGameCompletely media asset cleanup warning:", err);
    warnings.push(`Media asset cleanup: ${err.message}`);
  }

  try {
    const tables = [
      "banners",
      "previews",
      "media_assets",
      "atlas_mappings",
      "steam_mappings",
      "f95_zone_mappings",
      "lewdcorner_mappings",
      "tag_mappings",
      "game_metadata_overrides",
      "game_personal_ratings",
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

                        // Tags from source-specific remote tables
                        getDb().all(
                          `SELECT tags FROM f95_zone_data WHERE tags IS NOT NULL
                           UNION ALL
                           SELECT tags FROM lewdcorner_data WHERE tags IS NOT NULL`,
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

const setSelectedGameVersion = async (recordId, versionId) => {
  const selectedVersionId = Number.parseInt(versionId, 10);
  if (!Number.isInteger(selectedVersionId) || selectedVersionId <= 0) {
    throw new Error("Invalid selected version");
  }
  const version = await new Promise((resolve, reject) => {
    getDb().get(
      `SELECT rowid AS version_id
       FROM versions
       WHERE rowid = ? AND record_id = ?`,
      [selectedVersionId, recordId],
      (err, row) => err ? reject(err) : resolve(row),
    );
  });
  if (!version) throw new Error("Selected version does not belong to this game");
  await dbRun(
    "UPDATE games SET selected_version_id = ? WHERE record_id = ?",
    [selectedVersionId, recordId],
  );
  return { success: true, selectedVersionId };
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
  setGamePersonalRatings,
  setSelectedGameVersion,
  getUniqueFilterOptions,
  resetCachedFilterOptions,
}
