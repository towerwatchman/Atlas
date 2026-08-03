"use strict";

// ── Catalog -> library record ────────────────────────────────────────────────
//
// One implementation of "which library record does this catalog entry belong
// to, and create it if none does". Both callers use this: the drag-and-drop
// importer (`import-catalog-entry`) and the download installer
// (`downloads-install`) promoting a Browse download.
//
// It is extracted rather than copied because a second record-creation path
// would have been the fourth instance of one-rule-in-two-places in this area,
// and the previous three all failed silently:
//
//   - main.js duplicated the renderer's importer source ids
//   - getScanGameKey derived identity from fields that resolution rewrites
//   - `is_installed` vs `isInstalled` targeted the wrong directory to delete
//
// Everything here takes its database access through `deps` so the resolution
// order can be asserted without sqlite. That is the whole reason the order is
// testable at all: it used to be a single UNION whose row selection was
// effectively arbitrary (see RESOLUTION ORDER below).
//
// ── RESOLUTION ORDER ────────────────────────────────────────────────────────
//
// atlas mapping -> f95 mapping -> lewdcorner mapping -> steam mapping ->
// gog mapping -> provider lookups -> title+creator.
//
// This deliberately matches the COALESCE order in the browse query's
// `local_record_id` (db/versions.js ~1627). It has to: `local_record_id` is
// what the Browse tile shows as "in your library", so resolving to a DIFFERENT
// record than the tile points at would mean the UI and the importer disagree
// about which game this is.
//
// The previous implementation was one UNION of five SELECTs with a trailing
// LIMIT 1. In SQLite a compound SELECT's LIMIT applies to the whole compound
// and UNION deduplicates, so the row that came back was whichever the query
// planner produced — usually the lowest record_id, never a defined priority.
// Where the mappings all agree (the overwhelmingly normal case) both give the
// same answer; where they disagree this one is defined and matches the UI.
//
// ── ON `allowTitleMatch` ────────────────────────────────────────────────────
//
// The last resort is a title+creator match, which is a HEURISTIC, not a link.
// It is the same heuristic that produced duplicate titles before (see the
// comment at importer.js ~3664). The drag-and-drop importer keeps it: the user
// pointed at a folder and said "this is that game", so adopting a same-named
// record is what they meant.
//
// The download installer passes `allowTitleMatch: false`. It is not refusing to
// use the result — `games` has UNIQUE (title, creator, engine) and addGame()
// returns the existing record_id on a title+creator hit, so a genuinely
// separate row for the same title is not possible to create and pretending
// otherwise would just move the surprise later. What it does instead is REPORT
// it: `via` comes back as "title", the caller logs it and tells the user which
// record the download landed on, rather than silently merging a download into
// a record that was matched by name alone.

/** Every mapping table that can link a catalog id to a local record. */
const MAPPING_SOURCES = Object.freeze([
  { via: "atlas-mapping", table: "atlas_mappings", column: "atlas_id", field: "atlasId" },
  { via: "f95-mapping", table: "f95_zone_mappings", column: "f95_id", field: "f95Id" },
  { via: "lewdcorner-mapping", table: "lewdcorner_mappings", column: "lc_id", field: "lcId" },
  { via: "steam-mapping", table: "steam_mappings", column: "steam_id", field: "steamId" },
  { via: "gog-mapping", table: "gog_mappings", column: "gog_id", field: "gogId" },
]);

const toPositiveInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const cleanText = (value) => String(value ?? "").trim();

/**
 * The identity fields this module reads, normalised. Accepts either a hydrated
 * catalog entry (db/catalogEntry.js) or the raw `catalog` payload the importer
 * receives from the renderer, which use different key casings for the same ids.
 */
function normalizeCatalogIdentity(entry = {}) {
  return {
    atlasId: toPositiveInteger(entry.atlasId ?? entry.atlas_id),
    f95Id: toPositiveInteger(entry.f95Id ?? entry.f95_id),
    lcId: toPositiveInteger(entry.lcId ?? entry.lc_id ?? entry.lewdCornerId),
    steamId: toPositiveInteger(entry.steamId ?? entry.steam_id ?? entry.steam_appid),
    gogId: toPositiveInteger(entry.gogId ?? entry.gog_id ?? entry.gog_appid),
    // The "Unknown"/"Untitled" fallbacks are applied HERE and not on scan rows,
    // which is the existing rule: the table shows blanks, the database never
    // stores them.
    title: cleanText(entry.title ?? entry.name ?? entry.short_name) || "Untitled",
    creator: cleanText(entry.creator ?? entry.developer ?? entry.steam_developer) || "Unknown",
    engine: cleanText(entry.engine) || "Unknown",
    description: cleanText(entry.description ?? entry.overview),
  };
}

/**
 * Find the library record for a catalog entry without creating anything.
 *
 * @param {object} deps          { dbGet, findRecordByLewdCornerId, findRecordBySteamId, findRecordByGogId }
 * @param {object} entry         catalog entry or raw catalog payload
 * @param {object} [options]     { allowTitleMatch }
 * @returns {Promise<{recordId: number|null, via: string|null}>}
 */
async function resolveCatalogRecord(deps, entry, { allowTitleMatch = true } = {}) {
  const identity = normalizeCatalogIdentity(entry);
  const { dbGet } = deps;

  // MIN(record_id) per table, matching the browse query. Where two records
  // somehow carry the same mapping, both this and the Browse tile settle on
  // the same one instead of disagreeing.
  for (const source of MAPPING_SOURCES) {
    const id = identity[source.field];
    if (id === null) continue;
    const row = await dbGet(
      `SELECT MIN(record_id) AS record_id FROM ${source.table} WHERE ${source.column} = ?`,
      [id],
    );
    const recordId = toPositiveInteger(row?.record_id);
    if (recordId !== null) return { recordId, via: source.via };
  }

  // Provider lookups go beyond their mapping table — findRecordBySteamId also
  // matches a record listing the appid in external_ids, or one already mapped
  // to that appid's atlas_id. Still a link rather than a guess, so it ranks
  // above the title fallback.
  const lookups = [
    { via: "lewdcorner-lookup", id: identity.lcId, fn: deps.findRecordByLewdCornerId },
    { via: "steam-lookup", id: identity.steamId, fn: deps.findRecordBySteamId },
    { via: "gog-lookup", id: identity.gogId, fn: deps.findRecordByGogId },
  ];
  for (const lookup of lookups) {
    if (lookup.id === null || typeof lookup.fn !== "function") continue;
    const recordId = toPositiveInteger(await lookup.fn(lookup.id));
    if (recordId !== null) return { recordId, via: lookup.via };
  }

  if (!allowTitleMatch) return { recordId: null, via: null };

  const titleRow = await dbGet(
    `SELECT record_id FROM games WHERE title = ? AND creator = ? LIMIT 1`,
    [identity.title, identity.creator],
  );
  const titleRecordId = toPositiveInteger(titleRow?.record_id);
  return titleRecordId !== null
    ? { recordId: titleRecordId, via: "title" }
    : { recordId: null, via: null };
}

/**
 * Resolve, or create the record and write its mappings.
 *
 * @returns {Promise<{recordId: number, created: boolean, via: string,
 *                    titleCollision: boolean, mappings: object}>}
 *
 * `created` is honest about addGame(): that function returns the existing
 * record_id when title+creator already match, so a "create" can silently land
 * on an existing record. The title probe below runs FIRST so the caller is told
 * `via: "title"` and `titleCollision: true` instead of being handed a record it
 * believes it just made. That distinction is the difference between a download
 * appearing under an unexpected game silently and appearing there with a line
 * in the log saying why.
 */
async function ensureCatalogRecord(deps, entry, { allowTitleMatch = true } = {}) {
  const identity = normalizeCatalogIdentity(entry);
  const resolved = await resolveCatalogRecord(deps, entry, { allowTitleMatch });

  let recordId = resolved.recordId;
  let via = resolved.via;
  let created = false;
  let titleCollision = false;

  if (recordId === null) {
    // Not linked by anything. Check for the UNIQUE (title, creator, engine)
    // collision explicitly so it is reported rather than absorbed by addGame.
    const clash = await deps.dbGet(
      `SELECT record_id FROM games WHERE title = ? AND creator = ? LIMIT 1`,
      [identity.title, identity.creator],
    );
    const clashId = toPositiveInteger(clash?.record_id);
    if (clashId !== null) {
      recordId = clashId;
      via = "title";
      titleCollision = true;
    } else {
      recordId = toPositiveInteger(
        await deps.addGame({
          title: identity.title,
          creator: identity.creator,
          engine: identity.engine,
          description: identity.description,
        }),
      );
      if (recordId === null) throw new Error("Could not create a library record for this game");
      created = true;
      via = "created";
      // addGame does not write the description; the importer has always
      // followed it with updateGame to land that. Same call, same order.
      if (identity.description && typeof deps.updateGame === "function") {
        await deps.updateGame({
          record_id: recordId,
          title: identity.title,
          creator: identity.creator,
          engine: identity.engine,
          description: identity.description,
        });
      }
    }
  }

  // Written unconditionally, including for a record that already existed —
  // that is the existing importer behaviour and it is what backfills a mapping
  // the record was missing (a title-matched record has no atlas mapping until
  // something adds one, and without it no banner or metadata hydrates).
  const mappings = { atlasId: null, f95Id: null, lcId: null, steamId: null, gogId: null };
  if (identity.atlasId && typeof deps.addAtlasMapping === "function") {
    await deps.addAtlasMapping(recordId, identity.atlasId);
    mappings.atlasId = identity.atlasId;
  }
  if (identity.lcId && typeof deps.addLewdCornerMapping === "function") {
    await deps.addLewdCornerMapping(recordId, identity.lcId);
    mappings.lcId = identity.lcId;
  }
  if (identity.f95Id && typeof deps.dbRun === "function") {
    // No dedicated helper for this one, and f95_zone_mappings has no unique
    // constraint, so OR IGNORE is doing nothing here — the guard is the SELECT.
    // Kept as the importer wrote it.
    await deps.dbRun(
      `INSERT INTO f95_zone_mappings (record_id, f95_id)
       SELECT ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM f95_zone_mappings WHERE record_id = ? AND f95_id = ?
       )`,
      [recordId, identity.f95Id, recordId, identity.f95Id],
    );
    mappings.f95Id = identity.f95Id;
  }
  if (identity.steamId && typeof deps.addSteamMapping === "function") {
    await deps.addSteamMapping(recordId, identity.steamId);
    mappings.steamId = identity.steamId;
  }
  if (identity.gogId && typeof deps.addGogMapping === "function") {
    await deps.addGogMapping(recordId, identity.gogId);
    mappings.gogId = identity.gogId;
  }

  return { recordId, created, via, titleCollision, identity, mappings };
}

module.exports = {
  MAPPING_SOURCES,
  normalizeCatalogIdentity,
  resolveCatalogRecord,
  ensureCatalogRecord,
};
