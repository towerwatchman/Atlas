'use strict'

const path = require('path')
const fs = require('fs')
const fsPromises = fs.promises
const axios = require('axios')
const lz4 = require('lz4js')
const dbModule = require('./index')
const getDb = () => dbModule.db
const { toLocalAssetPath } = require('./helpers')
const { checkRecordExist, checkPathExist, findExistingRecordForImport, normalizePathForCompare } = require('./versions')
const { findRecordBySteamId } = require('./steam')
const { findRecordByLewdCornerId } = require('./lewdcorner')
const { resetCachedFilterOptions } = require('./games')


const normalizeSearchKey = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();

const normalizeSearchWords = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 3);

const buildAtlasSearchKeys = (title) => {
  const raw = String(title || "").replace(/\.(zip|rar|7z)$/i, "");
  const keys = new Set();
  const addKey = (value) => {
    const key = normalizeSearchKey(value);
    if (key.length >= 3) keys.add(key);
  };

  addKey(raw);
  addKey(
    raw
      .replace(/\[(.*?)\]/g, "$1")
      .replace(/\b(early\s*access|market|patreon|public|elite|free|demo|compressed|crunched|uncensored)\b/gi, " ")
      .replace(/\b(pc|win|windows|windows64|win64|linux|mac|fl)\b/gi, " ")
      .replace(/\b(?:ep|episode|ch|chapter)\.?\s*\d+[a-z]*\b/gi, " ")
      .replace(/\bpart\s*\d+[a-z]*\b/gi, " ")
      .replace(/\bv?\d+(?:\.\d+)*[a-z]*\b/gi, " "),
  );

  return Array.from(keys);
};

const scoreAtlasSearchRow = (row, searchKeys, title, creator) => {
  const rowShortName = normalizeSearchKey(row.short_name || row.title);
  const rowTitle = normalizeSearchKey(row.title);
  const queryWords = new Set(normalizeSearchWords(title));
  const rowWords = normalizeSearchWords(row.title);
  const creatorKey = normalizeSearchKey(creator);
  const rowCreatorKey = normalizeSearchKey(row.creator);
  let score = 0;

  for (const key of searchKeys) {
    if (!key || !rowShortName) continue;
    if (rowShortName === key) score = Math.max(score, 1000);
    else if (
      rowShortName.length >= 8 &&
      key.includes(rowShortName) &&
      rowShortName.length / key.length >= 0.45
    ) {
      score = Math.max(score, 860 - Math.abs(key.length - rowShortName.length));
    } else if (key.length >= 5 && rowShortName.includes(key)) {
      score = Math.max(score, 720 - Math.abs(rowShortName.length - key.length));
    }

    if (rowTitle && rowTitle === key) score = Math.max(score, 900);
    else if (
      rowTitle.length >= 8 &&
      key.includes(rowTitle) &&
      rowTitle.length / key.length >= 0.45
    ) {
      score = Math.max(score, 780 - Math.abs(key.length - rowTitle.length));
    }
  }

  const overlap = rowWords.filter((word) => queryWords.has(word)).length;
  if (overlap > 0) {
    score = Math.max(score, 500 + overlap * 60);
  }

  if (creatorKey && creatorKey !== "UNKNOWN" && rowCreatorKey.includes(creatorKey)) {
    score += 60;
  }
  if (row.f95_id) score += 20;
  if (row.lc_id) score += 10;

  return score;
};

// Exact title + creator lookup. There can legitimately be more than one
// atlas record sharing the same title and creator, so this returns every
// exact hit. Comparison is case/whitespace-insensitive (normalized title via
// the indexed normalized_title column, creator trimmed/lowercased).
const searchAtlasExact = async (title, creator) => {
  const normalizedTitle = normalizeSearchKey(title);
  const trimmedCreator = String(creator || "").trim();
  if (!normalizedTitle || !trimmedCreator) return [];

  const sql = `
    SELECT
      a.atlas_id,
      a.title,
      a.creator,
      a.engine,
      a.version as latestVersion,
      f.f95_id,
      f.site_url as siteUrl,
      lc.lc_id,
      lc.site_url as lewdCornerSiteUrl
    FROM atlas_data a
    LEFT JOIN f95_zone_data f ON f.atlas_id = a.atlas_id
    LEFT JOIN lewdcorner_data lc ON lc.atlas_id = a.atlas_id
    WHERE a.normalized_title = ?
      AND LOWER(TRIM(a.creator)) = LOWER(?)
  `;

  const rows = await new Promise((resolve, reject) => {
    getDb().all(sql, [normalizedTitle, trimmedCreator], (err, resultRows) => {
      if (err) reject(err);
      else resolve(resultRows || []);
    });
  });

  return rows.map((row) => ({ ...row, f95_id: row.f95_id || "" }));
};

const searchAtlas = async (title, creator) => {
  // Prefer exact title + creator matches; only fall back to the fuzzy
  // scoring search when no exact match exists in the database.
  const exactMatches = await searchAtlasExact(title, creator);
  if (exactMatches.length > 0) return exactMatches;

  const searchKeys = buildAtlasSearchKeys(title);
  if (searchKeys.length === 0) return [];

  // Single query covering all keys at once using the pre-computed indexed
  // normalized_title column — no per-row REPLACE/UPPER at query time,
  // no serial loop of separate DB calls per key.
  const keyConditions = searchKeys
    .map(() => `a.normalized_title = ? OR a.normalized_title LIKE ? OR ? LIKE a.normalized_title || '%'`)
    .join(" OR ");

  const keyParams = searchKeys.flatMap((key) => [key, `${key}%`, key]);

  const sql = `
    SELECT
      a.atlas_id,
      a.title,
      a.creator,
      a.engine,
      a.version as latestVersion,
      a.short_name,
      a.normalized_title,
      f.f95_id,
      f.site_url as siteUrl,
      lc.lc_id,
      lc.site_url as lewdCornerSiteUrl
    FROM atlas_data a
    LEFT JOIN f95_zone_data f ON f.atlas_id = a.atlas_id
    LEFT JOIN lewdcorner_data lc ON lc.atlas_id = a.atlas_id
    WHERE
      a.title LIKE ?
      OR a.creator LIKE ?
      OR ${keyConditions}
  `;

  const params = [`%${title}%`, `%${creator}%`, ...keyParams];

  const rows = await new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, resultRows) => {
      if (err) reject(err);
      else resolve(resultRows || []);
    });
  });

  const rowsByAtlasId = new Map();
  for (const row of rows) {
    const score = scoreAtlasSearchRow(row, searchKeys, title, creator);
    if (score < 650) continue;

    const existing = rowsByAtlasId.get(row.atlas_id);
    if (!existing || score > existing._matchScore) {
      rowsByAtlasId.set(row.atlas_id, {
        ...row,
        f95_id: row.f95_id || "",
        difference: Math.abs(
          normalizeSearchKey(row.short_name || row.title).length - searchKeys[0].length,
        ),
        _matchScore: score,
      });
    }
  }

  return Array.from(rowsByAtlasId.values())
    .sort((a, b) => b._matchScore - a._matchScore || a.difference - b.difference)
    .slice(0, 12)
    .map(({ _matchScore, short_name, normalized_title, ...row }) => row);
};

const findF95Id = (atlasId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT f95_id FROM f95_zone_data WHERE atlas_id = ?`,
      [atlasId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.f95_id : null);
      },
    );
  });
};

const GetAtlasIDbyRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT atlas_id FROM atlas_mappings WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.atlas_id : null);
      },
    );
  });
};

const addAtlasMapping = (recordId, atlasId) => {
  return new Promise((resolve, reject) => {
    console.log("Updating Atlas Mapping");
    // Validate inputs
    if (!recordId || !atlasId) {
      const error = new Error(
        `Invalid input: recordId=${recordId}, atlasId=${atlasId}`,
      );
      console.error("addAtlasMapping error:", error.message);
      return reject(error);
    }

    // Check if record_id exists in games
    getDb().get(
      `SELECT record_id FROM games WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) {
          console.error("Error checking games table:", err);
          return reject(err);
        }
        if (!row) {
          const error = new Error(
            `record_id ${recordId} does not exist in games table`,
          );
          console.error("addAtlasMapping error:", error.message);
          return reject(error);
        }

        // Check if atlas_id exists in atlas_data
        getDb().get(
          `SELECT atlas_id FROM atlas_data WHERE atlas_id = ?`,
          [atlasId],
          (err, row) => {
            if (err) {
              console.error("Error checking atlas_data table:", err);
              return reject(err);
            }
            if (!row) {
              const error = new Error(
                `atlas_id ${atlasId} does not exist in atlas_data table`,
              );
              console.error("addAtlasMapping error:", error.message);
              return reject(error);
            }

            // Determine whether this remaps to a DIFFERENT atlas_id than
            // before. If so, any explicit per-record source mappings
            // (lewdcorner/f95/steam) from the PREVIOUS mapping are now stale
            // and must be cleared — otherwise banner/screen/metadata joins keep
            // resolving old source rows (e.g. the old LewdCorner banner) that
            // override the new atlas_id's natural joins. See getRemoteBannerUrl,
            // which joins lewdcorner_mappings by record_id.
            getDb().get(
              `SELECT atlas_id FROM atlas_mappings WHERE record_id = ?`,
              [recordId],
              (prevErr, prevRow) => {
                if (prevErr) {
                  console.error("Error reading existing atlas mapping:", prevErr);
                  return reject(prevErr);
                }
                const changed = !prevRow || Number(prevRow.atlas_id) !== Number(atlasId);

                const writeMapping = () => {
                  getDb().run(
                    `INSERT OR REPLACE INTO atlas_mappings (record_id, atlas_id) VALUES (?, ?)`,
                    [recordId, atlasId],
                    (err) => {
                      if (err) {
                        console.error("Error inserting into atlas_mappings:", err);
                        return reject(err);
                      }
                      resolve();
                    },
                  );
                };

                if (!changed) {
                  writeMapping();
                  return;
                }

                // Clear stale per-record source overrides tied to the old
                // mapping, then write the new atlas mapping.
                getDb().serialize(() => {
                  getDb().run(`DELETE FROM lewdcorner_mappings WHERE record_id = ?`, [recordId], (e) => {
                    if (e) console.warn("Failed clearing stale lewdcorner_mappings:", e.message);
                  });
                  getDb().run(`DELETE FROM f95_zone_mappings WHERE record_id = ?`, [recordId], (e) => {
                    if (e) console.warn("Failed clearing stale f95_zone_mappings:", e.message);
                  });
                  getDb().run(`DELETE FROM steam_mappings WHERE record_id = ?`, [recordId], (e) => {
                    if (e) console.warn("Failed clearing stale steam_mappings:", e.message);
                  });
                  writeMapping();
                });
              },
            );
          },
        );
      },
    );
  });
};

const getAtlasData = (atlasId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT
        a.title,
        a.creator,
        a.engine,
        a.version as latestVersion,
        f.f95_id,
        f.site_url as siteUrl,
        lc.lc_id,
        lc.site_url as lewdCornerSiteUrl
      FROM atlas_data a
      LEFT JOIN f95_zone_data f ON a.atlas_id = f.atlas_id
      LEFT JOIN lewdcorner_data lc ON a.atlas_id = lc.atlas_id
      WHERE a.atlas_id = ?`,
      [atlasId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      },
    );
  });
};

const updateTableColumns = {
  atlas_data: new Set([
    "atlas_id",
    "id_name",
    "short_name",
    "title",
    "original_name",
    "category",
    "engine",
    "status",
    "version",
    "developer",
    "creator",
    "overview",
    "censored",
    "language",
    "translations",
    "genre",
    "tags",
    "voice",
    "os",
    "release_date",
    "length",
    "banner",
    "banner_wide",
    "cover",
    "logo",
    "wallpaper",
    "previews",
    "external_ids",
    "last_record_update",
    "edited",
    "edited_at",
    "edited_by",
  ]),
  f95_zone_data: new Set([
    "f95_id",
    "atlas_id",
    "banner_url",
    "site_url",
    "last_thread_comment",
    "thread_updated",
    "thread_publish_date",
    "last_record_update",
    "views",
    "likes",
    "tags",
    "rating",
    "screens",
    "downloads",
    "patches",
    "extras",
    "translations",
    "replies",
    "f95_latest_order",
    "floating",
  ]),
  lewdcorner_data: new Set([
    "lc_id",
    "atlas_id",
    "banner_url",
    "site_url",
    "register_date",
    "thread_updated",
    "last_record_update",
    "tier",
    "prefixes",
    "views",
    "likes",
    "tags",
    "rating",
    "screens",
    "downloads",
    "floating",
  ]),
};

const getImportRecordStatus = (game) => {
  const gamePath = String(game.folder || game.game_path || "").trim();
  const selectedValue = String(game.selectedValue || "").trim();
  const selectedExecPath =
    gamePath && selectedValue ? path.join(gamePath, selectedValue) : "";
  const atlasId = game.atlasId || game.atlas_id || null;
  const lcId = game.lcId || game.lc_id || game.lewdCornerId || game.lewdcornerId || null;
  const version = String(game.version || "").trim();

  const normalizeImportVersion = (value) =>
    String(value || "")
      .trim()
      .replace(/^v/i, "")
      .toLowerCase();

  const statusForVersionRow = (row, exactPath = false) => {
    const storedExecPath = String(row.exec_path || "");
    const storedExecValid = storedExecPath && fs.existsSync(storedExecPath);
    const selectedExecValid = selectedExecPath && fs.existsSync(selectedExecPath);
    const selectedDiffers =
      exactPath &&
      selectedExecValid &&
      normalizePathForCompare(selectedExecPath) !==
        normalizePathForCompare(storedExecPath);

    return {
      status: !storedExecValid || selectedDiffers ? "repairPath" : "alreadyImported",
      recordId: row.record_id,
      exactPath,
    };
  };

  return new Promise((resolve, reject) => {
    const steamId = game.steamId || game.steam_id || null;

    const resolveStatusForRecord = (recordId, missingVersionStatus, { steam = false } = {}) => {
      if (!recordId) {
        resolve({ status: "new", recordId: null, exactPath: false });
        return;
      }
      getDb().all(
        `SELECT record_id, version, exec_path FROM versions WHERE record_id = ?`,
        [recordId],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          const matchingVersion = version
            ? (rows || []).find(
                (row) =>
                  normalizeImportVersion(row.version) ===
                  normalizeImportVersion(version),
              )
            : null;
          if (matchingVersion) {
            resolve(
              steam
                ? { status: "alreadyImported", recordId, exactPath: false }
                : statusForVersionRow(matchingVersion, false),
            );
            return;
          }
          resolve({ status: missingVersionStatus, recordId, exactPath: false });
        },
      );
    };

    // Steam games launch via steam:// and store a placeholder exec_path, so the
    // file-based path/exec checks below never apply to them — running those is
    // what made every already-imported Steam game look like "repairPath".
    // Resolve purely by appid instead: a direct steam_mapping means it's already
    // in the library; an Atlas/f95 record listing the appid is a merge target
    // (attach as another version); otherwise it's new.
    if (steamId) {
      resolveBySteamId(steamId);
      return;
    }
    if (lcId && !atlasId) {
      resolveByLewdCornerId(lcId);
      return;
    }

    if (gamePath) {
      getDb().get(
        `SELECT record_id, exec_path FROM versions WHERE game_path = ? LIMIT 1`,
        [gamePath],
        (pathErr, pathRow) => {
          if (pathErr) {
            reject(pathErr);
            return;
          }
          if (pathRow?.record_id) {
            resolve(statusForVersionRow(pathRow, true));
            return;
          }
          resolveByAtlasVersionMatch();
        },
      );
      return;
    }

    resolveByAtlasVersionMatch();

    function resolveBySteamId(sid) {
      getDb().get(
        `SELECT record_id FROM steam_mappings WHERE steam_id = ? LIMIT 1`,
        [sid],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          if (row?.record_id) {
            resolveStatusForRecord(row.record_id, "steamVersion", { steam: true });
            return;
          }
          findRecordBySteamId(sid)
            .then((recordId) => {
              resolveStatusForRecord(recordId, recordId ? "steamVersion" : "new", { steam: true });
            })
            .catch(reject);
        },
      );
    }

    function resolveByLewdCornerId(id) {
      getDb().all(
        `SELECT lm.record_id, v.version, v.exec_path
         FROM lewdcorner_mappings lm
         LEFT JOIN versions v ON v.record_id = lm.record_id
         WHERE lm.lc_id = ?`,
        [id],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          const mappedRecordId = rows?.[0]?.record_id;
          if (mappedRecordId) {
            resolveStatusForRecord(mappedRecordId, "lewdCornerVersion");
            return;
          }
          findRecordByLewdCornerId(id)
            .then((recordId) => {
              resolveStatusForRecord(recordId, recordId ? "lewdCornerVersion" : "new");
            })
            .catch(reject);
        },
      );
    }

    function resolveByAtlasVersionMatch() {
      if (!atlasId || !version) {
        resolveByRecordMatch();
        return;
      }

      getDb().get(
        `SELECT record_id FROM atlas_mappings WHERE atlas_id = ? LIMIT 1`,
        [atlasId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolveStatusForRecord(row?.record_id || null, "new");
        },
      );
    }

    function resolveByRecordMatch() {
      findExistingRecordForImport(game)
        .then((recordId) => {
          if (recordId) {
            resolve({ status: "repairPath", recordId, exactPath: false });
          } else {
            resolve({ status: "new", recordId: null, exactPath: false });
          }
        })
        .catch(reject);
    }
  });
};

function getValidatedUpdateColumns(jsonData, tableName) {
  const allowedColumns = updateTableColumns[tableName];
  if (!allowedColumns) {
    throw new Error(`Unsupported update table: ${tableName}`);
  }

  if (!Array.isArray(jsonData) || jsonData.length === 0) {
    throw new Error(`No update rows supplied for ${tableName}`);
  }

  const columns = Array.from(
    new Set(jsonData.flatMap((row) => Object.keys(row))),
  );
  const invalidColumns = Array.from(
    new Set(
      jsonData.flatMap((row) =>
        Object.keys(row).filter((column) => !allowedColumns.has(column)),
      ),
    ),
  );
  if (invalidColumns.length > 0) {
    // Previously this threw, which aborted the ENTIRE package ingest (atlas +
    // f95 + lewdcorner) for that update — so one unexpected column (e.g. a new
    // server field the client doesn't know yet) could blank all metadata for
    // the whole batch and, since the package is then skipped, keep failing.
    // Instead, drop the unknown columns and write the known ones, so a schema
    // addition on the server degrades gracefully rather than losing data.
    console.warn(
      `insertJsonData: ignoring unexpected column(s) for ${tableName}: ${invalidColumns.join(", ")}`,
    );
    return columns.filter((column) => allowedColumns.has(column));
  }

  return columns;
}

const INSERT_CHUNK_SIZE = 500;

const insertJsonData = async (jsonData, tableName) => {
  const rows = Array.isArray(jsonData) ? jsonData : [];
  if (rows.length === 0) return;

  // Validate/derive the column set from the payload (throws on malformed data).
  const columns = getValidatedUpdateColumns(jsonData, tableName);

  // For atlas rows, compute normalized_title in JS using the SAME normalizer the
  // import matcher uses (normalizeSearchKey). The stored column was historically
  // computed by a SQL expression that only stripped a few ASCII punctuation
  // chars and did NOT strip accents/diacritics — so for titles with accented or
  // non-Latin characters (common for non-English-region users) the SQL value
  // and the JS match key DIVERGED, the import title match silently failed, the
  // game never linked to its atlas row, and atlas metadata (version, last
  // update, status, etc.) showed blank. Computing it here in JS keeps the stored
  // key identical to the match key and also avoids the "NULL until next app
  // start" gap (the old SQL migration only populated NULLs at startup).
  const isAtlas = tableName === 'atlas_data';
  const writeColumns = isAtlas && !columns.includes('normalized_title')
    ? [...columns, 'normalized_title']
    : columns;
  const valueForColumn = (item, column) => {
    if (isAtlas && column === 'normalized_title') {
      return normalizeSearchKey(item.short_name || item.title || '');
    }
    return item[column];
  };

  // Primary key per update table. The upsert conflict target and the column we
  // must never coalesce-away (it identifies the row).
  const primaryKeyByTable = {
    atlas_data: 'atlas_id',
    f95_zone_data: 'f95_id',
    lewdcorner_data: 'lc_id',
  };
  const pk = primaryKeyByTable[tableName];

  // Previously this used INSERT OR REPLACE, which DELETES the existing row and
  // re-inserts using only the payload's columns — so any column absent from the
  // payload, or present but NULL/empty, WIPED the locally-stored value. That
  // silently blanked metadata (e.g. Steam publisher/overview) that was fine
  // before. Instead upsert and, on conflict, only overwrite when the incoming
  // value is actually present: COALESCE(NULLIF(excluded.col,''), col) keeps the
  // existing value when the server sends '' or NULL. The primary key and
  // last_record_update always take the incoming value.
  let insertSql;
  if (pk && writeColumns.includes(pk)) {
    const updateAssignments = writeColumns
      .filter((col) => col !== pk)
      .map((col) => {
        if (col === 'last_record_update') {
          return `${col} = excluded.${col}`;
        }
        // normalized_title is JS-derived from title/short_name; always refresh it
        // to the freshly-computed value so it can't drift from those columns.
        if (col === 'normalized_title') {
          return `${col} = excluded.${col}`;
        }
        return `${col} = COALESCE(NULLIF(excluded.${col}, ''), ${tableName}.${col})`;
      })
      .join(', ');
    insertSql = `INSERT INTO ${tableName} (${writeColumns.join(', ')}) VALUES (${writeColumns
      .map(() => '?')
      .join(', ')}) ON CONFLICT(${pk}) DO UPDATE SET ${updateAssignments}`;
  } else {
    // Fallback for tables without a known PK: keep prior behavior.
    insertSql = `INSERT OR REPLACE INTO ${tableName} (${writeColumns.join(
      ', ',
    )}) VALUES (${writeColumns.map(() => '?').join(', ')})`;
  }

  const writeChunk = (chunk) =>
    new Promise((resolve, reject) => {
      const db = getDb();
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(insertSql);
        let failed = null;
        for (const item of chunk) {
          stmt.run(
            writeColumns.map((column) => valueForColumn(item, column)),
            (err) => {
              if (err && !failed) failed = err;
            },
          );
        }
        stmt.finalize((finalizeErr) => {
          const err = failed || finalizeErr;
          if (err) {
            db.run("ROLLBACK", () => reject(err));
          } else {
            db.run("COMMIT", (commitErr) =>
              commitErr ? reject(commitErr) : resolve(),
            );
          }
        });
      });
    });

  // Process in bounded chunks, yielding the event loop between commits. On the
  // single shared sqlite connection this lets renderer reads (games, previews,
  // banners) that arrive mid-update execute between chunks instead of waiting
  // for the whole snapshot to commit — which is what froze the UI.
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
    await writeChunk(rows.slice(start, start + INSERT_CHUNK_SIZE));
    await new Promise((resolve) => setImmediate(resolve));
  }

  resetCachedFilterOptions();
};

const searchAtlasByF95Id = (f95Id) => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT
        a.atlas_id,
        f.f95_id,
        f.site_url as siteUrl,
        a.title,
        a.creator,
        a.engine,
        a.version as latestVersion
       FROM atlas_data a
        LEFT JOIN f95_zone_data f ON a.atlas_id = f.atlas_id WHERE f.f95_id =?`,
      [f95Id],
      (err, rows) => {
        if (err) {
          console.error(`Error querying atlas_data for f95_id ${f95Id}:`, err);
          reject(err);
        } else {
          console.log(`Found ${rows.length} results for f95_id ${f95Id}`);
          resolve(rows || []);
        }
      },
    );
  });
};

// One-time (idempotent) repair: recompute normalized_title for ALL atlas rows
// in JS, so existing rows whose key was computed by the old SQL expression
// (which didn't strip accents/diacritics and diverged from the import matcher)
// get corrected. Without this, a user in a non-English region whose titles have
// accented/non-Latin characters keeps failing to match imports to atlas rows,
// leaving atlas metadata blank. Safe to run on every startup; it only rewrites
// rows whose stored key differs from the freshly-computed one.
const recomputeNormalizedTitles = () =>
  new Promise((resolve) => {
    const db = getDb();
    db.all(
      `SELECT atlas_id, short_name, title, normalized_title FROM atlas_data`,
      [],
      (err, rows) => {
        if (err) {
          console.error('recomputeNormalizedTitles: read failed:', err.message);
          resolve({ checked: 0, fixed: 0 });
          return;
        }
        const toFix = [];
        for (const row of rows || []) {
          const correct = normalizeSearchKey(row.short_name || row.title || '');
          if ((row.normalized_title || '') !== correct) {
            toFix.push({ atlas_id: row.atlas_id, normalized_title: correct });
          }
        }
        if (toFix.length === 0) {
          resolve({ checked: (rows || []).length, fixed: 0 });
          return;
        }
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          const stmt = db.prepare(
            `UPDATE atlas_data SET normalized_title = ? WHERE atlas_id = ?`,
          );
          for (const r of toFix) stmt.run([r.normalized_title, r.atlas_id]);
          stmt.finalize(() => {
            db.run('COMMIT', () => {
              console.log(
                `recomputeNormalizedTitles: fixed ${toFix.length}/${(rows || []).length} atlas rows`,
              );
              resolve({ checked: (rows || []).length, fixed: toFix.length });
            });
          });
        });
      },
    );
  });

module.exports = {
  searchAtlas,
  searchAtlasExact,
  findF95Id,
  GetAtlasIDbyRecord,
  addAtlasMapping,
  getAtlasData,
  getImportRecordStatus,
  insertJsonData,
  searchAtlasByF95Id,
  recomputeNormalizedTitles,
}
