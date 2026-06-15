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
    getDb().serialize(() => {
      getDb().run(
        `DELETE FROM steam_mappings WHERE record_id = ?`,
        [recordId],
        (deleteErr) => {
          if (deleteErr) {
            reject(deleteErr);
            return;
          }
          getDb().run(
            `INSERT INTO steam_mappings (record_id, steam_id) VALUES (?, ?)`,
            [recordId, steamId],
            (insertErr) => {
              if (insertErr) reject(insertErr);
              else resolve();
            },
          );
        },
      );
    });
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

module.exports = {
  getSteamIDbyRecord,
  addSteamMapping,
  getSteamBannerUrl,
  getSteamScreensUrlList,
}
