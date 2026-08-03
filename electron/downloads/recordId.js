"use strict";

// ── Local record ids ─────────────────────────────────────────────────────────
//
// Telling a real library record apart from a catalog placeholder.
//
// Browse rows are not library records. `db/versions.js` synthesises their
// `record_id` as a string so a catalog row can flow through the same UI as a
// local one: `catalog:30956`, `catalog:steam:480`, `catalog:gog:…`,
// `catalog:lewdcorner:…`. A real record id is the `games.record_id` integer.
//
// The distinction matters because `catalog:30956` is TRUTHY. Code that asks
// `if (!recordId)` to mean "this has no library record" passes a catalog id
// straight through, and it then fails further down against a games table that
// has never heard of it — reporting that the game "is no longer in your library"
// about a game that was never in it. That is exactly what happened when the
// mirror picker was opened from Browse: the download was queued carrying
// `catalog:30956`, and installing it failed at the record lookup with a message
// about a re-imported library.
//
// So the test is positive — a local id is a positive integer — rather than a
// truthiness check that a placeholder satisfies.

/** True only for a real games.record_id. */
function isLocalRecordId(value) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0;
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return false;
  return Number.parseInt(text, 10) > 0;
}

/**
 * A local record id as a number, or null when the value is a catalog placeholder
 * or anything else that is not one.
 *
 * Used at the boundary where renderer payloads arrive, so nothing downstream has
 * to repeat the rule — the reason it was got wrong in the first place.
 */
function toLocalRecordId(value) {
  return isLocalRecordId(value) ? Number.parseInt(String(value).trim(), 10) : null;
}

/** True for the synthetic ids the catalog queries build. */
function isCatalogRecordId(value) {
  return /^catalog:/i.test(String(value ?? "").trim());
}

module.exports = { isLocalRecordId, toLocalRecordId, isCatalogRecordId };
