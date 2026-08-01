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
//   read(path)   Parse -> { rows, summary, tabs, journalPresent }.
//   fileFilters  Filters for the manual file picker fallback.
//   dataDirs()   Candidate directories, shown in the UI when detection fails so
//                the user knows where we looked.

const f95checker = require("./f95checker");

const providers = [
  {
    id: "f95checker",
    label: "F95Checker",
    databaseName: f95checker.DB_FILENAME,
    dataDirs: f95checker.getCandidateDataDirs,
    locate: f95checker.locateDatabase,
    read: f95checker.readF95CheckerLibrary,
    fileFilters: [
      { name: "F95Checker database", extensions: ["sqlite3", "sqlite", "db"] },
      { name: "All files", extensions: ["*"] },
    ],
  },
];

const getProvider = (id) => {
  const key = String(id || "").trim().toLowerCase();
  return providers.find((provider) => provider.id === key) || null;
};

const listProviders = () =>
  providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    databaseName: provider.databaseName,
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
      error: `No ${provider.label} database was found automatically.`,
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
