"use strict";

// ── Synthetic catalog identity ───────────────────────────────────────────────
//
// The display name for a catalog row that has no atlas parent to take one from.
//
// ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
//
// The browse union in db/versions.js has FOUR branches: one canonical atlas
// branch, and three orphan branches (steam, gog, lewdcorner) that all end with
// the same clause --
//
//   LEFT JOIN atlas_data ON <table>.atlas_id = atlas_data.atlas_id
//   WHERE (<table>.atlas_id IS NULL OR atlas_data.atlas_id IS NULL)
//
// -- so anything WITH an atlas parent is shown once by the atlas branch and the
// side branches only pick up what it would miss. That is de-duplication, not a
// per-provider feature.
//
// `steam_data` and `gog_data` carry their own `title` and `developer`, because a
// store API returns those as separate structured fields, so their orphan
// branches read straight from them. `f95_zone_data` and `lewdcorner_data` carry
// NEITHER, because a forum thread's identity is a single string --
// "Game Name [v1.2] [Dev Name]" -- and splitting that into title, creator and
// version is a parsing job the server does, with the RESULT being the atlas_data
// row. The satellite tables keep only what is genuinely per-site: views, likes,
// tags, rating, thread dates, mirrors.
//
// So an orphaned LewdCorner row has no name available anywhere, and this is what
// it gets shown as instead.
//
// ── WHY IT IS NOT A DEFICIENCY TO GO AND FIX ────────────────────────────────
//
// This has been raised twice as "LewdCorner games have no titles, add the
// columns". Reading the SQL alone makes that inference very easy and nothing
// nearby contradicted it, which is why the explanation now lives here rather
// than in a doc beside the code.
//
// Adding `title`/`creator` to `lewdcorner_data` would not help:
//
//   1. `f95_zone_data` does not have them either, so it would make LewdCorner
//      the inconsistent one rather than the consistent one. The tables that DO
//      have them are steam/gog, for the reason above.
//   2. `updateTableColumns` in db/atlas.js is a whitelist of what the scraper
//      actually emits, and neither site table lists a title. Columns added
//      locally stay NULL forever, which is worse than absent -- the next reader
//      treats them as a source and finds nothing.
//   3. On a healthy database the orphan branches match NOTHING, so no tile ever
//      renders one of these names. Measured Aug 2026: 9,818 lewdcorner_data
//      rows, 0 with a null atlas_id, 0 with a dangling one. The audit in
//      db/audit.js reports these counts so the claim is checkable rather than
//      remembered -- if it is ever non-zero, that is an INGEST problem to fix
//      at the source, and this fallback is what makes it visible instead of
//      crashing on a null title.
//
// In other words this is a guard, not a display path. Before treating a
// `LewdCorner #<id>` tile as a naming bug, run the audit: if the orphan count is
// non-zero the bug is that the atlas row is missing, and inventing a name for it
// locally would conceal exactly that.
//
// ── WHY IT IS A MODULE AND NOT A LITERAL ────────────────────────────────────
//
// It was written out four times: twice in db/versions.js (title and short_name),
// once in db/catalogIndex.js as a JS template string, and once in
// db/catalogEntry.js. The browse INDEX and the browse QUERY must produce
// byte-identical names or search stops matching rows the grid displays -- the
// index is what gets searched and the query is what gets shown. Two literals
// that must agree, with nothing checking that they do, is the same
// one-rule-in-two-places shape that produced the last several silent failures in
// this codebase, so both forms are generated from here and
// scripts/check-catalog-identity.js runs the SQL through sqlite and asserts it
// matches the JS.

/** Creator shown when no atlas row supplies one. */
const FALLBACK_CREATOR = "Unknown";

/** Title shown when no atlas row supplies one. */
const FALLBACK_TITLE = "Untitled";

/**
 * Providers whose browse branch can render a synthetic identity, and the label
 * their placeholder title uses. Steam and GOG are absent deliberately: their
 * tables carry a real title, so their orphan branches never need one.
 */
const SYNTHETIC_IDENTITY_PROVIDERS = Object.freeze({
  lewdcorner: { label: "LewdCorner", table: "lewdcorner_data", idColumn: "lc_id" },
});

/**
 * The display title for an orphaned row, in JS.
 * Used by db/catalogIndex.js when it builds the searchable browse index.
 */
function syntheticTitle(provider, id) {
  const config = SYNTHETIC_IDENTITY_PROVIDERS[String(provider || "").toLowerCase()];
  if (!config) return FALLBACK_TITLE;
  const clean = Number(id);
  if (!Number.isInteger(clean) || clean <= 0) return FALLBACK_TITLE;
  return `${config.label} #${clean}`;
}

/**
 * The same title as a SQL expression, for the browse union and the single-entry
 * hydrator. `idExpression` is the qualified column, e.g. "lewdcorner_data.lc_id"
 * or "lc.lc_id", because the callers use different table aliases.
 *
 * String concatenation into SQL is safe here and only here: the provider is
 * looked up against a frozen map and rejected otherwise, and idExpression is a
 * column name written by the caller, never user input.
 */
function syntheticTitleSql(provider, idExpression) {
  const key = String(provider || "").toLowerCase();
  const config = SYNTHETIC_IDENTITY_PROVIDERS[key];
  if (!config) throw new Error(`No synthetic identity is defined for provider: ${provider}`);
  const column = String(idExpression || "").trim();
  // A qualified or bare column name. Anything else is a caller mistake, and
  // failing loudly beats building a query around it.
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) {
    throw new Error(`Not a column reference: ${idExpression}`);
  }
  return `'${config.label} #' || ${column}`;
}

/** The fallback creator as a SQL literal, so callers do not re-quote it. */
function fallbackCreatorSql() {
  return `'${FALLBACK_CREATOR}'`;
}

module.exports = {
  FALLBACK_CREATOR,
  FALLBACK_TITLE,
  SYNTHETIC_IDENTITY_PROVIDERS,
  syntheticTitle,
  syntheticTitleSql,
  fallbackCreatorSql,
};
