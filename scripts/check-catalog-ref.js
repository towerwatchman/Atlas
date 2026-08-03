"use strict";

// Assertions for electron/library/catalogRef.js.
//
// The rule under test is narrow but it decides which CATALOG TABLE a promoted
// download is hydrated from, so getting the kind wrong would attach a download
// to a different game entirely. `catalog:480` (atlas 480) and
// `catalog:steam:480` (Steam appid 480) are unrelated games.
//
// Run: node scripts/check-catalog-ref.js

const assert = require("assert");
const {
  parseCatalogRef,
  formatCatalogRef,
  toCatalogRef,
  isCatalogRef,
  describeCatalogRef,
} = require("../electron/library/catalogRef");

let passed = 0;
const check = (label, fn) => {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${label}\n  ${err.message}`);
    process.exitCode = 1;
  }
};

// ── The four shapes db/versions.js actually produces ────────────────────────

check("atlas ref has no kind segment", () => {
  assert.deepStrictEqual(parseCatalogRef("catalog:30956"), {
    kind: "atlas",
    id: 30956,
    idColumn: "atlas_id",
    ref: "catalog:30956",
  });
});

check("steam ref", () => {
  const parsed = parseCatalogRef("catalog:steam:480");
  assert.strictEqual(parsed.kind, "steam");
  assert.strictEqual(parsed.id, 480);
  assert.strictEqual(parsed.idColumn, "steam_id");
});

check("gog ref", () => {
  const parsed = parseCatalogRef("catalog:gog:1207658691");
  assert.strictEqual(parsed.kind, "gog");
  assert.strictEqual(parsed.id, 1207658691);
  assert.strictEqual(parsed.idColumn, "gog_id");
});

check("lewdcorner ref", () => {
  const parsed = parseCatalogRef("catalog:lewdcorner:12345");
  assert.strictEqual(parsed.kind, "lewdcorner");
  assert.strictEqual(parsed.id, 12345);
  assert.strictEqual(parsed.idColumn, "lc_id");
});

// The whole point of the module: an atlas id and a Steam appid can be the same
// number and mean different games.
check("same number, different kind, different ref", () => {
  assert.notStrictEqual(toCatalogRef("catalog:480"), toCatalogRef("catalog:steam:480"));
  assert.strictEqual(parseCatalogRef("catalog:480").idColumn, "atlas_id");
  assert.strictEqual(parseCatalogRef("catalog:steam:480").idColumn, "steam_id");
});

// ── Not refs ────────────────────────────────────────────────────────────────

check("a real record id is not a ref", () => {
  // This is why sending both recordId and catalogRef for every download is safe:
  // a library game's record_id round-trips to null here, so it is never stored
  // as a ref and never triggers promotion.
  assert.strictEqual(toCatalogRef("412"), null);
  assert.strictEqual(toCatalogRef(412), null);
  assert.strictEqual(isCatalogRef(412), false);
});

check("empty and missing values", () => {
  for (const value of [null, undefined, "", "   ", {}, [], NaN]) {
    assert.strictEqual(toCatalogRef(value), null, `expected null for ${JSON.stringify(value)}`);
  }
});

check("malformed refs", () => {
  for (const value of [
    "catalog:",
    "catalog",
    "catalog:abc",
    "catalog:steam:",
    "catalog:steam:abc",
    "catalog:steam:480:extra",
    "notcatalog:30956",
    "catalog:30956x",
  ]) {
    assert.strictEqual(toCatalogRef(value), null, `expected null for "${value}"`);
  }
});

check("an unknown kind is refused, not guessed", () => {
  // `catalog:itch:99` must NOT fall back to the atlas branch. Guessing would
  // hydrate id 99 out of atlas_data and promote the download onto whatever game
  // that happens to be.
  assert.strictEqual(parseCatalogRef("catalog:itch:99"), null);
  assert.strictEqual(parseCatalogRef("catalog:f95:99"), null);
});

check("zero and negative ids are not ids", () => {
  assert.strictEqual(toCatalogRef("catalog:0"), null);
  assert.strictEqual(toCatalogRef("catalog:steam:0"), null);
  assert.strictEqual(toCatalogRef("catalog:-5"), null);
  assert.strictEqual(toCatalogRef("catalog:steam:-5"), null);
});

// ── Normalisation ───────────────────────────────────────────────────────────

check("casing and surrounding whitespace normalise", () => {
  assert.strictEqual(toCatalogRef("  CATALOG:30956  "), "catalog:30956");
  assert.strictEqual(toCatalogRef("Catalog:Steam:480"), "catalog:steam:480");
  assert.strictEqual(toCatalogRef("catalog: steam : 480 "), "catalog:steam:480");
});

check("a stored ref round-trips unchanged", () => {
  for (const ref of [
    "catalog:30956",
    "catalog:steam:480",
    "catalog:gog:1207658691",
    "catalog:lewdcorner:12345",
  ]) {
    assert.strictEqual(toCatalogRef(ref), ref);
    assert.strictEqual(toCatalogRef(toCatalogRef(ref)), ref);
  }
});

check("formatCatalogRef mirrors parseCatalogRef", () => {
  assert.strictEqual(formatCatalogRef({ kind: "atlas", id: 30956 }), "catalog:30956");
  assert.strictEqual(formatCatalogRef({ id: 30956 }), "catalog:30956");
  assert.strictEqual(formatCatalogRef({ kind: "steam", id: 480 }), "catalog:steam:480");
  assert.strictEqual(formatCatalogRef({ kind: "itch", id: 1 }), null);
  assert.strictEqual(formatCatalogRef({ kind: "atlas", id: 0 }), null);
  assert.strictEqual(formatCatalogRef({}), null);
});

check("describeCatalogRef is for humans and blank for non-refs", () => {
  assert.strictEqual(describeCatalogRef("catalog:30956"), "Atlas #30956");
  assert.strictEqual(describeCatalogRef("catalog:steam:480"), "Steam #480");
  assert.strictEqual(describeCatalogRef("catalog:gog:12"), "GOG #12");
  assert.strictEqual(describeCatalogRef("catalog:lewdcorner:12"), "LewdCorner #12");
  assert.strictEqual(describeCatalogRef("412"), "");
});

if (process.exitCode) {
  console.error(`\ncheck-catalog-ref: ${passed} assertions passed, failures above.`);
} else {
  console.log(`check-catalog-ref: ${passed} assertions passed.`);
}
