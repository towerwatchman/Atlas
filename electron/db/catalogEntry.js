"use strict";

// ── One catalog entry, by ref ────────────────────────────────────────────────
//
// The promotion path needs the same identity and metadata a Browse tile shows,
// fetched from a stored `catalog:…` ref (see library/catalogRef.js).
//
// Re-queried rather than snapshotted. The alternative was to copy title,
// creator, engine and the ids onto the download row at enqueue time, but the
// catalog updates between a download starting and finishing — often that is
// exactly WHY it was downloaded — and a snapshot would create the record from
// whatever was true hours ago. The ref is the only thing stored, and it is
// stable.
//
// The SELECTs deliberately mirror the corresponding branch of the browse union
// in db/versions.js: same COALESCE precedence for creator, same synthetic title
// for a LewdCorner-only row. A promoted record should be the game the user was
// looking at, named the way the tile named it.
//
// Sibling ids come from correlated subqueries with MIN() rather than joins.
// f95_zone_data.atlas_id and lewdcorner_data.atlas_id are NOT unique — a server
// migration dropped that constraint (see the rebuild in db/index.js ~99) — so
// joining on atlas_id can multiply rows, and which one a LIMIT 1 kept would
// depend on the query planner.

const dbModule = require("./index");
const { parseCatalogRef } = require("../library/catalogRef");

const getDb = () => dbModule.db;

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });

// Ids for every other provider that shares this entry's atlas_id, so a promoted
// record picks up all of its mappings and not just the one it was browsed under.
const SIBLING_IDS = `
  (SELECT MIN(f.f95_id) FROM f95_zone_data f WHERE f.atlas_id = %ATLAS%) AS f95Id,
  (SELECT MIN(lc.lc_id) FROM lewdcorner_data lc WHERE lc.atlas_id = %ATLAS%) AS lcId,
  (SELECT MIN(s.steam_id) FROM steam_data s WHERE s.atlas_id = %ATLAS%) AS steamId,
  (SELECT MIN(g.gog_id) FROM gog_data g WHERE g.atlas_id = %ATLAS%) AS gogId
`;

const siblings = (atlasExpression) => SIBLING_IDS.split("%ATLAS%").join(atlasExpression);

const QUERIES = {
  atlas: `
    SELECT
      a.atlas_id AS atlasId,
      ${siblings("a.atlas_id")},
      a.title AS title,
      COALESCE(NULLIF(a.creator, ''), a.developer) AS creator,
      a.engine AS engine,
      a.overview AS description,
      a.version AS latestVersion
    FROM atlas_data a
    WHERE a.atlas_id = ?
    LIMIT 1
  `,
  steam: `
    SELECT
      s.atlas_id AS atlasId,
      ${siblings("s.atlas_id")},
      COALESCE(NULLIF(a.title, ''), s.title) AS title,
      COALESCE(NULLIF(a.creator, ''), NULLIF(a.developer, ''), s.developer) AS creator,
      COALESCE(NULLIF(a.engine, ''), s.engine) AS engine,
      COALESCE(NULLIF(a.overview, ''), s.overview) AS description,
      a.version AS latestVersion
    FROM steam_data s
    LEFT JOIN atlas_data a ON a.atlas_id = s.atlas_id
    WHERE s.steam_id = ?
    LIMIT 1
  `,
  gog: `
    SELECT
      g.atlas_id AS atlasId,
      ${siblings("g.atlas_id")},
      COALESCE(NULLIF(a.title, ''), g.title) AS title,
      COALESCE(NULLIF(a.creator, ''), NULLIF(a.developer, ''), g.developer) AS creator,
      COALESCE(NULLIF(a.engine, ''), g.engine) AS engine,
      COALESCE(NULLIF(a.overview, ''), g.overview) AS description,
      a.version AS latestVersion
    FROM gog_data g
    LEFT JOIN atlas_data a ON a.atlas_id = g.atlas_id
    WHERE g.gog_id = ?
    LIMIT 1
  `,
  // lewdcorner_data has no title or creator columns at all, which is why the
  // browse branch synthesises them. Same synthesis here, so a promoted record
  // is named what the tile was named — with the atlas title preferred when the
  // row happens to have one (the browse branch excludes those, this does not
  // need to).
  lewdcorner: `
    SELECT
      lc.atlas_id AS atlasId,
      ${siblings("lc.atlas_id")},
      COALESCE(NULLIF(a.title, ''), 'LewdCorner #' || lc.lc_id) AS title,
      COALESCE(NULLIF(a.creator, ''), NULLIF(a.developer, ''), 'Unknown') AS creator,
      a.engine AS engine,
      a.overview AS description,
      a.version AS latestVersion
    FROM lewdcorner_data lc
    LEFT JOIN atlas_data a ON a.atlas_id = lc.atlas_id
    WHERE lc.lc_id = ?
    LIMIT 1
  `,
};

const toId = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const toText = (value) => String(value ?? "").trim();

/**
 * Hydrate a catalog entry from a stored ref.
 *
 * @param {string} ref e.g. `catalog:30956`, `catalog:steam:480`
 * @returns {Promise<object|null>} null when the ref is unparseable OR the row
 *   is gone — a catalog refresh can retire an entry between a download starting
 *   and finishing, and the caller needs to say so rather than create a record
 *   with an empty title.
 */
const getCatalogEntryByRef = async (ref) => {
  const parsed = parseCatalogRef(ref);
  if (!parsed) return null;

  const row = await get(QUERIES[parsed.kind], [parsed.id]);
  if (!row) return null;

  // The ref's own id wins over anything the joins produced for that provider:
  // it is the entry the user was actually looking at.
  const ids = {
    atlasId: toId(row.atlasId),
    f95Id: toId(row.f95Id),
    lcId: toId(row.lcId),
    steamId: toId(row.steamId),
    gogId: toId(row.gogId),
  };
  const ownField = { atlas: "atlasId", steam: "steamId", gog: "gogId", lewdcorner: "lcId" };
  ids[ownField[parsed.kind]] = parsed.id;

  return {
    ref: parsed.ref,
    kind: parsed.kind,
    ...ids,
    title: toText(row.title),
    creator: toText(row.creator),
    engine: toText(row.engine),
    description: toText(row.description),
    latestVersion: toText(row.latestVersion),
  };
};

module.exports = { getCatalogEntryByRef, QUERIES };
