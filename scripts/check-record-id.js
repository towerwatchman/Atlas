"use strict";

// Guards the one distinction that made a Browse download fail with a message
// about a re-imported library: a catalog placeholder id is TRUTHY, so
// `if (!recordId)` treats `catalog:30956` as a real library record.

const assert = require("assert");
const { isLocalRecordId, toLocalRecordId, isCatalogRecordId } =
  require("../electron/downloads/recordId");

let n = 0;
const eq = (a, b, m) => { n += 1; assert.strictEqual(a, b, m); };

// ── The regression ──────────────────────────────────────────────────────────
// Every shape db/versions.js synthesises for a catalog row.
for (const id of [
  "catalog:30956", "catalog:steam:480", "catalog:gog:1207658691",
  "catalog:lewdcorner:4242",
]) {
  eq(isLocalRecordId(id), false, `${id} is not a library record`);
  eq(toLocalRecordId(id), null, `${id} normalises to null`);
  eq(isCatalogRecordId(id), true, `${id} is recognisably a catalog id`);
  // The property that caused the bug: it is truthy, so a truthiness check passes.
  eq(Boolean(id), true, `${id} is truthy — which is why !recordId was wrong`);
}

// ── Real record ids ─────────────────────────────────────────────────────────
eq(isLocalRecordId(412), true);
eq(isLocalRecordId("412"), true, "ids arrive from IPC as strings");
eq(isLocalRecordId(" 412 "), true);
eq(toLocalRecordId("412"), 412, "normalised to a number");
eq(toLocalRecordId(412), 412);
eq(isCatalogRecordId(412), false);

// ── Everything that is not an id ────────────────────────────────────────────
for (const value of [null, undefined, "", "   ", 0, "0", -1, "-1", "abc", "1.5", NaN, {}, []]) {
  eq(isLocalRecordId(value), false, `${JSON.stringify(value)} is not a record id`);
  eq(toLocalRecordId(value), null, `${JSON.stringify(value)} normalises to null`);
}

console.log(`Record id checks passed (${n} assertions)`);
