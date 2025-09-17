const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let db;

const initializeDatabase = (dataDir) => {
  const dbPath = path.join(dataDir, 'data.db');
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database error:', err);
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
        record_id INTEGER REFERENCES games (record_id),
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
        record_id INTEGER REFERENCES games (record_id) UNIQUE PRIMARY KEY,
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
  });
};

const addGame = (game) => {
  return new Promise((resolve, reject) => {
    const { title, creator, engine } = game;
    const escapedTitle = title.replace(/'/g, "''");
    const escapedCreator = creator.replace(/'/g, "''");
    const escapedEngine = engine.replace(/'/g, "''");

    // Check if game already exists
    db.get(
      `SELECT record_id FROM games WHERE title = ? AND creator = ?`,
      [escapedTitle, escapedCreator],
      (err, row) => {
        if (err) {
          console.error('Error checking existing game:', err);
          reject(err);
          return;
        }
        if (row) {
          // Game exists, return existing record_id
          console.log(`Game ${title} by ${creator} already exists with record_id: ${row.record_id}`);
          resolve(row.record_id);
          return;
        }
        // Game doesn't exist, insert new record
        db.run(
          `INSERT INTO games (title, creator, engine, last_played_r, total_playtime)
           VALUES (?, ?, ?, 0, 0)`,
          [escapedTitle, escapedCreator, escapedEngine],
          function (err) {
            if (err) {
              console.error('Error inserting game:', err);
              reject(err);
              return;
            }
            // Return the new record_id
            console.log(`Inserted new game ${title} by ${creator} with record_id: ${this.lastID}`);
            resolve(this.lastID);
          }
        );
      }
    );
  });
};

const addVersion = (game, recordId) => {
  const { version, folder, executables, folderSize = 0 } = game;
  const executable = executables && executables.length > 0 ? executables[0].value : '';
  const escapedVersion = version.replace(/'/g, "''");
  const escapedFolder = folder.replace(/'/g, "''");
  const escapedExecPath = executable ? path.join(folder, executable).replace(/'/g, "''") : '';
  const dateAdded = Math.floor(Date.now() / 1000);

  console.log('adding version')
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO versions (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [recordId, escapedVersion, escapedFolder, escapedExecPath, true, dateAdded, folderSize],
      (err) => {
        if (err) {
          console.error('Error adding or updating version:', err);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

const getGame = (recordId, appPath, isDev) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT g.record_id, g.title, g.creator, g.engine, g.description,
             v.version, v.game_path, v.exec_path, v.folder_size,
             b.path AS banner_path, b.type AS banner_type,
             p.path AS preview_path
      FROM games g
      LEFT JOIN versions v ON g.record_id = v.record_id
      LEFT JOIN banners b ON g.record_id = b.record_id
      LEFT JOIN previews p ON g.record_id = p.record_id
      WHERE g.record_id = ?
      ORDER BY g.title ASC, v.version DESC
    `;
    db.all(query, [recordId], (err, rows) => {
      if (err) {
        console.error('Error fetching game:', err);
        reject(err);
        return;
      }
      if (rows.length === 0) {
        resolve(null);
        return;
      }
      let game = null;
      for (const row of rows) {
        if (!game) {
          game = {
            record_id: row.record_id,
            title: row.title,
            creator: row.creator,
            engine: row.engine,
            description: row.description,
            versions: [],
            banners: {},
            previews: []
          };
        }
        if (row.version && !game.versions.some(v => v.version === row.version)) {
          game.versions.push({
            version: row.version,
            game_path: row.game_path,
            exec_path: row.exec_path,
            folder_size: row.folder_size
          });
        }
        if (row.banner_path) {
          game.banners[row.banner_type] = row.banner_path;
        }
        if (row.preview_path && !game.previews.includes(row.preview_path)) {
          game.previews.push(row.preview_path);
        }
      }
      const imagesDir = isDev ? path.join(appPath, 'data', 'images') : path.join(appPath, 'data', 'images');
      const gameImgDir = path.join(imagesDir, game.record_id.toString());
      if (game.banners.banner) {
        game.banner = path.join(gameImgDir, game.banners.banner);
      }
      game.previews = game.previews.map(preview => path.join(gameImgDir, preview));
      resolve(game);
    });
  });
};

const getGames = (appPath, isDev, offset = 0, limit = null) => {
  return new Promise((resolve, reject) => {
    const baseImagePath = isDev
      ? path.join(appPath, 'src')
      : path.resolve(appPath, '../../');

    // Main query with OFFSET and LIMIT
    let mainQuery = `
      SELECT
        games.record_id as record_id,
        atlas_mappings.atlas_id as atlas_id,
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
      LEFT JOIN banners ON games.record_id = banners.record_id
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
        console.error('Error fetching games:', err);
        reject(err);
        return;
      }

      // Execute versions query
      db.all(versionsQuery, [], (err, versionRows) => {
        if (err) {
          console.error('Error fetching versions:', err);
          reject(err);
          return;
        }

        // Group versions by record_id
        const versionsByRecordId = {};
        versionRows.forEach((row) => {
          if (!versionsByRecordId[row.record_id]) {
            versionsByRecordId[row.record_id] = [];
          }
          versionsByRecordId[row.record_id].push({
            version: row.version,
            game_path: row.game_path,
            exec_path: row.exec_path,
            in_place: row.in_place,
            last_played: row.last_played,
            version_playtime: row.version_playtime,
            folder_size: row.folder_size,
            date_added: row.date_added
          });
        });

        // Map rows to include versions array and isUpdateAvailable
        const games = rows.map((row) => {
          const versions = versionsByRecordId[row.record_id] || [];
          // Compute isUpdateAvailable based on C# logic
          let isUpdateAvailable = false;
          if (row.latestVersion && versions.length > 0) {
            let latest;
            try {
              latest = parseInt(row.latestVersion.replace(/[^0-9]/g, ''), 10);
            } catch {
              latest = 0;
            }
            for (const version of versions) {
              let current;
              try {
                current = parseInt(version.version.replace(/[^0-9]/g, ''), 10);
              } catch {
                current = 0;
              }
              if (latest > current) {
                isUpdateAvailable = true;
              } else {
                isUpdateAvailable = false;
                break;
              }
            }
          }

          return {
            ...row,
            // Unescape engine to fix 'Ren''Py' issue
            engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
            versions,
            versionCount: versions.length, // Add versionCount
            isUpdateAvailable
          };
        });

        console.log(`Fetched ${games.length} games with versions`);
        resolve(games);
      });
    });
  });
};

const removeGame = async (record_id) => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM games WHERE record_id = ?', [record_id], (err) => {
      if (err) reject(err);
      else resolve({ success: true });
    });
  });
};

const checkDbUpdates = async (updatesDir, mainWindow) => {
  const axios = require('axios');
  const fs = require('fs');
  const lz4 = require('lz4js');

  try {
    const url = 'https://atlas-gamesdb.com/api/updates';
    const response = await axios.get(url);
    const updates = response.data;
    if (!Array.isArray(updates)) throw new Error('Invalid updates data');

    // Get last update version
    const lastUpdateVersion = await new Promise((resolve, reject) => {
      db.get('SELECT MAX(update_time) as last_update FROM updates', [], (err, row) => {
        if (err) reject(err);
        else resolve(row.last_update ? parseInt(row.last_update) : 0);
      });
    });

    // Filter updates newer than lastUpdateVersion
    const newUpdates = updates.filter(update => parseInt(update.date) > lastUpdateVersion || lastUpdateVersion === 0);
    const total = newUpdates.length;

    if (total === 0) {
      return { success: true, message: 'No new updates available', total: 0, processed: 0 };
    }

    let processed = 0;
    for (const update of newUpdates.reverse()) {
      const { date, name, md5 } = update;
      const downloadUrl = `https://atlas-gamesdb.com/packages/${name}`;
      const outputPath = path.join(updatesDir, name);

      // Download update
      mainWindow.webContents.send('db-update-progress', { text: `Downloading Database Update ${processed + 1}/${total}`, progress: processed, total });
      const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
      fs.writeFileSync(outputPath, response.data);

      // Decompress LZ4
      const compressedData = fs.readFileSync(outputPath);
      const decompressedData = Buffer.from(lz4.decompress(compressedData));
      const data = JSON.parse(decompressedData.toString('utf8'));

      // Process atlas_data
      mainWindow.webContents.send('db-update-progress', { text: `Processing Atlas Metadata ${processed + 1}/${total}`, progress: processed, total });
      if (data.atlas) {
        await insertJsonData(data.atlas, 'atlas_data');
      }

      // Process f95_zone_data
      mainWindow.webContents.send('db-update-progress', { text: `Processing F95 Metadata ${processed + 1}/${total}`, progress: processed, total });
      if (data.f95_zone) {
        await insertJsonData(data.f95_zone, 'f95_zone_data');
      }

      // Insert update record
      const processedTime = Math.floor(Date.now() / 1000);
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO updates (update_time, processed_time, md5) VALUES (?, ?, ?)',
          [date, processedTime, md5],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      processed++;
      mainWindow.webContents.send('db-update-progress', { text: `Processed Update ${processed}/${total}`, progress: processed, total });
    }

    return { success: true, message: `Processed ${processed} updates`, total, processed };
  } catch (err) {
    console.error('Error checking database updates:', err);
    return { success: false, error: err.message, total: 0, processed: 0 };
  }
};

const searchAtlas = async (title, creator) => {
  const queries = [
    async () => {
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT atlas_id, title, creator, engine FROM atlas_data WHERE title LIKE ? AND creator LIKE ?`,
          [`%${title}%`, `%${creator}%`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    },
    async () => {
      const shortName = title.replace(/[\W_]+/g, '').toUpperCase();
      const queryTitle = `
        SELECT
          atlas_id,
          title,
          creator,
          engine,
          LENGTH(short_name) - LENGTH(?) as difference
        FROM atlas_data
        WHERE short_name LIKE ?
        ORDER BY LENGTH(short_name) - LENGTH(?)
      `;
      return new Promise((resolve, reject) => {
        db.all(
          queryTitle,
          [shortName, `%${shortName}%`, shortName],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    },
    async () => {
      const fullName = `${title}${creator}`.replace(/[\W_]+/g, '').toUpperCase();
      const queryFull = `
        WITH data_0 AS (
          SELECT
            atlas_id,
            title,
            creator,
            engine,
            UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              title || '' || creator,
              '-', ''), '_', ''), '/', ''), '\\', ''), ':', ''), ';', ''), '''', ''), ' ', ''), '.', '')) as full_name
          FROM atlas_data
        )
        SELECT
          atlas_id,
          title,
          creator,
          engine,
          LENGTH(full_name) - LENGTH(?) as difference
        FROM data_0
        WHERE full_name LIKE ?
        ORDER BY LENGTH(full_name) - LENGTH(?)
      `;
      return new Promise((resolve, reject) => {
        db.all(
          queryFull,
          [fullName, `%${fullName}%`, fullName],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    },
    async () => {
      // Title-only search
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT atlas_id, title, creator, engine FROM atlas_data WHERE title LIKE ?`,
          [`%${title}%`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    }
  ];

  const allResults = new Map(); // Use Map to store unique results by atlas_id

  for (const queryFn of queries) {
    try {
      const rows = await queryFn();
      console.log(`Query returned ${rows.length} results`);
      let hasF95Id = false;
      const enrichedRows = [];
      for (const row of rows) {
        const f95Id = await findF95Id(row.atlas_id);
        if (f95Id) {
          hasF95Id = true;
        }
        if (!allResults.has(row.atlas_id)) {
          allResults.set(row.atlas_id, { ...row, f95_id: f95Id || '' });
        }
        enrichedRows.push({ ...row, f95_id: f95Id || '' });
      }
      if (hasF95Id) {
        // Return results from this query if any have f95_id
        const filteredRows = enrichedRows.filter(row =>findF95Id(row.atlas_id));
        console.log(`Query found ${filteredRows.length} results with f95_id`);
        return filteredRows.length > 0 ? filteredRows : enrichedRows;
      }
    } catch (err) {
      console.error('Error in searchAtlas query:', err);
    }
  }

  // If no results with f95_id, return all unique results from all queries
  const finalResults = Array.from(allResults.values());
  console.log(`Returning ${finalResults.length} unique results from all queries`);
  return finalResults;
};


const findF95Id = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT f95_id FROM f95_zone_data WHERE atlas_id = ?`, [atlasId], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.f95_id : null);
    });
  });
};

const checkRecordExist = (title, creator, version) => {
  return new Promise((resolve, reject) => {
    const escapedTitle = title.replace(/'/g, "''");
    const escapedCreator = creator.replace(/'/g, "''");
    const escapedVersion = version.replace(/'/g, "''");
    db.get(
      `SELECT g.record_id
       FROM games g
       LEFT JOIN versions v ON g.record_id = v.record_id
       WHERE g.title = ? AND g.creator = ? AND v.version = ?`,
      [escapedTitle, escapedCreator, escapedVersion],
      (err, row) => {
        if (err) {
          console.error('Error checking record existence:', err);
          reject(err);
        } else {
          resolve(!!row);
        }
      }
    );
  });
};

const checkPathExist = (gamePath, title) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT v.record_id FROM games g JOIN versions v ON g.record_id = v.record_id WHERE g.title = ? AND v.game_path = ?`, [title, gamePath], (err, row) => {
      if (err) reject(err);
      resolve(!!row);
    });
  });
};

const addAtlasMapping = (recordId, atlasId) => {
  return new Promise((resolve, reject) => {
    // Validate inputs
    if (!recordId || !atlasId) {
      const error = new Error(`Invalid input: recordId=${recordId}, atlasId=${atlasId}`);
      console.error('addAtlasMapping error:', error.message);
      return reject(error);
    }

    // Check if record_id exists in games
    db.get(`SELECT record_id FROM games WHERE record_id = ?`, [recordId], (err, row) => {
      if (err) {
        console.error('Error checking games table:', err);
        return reject(err);
      }
      if (!row) {
        const error = new Error(`record_id ${recordId} does not exist in games table`);
        console.error('addAtlasMapping error:', error.message);
        return reject(error);
      }

      // Check if atlas_id exists in atlas_data
      db.get(`SELECT atlas_id FROM atlas_data WHERE atlas_id = ?`, [atlasId], (err, row) => {
        if (err) {
          console.error('Error checking atlas_data table:', err);
          return reject(err);
        }
        if (!row) {
          const error = new Error(`atlas_id ${atlasId} does not exist in atlas_data table`);
          console.error('addAtlasMapping error:', error.message);
          return reject(error);
        }

        // Insert or ignore mapping
        db.run(
          `INSERT OR IGNORE INTO atlas_mappings (record_id, atlas_id) VALUES (?, ?)`,
          [recordId, atlasId],
          (err) => {
            if (err) {
              console.error('Error inserting into atlas_mappings:', err);
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    });
  });
};

const updateFolderSize = (recordId, version, size) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE versions SET folder_size = ? WHERE record_id = ? AND version = ?`, [size, recordId, version], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const getBannerUrl = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT banner_url FROM f95_zone_data WHERE atlas_id = ?`, [atlasId], (err, row) => {
      if (err) {
        console.error('Error fetching banner_url:', err);
        reject(err);
      } else {
        resolve(row ? row.banner_url : '');
      }
    });
  });
};

const getScreensUrlList = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT screens FROM f95_zone_data WHERE atlas_id = ?`, [atlasId], (err, row) => {
      if (err) {
        console.error('Error fetching screens:', err);
        reject(err);
      } else {
        const screens = row && row.screens ? row.screens.split(',').map(s => s.trim()) : [];
        resolve(screens);
      }
    });
  });
};

const updateBanners = (recordId, bannerPath, type) => {
  return new Promise((resolve, reject) => {
    const escapedPath = bannerPath.replace(/'/g, "''");
    const escapedType = type.replace(/'/g, "''");
    db.run(
      `INSERT OR REPLACE INTO banners (record_id, path, type) VALUES (?, ?, ?)`,
      [recordId, escapedPath, escapedType],
      (err) => {
        if (err) {
          console.error('Error updating banners:', err);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

const updatePreviews = (recordId, previewPath) => {
  return new Promise((resolve, reject) => {
    const escapedPath = previewPath.replace(/'/g, "''");
    db.run(
      `INSERT OR REPLACE INTO previews (record_id, path) VALUES (?, ?)`,
      [recordId, escapedPath],
      (err) => {
        if (err) {
          console.error('Error updating previews:', err);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

const getAtlasData = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT title, creator, engine FROM atlas_data WHERE atlas_id = ?`, [atlasId], (err, row) => {
      if (err) reject(err);
      else resolve(row || {});
    });
  });
};

const insertJsonData = async (jsonData, tableName) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${tableName} (${Object.keys(jsonData[0]).join(', ')}) VALUES (${Object.keys(jsonData[0]).map(() => '?').join(', ')})`);
      for (const item of jsonData) {
        stmt.run(Object.values(item), (err) => {
          if (err) {
            db.run('ROLLBACK');
            reject(err);
          }
        });
      }
      stmt.finalize((err) => {
        if (err) {
          db.run('ROLLBACK');
          reject(err);
        } else {
          db.run('COMMIT', (err) => {
            if (err) reject(err);
            else resolve();
          });
        }
      });
    });
  });
};

module.exports = {
  initializeDatabase,
  addGame,
  addVersion,
  getGames,
  removeGame,
  checkDbUpdates,
  insertJsonData,
  searchAtlas,
  findF95Id,
  checkRecordExist,
  checkPathExist,
  addAtlasMapping,
  updateFolderSize,
  getBannerUrl,
  getScreensUrlList,
  updateBanners,
  updatePreviews,
  getAtlasData,
  getGame,
  db // Export db instance
};