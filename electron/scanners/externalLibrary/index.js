"use strict";

// ── External library registry ────────────────────────────────────────────────
//
// One place that knows which third-party library managers Atlas can read, and
// how to find and parse each one. Everything above this layer (the IPC handler,
// the importer step, the Settings cards) is written against this registry rather
// than against any single tool, so adding another reader means adding an entry
// here and a parser module beside it — no changes to the IPC, UI or writer.
//
// A provider contributes:
//   id           Stable key, doubles as the importer source id.
//   label        Display name.
//   locate()     Best-effort auto-detection -> absolute file path or null.
//   read(path)   Parse -> { rows, summary, mapping, optionalMappings, tabs, ... }.
//   fileFilters  Filters for the manual file picker fallback.
//   dataDirs()   Candidate directories, shown in the UI when detection fails so
//                the user knows where we looked.
//   candidatePaths()
//                The exact FILE paths detection tests. Optional — defaults to
//                dataDirs() joined with databaseName. Providers whose file sits
//                below the data directory supply their own, because a directory
//                plus a bare filename can describe a path that was never tried.
//   sourceNoun   What to call the input in the UI ("database", "library file").
//                Calling a JSON file a "database" in the picker is the kind of
//                small wrongness that makes a user think they have the wrong file.

const path = require("path");

const f95checker = require("./f95checker");
const xlibrary = require("./xlibrary");

const providers = [
  {
    id: "f95checker",
    label: "F95Checker",
    databaseName: f95checker.DB_FILENAME,
    dataDirs: f95checker.getCandidateDataDirs,
    locate: f95checker.locateDatabase,
    read: f95checker.readF95CheckerLibrary,
    candidatePaths: f95checker.getCandidatePaths,
    pickerHint: f95checker.DB_FILENAME,
    fileFilters: [
      { name: "F95Checker database", extensions: ["sqlite3", "sqlite", "db"] },
      { name: "All files", extensions: ["*"] },
    ],
    sourceNoun: "database",
  },
  {
    id: "xlibrary",
    label: "XLibrary",
    // The live library file, which is what auto-detection finds. A dated export
    // (xlibrary-data-<date>.json) is also accepted through the picker, for a
    // library that lives on another machine.
    databaseName: xlibrary.LIVE_LIBRARY_FILENAME,
    dataDirs: xlibrary.getCandidateDataDirs,
    locate: xlibrary.locateDatabase,
    read: xlibrary.readXLibraryExport,
    candidatePaths: xlibrary.getCandidatePaths,
    // Two legitimate choices, so naming only the live file in the picker would
    // make a user with an export think they had the wrong thing.
    pickerHint: `${xlibrary.LIVE_LIBRARY_FILENAME} or ${xlibrary.EXPORT_FILENAME_HINT}`,
    fileFilters: [
      { name: "XLibrary library or export", extensions: ["json"] },
      { name: "All files", extensions: ["*"] },
    ],
    sourceNoun: "library file",
  },
];

// The exact paths a provider's detection tests. Falls back to joining the data
// directories with the filename for providers that keep the file directly there.
const searchedPathsFor = (provider) => {
  try {
    if (typeof provider.candidatePaths === "function") return provider.candidatePaths();
    return provider.dataDirs().map((dir) => path.join(dir, provider.databaseName));
  } catch (err) {
    console.warn(`Could not list candidate paths for ${provider.id}:`, err.message);
    return [];
  }
};

const getProvider = (id) => {
  const key = String(id || "").trim().toLowerCase();
  return providers.find((provider) => provider.id === key) || null;
};

const listProviders = () =>
  providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    databaseName: provider.databaseName,
    sourceNoun: provider.sourceNoun || "database",
    pickerHint: provider.pickerHint || provider.databaseName,
  }));

// Where a provider's data lives, and whether we can see it right now. Drives the
// Settings cards so a user can tell at a glance whether Atlas found their
// library before they open the importer.
const describeProvider = (id) => {
  const provider = getProvider(id);
  if (!provider) return { success: false, error: `Unknown external library: ${id}` };
  let detectedPath = null;
  try {
    detectedPath = provider.locate();
  } catch (err) {
    console.warn(`Detection failed for ${provider.id}:`, err.message);
  }
  return {
    success: true,
    id: provider.id,
    label: provider.label,
    databaseName: provider.databaseName,
    detectedPath,
    detected: Boolean(detectedPath),
    searchedDirs: provider.dataDirs(),
    searchedPaths: searchedPathsFor(provider),
    sourceNoun: provider.sourceNoun || "database",
    pickerHint: provider.pickerHint || provider.databaseName,
  };
};

const readProviderLibrary = async (id, explicitPath = "") => {
  const provider = getProvider(id);
  if (!provider) {
    return { success: false, error: `Unknown external library: ${id}` };
  }
  const target = String(explicitPath || "").trim() || provider.locate();
  if (!target) {
    return {
      success: false,
      needsPath: true,
      id: provider.id,
      label: provider.label,
      searchedDirs: provider.dataDirs(),
      searchedPaths: searchedPathsFor(provider),
      error: `No ${provider.label} ${provider.sourceNoun || "database"} was found automatically.`,
    };
  }
  try {
    const result = await provider.read(target);
    return { ...result, id: provider.id, label: provider.label };
  } catch (err) {
    return {
      success: false,
      id: provider.id,
      label: provider.label,
      path: target,
      error: err.message || String(err),
    };
  }
};

module.exports = {
  providers,
  getProvider,
  listProviders,
  describeProvider,
  readProviderLibrary,
};
