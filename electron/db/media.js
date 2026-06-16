'use strict'

const path = require('path')
const fs = require('fs')
const fsPromises = fs.promises
const axios = require('axios')
const sharp = require('sharp')
const dbModule = require('./index')
const getDb = () => dbModule.db
const { toLocalAssetPath, normalizeMediaStorageMode, remoteBannerExpression,
        buildBannerJoinClauses, buildBannerSelectFields } = require('./helpers')


const updateFolderSize = (recordId, version, size) => {
  return new Promise((resolve, reject) => {
    getDb().run(
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
    getDb().get(
      `SELECT COALESCE(f95_zone_data.banner_url, atlas_data.banner_wide, atlas_data.banner) AS banner_url
       FROM atlas_data
       LEFT JOIN f95_zone_data ON atlas_data.atlas_id = f95_zone_data.atlas_id
       WHERE atlas_data.atlas_id = ?`,
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
    getDb().all(
      `SELECT screen_url AS url, 'f95' AS source, 0 AS sort_order
       FROM f95_zone_screens
       JOIN f95_zone_data ON f95_zone_screens.f95_id = f95_zone_data.f95_id
       WHERE f95_zone_data.atlas_id = ?
       UNION ALL
       SELECT preview_url AS url, 'atlas' AS source, 1 AS sort_order
       FROM atlas_previews
       WHERE atlas_id = ?
       ORDER BY sort_order`,
      [atlasId, atlasId],
      (err, rows) => {
        if (err) {
          console.error("Error fetching screens:", err);
          reject(err);
          return;
        }

        getDb().get(
          `SELECT screens FROM f95_zone_data WHERE atlas_id = ?`,
          [atlasId],
          (legacyErr, legacyRow) => {
            if (legacyErr) {
              console.error("Error fetching legacy screens:", legacyErr);
              reject(legacyErr);
              return;
            }

            const seen = new Set();
            const screens = [];
            const addScreen = (url, source) => {
              const value = String(url || "").trim();
              if (!value || seen.has(value)) return;
              seen.add(value);
              screens.push({ url: value, source });
            };

            rows.forEach((row) => addScreen(row.url, row.source));
            if (legacyRow?.screens) {
              legacyRow.screens
                .split(",")
                .forEach((screen) => addScreen(screen, "f95"));
            }
            resolve(screens);
          },
        );
      },
    );
  });
};

const updateBanners = (recordId, bannerPath, type) => {
  return new Promise((resolve, reject) => {
    getDb().run(
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
    getDb().run(
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

const getRemotePreviewUrls = (recordId) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT url FROM (
        SELECT steam_movies.movie_url AS url, 0 AS sort_order
        FROM steam_movies
        JOIN steam_mappings ON steam_movies.steam_id = steam_mappings.steam_id
        WHERE steam_mappings.record_id = ?
        UNION
        SELECT f95_zone_screens.screen_url AS url, 1 AS sort_order
        FROM f95_zone_screens
        JOIN f95_zone_data ON f95_zone_screens.f95_id = f95_zone_data.f95_id
        JOIN atlas_mappings ON f95_zone_data.atlas_id = atlas_mappings.atlas_id
        WHERE atlas_mappings.record_id = ?
        UNION
        SELECT atlas_previews.preview_url AS url, 1 AS sort_order
        FROM atlas_previews
        JOIN atlas_mappings ON atlas_previews.atlas_id = atlas_mappings.atlas_id
        WHERE atlas_mappings.record_id = ?
        UNION
        SELECT steam_screens.screen_url AS url, 1 AS sort_order
        FROM steam_screens
        JOIN steam_mappings ON steam_screens.steam_id = steam_mappings.steam_id
        WHERE steam_mappings.record_id = ?
      )
      WHERE url IS NOT NULL AND TRIM(url) != ''
      ORDER BY sort_order
    `;

    getDb().all(query, [recordId, recordId, recordId, recordId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      const urls = rows.map((row) => row.url).filter(Boolean);
      if (urls.length > 0) {
        resolve(urls);
        return;
      }

      getDb().get(
        `SELECT f95_zone_data.screens
         FROM f95_zone_data
         JOIN atlas_mappings ON f95_zone_data.atlas_id = atlas_mappings.atlas_id
         WHERE atlas_mappings.record_id = ?`,
        [recordId],
        (screensErr, row) => {
          if (screensErr) {
            reject(screensErr);
            return;
          }
          resolve(
            row?.screens
              ? row.screens.split(",").map((screen) => screen.trim()).filter(Boolean)
              : [],
          );
        },
      );
    });
  });
};

const getPreviews = (recordId, appPath, isDev, mediaStorageMode = "stream") => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT path FROM previews WHERE record_id = ? ORDER BY position ASC, path ASC`,
      [recordId],
      async (err, rows) => {
        if (err) {
          console.error("Error fetching previews:", err);
          reject(err);
        } else {
          try {
            const localPreviews = rows.map((row) =>
              toLocalAssetPath(appPath, isDev, row.path),
            );
            const remotePreviews = await getRemotePreviewUrls(recordId);
            const previews = localPreviews.length > 0
              ? localPreviews
              : remotePreviews;

            console.log("Previews fetched for recordId:", recordId, previews);
            resolve(previews);
          } catch (remoteErr) {
            console.error("Error resolving preview URLs:", remoteErr);
            reject(remoteErr);
          }
        }
      },
    );
  });
};

const getBanners = (recordId, appPath, isDev) => {
  return new Promise((resolve, reject) => {
    const baseImagePath = getAssetBasePath(appPath, isDev);
    getDb().all(
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

const getRemoteBannerUrl = (recordId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT COALESCE(f95_zone_data.banner_url, steam_data.header, steam_data.library_hero, atlas_data.banner_wide, atlas_data.banner) AS banner_url
       FROM games
       LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
       LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
       LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
       LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
       LEFT JOIN steam_data ON steam_mappings.steam_id = steam_data.steam_id
       WHERE games.record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row?.banner_url || "");
      },
    );
  });
};

const getBanner = (recordId, appPath, isDev, type, mediaStorageMode = "stream") => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT path
       FROM banners
       WHERE record_id = ? AND type = ?
       ORDER BY
         CASE
           WHEN path LIKE '%banner_custom_%' THEN 0
           WHEN path LIKE '%banner_f95_%' THEN 1
           ELSE 2
         END,
         path`,
      [recordId, type],
      async (err, rows) => {
        if (err) {
          console.error("Error fetching banners:", err);
          reject(err);
        } else {
          try {
            const localBanners = rows.map((row) =>
              toLocalAssetPath(appPath, isDev, row.path),
            );
            const remoteBannerUrl = await getRemoteBannerUrl(recordId);
            const remoteBanners = remoteBannerUrl ? [remoteBannerUrl] : [];
            const banners = localBanners.length > 0
              ? localBanners
              : remoteBanners;

            console.log("Banners fetched for recordId:", recordId, banners);
            resolve(banners);
          } catch (remoteErr) {
            console.error("Error resolving banner URLs:", remoteErr);
            reject(remoteErr);
          }
        }
      },
    );
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
      getDb().run(`DELETE FROM banners WHERE record_id = ?`, [recordId], (err) => {
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
      const previews = await new Promise((resolveLocal, rejectLocal) => {
        getDb().all(
          `SELECT path FROM previews WHERE record_id = ?`,
          [recordId],
          (err, rows) => {
            if (err) rejectLocal(err);
            else {
              resolveLocal(
                rows.map((row) => toLocalAssetPath(appPath, isDev, row.path)),
              );
            }
          },
        );
      });
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
      getDb().run(`DELETE FROM previews WHERE record_id = ?`, [recordId], (err) => {
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

module.exports = {
  updateFolderSize,
  getBannerUrl,
  getScreensUrlList,
  updateBanners,
  updatePreviews,
  getRemotePreviewUrls,
  getPreviews,
  getBanners,
  getRemoteBannerUrl,
  getBanner,
  deleteBanner,
  deletePreviews,
}
