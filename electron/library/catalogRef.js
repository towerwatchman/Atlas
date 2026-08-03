"use strict";

// ── Catalog refs ─────────────────────────────────────────────────────────────
//
// Parsing the synthetic record ids the browse queries build, so a download
// started from Browse can still say WHICH catalog entry it came from after the
// id itself has been rejected as a library record.
//
// db/versions.js synthesises four shapes (see the branch definitions around
// lines 1625 / 1734 / 1851 / 1943):
//
//   catalog:30956              atlas branch      -> atlas_data.atlas_id
//   catalog:steam:480          steam branch      -> steam_data.steam_id
//   catalog:gog:1207658691     gog branch        -> gog_data.gog_id
//   catalog:lewdcorner:12345   lewdcorner branch -> lewdcorner_data.lc_id
//
// downloads/recordId.js already refuses these as library records — correctly,
// they are not — but refusing them is where the identity USED to be thrown
// away, which is why a Browse download could not be promoted afterwards. This
// module is the other half of that rule: recordId.js says "not a record",
// this says "…but here is what it is instead".
//
// Deliberately NOT a new identity format. The renderer's wishlistIdentity.js
// and db/wishlist.js already carry one duplicated vocabulary between them
// (`f95:123`, `atlas:456`), and inventing a third to describe the same games
// would be a fourth place for one rule to live. The `catalog:` strings already
// exist and are already produced in exactly one place, so they are what gets
// stored.
//
// An unrecognised kind resolves to null rather than being guessed at. A bare
// `catalog:x` cannot be assumed to be an atlas id: the atlas shape is the one
// with no kind segment at all, so anything with an unknown segment is a shape
// this build does not understand, and hydrating it against the wrong table
// would attach a download to the wrong game.

/** Kind segment -> the catalog table's own primary key name. Atlas has no segment. */
const REF_KINDS = Object.freeze({
  atlas: "atlas_id",
  steam: "steam_id",
  gog: "gog_id",
  lewdcorner: "lc_id",
});

const toPositiveInteger = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number.parseInt(text, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
};

/**
 * Parse a synthetic browse record id.
 *
 * @returns {{kind: string, id: number, idColumn: string, ref: string}|null}
 */
function parseCatalogRef(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const parts = text.split(":");
  // `catalog` plus either a bare id, or a kind and an id. Anything else is a
  // shape this build did not produce.
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts[0].trim().toLowerCase() !== "catalog") return null;

  const kind = parts.length === 3 ? parts[1].trim().toLowerCase() : "atlas";
  const idColumn = REF_KINDS[kind];
  if (!idColumn) return null;

  const id = toPositiveInteger(parts[parts.length - 1]);
  if (id === null) return null;

  return { kind, id, idColumn, ref: formatCatalogRef({ kind, id }) };
}

/**
 * Build the canonical string for a kind and id. Round-tripping through this
 * rather than storing the caller's text means a ref read back out of the
 * downloads table is always in the one form the queries expect, whatever
 * casing or spacing arrived from the renderer.
 */
function formatCatalogRef({ kind = "atlas", id } = {}) {
  const cleanKind = String(kind || "atlas").trim().toLowerCase();
  const cleanId = toPositiveInteger(id);
  if (!REF_KINDS[cleanKind] || cleanId === null) return null;
  return cleanKind === "atlas" ? `catalog:${cleanId}` : `catalog:${cleanKind}:${cleanId}`;
}

/**
 * A storable ref, or null when the value is not one.
 *
 * Used at the enqueue boundary for the same reason toLocalRecordId is: the
 * renderer sends whatever the row happened to carry, and normalising once here
 * means nothing downstream repeats the rule. A real record id (`412`) is not a
 * ref and resolves to null, so passing both fields for every download is safe.
 */
function toCatalogRef(value) {
  return parseCatalogRef(value)?.ref ?? null;
}

/** True when the value is a ref this build understands. */
function isCatalogRef(value) {
  return parseCatalogRef(value) !== null;
}

/** Human-readable, for log lines and the one user-facing "cannot find" message. */
function describeCatalogRef(value) {
  const parsed = parseCatalogRef(value);
  if (!parsed) return "";
  const labels = {
    atlas: "Atlas",
    steam: "Steam",
    gog: "GOG",
    lewdcorner: "LewdCorner",
  };
  return `${labels[parsed.kind]} #${parsed.id}`;
}

module.exports = {
  REF_KINDS,
  parseCatalogRef,
  formatCatalogRef,
  toCatalogRef,
  isCatalogRef,
  describeCatalogRef,
};
