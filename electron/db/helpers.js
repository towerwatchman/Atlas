'use strict'

const path = require('path')

// Shared query-building helpers. No circular deps — required by all domain files.
// db is passed in at call time, NOT imported here.

const getAssetBasePath = (appPath, isDev) =>
  isDev ? path.join(appPath, "src") : appPath;

const toLocalAssetPath = (appPath, isDev, assetPath) =>
  path.join(getAssetBasePath(appPath, isDev), assetPath).replace(/\\/g, "/");

const normalizeMediaStorageMode = (mode) =>
  mode === "download" ? "download" : "stream";

const remoteBannerExpression =
  "COALESCE(f95_zone_data.banner_url, lewdcorner_data.banner_url, steam_data.header, steam_data.library_hero, atlas_data.banner_wide, atlas_data.banner)";

const buildBannerJoinClauses = () => `
      LEFT JOIN (
        SELECT record_id, MIN(path) AS path
        FROM banners
        WHERE type = 'animated' AND path LIKE '%banner_custom_%'
        GROUP BY record_id
      ) custom_animated_banners ON games.record_id = custom_animated_banners.record_id
      LEFT JOIN (
        SELECT record_id, MIN(path) AS path
        FROM banners
        WHERE type = 'small' AND path LIKE '%banner_custom_%'
        GROUP BY record_id
      ) custom_small_banners ON games.record_id = custom_small_banners.record_id
      LEFT JOIN (
        SELECT record_id, MIN(path) AS path
        FROM banners
        WHERE type = 'large' AND path LIKE '%banner_custom_%'
        GROUP BY record_id
      ) custom_large_banners ON games.record_id = custom_large_banners.record_id
      LEFT JOIN (
        SELECT record_id, MIN(path) AS path
        FROM banners
        WHERE type = 'animated' AND path NOT LIKE '%banner_custom_%'
        GROUP BY record_id
      ) source_animated_banners ON games.record_id = source_animated_banners.record_id
      LEFT JOIN (
        SELECT record_id, MIN(path) AS path
        FROM banners
        WHERE type = 'small' AND path NOT LIKE '%banner_custom_%'
        GROUP BY record_id
      ) source_small_banners ON games.record_id = source_small_banners.record_id
      LEFT JOIN (
        SELECT record_id, MIN(path) AS path
        FROM banners
        WHERE type = 'large' AND path NOT LIKE '%banner_custom_%'
        GROUP BY record_id
      ) source_large_banners ON games.record_id = source_large_banners.record_id`;

const buildBannerSelectFields = (baseImagePath, mediaStorageMode) => {
  const safeBaseImagePath = String(baseImagePath || '').replace(/'/g, "''");
  const customAnimatedBannerExpression = `REPLACE('${safeBaseImagePath}/' || custom_animated_banners.path, '\\', '/')`;
  const customSmallBannerExpression = `REPLACE('${safeBaseImagePath}/' || custom_small_banners.path, '\\', '/')`;
  const customLargeBannerExpression = `REPLACE('${safeBaseImagePath}/' || custom_large_banners.path, '\\', '/')`;
  const sourceAnimatedBannerExpression = `REPLACE('${safeBaseImagePath}/' || source_animated_banners.path, '\\', '/')`;
  const sourceSmallBannerExpression = `REPLACE('${safeBaseImagePath}/' || source_small_banners.path, '\\', '/')`;
  const sourceLargeBannerExpression = `REPLACE('${safeBaseImagePath}/' || source_large_banners.path, '\\', '/')`;
  const localSteamHeaderExpression = `(
            SELECT REPLACE('${safeBaseImagePath}/' || media_assets.path, '\\', '/')
            FROM media_assets
            WHERE media_assets.record_id = games.record_id
              AND media_assets.asset_type = 'steam_header'
            ORDER BY media_assets.created_at DESC
            LIMIT 1
          )`;
  const localBannerExpression = `COALESCE(${customAnimatedBannerExpression}, ${customSmallBannerExpression}, ${customLargeBannerExpression}, ${sourceAnimatedBannerExpression}, ${sourceSmallBannerExpression}, ${sourceLargeBannerExpression}, ${localSteamHeaderExpression})`;
  const bannerUrlExpression =
    `COALESCE(${localBannerExpression}, ${remoteBannerExpression})`;
  const bannerSourceExpression =
    `CASE
          WHEN custom_animated_banners.path IS NOT NULL OR source_animated_banners.path IS NOT NULL THEN 'download-animated'
          WHEN custom_small_banners.path IS NOT NULL OR custom_large_banners.path IS NOT NULL
            OR source_small_banners.path IS NOT NULL OR source_large_banners.path IS NOT NULL
            OR ${localSteamHeaderExpression} IS NOT NULL THEN 'download'
          WHEN ${remoteBannerExpression} IS NOT NULL THEN 'stream'
          ELSE ''
        END`;

  return `
        ${bannerUrlExpression} AS banner_url,
        ${bannerSourceExpression} AS banner_source,
        CASE
          WHEN custom_animated_banners.path IS NOT NULL OR custom_small_banners.path IS NOT NULL
            OR custom_large_banners.path IS NOT NULL OR source_animated_banners.path IS NOT NULL
            OR source_small_banners.path IS NOT NULL OR source_large_banners.path IS NOT NULL
            OR ${localSteamHeaderExpression} IS NOT NULL
          THEN 1 ELSE 0
        END AS has_downloaded_banner`;
};

module.exports = {
  getAssetBasePath,
  toLocalAssetPath,
  normalizeMediaStorageMode,
  remoteBannerExpression,
  buildBannerJoinClauses,
  buildBannerSelectFields,
}
