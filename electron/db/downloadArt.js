"use strict";

// ── Banner art for download rows ─────────────────────────────────────────────
//
// A download card showed cover art only when its game happened to be in the
// renderer's currently loaded, currently filtered library list — `gamesByRecordId`
// is built from that list, so a download for a game outside the active view got
// nothing, and a Browse or wishlist download (which has no record_id at all)
// never got anything.
//
// The art is resolved HERE, on the row, rather than looked up in the renderer.
// That makes a download card independent of whatever the library page happens to
// have loaded, which is the whole point: the two are unrelated views and one was
// silently depending on the other's state.
//
// ── Why correlated subqueries and not plain joins ────────────────────────────
//
// The catalog tables are joined to `games` through mapping tables, and two of
// those relationships are NOT one-to-one:
//
//   f95_zone_data.atlas_id   — not unique; a server migration dropped the
//                              constraint (see the rebuild in db/index.js ~99)
//   lewdcorner_data.atlas_id — same
//   lewdcorner_mappings      — UNIQUE(record_id, lc_id) only, so one record can
//                              carry several lc_ids
//
// Joining any of those onto `downloads` would multiply download rows, and
// db/downloads.js does `SELECT *` into a queue the UI renders one row per item.
// getGame() survives the same joins with a GROUP BY; here a duplicated queue
// entry would be a visible bug rather than a collapsed column. So every art
// lookup is a scalar subquery with its own LIMIT, and the only actual JOIN is
// onto the id-resolution CTEs below, which are keyed on downloads.id.
//
// ── Two paths into the same fields ───────────────────────────────────────────
//
// A download row identifies its game one of two ways, never both:
//
//   record_id    a real library record  -> ids come from the mapping tables
//   catalog_ref  a `catalog:…` string   -> ids are parsed out of the ref itself
//                                          (see library/catalogRef.js)
//
// Both funnel into one set of effective ids (atlas / steam / lc / gog) so the
// art expressions are written once. The atlas id is resolved first because the
// other three can be reached through it: a `catalog:steam:480` download picks up
// the atlas banner of whatever atlas row that appid maps to, exactly as the
// Browse tile it came from does.
//
// ── What this deliberately does not do ───────────────────────────────────────
//
// It does not honour Metadata.sourceOrder. db/mediaSources.js applyMediaSources()
// reorders candidates per the user's configured source preference, and that runs
// in the games pipeline, not here. The renderer therefore still prefers a game
// object from the library list when it has one and falls back to these fields
// otherwise — so a Steam-first user sees no change on rows that were already
// working, and rows that showed nothing now show something.

/** Ordered exactly as db/helpers.js bannerUrlExpression resolves them: local
 *  file first, then the remote COALESCE order. gog is appended rather than
 *  interleaved because helpers.js has no gog term at all — it only matters for a
 *  `catalog:gog:…` download, which would otherwise have no art whatsoever. */
const CANDIDATE_COLUMNS = Object.freeze([
  "art_banner_local",
  "art_banner_f95",
  "art_banner_lewdcorner",
  "art_banner_steam_header",
  "art_banner_steam_hero",
  "art_banner_atlas_wide",
  "art_banner_atlas",
  "art_banner_gog_header",
]);

/** Single-quote escaping for a path interpolated into SQL. Same treatment
 *  db/helpers.js buildBannerSelectFields gives its base image path. */
const quote = (value) => String(value || "").replace(/'/g, "''");

/** `catalog:steam:480` -> 480, and nothing for any other shape. NULLIF(...,0)
 *  because CAST of a non-numeric tail yields 0 rather than NULL, and 0 would
 *  then match nothing while still reading as "present" to a COALESCE. */
const refId = (prefix) => `
      CASE WHEN d.catalog_ref LIKE '${prefix}%'
        THEN NULLIF(CAST(SUBSTR(d.catalog_ref, LENGTH('${prefix}') + 1) AS INTEGER), 0)
      END`;

// The atlas shape is the one with NO kind segment, so it is matched by
// exclusion: one colon, not two. `catalog:steam:480` matches 'catalog:%' too,
// which is why the second test is there.
const REF_ATLAS_ID = `
      CASE WHEN d.catalog_ref LIKE 'catalog:%' AND d.catalog_ref NOT LIKE 'catalog:%:%'
        THEN NULLIF(CAST(SUBSTR(d.catalog_ref, LENGTH('catalog:') + 1) AS INTEGER), 0)
      END`;

/**
 * The CTE block that turns each download row into a set of effective catalog
 * ids. Prepended to the queries in db/downloads.js.
 *
 * Three levels because each one depends on the last: the ref is parsed, then an
 * atlas id is resolved from it, then steam / lc / gog fall back through that
 * atlas id. SQLite cannot reference a SELECT alias from a sibling expression, so
 * the alternative was repeating the whole resolution inside every art column.
 */
const DOWNLOAD_ART_CTE = `
  download_refs AS (
    SELECT
      d.id AS ref_download_id,
      d.record_id AS ref_record_id,
      ${REF_ATLAS_ID} AS ref_atlas_direct,
      ${refId("catalog:steam:")} AS ref_steam_id,
      ${refId("catalog:gog:")} AS ref_gog_id,
      ${refId("catalog:lewdcorner:")} AS ref_lc_id
    FROM downloads d
  ),
  download_atlas AS (
    SELECT
      r.ref_download_id,
      r.ref_record_id,
      r.ref_steam_id,
      r.ref_gog_id,
      r.ref_lc_id,
      -- A library record's own mapping wins over anything derived from the ref:
      -- the two are never both set today, but if they ever are, the record is
      -- the stronger claim.
      COALESCE(
        (SELECT am.atlas_id FROM atlas_mappings am WHERE am.record_id = r.ref_record_id),
        r.ref_atlas_direct,
        (SELECT s.atlas_id FROM steam_data s WHERE s.steam_id = r.ref_steam_id),
        (SELECT g.atlas_id FROM gog_data g WHERE g.gog_id = r.ref_gog_id),
        (SELECT lc.atlas_id FROM lewdcorner_data lc WHERE lc.lc_id = r.ref_lc_id)
      ) AS art_atlas_id
    FROM download_refs r
  ),
  download_art AS (
    SELECT
      a.ref_download_id AS art_download_id,
      a.ref_record_id AS art_record_id,
      a.art_atlas_id,
      -- Each falls back through the atlas id, which is how getGame() reaches a
      -- steam row for a record that has an atlas mapping but no steam mapping.
      COALESCE(
        (SELECT sm.steam_id FROM steam_mappings sm WHERE sm.record_id = a.ref_record_id),
        a.ref_steam_id,
        (SELECT s.steam_id FROM steam_data s WHERE s.atlas_id = a.art_atlas_id ORDER BY s.steam_id LIMIT 1)
      ) AS art_steam_id,
      COALESCE(
        (SELECT gm.gog_id FROM gog_mappings gm WHERE gm.record_id = a.ref_record_id),
        a.ref_gog_id,
        (SELECT g.gog_id FROM gog_data g WHERE g.atlas_id = a.art_atlas_id ORDER BY g.gog_id LIMIT 1)
      ) AS art_gog_id,
      -- ORDER BY … LIMIT 1 rather than a bare scalar: lewdcorner_mappings has
      -- only UNIQUE(record_id, lc_id), so a record CAN carry more than one.
      COALESCE(
        (SELECT lm.lc_id FROM lewdcorner_mappings lm WHERE lm.record_id = a.ref_record_id ORDER BY lm.lc_id LIMIT 1),
        a.ref_lc_id,
        (SELECT lc.lc_id FROM lewdcorner_data lc WHERE lc.atlas_id = a.art_atlas_id ORDER BY lc.lc_id LIMIT 1)
      ) AS art_lc_id
    FROM download_atlas a
  )`;

/**
 * The art columns themselves, for the outer SELECT list. Assumes `download_art`
 * is joined as `art`.
 *
 * @param {string} assetBasePath Root the `banners` / `media_assets` paths hang
 *   off. Empty when the caller has none (a test harness, or before the app has
 *   resolved its data dir), in which case only remote art is offered rather than
 *   emitting a path rooted at "/".
 */
const buildDownloadArtFields = (assetBasePath = "") => {
  const base = quote(assetBasePath);

  // Mirrors db/helpers.js exactly: custom banners beat source banners, animated
  // beats small beats large, and a downloaded steam header is the last local
  // option. MIN(path) there, ORDER BY … LIMIT 1 here — same row, without the
  // GROUP BY that a join would need.
  const bannerPick = (type, custom) => `
        (SELECT REPLACE('${base}/' || b.path, '\\', '/')
           FROM banners b
          WHERE b.record_id = art.art_record_id
            AND b.type = '${type}'
            AND b.path ${custom ? "LIKE" : "NOT LIKE"} '%banner_custom_%'
          ORDER BY b.path LIMIT 1)`;

  const localBanner = assetBasePath
    ? `COALESCE(
        ${bannerPick("animated", true)},
        ${bannerPick("small", true)},
        ${bannerPick("large", true)},
        ${bannerPick("animated", false)},
        ${bannerPick("small", false)},
        ${bannerPick("large", false)},
        (SELECT REPLACE('${base}/' || ma.path, '\\', '/')
           FROM media_assets ma
          WHERE ma.record_id = art.art_record_id
            AND ma.asset_type = 'steam_header'
          ORDER BY ma.created_at DESC LIMIT 1)
      )`
    : "NULL";

  return `
      ${localBanner} AS art_banner_local,
      (SELECT f.banner_url FROM f95_zone_data f
        WHERE f.atlas_id = art.art_atlas_id AND NULLIF(f.banner_url, '') IS NOT NULL
        ORDER BY f.f95_id LIMIT 1) AS art_banner_f95,
      (SELECT lc.banner_url FROM lewdcorner_data lc
        WHERE lc.lc_id = art.art_lc_id) AS art_banner_lewdcorner,
      (SELECT s.header FROM steam_data s
        WHERE s.steam_id = art.art_steam_id) AS art_banner_steam_header,
      (SELECT s.library_hero FROM steam_data s
        WHERE s.steam_id = art.art_steam_id) AS art_banner_steam_hero,
      (SELECT a.banner_wide FROM atlas_data a
        WHERE a.atlas_id = art.art_atlas_id) AS art_banner_atlas_wide,
      (SELECT a.banner FROM atlas_data a
        WHERE a.atlas_id = art.art_atlas_id) AS art_banner_atlas,
      (SELECT g.header FROM gog_data g
        WHERE g.gog_id = art.art_gog_id) AS art_banner_gog_header`;
};

/** The join that makes `art.*` available. Always a LEFT JOIN: a download row
 *  with neither a record nor a ref must still come back, just with no art. */
const DOWNLOAD_ART_JOIN = `LEFT JOIN download_art art ON art.art_download_id = downloads.id`;

/**
 * Read the art columns off a row into the ordered chain the renderer walks.
 *
 * Shaped to match `banner_candidates` on a game object, because
 * DownloadsPage's bannerChainFor() and the library's GameBanner both consume
 * that shape — a second shape here would be a second thing to keep in step.
 *
 * @returns {string[]} Deduped, empties dropped. Possibly empty.
 */
const downloadArtCandidates = (row = {}) => {
  const seen = new Set();
  const out = [];
  for (const column of CANDIDATE_COLUMNS) {
    const value = String(row?.[column] ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

module.exports = {
  CANDIDATE_COLUMNS,
  DOWNLOAD_ART_CTE,
  DOWNLOAD_ART_JOIN,
  buildDownloadArtFields,
  downloadArtCandidates,
};
