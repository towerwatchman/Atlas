'use strict'

const path = require('path')
const fs = require('fs')
const fsPromises = fs.promises
const dbModule = require('./index')
const getDb = () => dbModule.db
const { toLocalAssetPath, normalizeMediaStorageMode, remoteBannerExpression,
        buildBannerJoinClauses, buildBannerSelectFields, getAssetBasePath } = require('./helpers')
const { calculatePathSize } = require('../pathSize')
const { effectiveTitlePlaystate } = require('./playstates')

const localMediaAssetSelect = (baseImagePath, assetType, fallbackExpression) => {
  const safeBaseImagePath = String(baseImagePath || '').replace(/'/g, "''");
  const safeAssetType = String(assetType || '').replace(/'/g, "''");
  return `COALESCE(
          (
            SELECT REPLACE('${safeBaseImagePath}/' || media_assets.path, '\\', '/')
            FROM media_assets
            WHERE media_assets.record_id = games.record_id
              AND media_assets.asset_type = '${safeAssetType}'
            ORDER BY media_assets.created_at DESC
            LIMIT 1
          ),
          ${fallbackExpression}
        )`;
};

const getTableColumns = (tableName) =>
  new Promise((resolve) => {
    getDb().all(`PRAGMA table_info(${tableName})`, (err, rows) => {
      if (err || !Array.isArray(rows)) {
        resolve(new Set())
        return
      }
      resolve(new Set(rows.map((row) => row.name)))
    })
  })

const normalizePersonalRating = (value) => {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const getPersonalRatingOverall = (row = {}) => {
  const values = [
    normalizePersonalRating(row.personal_rating_story),
    normalizePersonalRating(row.personal_rating_graphics),
    normalizePersonalRating(row.personal_rating_gameplay),
    normalizePersonalRating(row.personal_rating_fappability),
  ].filter((value) => value !== null)
  if (values.length === 0) return null
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.round(average * 10) / 10
}

const applyPersonalRatings = (game, row = {}) => ({
  ...game,
  personalRatingStory: normalizePersonalRating(row.personal_rating_story),
  personalRatingGraphics: normalizePersonalRating(row.personal_rating_graphics),
  personalRatingGameplay: normalizePersonalRating(row.personal_rating_gameplay),
  personalRatingFappability: normalizePersonalRating(row.personal_rating_fappability),
  personalRatingOverall: getPersonalRatingOverall(row),
  personalRatingUpdatedAt: normalizePersonalRating(row.personal_rating_updated_at),
})

const DEFAULT_LAUNCHABLE_EXTENSIONS = [
  "exe",
  "swf",
  "flv",
  "f4v",
  "rag",
  "cmd",
  "bat",
  "jar",
  "html",
];

const LAUNCHABLE_NAME_BLACKLIST = new Set([
  "unitycrashhandler.exe",
  "unitycrashhandler64.exe",
  "unitycrashhandler32.exe",
  "unins000.exe",
  "uninstall.exe",
  "uninst.exe",
  "python.exe",
  "pythonw.exe",
]);

function normalizePathForCompare(value) {
  return path.normalize(String(value || "")).toLowerCase();
}

function normalizeExtensions(extensions = DEFAULT_LAUNCHABLE_EXTENSIONS) {
  return new Set(
    extensions
      .map((ext) => String(ext || "").trim().replace(/^\./, "").toLowerCase())
      .filter(Boolean),
  );
}

function isLaunchableFile(filePath, allowedExtensions) {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  return allowedExtensions.has(ext) && !LAUNCHABLE_NAME_BLACKLIST.has(base);
}

function findLaunchablesInFolder(rootPath, extensions) {
  if (!rootPath || !fs.existsSync(rootPath)) return [];

  const allowedExtensions = normalizeExtensions(extensions);
  const results = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && isLaunchableFile(fullPath, allowedExtensions)) {
        results.push(path.relative(rootPath, fullPath));
      }
    }
  }

  return results.sort((a, b) => {
    const depthDiff = a.split(path.sep).length - b.split(path.sep).length;
    if (depthDiff !== 0) return depthDiff;
    const extRank = (candidate) => {
      const ext = path.extname(candidate).replace(/^\./, "").toLowerCase();
      if (ext === "exe") return 0;
      if (ext === "html") return 1;
      return 2;
    };
    const rankDiff = extRank(a) - extRank(b);
    return rankDiff || a.localeCompare(b);
  });
}

function chooseLaunchableForRepair(gamePath, staleExecPath, extensions) {
  const launchables = findLaunchablesInFolder(gamePath, extensions);
  if (launchables.length === 0) return null;

  const staleBase = path.basename(String(staleExecPath || "")).toLowerCase();
  if (staleBase) {
    const matchingName = launchables.find(
      (candidate) => path.basename(candidate).toLowerCase() === staleBase,
    );
    if (matchingName) return matchingName;
  }

  return launchables[0];
}

const resolveVersionSize = async (game, gamePath) => {
  if (game.deferFolderSizeCalculation === true) return null;
  const existingSize = Number(game.folderSize ?? game.folder_size ?? 0);
  if (Number.isFinite(existingSize) && existingSize > 0) return existingSize;
  if (!gamePath) return null;
  const result = await calculatePathSize(gamePath);
  if (result.errors?.length) {
    console.warn(`Size calculation skipped some entries for ${gamePath}:`, result.errors);
  }
  return result.missing ? null : result.sizeBytes || 0;
};

function normalizeVersionName(value, fallback = "Unknown") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

async function getUniqueVersionName(recordId, value, { excludeRowId = null } = {}) {
  const base = normalizeVersionName(value);
  let candidate = base;
  let counter = 2;

  while (true) {
    const params = [recordId, candidate];
    let excludeClause = "";
    if (excludeRowId) {
      excludeClause = " AND rowid != ?";
      params.push(excludeRowId);
    }
    const existing = await dbGet(
      `SELECT rowid FROM versions WHERE record_id = ? AND version = ?${excludeClause} LIMIT 1`,
      params,
    );
    if (!existing) return candidate;
    candidate = `${base} (${counter})`;
    counter += 1;
  }
}

const addVersion = async (game, recordId) => {
  const { folder, executables, folderSize = 0 } = game;
  const version = await getUniqueVersionName(recordId, game.version);
  const executable =
    game.execPath ||
    game.exec_path ||
    (executables && executables.length > 0 ? path.join(String(folder || ""), executables[0].value) : "");
  const gamePath = String(folder || "");
  const execPath = executable || "";
  const dateAdded = Math.floor(Date.now() / 1000);
  const calculatedSize = folderSize > 0 ? folderSize : await resolveVersionSize(game, gamePath);
  const source = game.source ? String(game.source) : null;
  const sourceAppId = game.sourceAppId != null ? String(game.sourceAppId) : (game.source_app_id != null ? String(game.source_app_id) : null);

  console.log("adding version");
  return new Promise((resolve, reject) => {
    getDb().run(
      `INSERT INTO versions (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size, source, source_app_id) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      [
        recordId,
        version,
        gamePath,
        execPath,
        true,
        dateAdded,
        calculatedSize,
        source,
        sourceAppId,
      ],
      (err) => {
        if (err) {
          console.error("Error adding or updating version:", err);
          reject(err);
        } else {
          resolve({ version });
        }
      },
    );
  });
};

const upsertVersion = async (game, recordId) => {
  const version = normalizeVersionName(game.version);
  const folder = String(game.folder || game.game_path || "");
  const executable =
    game.execPath ||
    game.exec_path ||
    (game.selectedValue ? path.join(folder, game.selectedValue) : "");
  const folderSize = await resolveVersionSize(game, folder);
  const dateAdded = Math.floor(Date.now() / 1000);
  const source = game.source ? String(game.source) : null;
  const sourceAppId = game.sourceAppId != null ? String(game.sourceAppId) : (game.source_app_id != null ? String(game.source_app_id) : null);

  return new Promise((resolve, reject) => {
    const writeVersion = () => {
      getDb().run(
        `INSERT INTO versions
         (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size, source, source_app_id)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
         ON CONFLICT(record_id, version) DO UPDATE SET
           game_path = excluded.game_path,
           exec_path = excluded.exec_path,
           in_place = excluded.in_place,
           folder_size = COALESCE(excluded.folder_size, versions.folder_size),
           -- Keep the existing source tag if this upsert didn't supply one, so a
           -- plain path re-sync doesn't wipe a version's provider identity.
           source = COALESCE(excluded.source, versions.source),
           source_app_id = COALESCE(excluded.source_app_id, versions.source_app_id),
           -- New content replacing a finished version reverts it to "played"
           -- (per issue #245). Only demote when the actual build path/exe
           -- changes — a plain re-scan of the same paths keeps "finished".
           playstate = CASE
             WHEN versions.playstate = 'finished'
               AND (versions.game_path IS NOT excluded.game_path
                    OR versions.exec_path IS NOT excluded.exec_path)
             THEN 'played'
             ELSE versions.playstate
           END`,
        [recordId, version, folder, executable, true, dateAdded, folderSize, source, sourceAppId],
        (err) => {
          if (err) {
            console.error("Error upserting version:", err);
            reject(err);
          } else {
            resolve({ version });
          }
        },
      );
    };

    if (!folder) {
      writeVersion();
      return;
    }

    getDb().get(
      `SELECT rowid FROM versions WHERE game_path = ? LIMIT 1`,
      [folder],
      (pathErr, row) => {
        if (pathErr) {
          reject(pathErr);
          return;
        }
        if (!row?.rowid) {
          writeVersion();
          return;
        }

        getUniqueVersionName(recordId, version, { excludeRowId: row.rowid })
          .then((safeVersion) => {
            getDb().run(
              `UPDATE versions
               SET record_id = ?, version = ?, exec_path = ?, in_place = ?, folder_size = COALESCE(?, folder_size)
               WHERE rowid = ?`,
              [recordId, safeVersion, executable, true, folderSize, row.rowid],
              (err) => {
                if (err) {
                  console.error("Error repairing version by exact path:", err);
                  reject(err);
                } else {
                  resolve();
                }
              },
            );
          })
          .catch(reject);
      },
    );
  });
};

const updateVersion = (version, record_id) => {
  const previousVersion = version.previousVersion || version.version;
  const versionId = Number(version.version_id || version.versionId || 0);
  const nextVersionName = normalizeVersionName(version.version, "");

  console.log("updating version with id:", record_id);
  return new Promise((resolve, reject) => {
    if (!nextVersionName) {
      reject(new Error("Version name is required"));
      return;
    }

    const applyUpdate = () => {
      const params = [
        nextVersionName,
        version.game_path,
        version.exec_path,
        record_id,
      ];
      const identityClause = versionId > 0 ? "rowid = ?" : "version = ?";
      params.push(versionId > 0 ? versionId : previousVersion);

      getDb().run(
        `UPDATE versions SET version = ?, game_path = ?, exec_path = ?
         WHERE record_id = ? AND ${identityClause}`,
        params,
        function (err) {
          if (err) {
            console.error("Error updating version:", err);
            reject(err);
            return;
          }
          if (this.changes === 0) {
            reject(new Error("Version not found"));
            return;
          }
          resolve({ success: true, changes: this.changes });
        },
      );
    };

    const conflictParams = [record_id, nextVersionName];
    let conflictClause = "";
    if (versionId > 0) {
      conflictClause = " AND rowid != ?";
      conflictParams.push(versionId);
    } else if (previousVersion) {
      conflictClause = " AND version != ?";
      conflictParams.push(previousVersion);
    }

    getDb().get(
      `SELECT rowid FROM versions WHERE record_id = ? AND version = ?${conflictClause} LIMIT 1`,
      conflictParams,
      (conflictErr, existing) => {
        if (conflictErr) {
          reject(conflictErr);
          return;
        }
        if (existing) {
          reject(new Error("A version with this name already exists for this game."));
          return;
        }
        applyUpdate();
      },
    );
  });
};

const findExistingRecordForImport = (game) => {
  const atlasId = game.atlasId || game.atlas_id || null;
  const f95Id = game.f95Id || game.f95_id || null;
  const lcId = game.lcId || game.lc_id || game.lewdCornerId || game.lewdcornerId || null;
  const title = String(game.title || "").trim();
  const creator = String(game.creator || "").trim();
  const version = String(game.version || "").trim();
  const gamePath = String(game.folder || game.game_path || "").trim();

  return new Promise((resolve, reject) => {
    if (gamePath) {
      getDb().get(
        `SELECT record_id FROM versions WHERE game_path = ? LIMIT 1`,
        [gamePath],
        (pathErr, pathRow) => {
          if (pathErr) {
            reject(pathErr);
            return;
          }
          if (pathRow?.record_id) {
            resolve(pathRow.record_id);
            return;
          }
          findByAtlasMapping();
        },
      );
      return;
    }

    findByAtlasMapping();

    function findByAtlasMapping() {
      if (atlasId) {
        getDb().get(
          `SELECT record_id FROM atlas_mappings WHERE atlas_id = ? LIMIT 1`,
          [atlasId],
          (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            if (row?.record_id) {
              resolve(row.record_id);
              return;
            }
            findByF95Mapping();
          },
        );
        return;
      }

      findByF95Mapping();
    }

    function findByF95Mapping() {
      if (f95Id) {
        getDb().get(
          `SELECT record_id FROM f95_zone_mappings WHERE f95_id = ? LIMIT 1`,
          [f95Id],
          (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            if (row?.record_id) {
              resolve(row.record_id);
              return;
            }
            findByLewdCornerMapping();
          },
        );
        return;
      }

      findByLewdCornerMapping();
    }

    function findByLewdCornerMapping() {
      if (lcId) {
        getDb().get(
          `SELECT record_id FROM lewdcorner_mappings WHERE lc_id = ? LIMIT 1`,
          [lcId],
          (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            if (row?.record_id) {
              resolve(row.record_id);
              return;
            }
            findByTitleCreatorVersion();
          },
        );
        return;
      }

      findByTitleCreatorVersion();
    }

    function findByTitleCreatorVersion() {
      if (!title || !creator) {
        resolve(null);
        return;
      }

      const params = [title, creator];
      let versionClause = "";
      if (version) {
        versionClause = ` OR (TRIM(g.title) = ? AND TRIM(g.creator) = ? AND TRIM(v.version) = ?)`;
        params.push(title, creator, version);
      }

      getDb().get(
        `SELECT g.record_id
         FROM games g
         LEFT JOIN versions v ON g.record_id = v.record_id
         WHERE (TRIM(g.title) = ? AND TRIM(g.creator) = ?)${versionClause}
         LIMIT 1`,
        params,
        (err, row) => {
          if (err) reject(err);
          else resolve(row?.record_id || null);
        },
      );
    }
  });
};

// Version comparison lives in a standalone, dependency-free module so it can be
// unit-tested without sqlite. See electron/utils/versionCompare.js for the full
// rationale and the scheme hierarchy
// (terminal > season > chapter > episode > part > semver > letter > qualifier).
//
// Note: metadataUpdatedAt (thread_updated) is intentionally NO LONGER used.
// "Thread activity" is not "new version released" and was the primary source of
// false-positive update badges. The signal is now version-string authoritative.
const { getIsUpdateAvailable } = require("../utils/versionCompare");

function isExistingPath(value) {
  if (!value) return false;
  if (typeof fs.existsSync !== "function") {
    console.error("Path validation unavailable: fs.existsSync is not defined");
    return false;
  }
  try {
    return fs.existsSync(value);
  } catch {
    return false;
  }
}

function isSteamInstallPath(value) {
  return /(?:^|[\\/])steamapps[\\/]common(?:[\\/]|$)/i.test(String(value || ""));
}

function mapVersionRow(row, forceInstalled = false, options = {}) {
  const skipPathValidation = options.skipPathValidation === true;
  const hasPathValue = !!row.game_path;
  const hasGamePath = skipPathValidation ? hasPathValue : isExistingPath(row.game_path);
  const hasExecPath = skipPathValidation
    ? !row.exec_path || hasPathValue
    : row.exec_path
      ? isExistingPath(row.exec_path)
      : true;
  const isInstalled = forceInstalled || (hasGamePath && hasExecPath);

  return {
    version_id: row.version_id ?? row.rowid,
    version: row.version,
    game_path: row.game_path,
    exec_path: row.exec_path,
    in_place: row.in_place,
    last_played: row.last_played,
    version_playtime: row.version_playtime,
    folder_size: row.folder_size,
    date_added: row.date_added,
    playstate: row.playstate ?? null,
    source: row.source ?? null,
    source_app_id: row.source_app_id ?? null,
    isInstalled,
    installState: skipPathValidation && hasPathValue && !forceInstalled
      ? "pending"
      : isInstalled
        ? "installed"
        : "missing",
  };
}

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const maxPositiveNumber = (values = []) =>
  values.reduce((max, value) => {
    const number = toFiniteNumber(value, 0);
    return number > max ? number : max;
  }, 0);

const sumPositiveNumbers = (values = []) =>
  values.reduce((sum, value) => {
    const number = toFiniteNumber(value, 0);
    return number > 0 ? sum + number : sum;
  }, 0);

const applyLocalSortAggregates = (game, allVersions = [], installedVersions = []) => {
  const lastPlayedFromGame = toFiniteNumber(game.last_played_r, 0);
  const totalPlaytimeFromGame = toFiniteNumber(game.total_playtime, 0);
  const lastPlayed = lastPlayedFromGame > 0
    ? lastPlayedFromGame
    : maxPositiveNumber(allVersions.map((version) => version.last_played));
  const versionPlaytimeSum = sumPositiveNumbers(allVersions.map((version) => version.version_playtime));
  const totalPlaytime = Math.max(totalPlaytimeFromGame, versionPlaytimeSum);

  return {
    ...game,
    last_played_r: lastPlayed,
    total_playtime: totalPlaytime,
    lastPlayed,
    totalPlaytime,
    lastInstalled: maxPositiveNumber(allVersions.map((version) => version.date_added)),
    totalFolderSize: sumPositiveNumbers(installedVersions.map((version) => version.folder_size)),
    installedVersionCount: installedVersions.length,
  };
};

const getVersionForRecord = (recordId, version) => {
  return new Promise((resolve, reject) => {
    const params = [recordId];
    let versionClause = "";
    if (version) {
      versionClause = " AND v.version = ?";
      params.push(version);
    }

    getDb().get(
      `SELECT
         v.rowid AS version_id,
         v.version,
         v.game_path,
         v.exec_path,
         v.in_place,
         v.last_played,
         v.version_playtime,
         v.folder_size,
         v.date_added,
         v.playstate,
         v.source,
         v.source_app_id,
         sm.steam_id
       FROM versions v
       LEFT JOIN steam_mappings sm ON v.record_id = sm.record_id
       WHERE v.record_id = ?${versionClause}
       ORDER BY v.date_added DESC, v.version DESC
       LIMIT 1`,
      params,
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (!row) {
          resolve(null);
          return;
        }
        resolve(mapVersionRow(row, (row.source === 'steam' || !!row.steam_id) && (isSteamInstallPath(row.game_path) || (row.source === 'steam' && !!row.game_path))));
      },
    );
  });
};

const getInstalledVersionsForRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT rowid AS version_id, version, game_path, exec_path, folder_size, date_added, source, source_app_id
       FROM versions
       WHERE record_id = ?
       ORDER BY COALESCE(date_added, 0) DESC, version DESC`,
      [recordId],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const versions = (rows || [])
          .map((row) => mapVersionRow(row))
          .filter((version) => version.isInstalled);

        resolve(versions);
      },
    );
  });
};

const lewdCornerJoinClauses = `
      LEFT JOIN lewdcorner_mappings ON games.record_id = lewdcorner_mappings.record_id
      LEFT JOIN lewdcorner_data direct_lewdcorner_data ON lewdcorner_mappings.lc_id = direct_lewdcorner_data.lc_id
      LEFT JOIN lewdcorner_data ON direct_lewdcorner_data.lc_id IS NULL AND atlas_mappings.atlas_id = lewdcorner_data.atlas_id`;

const lewdCornerSelectFields = `
        COALESCE(direct_lewdcorner_data.lc_id, lewdcorner_data.lc_id) as lc_id,
        COALESCE(direct_lewdcorner_data.lc_id, lewdcorner_data.lc_id) as lcId,
        COALESCE(direct_lewdcorner_data.lc_id, lewdcorner_data.lc_id) as lewdCornerId,
        COALESCE(direct_lewdcorner_data.site_url, lewdcorner_data.site_url) as lewdCornerSiteUrl,
        COALESCE(direct_lewdcorner_data.banner_url, lewdcorner_data.banner_url) as lewdCornerBannerUrl,
        COALESCE(direct_lewdcorner_data.tags, lewdcorner_data.tags) as lewdcornerTags,
        COALESCE(direct_lewdcorner_data.rating, lewdcorner_data.rating) as lewdcornerRating,
        COALESCE(direct_lewdcorner_data.views, lewdcorner_data.views) as lewdcornerViews,
        COALESCE(direct_lewdcorner_data.likes, lewdcorner_data.likes) as lewdcornerLikes,
        COALESCE(direct_lewdcorner_data.tier, lewdcorner_data.tier) as lewdcornerTier,
        COALESCE(direct_lewdcorner_data.prefixes, lewdcorner_data.prefixes) as lewdcornerPrefixes,
        COALESCE(direct_lewdcorner_data.thread_updated, lewdcorner_data.thread_updated) as lewdcornerThreadUpdated,
        COALESCE(direct_lewdcorner_data.register_date, lewdcorner_data.register_date) as lewdcornerRegisterDate,`;

const getVersionPathsForRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT game_path FROM versions WHERE record_id = ?`,
      [recordId],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows.map((row) => row.game_path).filter(Boolean));
      },
    );
  });
};

const getGame = (recordId, appPath, isDev, mediaStorageMode = "stream") => {
  return new Promise((resolve, reject) => {
    const baseImagePath = getAssetBasePath(appPath, isDev);
    const bannerSelectFields = buildBannerSelectFields(
      baseImagePath,
      mediaStorageMode,
    );
    const bannerJoinClauses = buildBannerJoinClauses();
    const query = `
      SELECT
        games.record_id as record_id,
        atlas_mappings.atlas_id as atlas_id,
        COALESCE(steam_mappings.steam_id, steam_data.steam_id) as steam_id,
        games.title as title,
        games.creator as creator,
        games.engine as engine,
        games.description,
        COALESCE(games.is_favorite, 0) as is_favorite,
        games.playstate as playstate,
        game_personal_ratings.story as personal_rating_story,
        game_personal_ratings.graphics as personal_rating_graphics,
        game_personal_ratings.gameplay as personal_rating_gameplay,
        game_personal_ratings.fappability as personal_rating_fappability,
        game_personal_ratings.updated_at as personal_rating_updated_at,
        games.total_playtime,
        games.last_played_r,
        games.last_played_version,
        games.selected_version_id,
${bannerSelectFields},
        f95_zone_data.f95_id as f95_id,
        COALESCE(f95_zone_data.site_url, direct_lewdcorner_data.site_url, lewdcorner_data.site_url) as siteUrl,
        f95_zone_data.views as views,
        f95_zone_data.likes as likes,
        f95_zone_data.tags as f95_tags,
        COALESCE(f95_zone_data.thread_updated, direct_lewdcorner_data.thread_updated, lewdcorner_data.thread_updated) as thread_updated,
        COALESCE(game_metadata_overrides.rating, f95_zone_data.rating) as rating,
${lewdCornerSelectFields}
        COALESCE(game_metadata_overrides.status, atlas_data.status) AS status,
        COALESCE(game_metadata_overrides.latest_version, atlas_data.version) as latestVersion,
        COALESCE(game_metadata_overrides.category, NULLIF(atlas_data.category, ''), NULLIF(steam_data.category, ''), gog_data.category) AS category,
        COALESCE(game_metadata_overrides.censored, NULLIF(atlas_data.censored, ''), NULLIF(steam_data.censored, ''), gog_data.censored) AS censored,
        COALESCE(game_metadata_overrides.genre, NULLIF(atlas_data.genre, ''), NULLIF(steam_data.genre, ''), gog_data.genre) AS genre,
        COALESCE(game_metadata_overrides.language, NULLIF(atlas_data.language, ''), NULLIF(steam_data.language, ''), gog_data.language) AS language,
        COALESCE(game_metadata_overrides.os, NULLIF(atlas_data.os, ''), NULLIF(steam_data.os, ''), gog_data.os) AS os,
        COALESCE(game_metadata_overrides.overview, NULLIF(games.description, ''), NULLIF(atlas_data.overview, ''), NULLIF(steam_data.overview, ''), gog_data.overview) AS overview,
        COALESCE(game_metadata_overrides.translations, NULLIF(atlas_data.translations, ''), NULLIF(steam_data.translations, ''), gog_data.translations) AS translations,
        COALESCE(game_metadata_overrides.release_date, atlas_data.release_date, NULLIF(gog_data.release_date,'')) AS release_date,
        steam_data.release_date AS steam_release_date,
        COALESCE(game_metadata_overrides.voice, NULLIF(atlas_data.voice, ''), NULLIF(steam_data.voice, ''), gog_data.voice) AS voice,
        COALESCE(game_metadata_overrides.publisher, NULLIF(steam_data.publisher, ''), gog_data.publisher) AS publisher,
        steam_data.developer AS steam_developer,
        atlas_data.short_name,
        atlas_data.external_ids as external_ids,
        game_metadata_overrides.manual_external_ids as manual_external_ids,
        atlas_data.removed_from_server as atlas_removed_from_server,
        ${localMediaAssetSelect(baseImagePath, "atlas_banner_wide", "atlas_data.banner_wide")} as atlas_banner_wide,
        ${localMediaAssetSelect(baseImagePath, "atlas_banner", "atlas_data.banner")} as atlas_banner,
        ${localMediaAssetSelect(baseImagePath, "atlas_cover", "atlas_data.cover")} as atlas_cover,
        ${localMediaAssetSelect(baseImagePath, "atlas_wallpaper", "atlas_data.wallpaper")} as atlas_wallpaper,
        ${localMediaAssetSelect(baseImagePath, "atlas_logo", "atlas_data.logo")} as atlas_logo,
        f95_zone_data.banner_url as f95_banner,
        ${localMediaAssetSelect(baseImagePath, "steam_header", "steam_data.header")} as steam_header,
        ${localMediaAssetSelect(baseImagePath, "steam_hero", "steam_data.library_hero")} as steam_library_hero,
        ${localMediaAssetSelect(baseImagePath, "steam_cover", "steam_data.library_capsule")} as steam_library_capsule,
        ${localMediaAssetSelect(baseImagePath, "steam_logo", "steam_data.logo")} as steam_logo,
        steam_data.logo_position as logo_position,
        ${localMediaAssetSelect(baseImagePath, "gog_header", "gog_data.header")} as gog_header,
        ${localMediaAssetSelect(baseImagePath, "gog_hero", "gog_data.library_hero")} as gog_library_hero,
        ${localMediaAssetSelect(baseImagePath, "gog_cover", "gog_data.library_capsule")} as gog_library_capsule,
        ${localMediaAssetSelect(baseImagePath, "gog_logo", "gog_data.logo")} as gog_logo,
        COALESCE(gog_mappings.gog_id, gog_data.gog_id) as gog_id,
        gog_data.release_date AS gog_release_date,
        gog_data.developer AS gog_developer,
        gog_data.store_url AS gog_store_url,
        GROUP_CONCAT(tags.tag) AS tags
      FROM
        games
      LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
      LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
${lewdCornerJoinClauses}
      LEFT JOIN game_personal_ratings ON games.record_id = game_personal_ratings.record_id
      LEFT JOIN game_metadata_overrides ON games.record_id = game_metadata_overrides.record_id
${bannerJoinClauses}
      LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
      LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
      LEFT JOIN steam_data ON steam_mappings.steam_id = steam_data.steam_id
        OR (steam_mappings.steam_id IS NULL AND atlas_mappings.atlas_id IS NOT NULL AND steam_data.atlas_id = atlas_mappings.atlas_id)
      LEFT JOIN gog_mappings ON games.record_id = gog_mappings.record_id
      LEFT JOIN gog_data ON gog_mappings.gog_id = gog_data.gog_id
        OR (gog_mappings.gog_id IS NULL AND atlas_mappings.atlas_id IS NOT NULL AND gog_data.atlas_id = atlas_mappings.atlas_id)
      LEFT JOIN tag_mappings ON games.record_id = tag_mappings.record_id
      LEFT JOIN tags ON tag_mappings.tag_id = tags.tag_id
      WHERE games.record_id = ?
      GROUP BY games.record_id
    `;
    getDb().get(query, [recordId], (err, row) => {
      if (err) {
        console.error("Error fetching game:", err);
        reject(err);
        return;
      }
      if (!row) {
        resolve(null);
        return;
      }
      // Fetch versions separately
      getDb().all(
        `SELECT rowid AS version_id, version, game_path, exec_path, in_place, last_played, version_playtime, folder_size, date_added, playstate, source, source_app_id
         FROM versions
         WHERE record_id = ?`,
        [recordId],
        (err, versionRows) => {
          if (err) {
            console.error("Error fetching versions:", err);
            reject(err);
            return;
          }
          const allVersions = versionRows.map((v) => mapVersionRow(v, !!row.steam_id && isSteamInstallPath(v.game_path)));
          const installedVersions = allVersions.filter((v) => v.isInstalled);
          const game = applyLocalSortAggregates(applyPersonalRatings({
            ...row,
            isFavorite: row.is_favorite === 1,
            playstate: row.playstate ?? null,
            effectivePlaystate: effectiveTitlePlaystate(row.playstate, allVersions),
            engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
            versions: allVersions,
            versionCount: versionRows.length,
            isUpdateAvailable: false,
          }, row), allVersions, installedVersions);
          game.hasInstalledVersion = installedVersions.length > 0;
          game.totalVersionCount = versionRows.length;
          game.versionCount = installedVersions.length;
          game.isUpdateAvailable = getIsUpdateAvailable(
            row.latestVersion,
            installedVersions,
          );
          resolve(game);
        },
      );
    });
  });
};

const getGames = (
  appPath,
  isDev,
  offset = 0,
  limit = null,
  options = {},
) => {
  return new Promise((resolve, reject) => {
    const baseImagePath = getAssetBasePath(appPath, isDev);
    const bannerSelectFields = buildBannerSelectFields(
      baseImagePath,
      options.mediaStorageMode,
    );
    const bannerJoinClauses = buildBannerJoinClauses();
    const includeUninstalled = options.includeUninstalled === true;
    const skipPathValidation = options.skipPathValidation === true;

    // Main query with OFFSET and LIMIT
    let mainQuery = `
      SELECT
        games.record_id as record_id,
        atlas_mappings.atlas_id as atlas_id,
        COALESCE(steam_mappings.steam_id, steam_data.steam_id) as steam_id,
        games.title as title,
        games.creator as creator,
        games.engine as engine,
        games.description,
        COALESCE(games.is_favorite, 0) as is_favorite,
        games.playstate as playstate,
        game_personal_ratings.story as personal_rating_story,
        game_personal_ratings.graphics as personal_rating_graphics,
        game_personal_ratings.gameplay as personal_rating_gameplay,
        game_personal_ratings.fappability as personal_rating_fappability,
        game_personal_ratings.updated_at as personal_rating_updated_at,
        games.total_playtime,
        games.last_played_r,
        games.last_played_version,
        games.selected_version_id,
${bannerSelectFields},
        f95_zone_data.f95_id as f95_id,
        COALESCE(f95_zone_data.site_url, direct_lewdcorner_data.site_url, lewdcorner_data.site_url) as siteUrl,
        f95_zone_data.views as views,
        f95_zone_data.likes as likes,
        f95_zone_data.tags as f95_tags,
        COALESCE(f95_zone_data.thread_updated, direct_lewdcorner_data.thread_updated, lewdcorner_data.thread_updated) as thread_updated,
        COALESCE(game_metadata_overrides.rating, f95_zone_data.rating) as rating,
${lewdCornerSelectFields}
        COALESCE(game_metadata_overrides.status, atlas_data.status) AS status,
        COALESCE(game_metadata_overrides.latest_version, atlas_data.version) as latestVersion,
        COALESCE(game_metadata_overrides.category, NULLIF(atlas_data.category, ''), NULLIF(steam_data.category, ''), gog_data.category) AS category,
        COALESCE(game_metadata_overrides.censored, NULLIF(atlas_data.censored, ''), NULLIF(steam_data.censored, ''), gog_data.censored) AS censored,
        COALESCE(game_metadata_overrides.genre, NULLIF(atlas_data.genre, ''), NULLIF(steam_data.genre, ''), gog_data.genre) AS genre,
        COALESCE(game_metadata_overrides.language, NULLIF(atlas_data.language, ''), NULLIF(steam_data.language, ''), gog_data.language) AS language,
        COALESCE(game_metadata_overrides.os, NULLIF(atlas_data.os, ''), NULLIF(steam_data.os, ''), gog_data.os) AS os,
        COALESCE(game_metadata_overrides.overview, NULLIF(games.description, ''), NULLIF(atlas_data.overview, ''), NULLIF(steam_data.overview, ''), gog_data.overview) AS overview,
        COALESCE(game_metadata_overrides.translations, NULLIF(atlas_data.translations, ''), NULLIF(steam_data.translations, ''), gog_data.translations) AS translations,
        COALESCE(game_metadata_overrides.release_date, atlas_data.release_date, NULLIF(gog_data.release_date,'')) AS release_date,
        steam_data.release_date AS steam_release_date,
        COALESCE(game_metadata_overrides.voice, NULLIF(atlas_data.voice, ''), NULLIF(steam_data.voice, ''), gog_data.voice) AS voice,
        COALESCE(game_metadata_overrides.publisher, NULLIF(steam_data.publisher, ''), gog_data.publisher) AS publisher,
        steam_data.developer AS steam_developer,
        atlas_data.short_name,
        atlas_data.external_ids as external_ids,
        game_metadata_overrides.manual_external_ids as manual_external_ids,
        atlas_data.removed_from_server as atlas_removed_from_server,
        ${localMediaAssetSelect(baseImagePath, "atlas_banner_wide", "atlas_data.banner_wide")} as atlas_banner_wide,
        ${localMediaAssetSelect(baseImagePath, "atlas_banner", "atlas_data.banner")} as atlas_banner,
        ${localMediaAssetSelect(baseImagePath, "atlas_cover", "atlas_data.cover")} as atlas_cover,
        ${localMediaAssetSelect(baseImagePath, "atlas_wallpaper", "atlas_data.wallpaper")} as atlas_wallpaper,
        ${localMediaAssetSelect(baseImagePath, "atlas_logo", "atlas_data.logo")} as atlas_logo,
        f95_zone_data.banner_url as f95_banner,
        ${localMediaAssetSelect(baseImagePath, "steam_header", "steam_data.header")} as steam_header,
        ${localMediaAssetSelect(baseImagePath, "steam_hero", "steam_data.library_hero")} as steam_library_hero,
        ${localMediaAssetSelect(baseImagePath, "steam_cover", "steam_data.library_capsule")} as steam_library_capsule,
        ${localMediaAssetSelect(baseImagePath, "steam_logo", "steam_data.logo")} as steam_logo,
        steam_data.logo_position as logo_position,
        ${localMediaAssetSelect(baseImagePath, "gog_header", "gog_data.header")} as gog_header,
        ${localMediaAssetSelect(baseImagePath, "gog_hero", "gog_data.library_hero")} as gog_library_hero,
        ${localMediaAssetSelect(baseImagePath, "gog_cover", "gog_data.library_capsule")} as gog_library_capsule,
        ${localMediaAssetSelect(baseImagePath, "gog_logo", "gog_data.logo")} as gog_logo,
        COALESCE(gog_mappings.gog_id, gog_data.gog_id) as gog_id,
        gog_data.release_date AS gog_release_date,
        gog_data.developer AS gog_developer,
        gog_data.store_url AS gog_store_url,
        GROUP_CONCAT(tags.tag) AS tags
      FROM
        games
      LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
      LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
${lewdCornerJoinClauses}
      LEFT JOIN game_personal_ratings ON games.record_id = game_personal_ratings.record_id
      LEFT JOIN game_metadata_overrides ON games.record_id = game_metadata_overrides.record_id
${bannerJoinClauses}
      LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
      LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
      LEFT JOIN steam_data ON steam_mappings.steam_id = steam_data.steam_id
        OR (steam_mappings.steam_id IS NULL AND atlas_mappings.atlas_id IS NOT NULL AND steam_data.atlas_id = atlas_mappings.atlas_id)
      LEFT JOIN gog_mappings ON games.record_id = gog_mappings.record_id
      LEFT JOIN gog_data ON gog_mappings.gog_id = gog_data.gog_id
        OR (gog_mappings.gog_id IS NULL AND atlas_mappings.atlas_id IS NOT NULL AND gog_data.atlas_id = atlas_mappings.atlas_id)
      LEFT JOIN tag_mappings ON games.record_id = tag_mappings.record_id
      LEFT JOIN tags ON tag_mappings.tag_id = tags.tag_id
      GROUP BY games.record_id
    `;
    const params = [];
    if (limit !== null) {
      mainQuery += ` LIMIT ?`;
      params.push(limit);
    }
    if (offset > 0) {
      mainQuery += ` OFFSET ?`;
      params.push(offset);
    }

    // Query to aggregate versions for each game
    const versionsQuery = `
      SELECT rowid AS version_id, record_id, version, game_path, exec_path, in_place, last_played, version_playtime, folder_size, date_added, playstate, source, source_app_id
      FROM versions
    `;

    // Execute main query
    getDb().all(mainQuery, params, (err, rows) => {
      if (err) {
        console.error("Error fetching games:", err);
        reject(err);
        return;
      }

      // Execute versions query
      getDb().all(versionsQuery, [], (err, versionRows) => {
        if (err) {
          console.error("Error fetching versions:", err);
          reject(err);
          return;
        }

        // Group versions by record_id
        const versionsByRecordId = {};
        versionRows.forEach((row) => {
          if (!versionsByRecordId[row.record_id]) {
            versionsByRecordId[row.record_id] = [];
          }
          versionsByRecordId[row.record_id].push(row);
        });

        // Map rows to include versions array and isUpdateAvailable
        const games = rows
          .map((row) => {
            const allVersions = (versionsByRecordId[row.record_id] || []).map(
              (version) =>
                mapVersionRow(
                  version,
                  (!!row.steam_id && isSteamInstallPath(version.game_path)) ||
                    // GOG installs launch via Galaxy or a resolved exe; treat a
                    // GOG-mapped version as installed the same way Steam is so it
                    // shows in the banner/library view without an Atlas mapping.
                    (!!row.gog_id && (version.in_place === 1 || !!version.game_path)),
                  { skipPathValidation },
                ),
            );
            const installedVersions = allVersions.filter(
              (version) => version.isInstalled,
            );
            const versions = includeUninstalled
              ? allVersions
              : installedVersions;

            return applyLocalSortAggregates(applyPersonalRatings({
              ...row,
              isFavorite: row.is_favorite === 1,
              playstate: row.playstate ?? null,
              effectivePlaystate: effectiveTitlePlaystate(row.playstate, allVersions),
              // Unescape engine to fix 'Ren''Py' issue
              engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
              versions,
              versionCount: installedVersions.length,
              installedVersionCount: installedVersions.length,
              totalVersionCount: allVersions.length,
              hasInstalledVersion: installedVersions.length > 0,
              isUpdateAvailable: getIsUpdateAvailable(
                row.latestVersion,
                installedVersions,
              ),
            }, row), allVersions, installedVersions);
          })
          .filter(
            (game) => includeUninstalled || game.hasInstalledVersion,
          );

        console.log(`Fetched ${games.length} games with versions`);
        resolve(games);
      });
    });
  });
};

const getCatalogGames = (appPath, isDev, options = {}) => {
  return new Promise((resolve, reject) => {
    const rawOffset = Number.parseInt(options.offset, 10);
    const rawLimit = Number.parseInt(options.limit, 10);
    const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const limit = Number.isInteger(rawLimit)
      ? Math.min(1000, Math.max(50, rawLimit))
      : 250;
    const includeTotal = options.includeTotal === true;
    const countOnly = options.countOnly === true;
    const search = options.search && typeof options.search === 'object' ? options.search : {};
    let searchText = String(search.text || '').trim();
    let searchType = String(search.type || 'all').trim();
    const prefixedSearch = searchText.match(/^([a-z]+):\s*(.+)$/i);
    if (prefixedSearch) {
      const prefix = prefixedSearch[1].toLowerCase();
      searchText = prefixedSearch[2].trim();
      if (prefix === 'id') searchType = 'anyId';
      if (prefix === 'f95') searchType = 'f95Id';
      if (prefix === 'lc' || prefix === 'lewdcorner') searchType = 'lewdcornerId';
      if (prefix === 'atlas') searchType = 'atlasId';
      if (prefix === 'steam') searchType = 'steamId';
      if (prefix === 'url') searchType = 'source';
    }
    const escapeLike = (value) => String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
    const buildLikeTerm = (value) => `%${escapeLike(value).toLowerCase()}%`;
    const searchTerms = searchText
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term && !term.startsWith('-'));
    const searchParams = [];
    const addLikeConditions = (fields, terms) => {
      if (terms.length === 0) return '';
      const clauses = terms.map((term) => {
        const likeTerm = buildLikeTerm(term);
        searchParams.push(...fields.map(() => likeTerm));
        return `(${fields.map((field) => `LOWER(COALESCE(CAST(${field} AS TEXT), '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`;
      });
      return clauses.join(' AND ');
    };
    let searchWhere = '';
    if (searchTerms.length > 0) {
      if (searchType === 'title') {
        searchWhere = addLikeConditions(['catalog.title', 'catalog.short_name'], searchTerms);
      } else if (searchType === 'creator') {
        searchWhere = addLikeConditions(['catalog.creator'], searchTerms);
      } else if (searchType === 'atlasId') {
        searchWhere = addLikeConditions(['catalog.atlas_id', 'catalog.record_id'], searchTerms);
      } else if (searchType === 'f95Id') {
        searchWhere = addLikeConditions(['catalog.f95_id'], searchTerms);
      } else if (searchType === 'lewdcornerId') {
        searchWhere = addLikeConditions(['catalog.lc_id'], searchTerms);
      } else if (searchType === 'steamId') {
        searchWhere = addLikeConditions(['catalog.steam_id'], searchTerms);
      } else if (searchType === 'anyId') {
        searchWhere = addLikeConditions(['catalog.atlas_id', 'catalog.record_id', 'catalog.f95_id', 'catalog.lc_id', 'catalog.steam_id'], searchTerms);
      } else if (searchType === 'source') {
        searchWhere = addLikeConditions(['catalog.source', 'catalog.siteUrl', 'catalog.lewdCornerSiteUrl'], searchTerms);
      } else {
        searchWhere = addLikeConditions([
          'catalog.title',
          'catalog.short_name',
          'catalog.creator',
          'catalog.f95_tags',
          'catalog.tags',
          'catalog.lewdcornerTags',
          'catalog.lewdcornerPrefixes',
          'catalog.engine',
          'catalog.status',
          'catalog.category',
        ], searchTerms);
      }
    }
    const filters = options.filters && typeof options.filters === 'object' ? options.filters : {};
    const filterParams = [];
    const filterWhereParts = [];
    const toArray = (value) => {
      if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && String(item).trim() !== '').map(String);
      if (value === undefined || value === null || value === '') return [];
      return [String(value)];
    };
    const addInFilter = (field, values) => {
      const safeValues = toArray(values);
      if (safeValues.length === 0) return;
      filterWhereParts.push(`${field} COLLATE NOCASE IN (${safeValues.map(() => '?').join(', ')})`);
      filterParams.push(...safeValues);
    };
    const addNotInFilter = (field, values) => {
      const safeValues = toArray(values);
      if (safeValues.length === 0) return;
      filterWhereParts.push(`(${field} IS NULL OR ${field} COLLATE NOCASE NOT IN (${safeValues.map(() => '?').join(', ')}))`);
      filterParams.push(...safeValues);
    };
    const addTagFilter = (values, { exclude = false, logic = 'AND' } = {}) => {
      const safeValues = toArray(values);
      if (safeValues.length === 0) return;
      const tagFields = ['catalog.f95_tags', 'catalog.tags', 'catalog.lewdcornerTags', 'catalog.lewdcornerPrefixes'];
      const perTagClauses = safeValues.map((value) => {
        const clauses = tagFields.map((field) => `LOWER(COALESCE(${field}, '')) LIKE ? ESCAPE '\\'`);
        filterParams.push(...tagFields.map(() => `%${escapeLike(value).toLowerCase()}%`));
        const tagClause = `(${clauses.join(' OR ')})`;
        return exclude ? `NOT ${tagClause}` : tagClause;
      });
      filterWhereParts.push(`(${perTagClauses.join(exclude || logic === 'AND' ? ' AND ' : ' OR ')})`);
    };
    const dateMsExpression = (field) => `
      CASE
        WHEN ${field} IS NULL OR ${field} = '' THEN NULL
        WHEN length(CAST(${field} AS TEXT)) = 8 AND CAST(${field} AS TEXT) NOT GLOB '*[^0-9]*'
          THEN strftime('%s', substr(CAST(${field} AS TEXT), 1, 4) || '-' || substr(CAST(${field} AS TEXT), 5, 2) || '-' || substr(CAST(${field} AS TEXT), 7, 2)) * 1000
        WHEN CAST(${field} AS TEXT) NOT GLOB '*[^0-9]*'
          THEN CASE WHEN CAST(${field} AS REAL) > 100000000000 THEN CAST(${field} AS REAL) ELSE CAST(${field} AS REAL) * 1000 END
        ELSE strftime('%s', ${field}) * 1000
      END
    `;
    const addDateRangeFilter = (field, range) => {
      const now = Date.now();
      let min = null;
      let max = now;
      if (range === '7d') min = now - 7 * 86400000;
      else if (range === '30d') min = now - 30 * 86400000;
      else if (range === '90d') min = now - 90 * 86400000;
      else if (range === 'year') {
        const year = new Date(now).getFullYear();
        min = new Date(year, 0, 1).getTime();
        max = new Date(year + 1, 0, 1).getTime() - 1;
      } else {
        return;
      }
      const dateExpr = dateMsExpression(field);
      filterWhereParts.push(`(${dateExpr}) BETWEEN ? AND ?`);
      filterParams.push(min, max);
    };
    const browseSource = String(filters.browseSource || filters.source || 'all').toLowerCase();
    if (['f95', 'lewdcorner', 'steam', 'atlas'].includes(browseSource)) {
      filterWhereParts.push('catalog.source = ?');
      filterParams.push(browseSource);
    }
    addInFilter('catalog.category', filters.category);
    addNotInFilter('catalog.category', filters.excludedCategories);
    addInFilter('catalog.engine', filters.engine);
    addNotInFilter('catalog.engine', filters.excludedEngines);
    addInFilter('catalog.status', filters.status);
    addNotInFilter('catalog.status', filters.excludedStatuses);
    addInFilter('catalog.censored', filters.censored);
    const languageValues = toArray(filters.language);
    if (languageValues.length > 0) {
      filterWhereParts.push(`(${languageValues.map(() => `LOWER(COALESCE(catalog.language, '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      filterParams.push(...languageValues.map((value) => `%${escapeLike(value).toLowerCase()}%`));
    }
    addTagFilter(filters.tags, { logic: filters.tagLogic === 'OR' ? 'OR' : 'AND' });
    addTagFilter(filters.excludedTags, { exclude: true });
    if (filters.steamMapped === true) {
      filterWhereParts.push('(catalog.steam_id IS NOT NULL OR catalog.siteUrl LIKE ?)');
      filterParams.push('%store.steampowered.com/app/%');
    }
    if (filters.installState === 'installed') {
      filterWhereParts.push('catalog.is_installed = 1');
    } else if (filters.installState === 'uninstalled') {
      filterWhereParts.push('catalog.is_installed = 0');
    }
    // Updates-available is only meaningful for installed entries, and is
    // evaluated separately in JS below (see the updateAvailable branch) —
    // version-string comparison isn't something to approximate in SQL. It
    // still implies is_installed = 1 here so the count/page query this
    // function falls through to for non-updateAvailable callers is at
    // least scoped sensibly if both happen to be set.
    if (filters.updateAvailable === true) {
      filterWhereParts.push('catalog.is_installed = 1');
    }
    // Favorites and personal rating are local-record concepts (favorite
    // flag lives on `games`, personal rating on `game_personal_ratings`) —
    // joined in via local_record_id, see catalogJoins below. They can only
    // ever match the subset of the catalog that's actually installed,
    // same as in the local library.
    if (filters.favoritesOnly === true) {
      filterWhereParts.push('COALESCE(local_games.is_favorite, 0) = 1');
    }
    // Effective playstate: an explicit title override wins; otherwise it's
    // derived from the versions, but only when EVERY version shares the same
    // playstate (matching the per-title rollup rule — "all versions flagged").
    // Mixed or partially-unset versions yield NULL (no derived title state).
    const effectivePlaystateExpr = `COALESCE(
      local_games.playstate,
      (SELECT CASE
                WHEN COUNT(*) > 0
                 AND SUM(CASE WHEN v.playstate IS NULL OR v.playstate = '' THEN 1 ELSE 0 END) = 0
                 AND COUNT(DISTINCT v.playstate) = 1
                THEN MAX(v.playstate)
                ELSE NULL
              END
       FROM versions v
       WHERE v.record_id = local_games.record_id)
    )`;
    {
      const includePlaystates = toArray(filters.playstates);
      if (includePlaystates.length > 0) {
        filterWhereParts.push(`(${effectivePlaystateExpr}) COLLATE NOCASE IN (${includePlaystates.map(() => '?').join(', ')})`);
        filterParams.push(...includePlaystates);
      }
      const excludePlaystates = toArray(filters.excludedPlaystates);
      if (excludePlaystates.length > 0) {
        filterWhereParts.push(`((${effectivePlaystateExpr}) IS NULL OR (${effectivePlaystateExpr}) COLLATE NOCASE NOT IN (${excludePlaystates.map(() => '?').join(', ')}))`);
        // expression is inlined twice, so bind the exclude values twice
        filterParams.push(...excludePlaystates, ...excludePlaystates);
      }
    }
    if (filters.wishlistOnly === true) {
      filterWhereParts.push(`EXISTS (
        SELECT 1
        FROM wishlist_entries wishlist
        WHERE (wishlist.atlas_id IS NOT NULL AND wishlist.atlas_id = catalog.atlas_id)
           OR (wishlist.f95_id IS NOT NULL AND wishlist.f95_id = catalog.f95_id)
           OR (wishlist.lc_id IS NOT NULL AND wishlist.lc_id = catalog.lc_id)
           OR (wishlist.steam_id IS NOT NULL AND wishlist.steam_id = catalog.steam_id)
      )`);
    }
    const personalRatingOverallExpr = `(
      (COALESCE(local_ratings.story, 0) + COALESCE(local_ratings.graphics, 0) + COALESCE(local_ratings.gameplay, 0) + COALESCE(local_ratings.fappability, 0)) * 1.0
      / NULLIF(
          (CASE WHEN local_ratings.story IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN local_ratings.graphics IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN local_ratings.gameplay IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN local_ratings.fappability IS NOT NULL THEN 1 ELSE 0 END),
          0
        )
    )`;
    const personalRatingMinValue = Number(filters.personalRatingMin);
    const personalRatingStatus = ['rated', 'unrated'].includes(filters.personalRatingStatus)
      ? filters.personalRatingStatus
      : filters.personalRatingRatedOnly === true
        ? 'rated'
        : 'any';
    if (personalRatingStatus === 'unrated') {
      filterWhereParts.push(`${personalRatingOverallExpr} IS NULL`);
    } else if (personalRatingStatus === 'rated' || (Number.isFinite(personalRatingMinValue) && personalRatingMinValue > 0)) {
      filterWhereParts.push(`${personalRatingOverallExpr} IS NOT NULL`);
      if (Number.isFinite(personalRatingMinValue) && personalRatingMinValue > 0) {
        filterWhereParts.push(`${personalRatingOverallExpr} >= ?`);
        filterParams.push(personalRatingMinValue);
      }
    }
    // Community (F95Zone/LewdCorner) rating — unlike favorites/personal
    // rating above, this is on every catalog row regardless of install
    // status, since it comes from the source site itself rather than
    // anything local.
    const communityRatingMinValue = Number(filters.communityRatingMin);
    if (Number.isFinite(communityRatingMinValue) && communityRatingMinValue > 0) {
      // Community rating spans both F95 and LewdCorner — a title passes if
      // EITHER source's rating meets the threshold (i.e. the higher of the
      // two). COALESCE guards against a NULL/empty rating on one source.
      filterWhereParts.push('MAX(COALESCE(CAST(catalog.rating AS REAL), 0), COALESCE(CAST(catalog.lewdcornerRating AS REAL), 0)) >= ?');
      filterParams.push(communityRatingMinValue);
    }
    if (filters.dateField === 'releaseDate' && filters.dateRange && filters.dateRange !== 'any') {
      addDateRangeFilter('catalog.release_date', filters.dateRange);
    } else if (filters.dateField === 'latestUpdate' && filters.dateRange && filters.dateRange !== 'any') {
      addDateRangeFilter('catalog.thread_updated', filters.dateRange);
    } else if (filters.dateField === 'threadPublished' && filters.dateRange && filters.dateRange !== 'any') {
      addDateRangeFilter('catalog.thread_publish_date', filters.dateRange);
    } else if (filters.dateField === 'none' && filters.browseDateRange && filters.browseDateRange !== 'any') {
      addDateRangeFilter(filters.browseDateBasis === 'thread_publish_date' ? 'catalog.thread_publish_date' : 'catalog.thread_updated', filters.browseDateRange);
    }
    const whereParts = [searchWhere, ...filterWhereParts].filter(Boolean);
    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const queryParams = [...searchParams, ...filterParams];
    const browseSortAliases = {
      name: 'titleAsc',
      nameAsc: 'titleAsc',
      nameDesc: 'titleDesc',
      newest: 'threadUpdatedDesc',
      oldest: 'threadUpdatedAsc',
    };
    const browseSortValue = String(filters.browseSort || 'threadUpdatedDesc');
    const browseSort = browseSortAliases[browseSortValue] || browseSortValue;
    const orderByParsedDate = (field, direction) => {
      const dateExpr = dateMsExpression(field);
      const nowMs = Date.now();
      // Rows with a valid, non-future date sort first (by direction); rows with
      // a future date are pushed below them, and NULL/empty dates last. This
      // keeps bogus future timestamps (e.g. mis-scraped thread_updated values)
      // out of the top of the default newest-first Browse view.
      return `ORDER BY CASE WHEN (${dateExpr}) IS NULL THEN 2 WHEN (${dateExpr}) > ${nowMs} THEN 1 ELSE 0 END ASC, (${dateExpr}) ${direction}, title COLLATE NOCASE ASC, catalogKey ASC`;
    };
    const orderByNullableNumber = (field, direction) =>
      `ORDER BY CASE WHEN ${field} IS NULL OR ${field} = '' THEN 1 ELSE 0 END ASC, CAST(${field} AS REAL) ${direction}, title COLLATE NOCASE ASC, catalogKey ASC`;
    // Rating and Likes span both F95 and LewdCorner — sort by the higher of
    // the two so a title ranks by its best community signal from either
    // source. Rows with no value on either source sort last.
    const bestOfExpr = (a, b) => `MAX(COALESCE(CAST(${a} AS REAL), 0), COALESCE(CAST(${b} AS REAL), 0))`;
    const orderByBestOf = (a, b, direction) => {
      const expr = bestOfExpr(a, b);
      return `ORDER BY CASE WHEN ${expr} <= 0 THEN 1 ELSE 0 END ASC, ${expr} ${direction}, title COLLATE NOCASE ASC, catalogKey ASC`;
    };
    const orderByText = (field, direction) =>
      `ORDER BY CASE WHEN ${field} IS NULL OR ${field} = '' THEN 1 ELSE 0 END ASC, ${field} COLLATE NOCASE ${direction}, title COLLATE NOCASE ASC, catalogKey ASC`;
    const orderByClause = browseSort === 'titleDesc'
      ? 'ORDER BY title COLLATE NOCASE DESC, catalogKey DESC'
      : browseSort === 'creatorAsc'
        ? orderByText('catalog.creator', 'ASC')
        : browseSort === 'creatorDesc'
          ? orderByText('catalog.creator', 'DESC')
          : browseSort === 'likesDesc'
            ? orderByBestOf('catalog.likes', 'catalog.lewdcornerLikes', 'DESC')
            : browseSort === 'likesAsc'
              ? orderByBestOf('catalog.likes', 'catalog.lewdcornerLikes', 'ASC')
              : browseSort === 'ratingDesc'
                ? orderByBestOf('catalog.rating', 'catalog.lewdcornerRating', 'DESC')
                : browseSort === 'ratingAsc'
                  ? orderByBestOf('catalog.rating', 'catalog.lewdcornerRating', 'ASC')
                  : browseSort === 'threadUpdatedDesc'
                    ? orderByParsedDate('catalog.thread_updated', 'DESC')
                    : browseSort === 'threadUpdatedAsc'
                      ? orderByParsedDate('catalog.thread_updated', 'ASC')
                      : browseSort === 'threadPublishedDesc'
                        ? orderByParsedDate('catalog.thread_publish_date', 'DESC')
                        : browseSort === 'threadPublishedAsc'
                          ? orderByParsedDate('catalog.thread_publish_date', 'ASC')
                          : browseSort === 'releaseDateDesc'
                            ? orderByParsedDate('catalog.release_date', 'DESC')
                            : browseSort === 'releaseDateAsc'
                              ? orderByParsedDate('catalog.release_date', 'ASC')
                              : browseSort === 'f95LatestOrderDesc'
                                ? orderByNullableNumber('catalog.f95_latest_order', 'DESC')
                                : browseSort === 'f95LatestOrderAsc'
                                  ? orderByNullableNumber('catalog.f95_latest_order', 'ASC')
                                  : 'ORDER BY title COLLATE NOCASE ASC, catalogKey ASC';
    getTableColumns('f95_zone_data').then((f95Columns) => {
      const hasThreadUpdated = f95Columns.has('thread_updated')
      const threadUpdatedSelect = hasThreadUpdated
        ? 'f95_zone_data.thread_updated AS thread_updated'
        : 'NULL AS thread_updated'
      const hasF95LatestOrder = f95Columns.has('f95_latest_order')
      const f95LatestOrderSelect = hasF95LatestOrder
        ? 'f95_zone_data.f95_latest_order AS f95_latest_order'
        : 'NULL AS f95_latest_order'
      const query = `
      WITH atlas_branch_base AS (
        SELECT
          'catalog:' || atlas_data.atlas_id as record_id,
          'atlas:' || atlas_data.atlas_id as catalogKey,
          COALESCE(
            (SELECT MIN(am.record_id) FROM atlas_mappings am WHERE am.atlas_id = atlas_data.atlas_id),
            (SELECT MIN(fm.record_id) FROM f95_zone_mappings fm WHERE f95_zone_data.f95_id IS NOT NULL AND fm.f95_id = f95_zone_data.f95_id),
            (SELECT MIN(lm.record_id) FROM lewdcorner_mappings lm WHERE lewdcorner_data.lc_id IS NOT NULL AND lm.lc_id = lewdcorner_data.lc_id),
            (SELECT MIN(sm.record_id)
             FROM steam_mappings sm
             JOIN steam_data mapped_steam ON sm.steam_id = mapped_steam.steam_id
             WHERE mapped_steam.atlas_id = atlas_data.atlas_id)
          ) AS local_record_id,
          CASE
            WHEN f95_zone_data.f95_id IS NOT NULL THEN 'f95'
            WHEN lewdcorner_data.lc_id IS NOT NULL THEN 'lewdcorner'
            WHEN MIN(steam_data.steam_id) IS NOT NULL THEN 'steam'
            ELSE 'atlas'
          END as source,
          atlas_data.atlas_id as atlas_id,
          MIN(steam_data.steam_id) as steam_id,
          lewdcorner_data.lc_id as lc_id,
          lewdcorner_data.lc_id as lcId,
          lewdcorner_data.lc_id as lewdCornerId,
          atlas_data.title as title,
          COALESCE(NULLIF(atlas_data.creator, ''), atlas_data.developer) as creator,
          atlas_data.engine as engine,
          atlas_data.overview as description,
          0 as total_playtime,
          0 as last_played_r,
          '' as last_played_version,
          ${remoteBannerExpression} AS banner_url,
          CASE WHEN ${remoteBannerExpression} IS NOT NULL THEN 'stream' ELSE '' END AS banner_source,
          0 AS has_downloaded_banner,
          f95_zone_data.f95_id as f95_id,
          COALESCE(f95_zone_data.site_url, lewdcorner_data.site_url) as siteUrl,
          f95_zone_data.views as views,
          f95_zone_data.likes as likes,
          f95_zone_data.tags as f95_tags,
          f95_zone_data.rating as rating,
          lewdcorner_data.site_url as lewdCornerSiteUrl,
          lewdcorner_data.banner_url as lewdCornerBannerUrl,
          lewdcorner_data.tags as lewdcornerTags,
          lewdcorner_data.rating as lewdcornerRating,
          lewdcorner_data.views as lewdcornerViews,
          lewdcorner_data.likes as lewdcornerLikes,
          lewdcorner_data.tier as lewdcornerTier,
          lewdcorner_data.prefixes as lewdcornerPrefixes,
          lewdcorner_data.thread_updated as lewdcornerThreadUpdated,
          lewdcorner_data.register_date as lewdcornerRegisterDate,
          atlas_data.status,
          atlas_data.version as latestVersion,
          COALESCE(NULLIF(atlas_data.category, ''), MIN(steam_data.category)) AS category,
          COALESCE(NULLIF(atlas_data.censored, ''), MIN(steam_data.censored)) AS censored,
          COALESCE(NULLIF(atlas_data.genre, ''), MIN(steam_data.genre)) AS genre,
          COALESCE(NULLIF(atlas_data.language, ''), MIN(steam_data.language)) AS language,
          COALESCE(NULLIF(atlas_data.os, ''), MIN(steam_data.os)) AS os,
          COALESCE(NULLIF(atlas_data.overview, ''), MIN(steam_data.overview)) AS overview,
          COALESCE(NULLIF(atlas_data.translations, ''), MIN(steam_data.translations)) AS translations,
          atlas_data.release_date,
          atlas_data.last_record_update AS atlas_last_record_update,
          MIN(steam_data.release_date) AS steam_release_date,
          ${threadUpdatedSelect},
          f95_zone_data.thread_publish_date AS thread_publish_date,
          ${f95LatestOrderSelect},
          f95_zone_data.last_record_update AS f95_last_record_update,
          COALESCE(NULLIF(atlas_data.voice, ''), MIN(steam_data.voice)) AS voice,
          MIN(steam_data.publisher) AS publisher,
          MIN(steam_data.developer) AS steam_developer,
          atlas_data.short_name,
          atlas_data.external_ids as external_ids,
          atlas_data.banner_wide as atlas_banner_wide,
          atlas_data.banner as atlas_banner,
          atlas_data.logo as atlas_logo,
          f95_zone_data.banner_url as f95_banner,
          lewdcorner_data.banner_url as lewdcorner_banner,
          MIN(steam_data.header) as steam_header,
          MIN(steam_data.library_hero) as steam_library_hero,
          MIN(steam_data.library_capsule) as steam_library_capsule,
          MIN(steam_data.logo) as steam_logo,
          MIN(steam_data.logo_position) as logo_position,
          MIN(gog_data.header) as gog_header,
          MIN(gog_data.library_hero) as gog_library_hero,
          MIN(gog_data.library_capsule) as gog_library_capsule,
          MIN(gog_data.logo) as gog_logo,
          MIN(gog_data.gog_id) as gog_id,
          MIN(gog_data.release_date) AS gog_release_date,
          MIN(gog_data.developer) AS gog_developer,
          '' AS tags
        FROM atlas_data
        LEFT JOIN f95_zone_data ON atlas_data.atlas_id = f95_zone_data.atlas_id
        LEFT JOIN lewdcorner_data ON atlas_data.atlas_id = lewdcorner_data.atlas_id
        LEFT JOIN steam_data ON atlas_data.atlas_id = steam_data.atlas_id
        LEFT JOIN gog_data ON atlas_data.atlas_id = gog_data.atlas_id
        GROUP BY atlas_data.atlas_id
      ),
      atlas_branch AS (
        SELECT
          *,
          local_record_id AS localRecordId,
          local_record_id AS installedRecordId,
          CASE WHEN local_record_id IS NOT NULL THEN 1 ELSE 0 END AS is_installed
        FROM atlas_branch_base
      ),
      steam_branch_base AS (
        SELECT
          'catalog:steam:' || steam_data.steam_id as record_id,
          'steam:' || steam_data.steam_id as catalogKey,
          COALESCE(
            (SELECT MIN(sm.record_id) FROM steam_mappings sm WHERE sm.steam_id = steam_data.steam_id),
            (SELECT MIN(am.record_id) FROM atlas_mappings am WHERE steam_data.atlas_id IS NOT NULL AND am.atlas_id = steam_data.atlas_id)
          ) AS local_record_id,
          'steam' as source,
          NULL as atlas_id,
          steam_data.steam_id as steam_id,
          NULL as lc_id,
          NULL as lcId,
          NULL as lewdCornerId,
          steam_data.title as title,
          COALESCE(NULLIF(steam_data.developer, ''), steam_data.publisher) as creator,
          steam_data.engine as engine,
          steam_data.overview as description,
          0 as total_playtime,
          0 as last_played_r,
          '' as last_played_version,
          COALESCE(steam_data.header, steam_data.library_hero) AS banner_url,
          CASE WHEN COALESCE(steam_data.header, steam_data.library_hero) IS NOT NULL THEN 'stream' ELSE '' END AS banner_source,
          0 AS has_downloaded_banner,
          NULL as f95_id,
          CASE WHEN steam_data.steam_id IS NOT NULL THEN 'https://store.steampowered.com/app/' || steam_data.steam_id || '/' ELSE NULL END as siteUrl,
          NULL as views,
          NULL as likes,
          steam_data.tags as f95_tags,
          NULL as rating,
          NULL as lewdCornerSiteUrl,
          NULL as lewdCornerBannerUrl,
          NULL as lewdcornerTags,
          NULL as lewdcornerRating,
          NULL as lewdcornerViews,
          NULL as lewdcornerLikes,
          NULL as lewdcornerTier,
          NULL as lewdcornerPrefixes,
          NULL as lewdcornerThreadUpdated,
          NULL as lewdcornerRegisterDate,
          steam_data.release_state as status,
          NULL as latestVersion,
          steam_data.category AS category,
          steam_data.censored AS censored,
          steam_data.genre AS genre,
          steam_data.language AS language,
          steam_data.os AS os,
          steam_data.overview AS overview,
          steam_data.translations AS translations,
          steam_data.release_date AS release_date,
          NULL AS atlas_last_record_update,
          steam_data.release_date AS steam_release_date,
          NULL AS thread_updated,
          steam_data.release_date AS thread_publish_date,
          NULL AS f95_latest_order,
          NULL AS f95_last_record_update,
          steam_data.voice AS voice,
          steam_data.publisher AS publisher,
          steam_data.developer AS steam_developer,
          steam_data.title AS short_name,
          '{"steam_appid":"' || steam_data.steam_id || '"}' as external_ids,
          NULL as atlas_banner_wide,
          NULL as atlas_banner,
          NULL as atlas_logo,
          NULL as f95_banner,
          NULL as lewdcorner_banner,
          steam_data.header as steam_header,
          steam_data.library_hero as steam_library_hero,
          steam_data.library_capsule as steam_library_capsule,
          steam_data.logo as steam_logo,
          steam_data.logo_position as logo_position,
          NULL as gog_header,
          NULL as gog_library_hero,
          NULL as gog_library_capsule,
          NULL as gog_logo,
          NULL as gog_id,
          NULL AS gog_release_date,
          NULL AS gog_developer,
          steam_data.tags AS tags
        FROM steam_data
        LEFT JOIN atlas_data ON steam_data.atlas_id = atlas_data.atlas_id
        WHERE steam_data.atlas_id IS NULL OR atlas_data.atlas_id IS NULL
      ),
      steam_branch AS (
        SELECT
          *,
          local_record_id AS localRecordId,
          local_record_id AS installedRecordId,
          CASE WHEN local_record_id IS NOT NULL THEN 1 ELSE 0 END AS is_installed
        FROM steam_branch_base
      ),
      gog_branch_base AS (
        SELECT
          'catalog:gog:' || gog_data.gog_id as record_id,
          'gog:' || gog_data.gog_id as catalogKey,
          COALESCE(
            (SELECT MIN(gm.record_id) FROM gog_mappings gm WHERE gm.gog_id = gog_data.gog_id),
            (SELECT MIN(am.record_id) FROM atlas_mappings am WHERE gog_data.atlas_id IS NOT NULL AND am.atlas_id = gog_data.atlas_id)
          ) AS local_record_id,
          'gog' as source,
          NULL as atlas_id,
          NULL as steam_id,
          NULL as lc_id,
          NULL as lcId,
          NULL as lewdCornerId,
          gog_data.title as title,
          COALESCE(NULLIF(gog_data.developer, ''), gog_data.publisher) as creator,
          gog_data.engine as engine,
          gog_data.overview as description,
          0 as total_playtime,
          0 as last_played_r,
          '' as last_played_version,
          COALESCE(gog_data.header, gog_data.library_hero) AS banner_url,
          CASE WHEN COALESCE(gog_data.header, gog_data.library_hero) IS NOT NULL THEN 'stream' ELSE '' END AS banner_source,
          0 AS has_downloaded_banner,
          NULL as f95_id,
          CASE WHEN gog_data.gog_id IS NOT NULL THEN 'https://www.gog.com/game/' || gog_data.gog_id ELSE NULL END as siteUrl,
          NULL as views,
          NULL as likes,
          gog_data.tags as f95_tags,
          NULL as rating,
          NULL as lewdCornerSiteUrl,
          NULL as lewdCornerBannerUrl,
          NULL as lewdcornerTags,
          NULL as lewdcornerRating,
          NULL as lewdcornerViews,
          NULL as lewdcornerLikes,
          NULL as lewdcornerTier,
          NULL as lewdcornerPrefixes,
          NULL as lewdcornerThreadUpdated,
          NULL as lewdcornerRegisterDate,
          gog_data.release_state as status,
          NULL as latestVersion,
          gog_data.category AS category,
          gog_data.censored AS censored,
          gog_data.genre AS genre,
          gog_data.language AS language,
          gog_data.os AS os,
          gog_data.overview AS overview,
          gog_data.translations AS translations,
          gog_data.release_date AS release_date,
          NULL AS atlas_last_record_update,
          NULL AS steam_release_date,
          NULL AS thread_updated,
          gog_data.release_date AS thread_publish_date,
          NULL AS f95_latest_order,
          NULL AS f95_last_record_update,
          gog_data.voice AS voice,
          gog_data.publisher AS publisher,
          NULL AS steam_developer,
          gog_data.title AS short_name,
          '{"gog_id":"' || gog_data.gog_id || '"}' as external_ids,
          NULL as atlas_banner_wide,
          NULL as atlas_banner,
          NULL as atlas_logo,
          NULL as f95_banner,
          NULL as lewdcorner_banner,
          NULL as steam_header,
          NULL as steam_library_hero,
          NULL as steam_library_capsule,
          NULL as steam_logo,
          NULL as logo_position,
          gog_data.header as gog_header,
          gog_data.library_hero as gog_library_hero,
          gog_data.library_capsule as gog_library_capsule,
          gog_data.logo as gog_logo,
          gog_data.gog_id as gog_id,
          gog_data.release_date AS gog_release_date,
          gog_data.developer AS gog_developer,
          gog_data.tags AS tags
        FROM gog_data
        LEFT JOIN atlas_data ON gog_data.atlas_id = atlas_data.atlas_id
        WHERE gog_data.atlas_id IS NULL OR atlas_data.atlas_id IS NULL
      ),
      gog_branch AS (
        SELECT
          *,
          local_record_id AS localRecordId,
          local_record_id AS installedRecordId,
          CASE WHEN local_record_id IS NOT NULL THEN 1 ELSE 0 END AS is_installed
        FROM gog_branch_base
      ),
      lewdcorner_branch_base AS (
        SELECT
          'catalog:lewdcorner:' || lewdcorner_data.lc_id as record_id,
          'lewdcorner:' || lewdcorner_data.lc_id as catalogKey,
          (SELECT MIN(lm.record_id) FROM lewdcorner_mappings lm WHERE lm.lc_id = lewdcorner_data.lc_id) AS local_record_id,
          'lewdcorner' as source,
          NULL as atlas_id,
          NULL as steam_id,
          lewdcorner_data.lc_id as lc_id,
          lewdcorner_data.lc_id as lcId,
          lewdcorner_data.lc_id as lewdCornerId,
          'LewdCorner #' || lewdcorner_data.lc_id as title,
          'Unknown' as creator,
          NULL as engine,
          NULL as description,
          0 as total_playtime,
          0 as last_played_r,
          '' as last_played_version,
          lewdcorner_data.banner_url AS banner_url,
          CASE WHEN lewdcorner_data.banner_url IS NOT NULL THEN 'stream' ELSE '' END AS banner_source,
          0 AS has_downloaded_banner,
          NULL as f95_id,
          lewdcorner_data.site_url as siteUrl,
          lewdcorner_data.views as views,
          lewdcorner_data.likes as likes,
          lewdcorner_data.tags as f95_tags,
          lewdcorner_data.rating as rating,
          lewdcorner_data.site_url as lewdCornerSiteUrl,
          lewdcorner_data.banner_url as lewdCornerBannerUrl,
          lewdcorner_data.tags as lewdcornerTags,
          lewdcorner_data.rating as lewdcornerRating,
          lewdcorner_data.views as lewdcornerViews,
          lewdcorner_data.likes as lewdcornerLikes,
          lewdcorner_data.tier as lewdcornerTier,
          lewdcorner_data.prefixes as lewdcornerPrefixes,
          lewdcorner_data.thread_updated as lewdcornerThreadUpdated,
          lewdcorner_data.register_date as lewdcornerRegisterDate,
          NULL as status,
          NULL as latestVersion,
          NULL AS category,
          NULL AS censored,
          NULL AS genre,
          NULL AS language,
          NULL AS os,
          NULL AS overview,
          NULL AS translations,
          NULL AS release_date,
          NULL AS atlas_last_record_update,
          NULL AS steam_release_date,
          lewdcorner_data.thread_updated AS thread_updated,
          lewdcorner_data.register_date AS thread_publish_date,
          NULL AS f95_latest_order,
          lewdcorner_data.last_record_update AS f95_last_record_update,
          NULL AS voice,
          NULL AS publisher,
          NULL AS steam_developer,
          'LewdCorner #' || lewdcorner_data.lc_id AS short_name,
          NULL as external_ids,
          NULL as atlas_banner_wide,
          NULL as atlas_banner,
          NULL as atlas_logo,
          NULL as f95_banner,
          lewdcorner_data.banner_url as lewdcorner_banner,
          NULL as steam_header,
          NULL as steam_library_hero,
          NULL as steam_library_capsule,
          NULL as steam_logo,
          NULL as logo_position,
          NULL as gog_header,
          NULL as gog_library_hero,
          NULL as gog_library_capsule,
          NULL as gog_logo,
          NULL as gog_id,
          NULL AS gog_release_date,
          NULL AS gog_developer,
          lewdcorner_data.tags AS tags
        FROM lewdcorner_data
        LEFT JOIN atlas_data ON lewdcorner_data.atlas_id = atlas_data.atlas_id
        WHERE lewdcorner_data.atlas_id IS NULL OR atlas_data.atlas_id IS NULL
      ),
      lewdcorner_branch AS (
        SELECT
          *,
          local_record_id AS localRecordId,
          local_record_id AS installedRecordId,
          CASE WHEN local_record_id IS NOT NULL THEN 1 ELSE 0 END AS is_installed
        FROM lewdcorner_branch_base
      )
      SELECT * FROM atlas_branch
      UNION ALL
      SELECT * FROM steam_branch
      UNION ALL
      SELECT * FROM gog_branch
      UNION ALL
      SELECT * FROM lewdcorner_branch
    `;

      // Joins favorite/personal-rating data in from the local `games` /
      // game_personal_ratings tables via local_record_id — only ever
      // populated for catalog rows that are actually installed, same as
      // is_installed itself. See the favoritesOnly/personalRating filter
      // handling above.
      const catalogJoins = `
        LEFT JOIN games AS local_games ON local_games.record_id = catalog.local_record_id
        LEFT JOIN game_personal_ratings AS local_ratings ON local_ratings.record_id = catalog.local_record_id
      `;

      const pagedQuery = `
        SELECT catalog.*
        FROM (${query}) catalog
        ${catalogJoins}
        ${whereClause}
        ${orderByClause}
        LIMIT ? OFFSET ?
      `;
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM (${query}) catalog
        ${catalogJoins}
        ${whereClause}
      `;

      const mapCatalogRow = (row) => ({
        ...row,
        title: String(row.title || row.short_name || "Unknown Title"),
        creator: String(row.creator || "Unknown"),
        engine: row.engine ? String(row.engine).replace(/''/g, "'") : row.engine,
        status: row.status == null ? null : String(row.status),
        category: row.category == null ? null : String(row.category),
        censored: row.censored == null ? null : String(row.censored),
        language: row.language == null ? null : String(row.language),
        f95_tags: String(row.f95_tags || ""),
        threadUpdated: row.thread_updated || null,
        threadPublishDate: row.thread_publish_date || null,
        f95LatestOrder: row.f95_latest_order || null,
        versions: [],
        versionCount: 0,
        installedVersionCount: row.is_installed ? 1 : 0,
        totalVersionCount: row.is_installed ? 1 : 0,
        hasInstalledVersion: row.is_installed === 1,
        // Plain catalog rows never carry the local version history needed
        // to know this (see the updateAvailable branch below, which
        // computes it for real for that specific case) — left false here
        // rather than paying for an extra versions lookup on every single
        // Browse page just to populate a badge most rows don't need.
        isUpdateAvailable: false,
        isCatalogEntry: true,
        isMetadataOnly: true,
      });

      // Updates-available can't be expressed as a SQL predicate — it needs
      // the exact same version-string comparison logic local mode uses
      // (getIsUpdateAvailable: numeric-aware version comparison, "Final"
      // handling, etc.), which depends on each row's actual local version
      // history. Fetch the (bounded — only the is_installed subset, see
      // the WHERE clause this implies above) candidate rows, pull their
      // version history in one follow-up query, and filter/paginate/count
      // in JS instead of in SQL. Checked BEFORE the generic countOnly
      // branch below since a countOnly + updateAvailable request (exactly
      // what previewing the "Updates available" saved filter's count
      // does) needs this same JS comparison too, not the plain SQL count.
      if (filters.updateAvailable === true) {
        const candidateQuery = `
          SELECT catalog.*
          FROM (${query}) catalog
          ${catalogJoins}
          ${whereClause}
          ${orderByClause}
        `;
        getDb().all(candidateQuery, queryParams, (err, candidateRows) => {
          if (err) {
            console.error("Error fetching AtlasDB catalog candidates for updateAvailable:", err);
            reject(err);
            return;
          }
          const rows = candidateRows || [];
          const recordIds = [...new Set(
            rows.map((row) => row.local_record_id).filter((id) => id !== null && id !== undefined),
          )];
          if (recordIds.length === 0) {
            const total = 0;
            if (countOnly) {
              resolve({ games: [], offset: 0, limit, total, hasMore: false, countOnly: true });
            } else {
              resolve({ games: [], offset, limit, total: includeTotal ? total : null, hasMore: false });
            }
            return;
          }
          getDb().all(
            `SELECT record_id, version, date_added FROM versions WHERE record_id IN (${recordIds.map(() => '?').join(', ')})`,
            recordIds,
            (versionsErr, versionRows) => {
              if (versionsErr) {
                console.error("Error fetching local versions for updateAvailable:", versionsErr);
                reject(versionsErr);
                return;
              }
              const versionsByRecord = new Map();
              for (const versionRow of versionRows || []) {
                if (!versionsByRecord.has(versionRow.record_id)) versionsByRecord.set(versionRow.record_id, []);
                versionsByRecord.get(versionRow.record_id).push({ version: versionRow.version });
              }
              const matchingRows = rows.filter((row) =>
                getIsUpdateAvailable(
                  row.latestVersion,
                  versionsByRecord.get(row.local_record_id) || [],
                ),
              );
              const total = matchingRows.length;
              if (countOnly) {
                resolve({ games: [], offset: 0, limit, total, hasMore: total > 0, countOnly: true });
                return;
              }
              const games = matchingRows.slice(offset, offset + limit).map((row) => ({
                ...mapCatalogRow(row),
                isUpdateAvailable: true,
              }));
              resolve({
                games,
                offset,
                limit,
                total: includeTotal ? total : null,
                hasMore: offset + games.length < total,
              });
            },
          );
        });
        return;
      }

      if (countOnly) {
        getDb().get(countQuery, queryParams, (err, row) => {
          if (err) {
            console.error("Error counting AtlasDB catalog games:", err);
            reject(err);
            return;
          }
          const total = Number(row?.total || 0);
          resolve({ games: [], offset: 0, limit, total, hasMore: total > 0, countOnly: true });
        });
        return;
      }

      const finish = (total = null) => {
        getDb().all(pagedQuery, [...queryParams, limit, offset], (err, rows) => {
        if (err) {
          console.error("Error fetching AtlasDB catalog games:", err);
          reject(err);
          return;
        }

        const games = (rows || []).map(mapCatalogRow);

        const threadUpdatedCount = games.filter((game) => game.threadUpdated).length;
        const threadPublishDateCount = games.filter((game) => game.threadPublishDate).length;
        console.log(
          `Fetched ${games.length} AtlasDB catalog games ` +
          `(thread_updated column ${hasThreadUpdated ? 'available' : 'unavailable'}, ` +
          `f95_latest_order column ${hasF95LatestOrder ? 'available' : 'unavailable'}, ` +
          `thread_updated populated ${threadUpdatedCount}, ` +
          `thread_publish_date populated ${threadPublishDateCount})`,
        );
          resolve({
            games,
            offset,
            limit,
            total,
            hasMore: total === null ? games.length >= limit : offset + games.length < total,
          });
        });
      };

      if (!includeTotal) {
        finish(null);
        return;
      }

      getDb().get(countQuery, queryParams, (err, row) => {
        if (err) {
          console.error("Error counting AtlasDB catalog games:", err);
          reject(err);
          return;
        }
        finish(Number(row?.total || 0));
      });
    }).catch(reject);
  });
};

const checkRecordExist = (title, creator, engine, version, path) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT g.record_id
       FROM games g
       LEFT JOIN versions v ON g.record_id = v.record_id
       WHERE TRIM(g.title) = ? AND TRIM(g.creator) = ? AND TRIM(v.version) = ?
       OR v.game_path = ?`,
      [title.trim(), creator.trim(), version.trim(), path.trim()],
      (err, row) => {
        if (err) {
          console.error("Error checking record existence:", err);
          reject(err);
        } else {
          resolve(!!row);
        }
      },
    );
  });
};

const checkPathExist = (gamePath, title) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT v.record_id FROM games g JOIN versions v ON g.record_id = v.record_id WHERE g.title = ? AND v.game_path = ?`,
      [title, gamePath],
      (err, row) => {
        if (err) reject(err);
        resolve(!!row);
      },
    );
  });
};

module.exports = {
  addVersion,
  upsertVersion,
  updateVersion,
  findExistingRecordForImport,
  checkRecordExist,
  checkPathExist,
  getVersionForRecord,
  getInstalledVersionsForRecord,
  getVersionPathsForRecord,
  getGame,
  getGames,
  getCatalogGames,
  normalizePathForCompare,
  DEFAULT_LAUNCHABLE_EXTENSIONS,
  normalizeExtensions,
  isLaunchableFile,
  findLaunchablesInFolder,
  chooseLaunchableForRepair,
  normalizeVersionName,
  getUniqueVersionName,
  getIsUpdateAvailable,
}
