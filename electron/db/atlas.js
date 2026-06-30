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

const searchAtlas = async (title, creator) => {
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

            // Insert or ignore mapping
            getDb().run(
              `INSERT OR REPLACE INTO atlas_mappings (record_id, atlas_id) VALUES (?, ?)`,
              [recordId, atlasId],
              (err) => {
                if (err) {
                  console.error("Error inserting into atlas_mappings:", err);
                  reject(err);
                } else {
                  resolve();
                }
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
            resolve({
              status: "alreadyImported",
              recordId: row.record_id,
              exactPath: false,
            });
            return;
          }
          findRecordBySteamId(sid)
            .then((recordId) => {
              resolve(
                recordId
                  ? { status: "steamVersion", recordId, exactPath: false }
                  : { status: "new", recordId: null, exactPath: false },
              );
            })
            .catch(reject);
        },
      );
    }

    function resolveByLewdCornerId(id) {
      getDb().get(
        `SELECT record_id FROM lewdcorner_mappings WHERE lc_id = ? LIMIT 1`,
        [id],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          if (row?.record_id) {
            resolve({
              status: "alreadyImported",
              recordId: row.record_id,
              exactPath: false,
            });
            return;
          }
          findRecordByLewdCornerId(id)
            .then((recordId) => {
              resolve(
                recordId
                  ? { status: "lewdCornerVersion", recordId, exactPath: false }
                  : { status: "new", recordId: null, exactPath: false },
              );
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

      getDb().all(
        `SELECT v.record_id, v.version, v.exec_path
         FROM atlas_mappings am
         JOIN versions v ON am.record_id = v.record_id
         WHERE am.atlas_id = ?`,
        [atlasId],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const matchingVersion = (rows || []).find(
            (row) =>
              normalizeImportVersion(row.version) ===
              normalizeImportVersion(version),
          );
          if (matchingVersion) {
            resolve(statusForVersionRow(matchingVersion, false));
            return;
          }

          resolve({ status: "new", recordId: rows?.[0]?.record_id || null, exactPath: false });
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
    throw new Error(
      `Unexpected column(s) for ${tableName}: ${invalidColumns.join(", ")}`,
    );
  }

  return columns;
}

const insertJsonData = async (jsonData, tableName) => {
  return new Promise((resolve, reject) => {
    let columns;
    try {
      columns = getValidatedUpdateColumns(jsonData, tableName);
    } catch (err) {
      reject(err);
      return;
    }

    getDb().serialize(() => {
      getDb().run("BEGIN TRANSACTION");
      const stmt = getDb().prepare(
        `INSERT OR REPLACE INTO ${tableName} (${columns.join(", ")}) VALUES (${columns
          .map(() => "?")
          .join(", ")})`,
      );
      for (const item of jsonData) {
        stmt.run(columns.map((column) => item[column]), (err) => {
          if (err) {
            getDb().run("ROLLBACK");
            reject(err);
          }
        });
      }
      stmt.finalize((err) => {
        if (err) {
          getDb().run("ROLLBACK");
          reject(err);
        } else {
          getDb().run("COMMIT", (err) => {
            if (err) reject(err);
            else {
              resetCachedFilterOptions();
              resolve();
            }
          });
        }
      });
    });
  });
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

module.exports = {
  searchAtlas,
  findF95Id,
  GetAtlasIDbyRecord,
  addAtlasMapping,
  getAtlasData,
  getImportRecordStatus,
  insertJsonData,
  searchAtlasByF95Id,
}
