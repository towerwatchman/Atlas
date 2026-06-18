'use strict'

const path = require('path')
const fs = require('fs')
const dbModule = require('./index')
const getDb = () => dbModule.db
const { insertJsonData } = require('./atlas')
const { isNewerVersion } = require('../utils/versionUtils')

const withF95LatestOrder = (rows, updateDate) =>
  rows.map((row, index) => ({
    ...row,
    f95_latest_order: (Number(updateDate) * 100000) + (100000 - index),
  }))

const backfillF95LatestOrderFromUpdateFiles = async (updatesDir) => {
  const lz4 = require("lz4js");
  if (!fs.existsSync(updatesDir)) return 0;

  const files = fs.readdirSync(updatesDir)
    .filter((name) => /^\d+\.update$/.test(name))
    .sort((a, b) => Number(a.replace(".update", "")) - Number(b.replace(".update", "")));
  if (files.length === 0) return 0;

  return new Promise((resolve) => {
    const db = getDb();
    db.all(`PRAGMA table_info(f95_zone_data)`, [], (columnErr, columns = []) => {
      if (
        columnErr ||
        !Array.isArray(columns) ||
        !columns.some((column) => column.name === "f95_latest_order")
      ) {
        resolve(0);
        return;
      }

      db.serialize(() => {
        let updated = 0;
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(
          `UPDATE f95_zone_data SET f95_latest_order = ? WHERE f95_id = ?`,
        );

        for (const name of files) {
          try {
            const updateDate = Number(name.replace(".update", ""));
            const compressedData = fs.readFileSync(path.join(updatesDir, name));
            const data = JSON.parse(Buffer.from(lz4.decompress(compressedData)).toString("utf8"));
            if (!Array.isArray(data.f95_zone)) continue;
            for (const row of withF95LatestOrder(data.f95_zone, updateDate)) {
              if (!row.f95_id) continue;
              stmt.run([row.f95_latest_order, row.f95_id]);
              updated++;
            }
          } catch (err) {
            console.warn(`Unable to backfill F95 latest order from ${name}:`, err.message);
          }
        }

        stmt.finalize(() => {
          db.run("COMMIT", () => resolve(updated));
        });
      });
    });
  });
}


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
      getDb().get(
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
      await backfillF95LatestOrderFromUpdateFiles(updatesDir);
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
        await insertJsonData(withF95LatestOrder(data.f95_zone, date), "f95_zone_data");
      }

      // Insert update record
      const processedTime = Math.floor(Date.now() / 1000);
      await new Promise((resolve, reject) => {
        getDb().run(
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

module.exports = {
  checkDbUpdates,
}
