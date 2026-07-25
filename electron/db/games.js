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
const { normalizePlaystate } = require('./playstates')
const { OVERRIDE_FIELDS, OVERRIDE_COLUMNS, extractOverridePatch,
        inheritedSelect, INHERITED_JOINS, sameValue,
        BASE_FIELDS, BASE_COLUMNS, baseSourceSelect } = require('./overrides')

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

const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)

// Deletes an override row that no longer carries any user data, so "does a row
// exist" stays a truthful answer to "does this title have custom data".
const pruneEmptyOverrideRow = async (recordId) => {
  const emptyCheck = OVERRIDE_COLUMNS.map((col) => `${col} IS NULL`).join(" AND ")
  const result = await dbRun(
    `DELETE FROM game_metadata_overrides
     WHERE record_id = ?
       AND ${emptyCheck}
       AND (manual_external_ids IS NULL OR TRIM(manual_external_ids) IN ('', '{}'))`,
    [recordId],
  )
  return result.changes > 0
}

// Writes the override columns named in `patch` and nothing else. A null value
// clears that single override (the field falls back to its source chain).
const writeOverridePatch = async (recordId, patch) => {
  const columns = Object.keys(patch)
  if (columns.length === 0) return false

  const placeholders = columns.map(() => "?").join(", ")
  const assignments = columns.map((col) => `${col} = excluded.${col}`).join(",\n         ")
  await dbRun(
    `INSERT INTO game_metadata_overrides (record_id, ${columns.join(", ")}, updated_at)
     VALUES (?, ${placeholders}, ?)
     ON CONFLICT(record_id) DO UPDATE SET
         ${assignments},
         updated_at = excluded.updated_at`,
    [recordId, ...columns.map((col) => patch[col]), Math.floor(Date.now() / 1000)],
  )
  await pruneEmptyOverrideRow(recordId)
  return true
}

// Updates a game record. Everything here is a PATCH: only the keys actually
// present on `game` are written.
//
// This matters because the merge queries in versions.js resolve metadata as
// COALESCE(game_metadata_overrides.x, <source chain>). Writing a column we were
// not asked to write pins that field to a user override forever — and writing ''
// rather than NULL blanks the field outright, because '' is not null and wins
// the COALESCE. The previous implementation did both on every call, so editing
// one field in the properties window overrode all thirteen, and an import that
// carried a description wrote a full row of blanking overrides.
//
// Base `games` columns (title/creator/engine/description) are also only touched
// when supplied. Note that `description` writes games.description (the record's
// own text, part of the inherited chain) whereas `overview` writes the override
// column — they are deliberately separate so that reverting or clearing custom
// data can restore the source description.
const updateGame = async (game) => {
  const recordId = game.record_id;

  try {
    const baseAssignments = []
    const baseParams = []
    if (hasKey(game, "title"))       { baseAssignments.push("title = ?");       baseParams.push(game.title) }
    if (hasKey(game, "creator"))     { baseAssignments.push("creator = ?");     baseParams.push(game.creator) }
    if (hasKey(game, "engine"))      { baseAssignments.push("engine = ?");      baseParams.push(game.engine) }
    if (hasKey(game, "description")) { baseAssignments.push("description = ?"); baseParams.push(normalizeText(game.description)) }

    if (baseAssignments.length > 0) {
      await dbRun(
        `UPDATE games SET ${baseAssignments.join(", ")} WHERE record_id = ?`,
        [...baseParams, recordId],
      );
    }

    await writeOverridePatch(recordId, extractOverridePatch(game));

    // Only rewrite tags when the caller actually supplied them. The old
    // unconditional call deleted every tag mapping whenever a partial payload
    // (e.g. the importer's five-key update) omitted tags.
    if (hasKey(game, "tags") || hasKey(game, "f95_tags")) {
      await replaceGameTags(recordId, game.tags ?? game.f95_tags ?? "");
    }

    resetCachedFilterOptions();
    console.log(`Updated game ${game.title ?? ""} with record_id: ${recordId}`);
    return recordId;
  } catch (err) {
    console.error("Error updating game:", err);
    throw err;
  }
};

// Reports, per overridable field, whether the user has set a custom value and
// what the value would be if that override were cleared. Powers the "custom vs
// inherited" markers and per-field revert in the properties window.
const getGameOverrides = (recordId) =>
  new Promise((resolve, reject) => {
    const overrideSelect = OVERRIDE_COLUMNS
      .map((col) => `game_metadata_overrides.${col} AS override_${col}`)
      .join(",\n        ")
    getDb().get(
      `SELECT
        games.record_id,
        ${BASE_COLUMNS.map((col) => `games.${col} AS base_${col}`).join(",\n        ")},
        ${baseSourceSelect()},
        ${overrideSelect},
        ${inheritedSelect()}
      FROM games
      LEFT JOIN game_metadata_overrides ON games.record_id = game_metadata_overrides.record_id
${INHERITED_JOINS}
      WHERE games.record_id = ?
      GROUP BY games.record_id`,
      [recordId],
      (err, row) => {
        if (err) {
          console.error("Error reading game overrides:", err)
          return reject(err)
        }
        if (!row) return resolve({ recordId, fields: [], overriddenCount: 0 })

        // Base `games` columns. There is no override row to consult, so
        // "changed" means the stored value differs from what the sources report.
        // That is usually a user edit but would also be true if a source changed
        // upstream after import, so this is reported as a difference from the
        // source rather than as stored custom intent.
        const baseReport = BASE_FIELDS.map(({ column, label, formKey }) => {
          const stored = row[`base_${column}`]
          const source = row[`source_${column}`]
          const storedText = stored === null || stored === undefined ? "" : String(stored)
          const sourceText = source === null || source === undefined ? "" : String(source)
          return {
            column,
            label,
            formKey,
            base: true,
            // Only a real difference counts, and only when there is a source to
            // compare against — an unmatched record has nothing to differ from.
            overridden: sourceText !== "" && storedText !== "" && !sameValue(storedText, sourceText),
            custom: storedText || null,
            inherited: sourceText,
            // A base field can only be reset when a source value exists; title
            // in particular must never be blanked.
            resettable: sourceText !== "",
            redundant: false,
          }
        })

        const overrideReport = OVERRIDE_FIELDS.map(({ column, label, formKey }) => {
          const custom = row[`override_${column}`]
          const inherited = row[`inherited_${column}`]
          const overridden = custom !== null && custom !== undefined && String(custom).trim() !== ""
          return {
            column,
            label,
            formKey,
            base: false,
            overridden,
            custom: overridden ? String(custom) : null,
            inherited: inherited === null || inherited === undefined ? "" : String(inherited),
            resettable: true,
            // A custom value identical to the source value changes nothing —
            // the signature of the old write-everything bug.
            redundant: overridden && sameValue(custom, inherited),
          }
        })

        const fields = [...baseReport, ...overrideReport]
        resolve({
          recordId,
          fields,
          overriddenCount: fields.filter((f) => f.overridden).length,
          overrideFieldCount: overrideReport.filter((f) => f.overridden).length,
          baseFieldCount: baseReport.filter((f) => f.overridden).length,
        })
      },
    )
  })

// Resets fields on a record. Pass a list of columns (or form keys) to reset
// specific fields; omit it to reset everything.
//
// Two kinds of field are handled differently:
//   * Overridable metadata — the override column is set to NULL, so the field
//     falls back through its source chain.
//   * Base `games` columns (title / creator / engine) — there is no override to
//     null, so the SOURCE VALUE IS WRITTEN BACK into the games row. A base field
//     with no source value is skipped rather than blanked; title especially is
//     the record's identity across the library grid, search and sorting.
const clearGameOverrides = async (recordId, fields = null) => {
  if (!recordId) throw new Error("recordId is required")

  const requested = Array.isArray(fields) ? fields : fields ? [fields] : null
  const byFormKey = new Map([
    ...OVERRIDE_FIELDS.map((f) => [f.formKey, f.column]),
    ...BASE_FIELDS.map((f) => [f.formKey, f.column]),
  ])
  const resolveName = (name) =>
    OVERRIDE_COLUMNS.includes(name) || BASE_COLUMNS.includes(name) ? name : byFormKey.get(name)

  let overrideCols = OVERRIDE_COLUMNS
  let baseCols = BASE_COLUMNS
  if (requested) {
    const resolved = requested.map(resolveName).filter(Boolean)
    overrideCols = resolved.filter((c) => OVERRIDE_COLUMNS.includes(c))
    baseCols = resolved.filter((c) => BASE_COLUMNS.includes(c))
    if (overrideCols.length === 0 && baseCols.length === 0) {
      return { success: false, error: "No recognised fields to reset", cleared: [], skipped: [] }
    }
  }

  try {
    const cleared = []
    const skipped = []

    if (overrideCols.length > 0) {
      await dbRun(
        `UPDATE game_metadata_overrides
         SET ${overrideCols.map((col) => `${col} = NULL`).join(", ")}, updated_at = ?
         WHERE record_id = ?`,
        [Math.floor(Date.now() / 1000), recordId],
      )
      await pruneEmptyOverrideRow(recordId)
      cleared.push(...overrideCols)
    }

    if (baseCols.length > 0) {
      // Read the source values through the shared chains rather than
      // duplicating them here.
      const report = await getGameOverrides(recordId)
      const byColumn = new Map((report?.fields || []).map((f) => [f.column, f]))
      const writes = []
      for (const col of baseCols) {
        const field = byColumn.get(col)
        const source = field?.inherited || ""
        if (!source) { skipped.push(col); continue }        // nothing to reset to
        if (!field.overridden) continue                     // already matches source
        writes.push([col, source])
      }
      if (writes.length > 0) {
        try {
          await dbRun(
            `UPDATE games SET ${writes.map(([col]) => `${col} = ?`).join(", ")} WHERE record_id = ?`,
            [...writes.map(([, value]) => value), recordId],
          )
          cleared.push(...writes.map(([col]) => col))
        } catch (err) {
          // games has a UNIQUE constraint on (title, creator, engine). Restoring
          // source values can therefore collide with another record — typically
          // a duplicate import the user renamed precisely to tell the two apart.
          // Report that plainly instead of leaking the raw SQLite message; any
          // override columns cleared above still stand.
          if (String(err?.code) === "SQLITE_CONSTRAINT") {
            return {
              success: false,
              error:
                "Resetting these fields would make this title identical to another record " +
                "in your library. Rename or merge the duplicate first.",
              cleared,
              skipped: [...skipped, ...writes.map(([col]) => col)],
            }
          }
          throw err
        }
      }
    }

    resetCachedFilterOptions()
    return { success: true, cleared, skipped }
  } catch (err) {
    console.error("Error resetting game fields:", err)
    return { success: false, error: err.message, cleared: [], skipped: [] }
  }
}

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

// Set (or clear, with null) the per-TITLE playstate override. A null/invalid
// value clears the override, causing the title to fall back to a playstate
// derived from its versions.
const setGamePlaystate = (recordId, playstate) => {
  const id = Number.parseInt(recordId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.resolve({ success: false, error: "Invalid recordId" });
  }
  const next = normalizePlaystate(playstate); // null clears the override
  return new Promise((resolve) => {
    getDb().run(
      `UPDATE games SET playstate = ? WHERE record_id = ?`,
      [next, id],
      function onRun(err) {
        if (err) {
          console.error("Error updating game playstate:", err);
          resolve({ success: false, error: err.message });
          return;
        }
        if (!this.changes) {
          resolve({ success: false, error: "Game record not found" });
          return;
        }
        resolve({ success: true, recordId: id, playstate: next });
      },
    );
  });
};

// Set (or clear, with null) the playstate for a single version, identified by
// its rowid (version_id). Scoped to record_id as a safety check.
const setVersionPlaystate = (recordId, versionId, playstate) => {
  const rid = Number.parseInt(recordId, 10);
  const vid = Number.parseInt(versionId, 10);
  if (!Number.isInteger(rid) || rid <= 0 || !Number.isInteger(vid) || vid <= 0) {
    return Promise.resolve({ success: false, error: "Invalid recordId or versionId" });
  }
  const next = normalizePlaystate(playstate);
  return new Promise((resolve) => {
    getDb().run(
      `UPDATE versions SET playstate = ? WHERE rowid = ? AND record_id = ?`,
      [next, vid, rid],
      function onRun(err) {
        if (err) {
          console.error("Error updating version playstate:", err);
          resolve({ success: false, error: err.message });
          return;
        }
        if (!this.changes) {
          resolve({ success: false, error: "Version not found" });
          return;
        }
        resolve({ success: true, recordId: rid, versionId: vid, playstate: next });
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

// Manual source-ID overrides (F95 / Steam / LewdCorner) set by the user from
// the game properties Mappings tab. Stored as a JSON blob on the per-game
// override row (game_metadata_overrides.manual_external_ids). Only the keys
// the user actually sets are kept; clearing a field removes its key. Steam is
// ALSO written to steam_mappings via addSteamMapping so existing Steam art/
// metadata linkage keeps working; the blob is the durable record of the raw
// ids the user typed and what the Mappings tab renders.
const getManualMappings = (recordId) =>
  new Promise((resolve, reject) => {
    getDb().get(
      `SELECT manual_external_ids FROM game_metadata_overrides WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) return reject(err)
        if (!row || !row.manual_external_ids) return resolve({})
        try {
          const parsed = JSON.parse(row.manual_external_ids)
          resolve(parsed && typeof parsed === 'object' ? parsed : {})
        } catch {
          resolve({})
        }
      },
    )
  })

const setManualMappings = async (recordId, mappings = {}) => {
  if (!recordId) throw new Error('recordId is required')
  // Keep only non-empty string/number values; drop cleared fields entirely.
  const clean = {}
  for (const [key, value] of Object.entries(mappings || {})) {
    const v = String(value ?? '').trim()
    if (v) clean[key] = v
  }
  const json = Object.keys(clean).length > 0 ? JSON.stringify(clean) : null
  await dbRun(
    `INSERT INTO game_metadata_overrides (record_id, manual_external_ids, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(record_id) DO UPDATE SET
       manual_external_ids = excluded.manual_external_ids,
       updated_at = excluded.updated_at`,
    [recordId, json, Math.floor(Date.now() / 1000)],
  )
  return clean
}

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
  setGamePlaystate,
  setVersionPlaystate,
  setGamePersonalRatings,
  setSelectedGameVersion,
  getUniqueFilterOptions,
  resetCachedFilterOptions,
  getManualMappings,
  setManualMappings,
  getGameOverrides,
  clearGameOverrides,
}
