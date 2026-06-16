'use strict'

const dbModule = require('./index')
const getDb = () => dbModule.db


const getSteamIDbyRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
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
    getDb().run(
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
    getDb().get(
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
    getDb().all(
      `SELECT screen_url FROM steam_screens WHERE steam_id = ?`,
      [steamId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map((row) => row.screen_url));
      },
    );
  });
};

// Find an existing library record that already owns a given Steam appid, either
// through a direct steam_mapping or because an Atlas/f95 record lists the appid
// in its external_ids. Used to merge a scanned Steam install into the existing
// title as another version instead of creating a duplicate.
const findRecordBySteamId = (steamId) => {
  return new Promise((resolve, reject) => {
    if (!steamId) {
      resolve(null);
      return;
    }
    const id = String(steamId);
    getDb().get(
      `SELECT record_id FROM steam_mappings WHERE steam_id = ? LIMIT 1`,
      [steamId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (row?.record_id) {
          resolve(row.record_id);
          return;
        }
        // Cross-source: an Atlas/f95 record whose external_ids JSON references
        // this appid (under steam_appid or steam_id, quoted or unquoted).
        getDb().get(
          `SELECT am.record_id
           FROM atlas_mappings am
           JOIN atlas_data a ON am.atlas_id = a.atlas_id
           WHERE a.external_ids LIKE '%"steam_appid":"' || ? || '"%'
              OR a.external_ids LIKE '%"steam_appid": "' || ? || '"%'
              OR a.external_ids LIKE '%"steam_appid":' || ? || '%'
              OR a.external_ids LIKE '%"steam_id":"' || ? || '"%'
           LIMIT 1`,
          [id, id, id, id],
          (err2, row2) => {
            if (err2) reject(err2);
            else resolve(row2?.record_id || null);
          },
        );
      },
    );
  });
};

module.exports = {
  getSteamIDbyRecord,
  addSteamMapping,
  getSteamBannerUrl,
  getSteamScreensUrlList,
  findRecordBySteamId,
}
