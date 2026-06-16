'use strict'

const path = require('path')
const fs = require('fs')
const fsPromises = fs.promises
const dbModule = require('./index')
const getDb = () => dbModule.db
const { toLocalAssetPath, normalizeMediaStorageMode, remoteBannerExpression,
        buildBannerJoinClauses, buildBannerSelectFields, getAssetBasePath } = require('./helpers')


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

const addVersion = (game, recordId) => {
  const { version, folder, executables, folderSize = 0 } = game;
  const executable =
    executables && executables.length > 0 ? executables[0].value : "";
  const gamePath = String(folder || "");
  const execPath = executable ? path.join(gamePath, executable) : "";
  const dateAdded = Math.floor(Date.now() / 1000);

  console.log("adding version");
  return new Promise((resolve, reject) => {
    getDb().run(
      `INSERT OR REPLACE INTO versions (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        recordId,
        version,
        gamePath,
        execPath,
        true,
        dateAdded,
        folderSize,
      ],
      (err) => {
        if (err) {
          console.error("Error adding or updating version:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const upsertVersion = (game, recordId) => {
  const version = String(game.version || "Unknown");
  const folder = String(game.folder || game.game_path || "");
  const executable =
    game.execPath ||
    game.exec_path ||
    (game.selectedValue ? path.join(folder, game.selectedValue) : "");
  const folderSize = game.folderSize || game.folder_size || 0;
  const dateAdded = Math.floor(Date.now() / 1000);

  return new Promise((resolve, reject) => {
    const writeVersion = () => {
      getDb().run(
        `INSERT INTO versions
         (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
         ON CONFLICT(record_id, version) DO UPDATE SET
           game_path = excluded.game_path,
           exec_path = excluded.exec_path,
           in_place = excluded.in_place,
           folder_size = CASE
             WHEN excluded.folder_size > 0 THEN excluded.folder_size
             ELSE versions.folder_size
           END`,
        [recordId, version, folder, executable, true, dateAdded, folderSize],
        (err) => {
          if (err) {
            console.error("Error upserting version:", err);
            reject(err);
          } else {
            resolve();
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

        getDb().run(
          `UPDATE versions
           SET record_id = ?, version = ?, exec_path = ?, in_place = ?, folder_size = CASE
             WHEN ? > 0 THEN ?
             ELSE folder_size
           END
           WHERE rowid = ?`,
          [recordId, version, executable, true, folderSize, folderSize, row.rowid],
          (err) => {
            if (err) {
              console.error("Error repairing version by exact path:", err);
              reject(err);
            } else {
              resolve();
            }
          },
        );
      },
    );
  });
};

const updateVersion = (version, record_id) => {
  const previousVersion = version.previousVersion || version.version;

  console.log("updating version with id:", record_id);
  return new Promise((resolve, reject) => {
    getDb().run(
      `UPDATE versions SET version = ?, game_path = ?, exec_path = ?
       WHERE record_id = ? AND version = ?`,
      [
        version.version,
        version.game_path,
        version.exec_path,
        record_id,
        previousVersion,
      ],
      (err) => {
        if (err) {
          console.error("Error updating version:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const findExistingRecordForImport = (game) => {
  const atlasId = game.atlasId || game.atlas_id || null;
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

function normalizeVersionForCompare(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^v/, "")
    .replace(/[^0-9.]/g, "");
}

function compareVersionParts(current, latest) {
  const currentParts = current.split(".").map((n) => parseInt(n, 10) || 0);
  const latestParts = latest.split(".").map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(currentParts.length, latestParts.length);

  while (currentParts.length < maxLen) currentParts.push(0);
  while (latestParts.length < maxLen) latestParts.push(0);

  for (let i = 0; i < maxLen; i++) {
    if (currentParts[i] < latestParts[i]) return -1;
    if (currentParts[i] > latestParts[i]) return 1;
  }

  return 0;
}

function getIsUpdateAvailable(latestVersion, versions) {
  if (!latestVersion || !versions || versions.length === 0) return false;

  if (
    versions.some((version) =>
      String(version.version || "")
        .trim()
        .toLowerCase()
        .includes("final"),
    )
  ) {
    return false;
  }

  const latest = normalizeVersionForCompare(latestVersion);
  if (!latest) return false;

  // Find the newest local version. An update is only available if even the
  // newest installed/known version is older than the latest — not if *any*
  // single version happens to be older.
  let newest = null;
  for (const version of versions) {
    const current = normalizeVersionForCompare(version.version);
    if (!current) continue;
    if (newest === null || compareVersionParts(current, newest) > 0) {
      newest = current;
    }
  }
  if (newest === null) return false;

  return compareVersionParts(newest, latest) < 0;
}

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
    version: row.version,
    game_path: row.game_path,
    exec_path: row.exec_path,
    in_place: row.in_place,
    last_played: row.last_played,
    version_playtime: row.version_playtime,
    folder_size: row.folder_size,
    date_added: row.date_added,
    isInstalled,
    installState: skipPathValidation && hasPathValue && !forceInstalled
      ? "pending"
      : isInstalled
        ? "installed"
        : "missing",
  };
}

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
         v.version,
         v.game_path,
         v.exec_path,
         v.in_place,
         v.last_played,
         v.version_playtime,
         v.folder_size,
         v.date_added,
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
        resolve(mapVersionRow(row, !!row.steam_id));
      },
    );
  });
};

const getInstalledVersionsForRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT version, game_path, exec_path, folder_size, date_added
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
        steam_mappings.steam_id as steam_id,
        games.title as title,
        games.creator as creator,
        games.engine as engine,
        games.description,
        games.total_playtime,
        games.last_played_r,
        games.last_played_version,
${bannerSelectFields},
        f95_zone_data.f95_id as f95_id,
        f95_zone_data.site_url as siteUrl,
        f95_zone_data.views as views,
        f95_zone_data.likes as likes,
        f95_zone_data.tags as f95_tags,
        f95_zone_data.rating as rating,
        atlas_data.status,
        atlas_data.version as latestVersion,
        COALESCE(NULLIF(atlas_data.category, ''), steam_data.category) AS category,
        COALESCE(NULLIF(atlas_data.censored, ''), steam_data.censored) AS censored,
        COALESCE(NULLIF(atlas_data.genre, ''), steam_data.genre) AS genre,
        COALESCE(NULLIF(atlas_data.language, ''), steam_data.language) AS language,
        COALESCE(NULLIF(atlas_data.os, ''), steam_data.os) AS os,
        COALESCE(NULLIF(atlas_data.overview, ''), steam_data.overview) AS overview,
        COALESCE(NULLIF(atlas_data.translations, ''), steam_data.translations) AS translations,
        atlas_data.release_date,
        COALESCE(NULLIF(atlas_data.voice, ''), steam_data.voice) AS voice,
        steam_data.publisher AS publisher,
        atlas_data.short_name,
        atlas_data.external_ids as external_ids,
        atlas_data.banner_wide as atlas_banner_wide,
        atlas_data.banner as atlas_banner,
        atlas_data.logo as atlas_logo,
        f95_zone_data.banner_url as f95_banner,
        steam_data.header as steam_header,
        steam_data.library_hero as steam_library_hero,
        steam_data.logo as steam_logo,
        GROUP_CONCAT(tags.tag) AS tags
      FROM
        games
      LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
      LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
${bannerJoinClauses}
      LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
      LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
      LEFT JOIN steam_data ON steam_mappings.steam_id = steam_data.steam_id
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
        `SELECT version, game_path, exec_path, in_place, last_played, version_playtime, folder_size, date_added
         FROM versions
         WHERE record_id = ?`,
        [recordId],
        (err, versionRows) => {
          if (err) {
            console.error("Error fetching versions:", err);
            reject(err);
            return;
          }
          const game = {
            ...row,
            engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
            versions: versionRows.map((v) => mapVersionRow(v, !!row.steam_id)),
            versionCount: versionRows.length,
            isUpdateAvailable: false,
          };
          const installedVersions = game.versions.filter((v) => v.isInstalled);
          game.installedVersionCount = installedVersions.length;
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
        steam_mappings.steam_id as steam_id,
        games.title as title,
        games.creator as creator,
        games.engine as engine,
        games.description,
        games.total_playtime,
        games.last_played_r,
        games.last_played_version,
${bannerSelectFields},
        f95_zone_data.f95_id as f95_id,
        f95_zone_data.site_url as siteUrl,
        f95_zone_data.views as views,
        f95_zone_data.likes as likes,
        f95_zone_data.tags as f95_tags,
        f95_zone_data.rating as rating,
        atlas_data.status,
        atlas_data.version as latestVersion,
        COALESCE(NULLIF(atlas_data.category, ''), steam_data.category) AS category,
        COALESCE(NULLIF(atlas_data.censored, ''), steam_data.censored) AS censored,
        COALESCE(NULLIF(atlas_data.genre, ''), steam_data.genre) AS genre,
        COALESCE(NULLIF(atlas_data.language, ''), steam_data.language) AS language,
        COALESCE(NULLIF(atlas_data.os, ''), steam_data.os) AS os,
        COALESCE(NULLIF(atlas_data.overview, ''), steam_data.overview) AS overview,
        COALESCE(NULLIF(atlas_data.translations, ''), steam_data.translations) AS translations,
        atlas_data.release_date,
        COALESCE(NULLIF(atlas_data.voice, ''), steam_data.voice) AS voice,
        steam_data.publisher AS publisher,
        atlas_data.short_name,
        atlas_data.external_ids as external_ids,
        atlas_data.banner_wide as atlas_banner_wide,
        atlas_data.banner as atlas_banner,
        atlas_data.logo as atlas_logo,
        f95_zone_data.banner_url as f95_banner,
        steam_data.header as steam_header,
        steam_data.library_hero as steam_library_hero,
        steam_data.logo as steam_logo,
        GROUP_CONCAT(tags.tag) AS tags
      FROM
        games
      LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
      LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
${bannerJoinClauses}
      LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
      LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
      LEFT JOIN steam_data ON steam_mappings.steam_id = steam_data.steam_id
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
      SELECT record_id, version, game_path, exec_path, in_place, last_played, version_playtime, folder_size, date_added
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
                mapVersionRow(version, !!row.steam_id, { skipPathValidation }),
            );
            const installedVersions = allVersions.filter(
              (version) => version.isInstalled,
            );
            const versions = includeUninstalled
              ? allVersions
              : installedVersions;

            return {
              ...row,
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
            };
          })
          .filter(
            (game) => includeUninstalled || game.hasInstalledVersion,
          );

        if (!includeUninstalled) {
          console.log(`Fetched ${games.length} games with versions`);
          resolve(games);
          return;
        }

        const metadataOnlyQuery = `
          SELECT
            'metadata:' || atlas_data.atlas_id as record_id,
            atlas_data.atlas_id as atlas_id,
            MIN(steam_data.steam_id) as steam_id,
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
            f95_zone_data.site_url as siteUrl,
            f95_zone_data.views as views,
            f95_zone_data.likes as likes,
            f95_zone_data.tags as f95_tags,
            f95_zone_data.rating as rating,
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
            COALESCE(NULLIF(atlas_data.voice, ''), MIN(steam_data.voice)) AS voice,
            MIN(steam_data.publisher) AS publisher,
            atlas_data.short_name,
            atlas_data.external_ids as external_ids,
            atlas_data.banner_wide as atlas_banner_wide,
            atlas_data.banner as atlas_banner,
            atlas_data.logo as atlas_logo,
            f95_zone_data.banner_url as f95_banner,
            MIN(steam_data.header) as steam_header,
            MIN(steam_data.library_hero) as steam_library_hero,
            MIN(steam_data.logo) as steam_logo,
            '' AS tags
          FROM atlas_data
          LEFT JOIN atlas_mappings ON atlas_data.atlas_id = atlas_mappings.atlas_id
          LEFT JOIN f95_zone_data ON atlas_data.atlas_id = f95_zone_data.atlas_id
          LEFT JOIN f95_zone_mappings ON f95_zone_data.f95_id = f95_zone_mappings.f95_id
          LEFT JOIN steam_data ON atlas_data.atlas_id = steam_data.atlas_id
          LEFT JOIN steam_mappings ON steam_data.steam_id = steam_mappings.steam_id
          WHERE atlas_mappings.record_id IS NULL
            AND f95_zone_mappings.record_id IS NULL
            AND steam_mappings.record_id IS NULL
          GROUP BY atlas_data.atlas_id
        `;

        getDb().all(metadataOnlyQuery, [], (metadataErr, metadataRows) => {
          if (metadataErr) {
            console.error("Error fetching metadata-only games:", metadataErr);
            resolve(games);
            return;
          }

          const metadataGames = (metadataRows || []).map((row) => ({
            ...row,
            title: row.title || row.short_name || "Unknown Title",
            creator: row.creator || "Unknown",
            engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
            versions: [],
            versionCount: 0,
            installedVersionCount: 0,
            totalVersionCount: 0,
            hasInstalledVersion: false,
            isUpdateAvailable: false,
            isMetadataOnly: true,
          }));
          const combinedGames = [...games, ...metadataGames];
          console.log(`Fetched ${combinedGames.length} games with versions`);
          resolve(combinedGames);
        });
      });
    });
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
  normalizePathForCompare,
  DEFAULT_LAUNCHABLE_EXTENSIONS,
  normalizeExtensions,
  isLaunchableFile,
  findLaunchablesInFolder,
  chooseLaunchableForRepair,
}
