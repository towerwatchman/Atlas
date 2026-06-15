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
const { resetCachedFilterOptions } = require('./games')

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });


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
      f.f95_id
    FROM atlas_data a
    LEFT JOIN f95_zone_data f ON f.atlas_id = a.atlas_id
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

const addF95ZoneMapping = async (recordId, f95Id) => {
  const normalizedF95Id = String(f95Id || "").trim();
  if (!recordId || !normalizedF95Id) return;

  await dbRun("DELETE FROM f95_zone_mappings WHERE record_id = ?", [recordId]);
  await dbRun(
    "INSERT INTO f95_zone_mappings (record_id, f95_id) VALUES (?, ?)",
    [recordId, normalizedF95Id],
  );
};

const normalizeSourceId = (value) => String(value || "").trim();

const resolveAtlasIdsByF95Id = async (f95Id) => {
  const rows = await dbAll(
    `SELECT f.atlas_id
     FROM f95_zone_data f
     JOIN atlas_data a ON a.atlas_id = f.atlas_id
     WHERE f.f95_id = ?`,
    [f95Id],
  );
  return Array.from(new Set(rows.map((row) => row.atlas_id).filter(Boolean)));
};

const hasMatchingSteamExternalId = (value, steamId) => {
  const target = normalizeSourceId(steamId);
  const steamKeys = new Set([
    "steam",
    "steam_id",
    "steamid",
    "steam_appid",
    "appid",
  ]);
  const providerKeys = new Set(["provider", "source", "name", "type", "site"]);
  const idKeys = new Set(["id", "value", "steam_id", "steamid", "steam_appid", "appid"]);

  const primitiveMatches = (candidate) => normalizeSourceId(candidate) === target;

  const inspect = (candidate) => {
    if (candidate === null || candidate === undefined) return false;

    if (Array.isArray(candidate)) {
      return candidate.some(inspect);
    }

    if (typeof candidate === "object") {
      for (const [key, nestedValue] of Object.entries(candidate)) {
        const normalizedKey = String(key || "").toLowerCase();
        if (steamKeys.has(normalizedKey) && primitiveMatches(nestedValue)) {
          return true;
        }
      }

      const mentionsSteam = Object.entries(candidate).some(([key, nestedValue]) => {
        const normalizedKey = String(key || "").toLowerCase();
        return (
          providerKeys.has(normalizedKey) &&
          String(nestedValue || "").toLowerCase().includes("steam")
        );
      });
      if (
        mentionsSteam &&
        Object.entries(candidate).some(([key, nestedValue]) =>
          idKeys.has(String(key || "").toLowerCase()) && primitiveMatches(nestedValue),
        )
      ) {
        return true;
      }

      return Object.values(candidate).some(inspect);
    }

    return false;
  };

  return inspect(value);
};

const parseExternalIds = (externalIds) => {
  if (!externalIds) return null;
  if (typeof externalIds !== "string") return externalIds;

  try {
    return JSON.parse(externalIds);
  } catch {
    return null;
  }
};

const resolveAtlasIdsBySteamId = async (steamId, externalRows) => {
  const directRows = await dbAll(
    `SELECT s.atlas_id
     FROM steam_data s
     JOIN atlas_data a ON a.atlas_id = s.atlas_id
     WHERE s.steam_id = ?
       AND s.atlas_id IS NOT NULL
       AND TRIM(CAST(s.atlas_id AS TEXT)) <> ''`,
    [steamId],
  );

  const resolved = new Set(directRows.map((row) => row.atlas_id).filter(Boolean));
  for (const row of externalRows) {
    if (hasMatchingSteamExternalId(parseExternalIds(row.external_ids), steamId)) {
      resolved.add(row.atlas_id);
    }
  }

  return Array.from(resolved);
};

const refreshAtlasMappingsFromSources = async (options = {}) => {
  const result = {
    success: true,
    processed: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    missingSource: 0,
    missingAtlas: 0,
    conflicts: 0,
    f95Resolved: 0,
    steamResolved: 0,
    details: [],
    errors: [],
  };

  const rows = await dbAll(
    `SELECT
       g.record_id,
       g.title,
       g.creator,
       am.atlas_id AS old_atlas_id,
       explicit_f95.f95_id AS explicit_f95_id,
       explicit_f95.f95_id_count AS explicit_f95_id_count,
       sm.steam_id AS steam_id
     FROM games g
     JOIN atlas_mappings am ON am.record_id = g.record_id
     LEFT JOIN (
       SELECT
         record_id,
         MIN(f95_id) AS f95_id,
         COUNT(DISTINCT f95_id) AS f95_id_count
       FROM f95_zone_mappings
       GROUP BY record_id
     ) explicit_f95 ON explicit_f95.record_id = g.record_id
     LEFT JOIN steam_mappings sm ON sm.record_id = g.record_id
     ORDER BY g.record_id`,
  );
  const steamExternalRows = await dbAll(
    `SELECT atlas_id, external_ids
     FROM atlas_data
     WHERE external_ids IS NOT NULL
       AND TRIM(CAST(external_ids AS TEXT)) <> ''`,
  );

  await dbRun("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const row of rows) {
      result.processed += 1;

      try {
        const detail = {
          recordId: row.record_id,
          title: row.title || "",
          oldAtlasId: row.old_atlas_id,
          newAtlasId: null,
          source: "",
          status: "",
          f95Id: normalizeSourceId(row.explicit_f95_id),
          steamId: normalizeSourceId(row.steam_id),
          reason: "",
        };

        if (Number(row.explicit_f95_id_count || 0) > 1) {
          result.skipped += 1;
          result.conflicts += 1;
          detail.status = "conflict";
          detail.reason = "Multiple F95 source IDs found for this record";
          result.details.push(detail);
          result.errors.push({
            recordId: row.record_id,
            error: detail.reason,
          });
          continue;
        }

        const f95Id = detail.f95Id;
        const steamId = detail.steamId;
        const f95AtlasIds = f95Id ? await resolveAtlasIdsByF95Id(f95Id) : [];
        const steamAtlasIds = steamId
          ? await resolveAtlasIdsBySteamId(steamId, steamExternalRows)
          : [];
        const f95AtlasId = f95AtlasIds.length === 1 ? f95AtlasIds[0] : null;
        const steamAtlasId = steamAtlasIds.length === 1 ? steamAtlasIds[0] : null;
        let resolvedAtlasId = null;
        let source = "";

        if (!f95Id && !steamId) {
          result.missingSource += 1;
          result.skipped += 1;
          detail.status = "missing-source";
          detail.reason = "No saved F95ID or SteamID";
          result.details.push(detail);
          continue;
        }

        if (f95AtlasIds.length > 1 || steamAtlasIds.length > 1) {
          result.skipped += 1;
          result.conflicts += 1;
          detail.status = "conflict";
          detail.reason = "Source ID resolved to more than one AtlasID";
          result.details.push(detail);
          continue;
        }

        if (f95AtlasId && steamAtlasId && String(f95AtlasId) !== String(steamAtlasId)) {
          result.skipped += 1;
          result.conflicts += 1;
          detail.status = "conflict";
          detail.reason = "F95ID and SteamID resolve to different AtlasIDs";
          detail.newAtlasId = `${f95AtlasId} / ${steamAtlasId}`;
          result.details.push(detail);
          continue;
        }

        if (f95AtlasId && steamAtlasId) {
          resolvedAtlasId = f95AtlasId;
          source = "f95+steam";
          result.f95Resolved += 1;
          result.steamResolved += 1;
        } else if (f95AtlasId) {
          resolvedAtlasId = f95AtlasId;
          source = "f95";
          result.f95Resolved += 1;
        } else if (steamAtlasId) {
          resolvedAtlasId = steamAtlasId;
          source = "steam";
          result.steamResolved += 1;
        }

        if (!resolvedAtlasId) {
          result.missingAtlas += 1;
          result.skipped += 1;
          detail.status = "missing-atlas";
          detail.reason = "Saved source ID did not resolve to current Atlas metadata";
          result.details.push(detail);
          continue;
        }

        detail.newAtlasId = resolvedAtlasId;
        detail.source = source;

        if (String(resolvedAtlasId) === String(row.old_atlas_id || "")) {
          result.unchanged += 1;
          detail.status = "unchanged";
          result.details.push(detail);
          continue;
        }

        await dbRun(
          `INSERT INTO atlas_mappings (record_id, atlas_id) VALUES (?, ?)
           ON CONFLICT(record_id) DO UPDATE SET atlas_id = excluded.atlas_id`,
          [row.record_id, resolvedAtlasId],
        );
        result.updated += 1;
        detail.status = "updated";
        result.details.push(detail);
      } catch (err) {
        result.skipped += 1;
        result.details.push({
          recordId: row.record_id,
          title: row.title || "",
          oldAtlasId: row.old_atlas_id,
          newAtlasId: null,
          source: "",
          status: "error",
          f95Id: normalizeSourceId(row.explicit_f95_id),
          steamId: normalizeSourceId(row.steam_id),
          reason: err.message,
        });
        result.errors.push({
          recordId: row.record_id,
          error: err.message,
        });
      }
    }

    await dbRun("COMMIT");
  } catch (err) {
    await dbRun("ROLLBACK").catch(() => {});
    throw err;
  }

  if (options.includeDetails === false) {
    result.details = [];
  }

  return result;
};

const getAtlasData = (atlasId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT
        a.title,
        a.creator,
        a.engine,
        a.version as latestVersion,
        f.f95_id
      FROM atlas_data a
      LEFT JOIN f95_zone_data f ON a.atlas_id = f.atlas_id
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
  ]),
};

const getImportRecordStatus = (game) => {
  const gamePath = String(game.folder || game.game_path || "").trim();
  const selectedValue = String(game.selectedValue || "").trim();
  const selectedExecPath =
    gamePath && selectedValue ? path.join(gamePath, selectedValue) : "";
  const atlasId = game.atlasId || game.atlas_id || null;
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
  addF95ZoneMapping,
  refreshAtlasMappingsFromSources,
  getAtlasData,
  getImportRecordStatus,
  insertJsonData,
  searchAtlasByF95Id,
}
