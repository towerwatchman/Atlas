"use strict";

// Guards the importer's source-id plumbing against drift.
//
// An importer source id has to be recognised in three places: the external
// library reader registry (where a provider is defined), the main process (which
// validates the id before opening the window), and the renderer (which routes it
// to a view and supplies the label). Historically all three were hand-written
// lists, and main.js carried the comment "Keep in sync with importerSources.js
// in the renderer".
//
// It drifted the first time a provider was added, and the failure mode is the
// worst kind: an unrecognised id does not error, it falls back to 'atlas'. So
// clicking "Import library" on the new provider opened the ordinary folder
// importer, which reads as a broken button rather than as a rejected id. Nothing
// logged, nothing threw, and both lists looked correct in isolation.
//
// This asserts the three stay reconciled. It reads main.js and the renderer's
// importerSources.js as TEXT rather than importing them: main.js boots Electron
// at require time, and the renderer module is ESM importing an SVG. Textual
// checks are weaker than executing the real functions, but they run anywhere and
// they catch the one thing that actually went wrong — an id defined in one place
// and absent from another.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { listProviders } = require("../electron/scanners/externalLibrary");

let assertions = 0;
const check = (fn) => {
  assertions += 1;
  fn();
};
const ok = (value, message) => check(() => assert.ok(value, message));
const deep = (actual, expected, message) =>
  check(() => assert.deepStrictEqual(actual, expected, message));

const read = (relative) =>
  fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

const mainSource = read("electron/main.js");
const rendererSource = read("src/components/importer/importerSources.js");

const providerIds = listProviders().map((provider) => provider.id);
ok(providerIds.length > 0, "the registry defines at least one provider");
ok(providerIds.includes("f95checker"), "F95Checker is registered");
ok(providerIds.includes("xlibrary"), "XLibrary is registered");

// ── Main process ────────────────────────────────────────────────────────────
//
// It must derive external-library ids from the registry rather than list them.
// A literal provider id in main.js is the exact shape of the original bug.
ok(
  /listProviders:\s*listExternalLibraryProviders/.test(mainSource)
  || /listExternalLibraryProviders/.test(mainSource),
  "main.js pulls the provider list from the reader registry",
);
ok(
  /listExternalLibraryProviders\(\)\.map/.test(mainSource),
  "and folds it into the accepted-source list",
);
for (const id of providerIds) {
  ok(
    !new RegExp(`['"\`]${id}['"\`]`).test(mainSource),
    `main.js must not hardcode the provider id '${id}' — derive it instead`,
  );
}
// The built-in sources are legitimately literal: they are views the importer
// window implements, not registry entries.
ok(
  /BUILT_IN_IMPORTER_SOURCES\s*=\s*\[/.test(mainSource),
  "built-in sources are named as such rather than mixed in with providers",
);
for (const builtIn of ["atlas", "steam", "gog", "renpy", "manual"]) {
  ok(
    new RegExp(`['"]${builtIn}['"]`).test(mainSource),
    `built-in source '${builtIn}' is still accepted`,
  );
}

// ── Renderer ────────────────────────────────────────────────────────────────
//
// Every registry provider needs an entry here, because this is what supplies the
// label and what normalizeImporterSource validates against. A provider missing
// from this list is rejected in the importer window even when the main process
// accepted it.
for (const id of providerIds) {
  ok(
    new RegExp(`['"]${id}['"]`).test(rendererSource),
    `importerSources.js has an entry for provider '${id}'`,
  );
}

// Each must be flagged as an external library, or Importer.jsx will not route it
// to the external-library step — it would fall through to the folder scanner.
const externalLibraryBlocks = rendererSource
  .split(/\n\s*\{\s*\n/)
  .filter((block) => /externalLibrary:\s*true/.test(block));
const flaggedIds = externalLibraryBlocks
  .map((block) => {
    const match = block.match(/IMPORTER_SOURCE_IDS\.([A-Z0-9_]+)/);
    return match ? match[1].toLowerCase() : "";
  })
  .filter(Boolean);
deep(
  flaggedIds.slice().sort(),
  providerIds.slice().sort(),
  "every registry provider is flagged externalLibrary: true, and nothing else is",
);

// External library imports are reached from Settings -> Import, never from the +
// dropdown; the dropdown is meant to stay a short list of ways to add one game.
for (const block of externalLibraryBlocks) {
  ok(/menu:\s*false/.test(block), "external library sources stay out of the + menu");
}

// The derived export Importer.jsx routes on must exist and be derived, not
// re-listed.
ok(
  /export const EXTERNAL_LIBRARY_SOURCE_IDS = importerSources/.test(rendererSource),
  "EXTERNAL_LIBRARY_SOURCE_IDS is derived from the source list",
);
ok(
  /item\.externalLibrary === true/.test(rendererSource),
  "and derived via the externalLibrary flag rather than a second literal list",
);

// ── Renderer routing ────────────────────────────────────────────────────────
const importerSource = read("src/components/importer/Importer.jsx");
ok(
  /EXTERNAL_LIBRARY_SOURCE_IDS\.includes\(safeSource\)/.test(importerSource),
  "Importer.jsx routes every external-library id, not one named provider",
);
for (const id of providerIds) {
  ok(
    !new RegExp(`safeSource === ['"]${id}['"]`).test(importerSource),
    `Importer.jsx must not special-case '${id}'`,
  );
}

console.log(`Importer source id checks passed (${assertions} assertions)`);
