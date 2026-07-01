'use strict'

const path = require('path')
const fs = require('fs')
const fsPromises = fs.promises
const axios = require('axios')
const sharp = require('sharp')
const dbModule = require('./index')
const getDb = () => dbModule.db
const { toLocalAssetPath, getAssetBasePath, normalizeMediaStorageMode, remoteBannerExpression,
        buildBannerJoinClauses, buildBannerSelectFields } = require('./helpers')
const { deletePathWithElevationFallback } = require('../deleteUtils')
const { normalizeSourceOrder, parseExternalIds, resolveSteamAppId } = require('./mediaSources')

function normalizeVersionName(value, fallback = "Unknown") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

const updateFolderSize = (recordId, version, size) => {
  return new Promise((resolve, reject) => {
    getDb().run(
      `UPDATE versions SET folder_size = ? WHERE record_id = ? AND version = ?`,
      [size, recordId, normalizeVersionName(version)],
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
      `SELECT COALESCE(f95_zone_data.banner_url, lewdcorner_data.banner_url, atlas_data.banner_wide, atlas_data.banner) AS banner_url
       FROM atlas_data
       LEFT JOIN f95_zone_data ON atlas_data.atlas_id = f95_zone_data.atlas_id
       LEFT JOIN lewdcorner_data ON atlas_data.atlas_id = lewdcorner_data.atlas_id
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
       SELECT NULL AS url, 'lewdcorner' AS source, 1 AS sort_order
       FROM lewdcorner_data
       WHERE lewdcorner_data.atlas_id = ?
       UNION ALL
       SELECT preview_url AS url, 'atlas' AS source, 2 AS sort_order
       FROM atlas_previews
       WHERE atlas_id = ?
       ORDER BY sort_order`,
      [atlasId, atlasId, atlasId],
      (err, rows) => {
        if (err) {
          console.error("Error fetching screens:", err);
          reject(err);
          return;
        }

        getDb().get(
          `SELECT f95_zone_data.screens AS f95_screens, lewdcorner_data.screens AS lewdcorner_screens
           FROM atlas_data
           LEFT JOIN f95_zone_data ON atlas_data.atlas_id = f95_zone_data.atlas_id
           LEFT JOIN lewdcorner_data ON atlas_data.atlas_id = lewdcorner_data.atlas_id
           WHERE atlas_data.atlas_id = ?`,
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
            if (legacyRow?.f95_screens) {
              legacyRow.f95_screens
                .split(",")
                .forEach((screen) => addScreen(screen, "f95"));
            }
            if (legacyRow?.lewdcorner_screens) {
              legacyRow.lewdcorner_screens
                .split(",")
                .forEach((screen) => addScreen(screen, "lewdcorner"));
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

const isRemoteHttpUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

const addRemotePreviewUrl = (target, seen, value) => {
  const url = String(value || "").trim();
  if (!isRemoteHttpUrl(url) || seen.has(url)) return false;
  seen.add(url);
  target.push(url);
  return true;
};

const parsePreviewList = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => typeof item === "string" ? item : item?.url);
    }
  } catch {}
  return raw.split(",").map((item) => item.trim());
};

const parseAssetList = (value) => parsePreviewList(value).filter(isRemoteHttpUrl);

const sourceRanker = (rawOrder) => {
  const order = normalizeSourceOrder(rawOrder);
  return (source) => {
    const idx = order.indexOf(String(source || "").toLowerCase());
    return idx === -1 ? order.length : idx;
  };
};

const sourceEnabled = (source, rawOrder) => {
  const order = normalizeSourceOrder(rawOrder);
  return order.includes(String(source || "").toLowerCase());
};

const dedupeAssetEntries = (entries) => {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const url = String(entry?.url || "").trim();
    if (!isRemoteHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...entry, url });
  }
  return out;
};

const steamCdnAsset = (steamId, file) =>
  steamId ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/${file}` : "";

const STEAM_STORE_ASSET_BASE = "https://shared.fastly.steamstatic.com/store_item_assets/";

const fetchSteamStoreAssetUrls = async (steamId) => {
  const appid = parseInt(steamId, 10);
  if (!appid) return {};
  try {
    const input = {
      ids: [{ appid }],
      context: { language: "english", country_code: "US" },
      data_request: { include_assets: true },
    };
    const response = await axios.get(
      `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(
        JSON.stringify(input),
      )}`,
      {
        timeout: 15000,
        headers: {
          "User-Agent": "Atlas/1.0 (+https://github.com/towerwatchman/Atlas)",
          Accept: "application/json,*/*;q=0.8",
        },
      },
    );
    const assets = response.data?.response?.store_items?.[0]?.assets;
    if (!assets?.asset_url_format) return {};

    const build = (filename) =>
      filename
        ? STEAM_STORE_ASSET_BASE +
          assets.asset_url_format.replace(/\$\{FILENAME\}|\$\{filename\}|\{filename\}/, filename)
        : "";
    const pick = (...keys) => {
      for (const key of keys) if (assets[key]) return build(assets[key]);
      return "";
    };

    return {
      header: pick("header", "library_header"),
      hero: pick("library_hero_2x", "library_hero"),
      cover: pick("library_capsule_2x", "library_capsule"),
      logo: pick("logo_2x", "logo"),
    };
  } catch (err) {
    console.warn(`Unable to resolve Steam store assets for ${appid}:`, err?.message || err);
    return {};
  }
};

const orderAssetEntriesBySource = (entries, rawOrder) => {
  const rank = sourceRanker(rawOrder);
  return [...entries]
    .filter((entry) => sourceEnabled(entry.source, rawOrder))
    .sort((a, b) => rank(a.source) - rank(b.source));
};

const selectPreviewUrlsBySource = (entries, rawOrder) => {
  const cleaned = dedupeAssetEntries(entries);
  if (cleaned.length === 0) return [];
  const order = normalizeSourceOrder(rawOrder);
  if (order.length === 0) return [];
  const bySource = new Map();
  cleaned.forEach((entry) => {
    const source = String(entry.source || "").toLowerCase();
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(entry.url);
  });
  for (const source of order) {
    const urls = bySource.get(source);
    if (urls?.length) return urls;
  }
  return [];
};

const isSteamCapsuleLike = (url) => /library_600x900|library_capsule/i.test(String(url || ""));
const isResolvedSteamAssetUrl = (url) => {
  const value = String(url || "");
  return value && !/\$\{?FILENAME\}?|\$\{?filename\}?/i.test(value);
};

const getAllDownloadableAssetUrlsForRecord = (recordId, options = {}) => {
  return new Promise((resolve, reject) => {
    const includeVideos = options.downloadVideos === true;
    const isVideo = (url) => /\.(mp4|webm|m4v)(\?|#|$)/i.test(String(url || ""));
    getDb().get(
      `SELECT
        games.record_id,
        atlas_mappings.atlas_id,
        steam_mappings.steam_id,
        atlas_data.external_ids,
        f95_zone_data.banner_url AS f95_banner,
        f95_zone_data.screens AS f95_legacy_screens,
        lewdcorner_data.banner_url AS lewdcorner_banner,
        lewdcorner_data.screens AS lewdcorner_legacy_screens,
        atlas_data.banner AS atlas_banner,
        atlas_data.banner_wide AS atlas_banner_wide,
        atlas_data.cover AS atlas_cover,
        atlas_data.logo AS atlas_logo,
        atlas_data.wallpaper AS atlas_wallpaper,
        atlas_data.previews AS atlas_legacy_previews,
        steam_data.header AS steam_header,
        steam_data.library_hero AS steam_hero,
        steam_data.library_capsule AS steam_cover,
        steam_data.logo AS steam_logo
       FROM games
       LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
       LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
       LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
       LEFT JOIN lewdcorner_data ON atlas_mappings.atlas_id = lewdcorner_data.atlas_id
       LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
       LEFT JOIN steam_data ON steam_mappings.steam_id = steam_data.steam_id
         OR (steam_mappings.steam_id IS NULL AND atlas_mappings.atlas_id IS NOT NULL AND steam_data.atlas_id = atlas_mappings.atlas_id)
       WHERE games.record_id = ?`,
      [recordId],
      async (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (!row) {
          resolve([]);
          return;
        }

        const entries = [];
        const add = (source, assetType, url, preferredFilename, targetKind = "asset") => {
          const value = String(url || "").trim();
          if (!isRemoteHttpUrl(value)) return;
          if (!includeVideos && isVideo(value)) return;
          entries.push({ source, assetType, url: value, preferredFilename, targetKind });
        };

        add("f95", "f95_banner", row.f95_banner, "f95_banner", "banner");
        add("lewdcorner", "lewdcorner_banner", row.lewdcorner_banner, "lewdcorner_banner", "banner");
        add("atlas", "atlas_banner", row.atlas_banner, "atlas_banner", "banner");
        add("atlas", "atlas_banner_wide", row.atlas_banner_wide, "atlas_banner_wide", "banner");
        add("atlas", "atlas_cover", row.atlas_cover, "atlas_cover");
        add("atlas", "atlas_logo", row.atlas_logo, "atlas_logo");
        add("atlas", "atlas_wallpaper", row.atlas_wallpaper, "atlas_wallpaper");

        const steamId = row.steam_id || resolveSteamAppId(row, parseExternalIds(row.external_ids));
        const steamAssets = await fetchSteamStoreAssetUrls(steamId);
        const rowSteamHeader = isResolvedSteamAssetUrl(row.steam_header) ? row.steam_header : "";
        const rowSteamHero = isResolvedSteamAssetUrl(row.steam_hero) ? row.steam_hero : "";
        const rowSteamCover = isResolvedSteamAssetUrl(row.steam_cover) ? row.steam_cover : "";
        const rowSteamLogo = isResolvedSteamAssetUrl(row.steam_logo) ? row.steam_logo : "";
        const steamCoverUrl = rowSteamCover || steamAssets.cover || (isSteamCapsuleLike(rowSteamLogo) ? rowSteamLogo : "");
        const steamLogoUrl = isSteamCapsuleLike(rowSteamLogo) ? "" : rowSteamLogo;
        add("steam", "steam_header", rowSteamHeader || steamAssets.header || steamCdnAsset(steamId, "header.jpg"), "steam_header", "banner");
        add("steam", "steam_hero", rowSteamHero || steamAssets.hero || steamCdnAsset(steamId, "library_hero.jpg"), "steam_hero");
        add("steam", "steam_cover", steamCoverUrl || steamCdnAsset(steamId, "library_600x900.jpg"), "steam_cover");
        add("steam", "steam_logo", steamLogoUrl || steamAssets.logo || steamCdnAsset(steamId, "logo.png"), "steam_logo");

        parseAssetList(row.atlas_legacy_previews).forEach((url, index) =>
          add("atlas", "atlas_preview", url, `atlas_preview_${String(index + 1).padStart(3, "0")}`, "preview"));
        parseAssetList(row.f95_legacy_screens).forEach((url, index) =>
          add("f95", "f95_preview", url, `f95_preview_${String(index + 1).padStart(3, "0")}`, "preview"));
        parseAssetList(row.lewdcorner_legacy_screens).forEach((url, index) =>
          add("lewdcorner", "lewdcorner_preview", url, `lewdcorner_preview_${String(index + 1).padStart(3, "0")}`, "preview"));

        getDb().all(
          `SELECT 'steam_screenshot' AS asset_type, screen_url AS url
           FROM steam_screens
           JOIN steam_data screen_steam_data ON steam_screens.steam_id = screen_steam_data.steam_id
           JOIN games ON games.record_id = ?
           LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
           LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
           LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
           WHERE steam_screens.steam_id = steam_mappings.steam_id
              OR screen_steam_data.atlas_id = atlas_mappings.atlas_id
              OR atlas_data.external_ids LIKE '%"steam_appid":"' || steam_screens.steam_id || '"%'
              OR atlas_data.external_ids LIKE '%"steam_appid": "' || steam_screens.steam_id || '"%'
              OR atlas_data.external_ids LIKE '%"steam_id":"' || steam_screens.steam_id || '"%'
              OR atlas_data.external_ids LIKE '%"steam_id": "' || steam_screens.steam_id || '"%'
           UNION ALL
           SELECT 'atlas_preview' AS asset_type, preview_url AS url
           FROM atlas_previews
           JOIN atlas_mappings ON atlas_previews.atlas_id = atlas_mappings.atlas_id
           WHERE atlas_mappings.record_id = ?
           UNION ALL
           SELECT 'f95_preview' AS asset_type, screen_url AS url
           FROM f95_zone_screens
           JOIN f95_zone_data ON f95_zone_screens.f95_id = f95_zone_data.f95_id
           JOIN atlas_mappings ON f95_zone_data.atlas_id = atlas_mappings.atlas_id
           WHERE atlas_mappings.record_id = ?`,
          [recordId, recordId, recordId],
          (assetErr, rows) => {
            if (assetErr) {
              reject(assetErr);
              return;
            }
            (rows || []).forEach((assetRow, index) => {
              const type = assetRow.asset_type;
              const source = type.startsWith("steam") ? "steam" : type.startsWith("f95") ? "f95" : type.startsWith("lewdcorner") ? "lewdcorner" : "atlas";
              add(source, type, assetRow.url, `${type}_${String(index + 1).padStart(3, "0")}`, "preview");
            });
            resolve(orderAssetEntriesBySource(dedupeAssetEntries(entries), options.sourceOrder));
          },
        );
      },
    );
  });
};

const upsertMediaAsset = ({ recordId, source, assetType, path: assetPath, originalUrl, width = null, height = null }) => {
  return new Promise((resolve, reject) => {
    getDb().run(
      `INSERT INTO media_assets
       (record_id, source, asset_type, path, original_url, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(record_id, source, asset_type, original_url) DO UPDATE SET
         path = excluded.path,
         width = excluded.width,
         height = excluded.height`,
      [recordId, source, assetType, assetPath, originalUrl, width, height, Math.floor(Date.now() / 1000)],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
};

const getBrowsePreviewUrls = ({ atlasId, f95Id, steamId, lcId, sourceOrder } = {}) => {
  return new Promise((resolve, reject) => {
    const atlasParam = atlasId || null;
    const f95Param = f95Id || null;
    const steamParam = steamId || null;
    const lcParam = lcId || null;
    const query = `
      SELECT source, url_blob, sort_order FROM (
        SELECT 'f95_screens' AS source, f95_zone_screens.screen_url AS url_blob, 0 AS sort_order
        FROM f95_zone_screens
        JOIN f95_zone_data ON f95_zone_screens.f95_id = f95_zone_data.f95_id
        WHERE (? IS NOT NULL AND f95_zone_data.f95_id = ?)
           OR (? IS NOT NULL AND f95_zone_data.atlas_id = ?)
        UNION ALL
        SELECT 'lewdcorner_screens' AS source, lewdcorner_data.screens AS url_blob, 1 AS sort_order
        FROM lewdcorner_data
        WHERE (? IS NOT NULL AND lewdcorner_data.lc_id = ?)
           OR (? IS NOT NULL AND lewdcorner_data.atlas_id = ?)
        UNION ALL
        SELECT 'atlas_previews' AS source, atlas_previews.preview_url AS url_blob, 2 AS sort_order
        FROM atlas_previews
        WHERE ? IS NOT NULL AND atlas_previews.atlas_id = ?
        UNION ALL
        SELECT 'steam_screens' AS source, steam_screens.screen_url AS url_blob, 3 AS sort_order
        FROM steam_screens
        JOIN steam_data ON steam_screens.steam_id = steam_data.steam_id
        WHERE (? IS NOT NULL AND steam_screens.steam_id = ?)
           OR (? IS NOT NULL AND steam_data.atlas_id = ?)
      )
      WHERE url_blob IS NOT NULL AND TRIM(url_blob) != ''
      ORDER BY sort_order
    `;

    getDb().all(
      query,
      [
        f95Param, f95Param,
        atlasParam, atlasParam,
        lcParam, lcParam,
        atlasParam, atlasParam,
        atlasParam, atlasParam,
        steamParam, steamParam,
        atlasParam, atlasParam,
      ],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const entries = [];
        const seen = new Set();
        let invalidCount = 0;
        const addUrl = (source, value) => {
          const url = String(value || "").trim();
          if (!url) return;
          if (!isRemoteHttpUrl(url)) {
            invalidCount++;
            return;
          }
          if (seen.has(url)) return;
          seen.add(url);
          entries.push({ source, url });
        };

        const f95Rows = (rows || []).filter((row) => row.source === "f95_screens");
        const lewdCornerRows = (rows || []).filter((row) => row.source === "lewdcorner_screens");
        const atlasRows = (rows || []).filter((row) => row.source === "atlas_previews");
        const steamRows = (rows || []).filter((row) => row.source === "steam_screens");

        f95Rows.forEach((row) => addUrl("f95", row.url_blob));
        lewdCornerRows.forEach((row) => parsePreviewList(row.url_blob).forEach((url) => addUrl("lewdcorner", url)));
        atlasRows.forEach((row) => addUrl("atlas", row.url_blob));
        steamRows.forEach((row) => addUrl("steam", row.url_blob));

        getDb().get(
          `SELECT f95_zone_data.screens, lewdcorner_data.screens AS lewdcorner_screens, atlas_data.previews
           FROM atlas_data
           LEFT JOIN f95_zone_data ON atlas_data.atlas_id = f95_zone_data.atlas_id
           LEFT JOIN lewdcorner_data ON atlas_data.atlas_id = lewdcorner_data.atlas_id
           WHERE (? IS NOT NULL AND atlas_data.atlas_id = ?)
              OR (? IS NOT NULL AND f95_zone_data.f95_id = ?)
              OR (? IS NOT NULL AND lewdcorner_data.lc_id = ?)
           LIMIT 1`,
          [atlasParam, atlasParam, f95Param, f95Param, lcParam, lcParam],
          (legacyErr, row) => {
            if (legacyErr) {
              reject(legacyErr);
              return;
            }

            parsePreviewList(row?.screens).forEach((url) => addUrl("f95", url));
            parsePreviewList(row?.lewdcorner_screens).forEach((url) => addUrl("lewdcorner", url));
            parsePreviewList(row?.previews).forEach((url) => addUrl("atlas", url));

            console.log(
              `Browse preview URLs resolved: atlasId=${atlasId || "none"} ` +
              `f95Id=${f95Id || "none"} lcId=${lcId || "none"} steamId=${steamId || "none"} ` +
              `count=${entries.length} invalid=${invalidCount}`,
            );
            resolve(selectPreviewUrlsBySource(entries, sourceOrder));
          },
        );
      },
    );
  });
};

const getRemotePreviewUrls = (recordId, options = {}) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT source, url FROM (
        SELECT 'steam' AS source, steam_movies.movie_url AS url, 0 AS sort_order
        FROM steam_movies
        JOIN steam_data movie_steam_data ON steam_movies.steam_id = movie_steam_data.steam_id
        JOIN games ON games.record_id = ?
        LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
        LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
        LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
        WHERE steam_movies.steam_id = steam_mappings.steam_id
           OR movie_steam_data.atlas_id = atlas_mappings.atlas_id
           OR atlas_data.external_ids LIKE '%"steam_appid":"' || steam_movies.steam_id || '"%'
           OR atlas_data.external_ids LIKE '%"steam_appid": "' || steam_movies.steam_id || '"%'
           OR atlas_data.external_ids LIKE '%"steam_id":"' || steam_movies.steam_id || '"%'
           OR atlas_data.external_ids LIKE '%"steam_id": "' || steam_movies.steam_id || '"%'
        UNION
        SELECT 'f95' AS source, f95_zone_screens.screen_url AS url, 1 AS sort_order
        FROM f95_zone_screens
        JOIN f95_zone_data ON f95_zone_screens.f95_id = f95_zone_data.f95_id
        JOIN atlas_mappings ON f95_zone_data.atlas_id = atlas_mappings.atlas_id
        WHERE atlas_mappings.record_id = ?
        UNION
        SELECT 'lewdcorner' AS source, NULL AS url, 1 AS sort_order
        FROM lewdcorner_mappings
        WHERE lewdcorner_mappings.record_id = ?
        UNION
        SELECT 'atlas' AS source, atlas_previews.preview_url AS url, 1 AS sort_order
        FROM atlas_previews
        JOIN atlas_mappings ON atlas_previews.atlas_id = atlas_mappings.atlas_id
        WHERE atlas_mappings.record_id = ?
        UNION
        SELECT 'steam' AS source, steam_screens.screen_url AS url, 1 AS sort_order
        FROM steam_screens
        JOIN steam_data screen_steam_data ON steam_screens.steam_id = screen_steam_data.steam_id
        JOIN games ON games.record_id = ?
        LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
        LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
        LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
        WHERE steam_screens.steam_id = steam_mappings.steam_id
           OR screen_steam_data.atlas_id = atlas_mappings.atlas_id
           OR atlas_data.external_ids LIKE '%"steam_appid":"' || steam_screens.steam_id || '"%'
           OR atlas_data.external_ids LIKE '%"steam_appid": "' || steam_screens.steam_id || '"%'
           OR atlas_data.external_ids LIKE '%"steam_id":"' || steam_screens.steam_id || '"%'
           OR atlas_data.external_ids LIKE '%"steam_id": "' || steam_screens.steam_id || '"%'
      )
      WHERE url IS NOT NULL AND TRIM(url) != ''
      ORDER BY sort_order
    `;

    getDb().all(query, [recordId, recordId, recordId, recordId, recordId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      const previewEntries = rows
        .map((row) => ({
          url: row.url,
          source: row.source,
        }))
        .filter((row) => row.url);
      const urls = selectPreviewUrlsBySource(previewEntries, options.sourceOrder);
      if (urls.length > 0) {
        resolve(urls);
        return;
      }

      getDb().get(
        `SELECT f95_zone_data.screens AS f95_screens, lewdcorner_data.screens AS lewdcorner_screens
         FROM games
         LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
         LEFT JOIN f95_zone_data ON f95_zone_data.atlas_id = atlas_mappings.atlas_id
         LEFT JOIN lewdcorner_mappings ON games.record_id = lewdcorner_mappings.record_id
         LEFT JOIN lewdcorner_data ON lewdcorner_data.lc_id = lewdcorner_mappings.lc_id
           OR (lewdcorner_mappings.lc_id IS NULL AND lewdcorner_data.atlas_id = atlas_mappings.atlas_id)
         WHERE games.record_id = ?`,
        [recordId],
        (screensErr, row) => {
          if (screensErr) {
            reject(screensErr);
            return;
          }
          resolve(
            selectPreviewUrlsBySource(
              [
                ...String(row?.f95_screens || "").split(",").map((url) => ({ url, source: "f95" })),
                ...String(row?.lewdcorner_screens || "").split(",").map((url) => ({ url, source: "lewdcorner" })),
              ]
                .map((entry) => ({
                url: String(entry.url || "").trim(),
                source: entry.source,
                }))
                .filter((entry) => entry.url),
              options.sourceOrder,
            ),
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
            const remotePreviews = await getRemotePreviewUrls(recordId, { sourceOrder: mediaStorageMode?.sourceOrder });

            let previews;
            if (localPreviews.length > 0) {
              // Local art wins, BUT trailers are never downloaded in stream mode
              // (and junk preview rows left by the old broken refresh-game-media
              // could otherwise suppress the remote fallback entirely). So always
              // surface remote *video* URLs that aren't already present, prepended
              // so the trailer leads the grid. Screenshots stay local.
              const isVideo = (u) => /\.(mp4|webm|m4v)(\?|#|$)/i.test(String(u || ""));
              const have = new Set(localPreviews);
              const remoteTrailers = remotePreviews.filter(
                (u) => isVideo(u) && !have.has(u),
              );
              previews = [...remoteTrailers, ...localPreviews];
            } else {
              previews = remotePreviews;
            }

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

const getRemoteBannerUrl = (recordId, options = {}) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT
        f95_zone_data.banner_url AS f95_banner,
        lewdcorner_data.banner_url AS lewdcorner_banner,
        steam_mappings.steam_id AS mapped_steam_id,
        atlas_data.external_ids,
        steam_data.header AS steam_header,
        steam_data.library_hero AS steam_hero,
        atlas_data.banner_wide AS atlas_banner_wide,
        atlas_data.banner AS atlas_banner
       FROM games
       LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
       LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
       LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
       LEFT JOIN lewdcorner_mappings ON games.record_id = lewdcorner_mappings.record_id
       LEFT JOIN lewdcorner_data ON lewdcorner_data.lc_id = lewdcorner_mappings.lc_id
         OR (lewdcorner_mappings.lc_id IS NULL AND lewdcorner_data.atlas_id = atlas_mappings.atlas_id)
       LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
       LEFT JOIN steam_data ON steam_mappings.steam_id = steam_data.steam_id
         OR (steam_mappings.steam_id IS NULL AND atlas_mappings.atlas_id IS NOT NULL AND steam_data.atlas_id = atlas_mappings.atlas_id)
       WHERE games.record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        const steamId = row?.mapped_steam_id || resolveSteamAppId(row, parseExternalIds(row?.external_ids));
        const bySource = {
          f95: [row?.f95_banner],
          lewdcorner: [row?.lewdcorner_banner],
          steam: [row?.steam_header, steamCdnAsset(steamId, "header.jpg"), row?.steam_hero],
          atlas: [row?.atlas_banner_wide, row?.atlas_banner],
        };
        for (const source of normalizeSourceOrder(options.sourceOrder)) {
          const url = (bySource[source] || []).find(isRemoteHttpUrl);
          if (url) {
            resolve(url);
            return;
          }
        }
        resolve("");
      },
    );
  });
};

const getBanner = (recordId, appPath, isDev, type, mediaStorageMode = "stream") => {
  return new Promise((resolve, reject) => {
    const sourceOrder = typeof mediaStorageMode === "object" ? mediaStorageMode.sourceOrder : null;
    const rank = sourceRanker(sourceOrder);
    getDb().all(
      `SELECT path, source, created_at FROM (
         SELECT path,
           CASE
             WHEN path LIKE '%banner_custom_%' THEN 'custom'
             WHEN path LIKE '%banner_f95_%' THEN 'f95'
             WHEN path LIKE '%banner_lewdcorner_%' THEN 'lewdcorner'
             WHEN path LIKE '%banner_atlas_%' THEN 'atlas'
             ELSE 'source'
           END AS source,
           0 AS created_at
         FROM banners
         WHERE record_id = ? AND type = ?
         UNION ALL
         SELECT path, 'steam' AS source, COALESCE(created_at, 0) AS created_at
         FROM media_assets
         WHERE record_id = ? AND asset_type = 'steam_header'
       )
       ORDER BY
         CASE
           WHEN source = 'custom' THEN 0
           ELSE 2
         END,
         created_at DESC,
         path`,
      [recordId, type, recordId],
      async (err, rows) => {
        if (err) {
          console.error("Error fetching banners:", err);
          reject(err);
        } else {
          try {
            const localEntries = rows.map((row, index) => ({
              url: toLocalAssetPath(appPath, isDev, row.path),
              source: row.source,
              index,
            }));
            const remoteBannerUrl = await getRemoteBannerUrl(recordId, { sourceOrder });
            const remoteBanners = remoteBannerUrl ? [remoteBannerUrl] : [];
            const customBanners = localEntries.filter((entry) => entry.source === "custom");
            const sourceBanners = localEntries
              .filter((entry) => entry.source !== "custom")
              .filter((entry) => sourceEnabled(entry.source, sourceOrder))
              .sort((a, b) => rank(a.source) - rank(b.source) || a.index - b.index);
            const banners = customBanners.length > 0
              ? customBanners.map((entry) => entry.url)
              : sourceBanners.length > 0
                ? sourceBanners.map((entry) => entry.url)
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
      const mediaRoot = path.resolve(getAssetBasePath(appPath, isDev), "data", "images");
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
            await deletePathWithElevationFallback(filePath, {
              recursive: false,
              force: true,
              description: "Delete banner image",
              validatePath: (candidatePath) => {
                const resolved = path.resolve(candidatePath);
                const relative = path.relative(mediaRoot, resolved);
                if (relative.startsWith("..") || path.isAbsolute(relative)) {
                  throw new Error("Banner path is outside the media folder");
                }
              },
            });
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
      const mediaRoot = path.resolve(getAssetBasePath(appPath, isDev), "data", "images");
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
            await deletePathWithElevationFallback(filePath, {
              recursive: false,
              force: true,
              description: "Delete preview image",
              validatePath: (candidatePath) => {
                const resolved = path.resolve(candidatePath);
                const relative = path.relative(mediaRoot, resolved);
                if (relative.startsWith("..") || path.isAbsolute(relative)) {
                  throw new Error("Preview path is outside the media folder");
                }
              },
            });
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

// Removes a record's cached media_assets rows and their backing files. Steam
// art can be cached by appid and shared across records, so a file is only
// unlinked when no OTHER record still references that same path.
const deleteMediaAssets = (recordId, appPath, isDev) => {
  return new Promise((resolve, reject) => {
    const assetRoot = path.resolve(getAssetBasePath(appPath, isDev));
    getDb().all(
      `SELECT path FROM media_assets WHERE record_id = ?`,
      [recordId],
      async (err, rows) => {
        if (err) {
          console.error("Error fetching media_assets for deletion:", err);
          reject(err);
          return;
        }
        for (const row of rows || []) {
          const rawPath = String(row?.path || "").replace("file://", "");
          if (!rawPath) continue;

          // Skip files still referenced by another record.
          const sharedCount = await new Promise((res) => {
            getDb().get(
              `SELECT COUNT(*) AS c FROM media_assets WHERE path = ? AND record_id != ?`,
              [row.path, recordId],
              (cErr, cRow) => res(cErr ? 1 : Number(cRow?.c || 0)),
            );
          });
          if (sharedCount > 0) continue;

          const filePath = path.isAbsolute(rawPath)
            ? rawPath
            : path.join(getAssetBasePath(appPath, isDev), rawPath);
          try {
            const exists = await fsPromises
              .access(filePath)
              .then(() => true)
              .catch(() => false);
            if (!exists) continue;
            await deletePathWithElevationFallback(filePath, {
              recursive: false,
              force: true,
              description: "Delete media asset",
              validatePath: (candidatePath) => {
                const resolved = path.resolve(candidatePath);
                const relative = path.relative(assetRoot, resolved);
                if (relative.startsWith("..") || path.isAbsolute(relative)) {
                  throw new Error("Media asset path is outside the app data folder");
                }
              },
            });
          } catch (fileErr) {
            console.error("Error deleting media asset file:", fileErr);
            // Continue with next file
          }
        }
        getDb().run(`DELETE FROM media_assets WHERE record_id = ?`, [recordId], (delErr) => {
          if (delErr) {
            console.error("Error removing media_assets from database:", delErr);
            reject(delErr);
          } else {
            resolve();
          }
        });
      },
    );
  });
};

module.exports = {
  updateFolderSize,
  getBannerUrl,
  getScreensUrlList,
  updateBanners,
  updatePreviews,
  getAllDownloadableAssetUrlsForRecord,
  upsertMediaAsset,
  getBrowsePreviewUrls,
  getRemotePreviewUrls,
  getPreviews,
  getBanners,
  getRemoteBannerUrl,
  getBanner,
  deleteBanner,
  deletePreviews,
  deleteMediaAssets,
}
