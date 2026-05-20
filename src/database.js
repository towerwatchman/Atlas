const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;

let db;
let cachedFilterOptions = null;

const getAssetBasePath = (appPath, isDev) =>
  isDev ? path.join(appPath, "src") : appPath;

const initializeDatabase = (dataDir) => {
  const dbPath = path.join(dataDir, "data.db");
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database error:", err);
  });

  db.serialize(() => {
    // Table creation migrations from C#
    db.run(`
      CREATE TABLE IF NOT EXISTS games
      (
        record_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        creator TEXT NOT NULL,
        engine TEXT,
        last_played_r DATE DEFAULT 0,
        total_playtime INTEGER DEFAULT 0,
        description TEXT,
        last_played_version TEXT,
        UNIQUE (title, creator, engine)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS versions
      (
        record_id INTEGER REFERENCES games (record_id),
        version TEXT,
        game_path TEXT,
        exec_path TEXT,
        in_place BOOLEAN,
        last_played DATE,
        version_playtime INTEGER,
        folder_size INTEGER,
        date_added INTEGER,
        UNIQUE (record_id, version)
      );
    `);
    db.run(`
      CREATE VIEW IF NOT EXISTS last_import_times (record_id, last_import) AS
      SELECT DISTINCT record_id, versions.date_added
      FROM games
      NATURAL JOIN versions
      ORDER BY versions.date_added DESC;
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_data
      (
        atlas_id INTEGER PRIMARY KEY,
        id_name STRING UNIQUE,
        short_name STRING,
        title STRING,
        original_name STRING,
        category STRING,
        engine STRING,
        status STRING,
        version STRING,
        developer STRING,
        creator STRING,
        overview STRING,
        censored STRING,
        language STRING,
        translations STRING,
        genre STRING,
        tags STRING,
        voice STRING,
        os STRING,
        release_date DATE,
        length STRING,
        banner STRING,
        banner_wide STRING,
        cover STRING,
        logo STRING,
        wallpaper STRING,
        previews STRING,
        last_record_update STRING
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_previews
      (
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        preview_url STRING NOT NULL,
        UNIQUE (atlas_id, preview_url)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_mappings
      (
        record_id INTEGER REFERENCES games (record_id) PRIMARY KEY,
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        UNIQUE (record_id, atlas_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_data
      (
        f95_id INTEGER UNIQUE PRIMARY KEY,
        atlas_id INTEGER REFERENCES atlas_data (atlas_id) UNIQUE,
        banner_url STRING,
        site_url STRING,
        last_thread_comment STRING,
        thread_publish_date STRING,
        last_record_update STRING,
        views STRING,
        likes STRING,
        tags STRING,
        rating STRING,
        screens STRING,
        replies STRING
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_screens
      (
        f95_id INTEGER REFERENCES f95_zone_data (f95_id),
        screen_url TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS updates
      (
        update_time INTEGER PRIMARY KEY,
        processed_time INTEGER,
        md5 BLOB
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS tags
      (
        tag_id INTEGER PRIMARY KEY,
        tag TEXT UNIQUE
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS tag_mappings
      (
        record_id INTEGER REFERENCES games (record_id),
        tag_id INTEGER REFERENCES tags (tag_id),
        UNIQUE (record_id, tag_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_tags
      (
        tag_id INTEGER REFERENCES tags (tag_id),
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        UNIQUE (atlas_id, tag_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_tags
      (
        f95_id INTEGER REFERENCES f95_zone_data (f95_id),
        tag_id INTEGER REFERENCES tags (tag_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS previews
      (
        record_id INTEGER REFERENCES games (record_id),
        path TEXT UNIQUE,
        position INTEGER DEFAULT 256,
        UNIQUE (record_id, path)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS banners
      (
        record_id INTEGER REFERENCES games (record_id),
        path TEXT UNIQUE,
        type INTEGER,
        UNIQUE (record_id, path, type)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS data_change
      (
        timestamp INTEGER,
        delta INTEGER
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_mappings
      (
        record_id INTEGER REFERENCES games(record_id),
        f95_id INTEGER REFERENCES f95_zone_data(f95_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS emulators
      (
        extension TEXT PRIMARY KEY,
        program_path TEXT NOT NULL,
        parameters TEXT
      );
    `);
    db.run(`
  CREATE TABLE IF NOT EXISTS steam_data
  (
    steam_id INTEGER PRIMARY KEY,
    atlas_id INTEGER REFERENCES atlas_data (atlas_id),
    title TEXT,
    category TEXT,
    engine TEXT,
    developer TEXT,
    publisher TEXT,
    overview TEXT,
    censored TEXT,
    language TEXT,
    translations TEXT,
    genre TEXT,
    tags TEXT,
    voice TEXT,
    os TEXT,
    release_state TEXT,
    release_date TEXT,
    header TEXT,
    library_hero TEXT,
    logo TEXT,
    last_record_update TEXT
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS steam_screens
  (
    steam_id INTEGER REFERENCES steam_data (steam_id),
    screen_url TEXT NOT NULL,
    UNIQUE (steam_id, screen_url)
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS steam_mappings
  (
    record_id INTEGER REFERENCES games (record_id) PRIMARY KEY,
    steam_id INTEGER REFERENCES steam_data (steam_id),
    UNIQUE (record_id, steam_id)
  );
`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_versions_game_path ON versions(game_path);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_versions_record_version ON versions(record_id, version);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_mappings_atlas_id ON atlas_mappings(atlas_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_banners_record_type ON banners(record_id, type);`);
  });
};

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

const repairDoubledApostropheRows = () => {
  if (!db) return Promise.resolve();

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

  return new Promise((resolve, reject) => {
    db.serialize(async () => {
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
  if (!db) return Promise.resolve();

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this.changes || 0);
      });
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        const rows = await all(
          `SELECT rowid, record_id, version, game_path, exec_path
           FROM versions
           WHERE game_path IS NOT NULL AND TRIM(game_path) != ''`,
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

const addGame = (game) => {
  return new Promise((resolve, reject) => {
    const { title, creator, engine } = game;

    // Check if game already exists
    db.get(
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
        db.run(
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
    db.run(
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

const addVersion = (game, recordId) => {
  const { version, folder, executables, folderSize = 0 } = game;
  const executable =
    executables && executables.length > 0 ? executables[0].value : "";
  const gamePath = String(folder || "");
  const execPath = executable ? path.join(gamePath, executable) : "";
  const dateAdded = Math.floor(Date.now() / 1000);

  console.log("adding version");
  return new Promise((resolve, reject) => {
    db.run(
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
      db.run(
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

    db.get(
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

        db.run(
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
    db.run(
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
      db.get(
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
      db.get(
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

      db.get(
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

const recordGameLaunchStarted = (recordId, version, timestamp) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
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
      db.run(
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
    db.serialize(() => {
      db.run(
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
      db.run(
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

  return versions.some((version) => {
    const current = normalizeVersionForCompare(version.version);
    if (!current) return false;
    return compareVersionParts(current, latest) < 0;
  });
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

    db.get(
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

const getVersionPathsForRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    db.all(
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

const getGame = (recordId, appPath, isDev) => {
  return new Promise((resolve, reject) => {
    const baseImagePath = getAssetBasePath(appPath, isDev);
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
        CASE 
          WHEN banners.path IS NOT NULL THEN REPLACE('${baseImagePath}/' || banners.path, '\\', '/')
          ELSE NULL
        END AS banner_url,
        f95_zone_data.f95_id as f95_id,
        f95_zone_data.site_url as siteUrl,
        f95_zone_data.views as views,
        f95_zone_data.likes as likes,
        f95_zone_data.tags as f95_tags,
        f95_zone_data.rating as rating,
        atlas_data.status,
        atlas_data.version as latestVersion,
        atlas_data.category,
        atlas_data.censored,
        atlas_data.genre,
        atlas_data.language,
        atlas_data.os,
        atlas_data.overview,
        atlas_data.translations,
        atlas_data.release_date,
        atlas_data.voice,
        atlas_data.short_name,
        GROUP_CONCAT(tags.tag) AS tags
      FROM
        games
      LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
      LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
      LEFT JOIN banners ON games.record_id = banners.record_id AND banners.type = 'small'
      LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
      LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
      LEFT JOIN tag_mappings ON games.record_id = tag_mappings.record_id
      LEFT JOIN tags ON tag_mappings.tag_id = tags.tag_id
      WHERE games.record_id = ?
      GROUP BY games.record_id
    `;
    db.get(query, [recordId], (err, row) => {
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
      db.all(
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
    const includeUninstalled = options.includeUninstalled === true;
    const skipPathValidation = options.skipPathValidation !== false;

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
        CASE 
          WHEN banners.path IS NOT NULL THEN REPLACE('${baseImagePath}/' || banners.path, '\\', '/')
          ELSE NULL
        END AS banner_url,
        f95_zone_data.f95_id as f95_id,
        f95_zone_data.site_url as siteUrl,
        f95_zone_data.views as views,
        f95_zone_data.likes as likes,
        f95_zone_data.tags as f95_tags,
        f95_zone_data.rating as rating,
        atlas_data.status,
        atlas_data.version as latestVersion,
        atlas_data.category,
        atlas_data.censored,
        atlas_data.genre,
        atlas_data.language,
        atlas_data.os,
        atlas_data.overview,
        atlas_data.translations,
        atlas_data.release_date,
        atlas_data.voice,
        atlas_data.short_name,
        GROUP_CONCAT(tags.tag) AS tags
      FROM
        games
      LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
      LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
      LEFT JOIN banners ON games.record_id = banners.record_id AND banners.type = 'small'
      LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
      LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
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
    db.all(mainQuery, params, (err, rows) => {
      if (err) {
        console.error("Error fetching games:", err);
        reject(err);
        return;
      }

      // Execute versions query
      db.all(versionsQuery, [], (err, versionRows) => {
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

        console.log(`Fetched ${games.length} games with versions`);
        resolve(games);
      });
    });
  });
};

const getGameRecordIds = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT record_id FROM games ORDER BY title COLLATE NOCASE`, [], (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []).map((row) => row.record_id));
    });
  });
};

const removeGame = async (record_id) => {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM games WHERE record_id = ?", [record_id], (err) => {
      if (err) reject(err);
      else resolve({ success: true });
    });
  });
};

// Count versions for a game
const countVersions = (recordId) =>
  new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as count FROM versions WHERE record_id = ?`,
      [recordId],
      (err, row) => (err ? reject(err) : resolve(row?.count || 0)),
    );
  });

// Delete ONE specific version
const deleteVersion = (recordId, version) =>
  new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM versions WHERE record_id = ? AND version = ?`,
      [recordId, version],
      function (err) {
        err ? reject(err) : resolve({ changes: this.changes });
      },
    );
  });

// Full cleanup (images + mappings + versions + game record)
const deleteGameCompletely = async (recordId, appPath, isDev) => {
  try {
    await deleteBanner(recordId, appPath, isDev);
    await deletePreviews(recordId, appPath, isDev);

    const tables = [
      "atlas_mappings",
      "steam_mappings",
      "f95_zone_mappings",
      "tag_mappings",
      // add others if you have more
    ];

    for (const tbl of tables) {
      await new Promise((r, j) =>
        db.run(`DELETE FROM ${tbl} WHERE record_id = ?`, [recordId], (e) =>
          e ? j(e) : r(),
        ),
      );
    }

    await new Promise((r, j) =>
      db.run(`DELETE FROM versions WHERE record_id = ?`, [recordId], (e) =>
        e ? j(e) : r(),
      ),
    );

    await new Promise((r, j) =>
      db.run(`DELETE FROM games WHERE record_id = ?`, [recordId], (e) =>
        e ? j(e) : r(),
      ),
    );

    return { success: true };
  } catch (err) {
    console.error("deleteGameCompletely failed:", err);
    return { success: false, error: err.message };
  }
};

const checkDbUpdates = async (updatesDir, mainWindow) => {
  const axios = require("axios");
  const fs = require("fs");
  const lz4 = require("lz4js");

  try {
    const url = "https://atlas-gamesdb.com/api/updates";
    const response = await axios.get(url);
    const updates = response.data;
    if (!Array.isArray(updates)) throw new Error("Invalid updates data");

    // Get last update version
    const lastUpdateVersion = await new Promise((resolve, reject) => {
      db.get(
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
      return {
        success: true,
        message: "No new updates available",
        total: 0,
        processed: 0,
      };
    }

    let processed = 0;
    for (const update of newUpdates.reverse()) {
      const { date, name, md5 } = update;
      const downloadUrl = `https://atlas-gamesdb.com/packages/${name}`;
      const outputPath = path.join(updatesDir, name);

      // Download update
      mainWindow.webContents.send("db-update-progress", {
        text: `Downloading Database Update ${processed + 1}/${total}`,
        progress: processed,
        total,
      });
      const response = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
      });
      fs.writeFileSync(outputPath, response.data);

      // Decompress LZ4
      const compressedData = fs.readFileSync(outputPath);
      const decompressedData = Buffer.from(lz4.decompress(compressedData));
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
        await insertJsonData(data.f95_zone, "f95_zone_data");
      }

      // Insert update record
      const processedTime = Math.floor(Date.now() / 1000);
      await new Promise((resolve, reject) => {
        db.run(
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
    }

    return {
      success: true,
      message: `Processed ${processed} updates`,
      total,
      processed,
    };
  } catch (err) {
    console.error("Error checking database updates:", err);
    return { success: false, error: err.message, total: 0, processed: 0 };
  }
};

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

  const rowsByAtlasId = new Map();
  const sql = `
    SELECT
      a.atlas_id,
      a.title,
      a.creator,
      a.engine,
      a.version as latestVersion,
      a.short_name,
      f.f95_id
    FROM atlas_data a
    LEFT JOIN f95_zone_data f ON f.atlas_id = a.atlas_id
    WHERE
      a.title LIKE ?
      OR a.creator LIKE ?
      OR a.short_name LIKE ?
      OR ? LIKE '%' || a.short_name || '%'
      OR UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        a.title,
        '-', ''), '_', ''), '/', ''), '\\', ''), ':', ''), ';', ''), '''', ''), ' ', ''), '.', '')) LIKE ?
  `;

  for (const key of searchKeys) {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        sql,
        [`%${title}%`, `%${creator}%`, `%${key}%`, key, `%${key}%`],
        (err, resultRows) => {
          if (err) reject(err);
          else resolve(resultRows || []);
        },
      );
    });
    console.log(`Search key ${key} returned ${rows.length} results`);

    for (const row of rows) {
      const score = scoreAtlasSearchRow(row, searchKeys, title, creator);
      if (score < 650) continue;

      const existing = rowsByAtlasId.get(row.atlas_id);
      if (!existing || score > existing._matchScore) {
        rowsByAtlasId.set(row.atlas_id, {
          ...row,
          f95_id: row.f95_id || "",
          difference: Math.abs(
            normalizeSearchKey(row.short_name || row.title).length - key.length,
          ),
          _matchScore: score,
        });
      }
    }
  }

  const finalResults = Array.from(rowsByAtlasId.values())
    .sort((a, b) => b._matchScore - a._matchScore || a.difference - b.difference)
    .slice(0, 12)
    .map(({ _matchScore, short_name, ...row }) => row);

  console.log(
    `Returning ${finalResults.length} ranked Atlas search results for ${title}`,
  );
  return finalResults;
};

const findF95Id = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(
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
    db.get(
      `SELECT atlas_id FROM atlas_mappings WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.atlas_id : null);
      },
    );
  });
};

const checkRecordExist = (title, creator, engine, version, path) => {
  return new Promise((resolve, reject) => {
    db.get(
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
    db.get(
      `SELECT v.record_id FROM games g JOIN versions v ON g.record_id = v.record_id WHERE g.title = ? AND v.game_path = ?`,
      [title, gamePath],
      (err, row) => {
        if (err) reject(err);
        resolve(!!row);
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
    db.get(
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
        db.get(
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
            db.run(
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

const updateFolderSize = (recordId, version, size) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE versions SET folder_size = ? WHERE record_id = ? AND version = ?`,
      [size, recordId, version],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
};

const getBannerUrl = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT banner_url FROM f95_zone_data WHERE atlas_id = ?`,
      [atlasId],
      (err, row) => {
        if (err) {
          console.error("Error fetching banner_url:", err);
          reject(err);
        } else {
          resolve(row ? row.banner_url : "");
        }
      },
    );
  });
};

const getScreensUrlList = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT screens FROM f95_zone_data WHERE atlas_id = ?`,
      [atlasId],
      (err, row) => {
        if (err) {
          console.error("Error fetching screens:", err);
          reject(err);
        } else {
          const screens =
            row && row.screens
              ? row.screens.split(",").map((s) => s.trim())
              : [];
          resolve(screens);
        }
      },
    );
  });
};

const updateBanners = (recordId, bannerPath, type) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO banners (record_id, path, type) VALUES (?, ?, ?)`,
      [recordId, bannerPath, type],
      (err) => {
        if (err) {
          console.error("Error updating banners:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const updatePreviews = (recordId, previewPath) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO previews (record_id, path) VALUES (?, ?)`,
      [recordId, previewPath],
      (err) => {
        if (err) {
          console.error("Error updating previews:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const getPreviews = (recordId, appPath, isDev) => {
  return new Promise((resolve, reject) => {
    const baseImagePath = getAssetBasePath(appPath, isDev);
    db.all(
      `SELECT path FROM previews WHERE record_id = ?`,
      [recordId],
      (err, rows) => {
        if (err) {
          console.error("Error fetching previews:", err);
          reject(err);
        } else {
          console.log(rows);
          const previews = rows.map(
            (row) =>
              `${path.join(baseImagePath, row.path).replace(/\\/g, "/")}`,
          );
          console.log("Previews fetched for recordId:", recordId, previews);
          resolve(previews);
        }
      },
    );
  });
};

const getBanners = (recordId, appPath, isDev) => {
  return new Promise((resolve, reject) => {
    const baseImagePath = getAssetBasePath(appPath, isDev);
    db.all(
      `SELECT path FROM banners WHERE record_id = ?`,
      [recordId],
      (err, rows) => {
        if (err) {
          console.error("Error fetching banners:", err);
          reject(err);
        } else {
          const banners = rows.map(
            (row) =>
              `${path.join(baseImagePath, row.path).replace(/\\/g, "/")}`,
          );
          console.log("Banners fetched for recordId:", recordId, banners);
          resolve(banners);
        }
      },
    );
  });
};

const getBanner = (recordId, appPath, isDev, type) => {
  return new Promise((resolve, reject) => {
    const baseImagePath = getAssetBasePath(appPath, isDev);
    db.all(
      `SELECT path FROM banners WHERE record_id = ? AND type=?`,
      [recordId, type],
      (err, rows) => {
        if (err) {
          console.error("Error fetching banners:", err);
          reject(err);
        } else {
          const banners = rows.map(
            (row) =>
              `${path.join(baseImagePath, row.path).replace(/\\/g, "/")}`,
          );
          console.log("Banners fetched for recordId:", recordId, banners);
          resolve(banners);
        }
      },
    );
  });
};

const getAtlasData = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(
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
      db.get(
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

      db.all(
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

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${tableName} (${columns.join(", ")}) VALUES (${columns
          .map(() => "?")
          .join(", ")})`,
      );
      for (const item of jsonData) {
        stmt.run(columns.map((column) => item[column]), (err) => {
          if (err) {
            db.run("ROLLBACK");
            reject(err);
          }
        });
      }
      stmt.finalize((err) => {
        if (err) {
          db.run("ROLLBACK");
          reject(err);
        } else {
          db.run("COMMIT", (err) => {
            if (err) reject(err);
            else {
              cachedFilterOptions = null;
              resolve();
            }
          });
        }
      });
    });
  });
};

const saveEmulatorConfig = (emulator) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO emulators (extension, program_path, parameters) VALUES (?, ?, ?)`,
      [emulator.extension, emulator.program_path, emulator.parameters || ""],
      (err) => {
        if (err) {
          console.error("Error saving emulator config:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const getEmulatorConfig = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT extension, program_path, parameters FROM emulators`,
      [],
      (err, rows) => {
        if (err) {
          console.error("Error fetching emulator config:", err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      },
    );
  });
};

const removeEmulatorConfig = (extension) => {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM emulators WHERE extension = ?`, [extension], (err) => {
      if (err) {
        console.error("Error removing emulator config:", err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const deleteBanner = (recordId, appPath, isDev) => {
  return new Promise(async (resolve, reject) => {
    try {
      const banners = await getBanners(recordId, appPath, isDev);
      for (const banner_path of banners) {
        const filePath = banner_path.replace("file://", ""); // Adjust to data/images
        console.log("Attempting to delete preview file:", filePath);
        try {
          if (
            await fsPromises
              .access(filePath)
              .then(() => true)
              .catch(() => false)
          ) {
            await fsPromises.unlink(filePath);
            console.log("Deleted preview file:", filePath);
          } else {
            console.log("Preview file does not exist:", filePath);
          }
        } catch (fileErr) {
          console.error("Error deleting preview file:", fileErr);
          // Continue with next file
        }
      }
      db.run(`DELETE FROM banners WHERE record_id = ?`, [recordId], (err) => {
        if (err) {
          console.error("Error removing banners from database:", err);
          reject(err);
        } else {
          console.log("banners removed from database for recordId:", recordId);
          resolve();
        }
      });
    } catch (err) {
      console.error("Error deleting banners:", err);
      reject(err);
    }
  });
};

const deletePreviews = (recordId, appPath, isDev) => {
  return new Promise(async (resolve, reject) => {
    try {
      const previews = await getPreviews(recordId, appPath, isDev);
      for (const previewUrl of previews) {
        const filePath = previewUrl.replace("file://", ""); // Adjust to data/images
        console.log("Attempting to delete preview file:", filePath);
        try {
          if (
            await fsPromises
              .access(filePath)
              .then(() => true)
              .catch(() => false)
          ) {
            await fsPromises.unlink(filePath);
            console.log("Deleted preview file:", filePath);
          } else {
            console.log("Preview file does not exist:", filePath);
          }
        } catch (fileErr) {
          console.error("Error deleting preview file:", fileErr);
          // Continue with next file
        }
      }
      db.run(`DELETE FROM previews WHERE record_id = ?`, [recordId], (err) => {
        if (err) {
          console.error("Error removing previews from database:", err);
          reject(err);
        } else {
          console.log("Previews removed from database for recordId:", recordId);
          resolve();
        }
      });
    } catch (err) {
      console.error("Error deleting previews:", err);
      reject(err);
    }
  });
};

const getEmulatorByExtension = (extension) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM emulators WHERE extension = ?`,
      [extension],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      },
    );
  });
};

//STEAM SPECIFIC FUNCTIONS
const getSteamIDbyRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT steam_id FROM steam_mappings WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.steam_id : null);
      },
    );
  });
};

const addSteamMapping = (recordId, steamId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO steam_mappings (record_id, steam_id) VALUES (?, ?)`,
      [recordId, steamId],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
};

const getSteamBannerUrl = (steamId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT header FROM steam_data WHERE steam_id = ?`,
      [steamId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.header : null);
      },
    );
  });
};

const getSteamScreensUrlList = (steamId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT screen_url FROM steam_screens WHERE steam_id = ?`,
      [steamId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map((row) => row.screen_url));
      },
    );
  });
};

const searchAtlasByF95Id = (f95Id) => {
  return new Promise((resolve, reject) => {
    db.all(
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

const getUniqueFilterOptions = () => {
  return new Promise((resolve, reject) => {
    if (cachedFilterOptions) {
      resolve(cachedFilterOptions);
      return;
    }

    const options = {};

    db.all(
      "SELECT DISTINCT category FROM atlas_data WHERE category IS NOT NULL",
      [],
      (err, rows) => {
        if (err) return reject(err);
        options.categories = rows.map((r) => r.category);

        db.all(
          "SELECT DISTINCT engine FROM atlas_data WHERE engine IS NOT NULL",
          [],
          (err, rows) => {
            if (err) return reject(err);
            options.engines = rows.map((r) => r.engine);

            db.all(
              "SELECT DISTINCT status FROM atlas_data WHERE status IS NOT NULL",
              [],
              (err, rows) => {
                if (err) return reject(err);
                options.statuses = rows.map((r) => r.status);

                db.all(
                  "SELECT DISTINCT censored FROM atlas_data WHERE censored IS NOT NULL",
                  [],
                  (err, rows) => {
                    if (err) return reject(err);
                    options.censored = rows.map((r) => r.censored);

                    db.all(
                      "SELECT DISTINCT language FROM atlas_data WHERE language IS NOT NULL",
                      [],
                      (err, rows) => {
                        if (err) return reject(err);
                        options.languages = rows.map((r) => r.language);

                        // Tags from f95_zone_data
                        db.all(
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
  initializeDatabase,
  repairDoubledApostropheRows,
  repairStaleVersionExecutables,
  addGame,
  addVersion,
  upsertVersion,
  getGames,
  getGameRecordIds,
  removeGame,
  checkDbUpdates,
  insertJsonData,
  searchAtlas,
  findF95Id,
  checkRecordExist,
  getImportRecordStatus,
  findExistingRecordForImport,
  checkPathExist,
  addAtlasMapping,
  updateFolderSize,
  getBannerUrl,
  getScreensUrlList,
  updateBanners,
  updatePreviews,
  getAtlasData,
  getGame,
  saveEmulatorConfig,
  getEmulatorConfig,
  removeEmulatorConfig,
  getEmulatorByExtension,
  GetAtlasIDbyRecord,
  getPreviews,
  deleteBanner,
  deletePreviews,
  getBanners,
  getBanner,
  updateGame,
  updateVersion,
  recordGameLaunchStarted,
  recordGamePlaytime,
  getSteamIDbyRecord,
  addSteamMapping,
  getSteamBannerUrl,
  getSteamScreensUrlList,
  searchAtlasByF95Id,
  countVersions,
  deleteVersion,
  deleteGameCompletely,
  getUniqueFilterOptions,
  getVersionForRecord,
  getVersionPathsForRecord,
  db, // Export db instance
};
