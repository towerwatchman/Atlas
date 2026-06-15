'use strict'

const path = require('path')
const fs = require('fs')
const dbModule = require('./index')
const getDb = () => dbModule.db
const { insertJsonData } = require('./atlas')
const { isNewerVersion } = require('../utils/versionUtils')


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
