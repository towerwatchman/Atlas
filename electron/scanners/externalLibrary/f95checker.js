"use strict";

// ── F95Checker library reader ────────────────────────────────────────────────
//
// Reads a F95Checker installation's own SQLite database and turns it into
// importer rows in the same shape f95scanner.js emits, so the existing scan
// review table, match resolution and import writer all work unchanged.
//
// Verified against F95Checker 11.1.3 (modules/db.py, common/structs.py).
// The pieces of their schema that matter here:
//
//   games.id          The F95Zone THREAD id — but only when positive. Custom
//                     (user-created, non-forum) entries get negative ids from
//                     utils.custom_id(), which returns min(min(ids), 0) - 1.
//                     A negative id must never reach f95_zone_mappings.f95_id;
//                     those rows fall through to fuzzy title/creator matching.
//   games.version     Latest version known from the thread.
//   games.installed   Version string the USER has on disk ("" = not installed).
//   games.finished    Version string the USER completed ("" = not finished).
//                     Deliberately allowed to differ from `installed` — that is
//                     their "finished an older build" state, which maps onto
//                     Atlas's per-version playstate.
//   games.executables JSON array of absolute paths to the installed game.
//   games.archived    User archived it ("hide and stop tracking").
//   games.rating      The user's own score, 0-5. Zero means unrated.
//   games.last_launched  Unix timestamp. NOTE: F95Checker stores no playtime
//                     anywhere, only this timestamp, so total_playtime and
//                     version_playtime have nothing to read from.
//   games.labels      JSON array of ids into their `labels` table (user tags).
//   games.tab         Id into their `tabs` table (user grouping).
//
// Everything else on the row (status, type, tags, description, changelog,
// score, votes, image_url, previews_urls) is forum metadata that Atlas already
// has from its own catalog, so none of it is imported — the catalog match wins.
//
// Reading safely: F95Checker sets no WAL pragma and its save_loop() only
// commits every 30 seconds, so a running instance can have both uncommitted
// changes and a live rollback journal. We copy the database AND its journal
// siblings to a temp file and open the copy read-only, which (a) never touches
// or locks the user's file and (b) lets SQLite recover the journal into a
// consistent snapshot instead of reading half-applied pages.

const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

const DB_FILENAME = "db.sqlite3";
// Copied alongside the database so SQLite can roll back / recover a snapshot
// taken while F95Checker had a transaction open.
const DB_SIDECAR_SUFFIXES = ["-journal", "-wal", "-shm"];

// Data locations, from F95Checker's modules/globals.py. Linux gets both the
// current path and the pre-11 one: they migrate ~/.f95checker into
// ~/.config/f95checker on launch, but an install that has not been opened since
// the migration still has the old directory.
const getCandidateDataDirs = () => {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "f95checker")];
  }
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "f95checker")];
  }
  return [
    path.join(home, ".config", "f95checker"),
    path.join(home, ".f95checker"),
  ];
};

// First existing db.sqlite3 across the candidate data dirs, or null.
const locateDatabase = () => {
  for (const dir of getCandidateDataDirs()) {
    const candidate = path.join(dir, DB_FILENAME);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not there — try the next candidate.
    }
  }
  return null;
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // F95Checker's own sql_to_py() falls back to treating an unparseable value
    // as a single-element list, so mirror that rather than dropping the data.
    return [raw];
  }
};

const toPositiveInt = (value) => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const cleanText = (value) => String(value ?? "").trim();

// Copy the database (plus any journal sidecars) somewhere we own, so the read
// can never lock or mutate the user's live file.
const snapshotDatabase = async (dbPath) => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "atlas-f95checker-"));
  const target = path.join(tempDir, DB_FILENAME);
  await fsp.copyFile(dbPath, target);
  let journalPresent = false;
  for (const suffix of DB_SIDECAR_SUFFIXES) {
    const sidecar = `${dbPath}${suffix}`;
    try {
      await fsp.copyFile(sidecar, `${target}${suffix}`);
      journalPresent = true;
    } catch {
      // Absent sidecars are the normal case.
    }
  }
  return { tempDir, target, journalPresent };
};

const openReadOnly = (filePath) =>
  new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) reject(err);
      else resolve(handle);
    });
  });

const allRows = (handle, sql) =>
  new Promise((resolve, reject) => {
    handle.all(sql, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

const closeQuietly = (handle) =>
  new Promise((resolve) => {
    if (!handle) {
      resolve();
      return;
    }
    handle.close(() => resolve());
  });

const removeQuietly = async (dir) => {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn("Failed to clean up F95Checker snapshot:", err.message);
  }
};

// Resolve the on-disk location for a row from its `executables` array. Their
// entries are absolute paths and can be either a file (the usual case) or a
// directory, and can point at something that no longer exists.
const resolveInstallPaths = (executables) => {
  for (const entry of executables) {
    const candidate = cleanText(entry);
    if (!candidate) continue;
    let stat = null;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      return { folder: candidate, execPath: "", singleExecutable: "", missing: false };
    }
    if (stat.isFile()) {
      return {
        folder: path.dirname(candidate),
        execPath: candidate,
        singleExecutable: path.basename(candidate),
        missing: false,
      };
    }
  }
  // Recorded but gone: keep the first path so the UI can say what it looked for.
  const firstRecorded = cleanText(executables[0] || "");
  return {
    folder: "",
    execPath: "",
    singleExecutable: "",
    missing: Boolean(firstRecorded),
    recordedPath: firstRecorded,
  };
};

// One F95Checker row -> one importer row. `externalState` carries the user data
// that only gets written after the record exists (see applyExternalLibraryState
// in ipc/importer.js); everything outside it is what the scan table and match
// resolver already understand.
const buildImportRow = (row, { labelsById, tabsById }) => {
  const rawId = Number.parseInt(row.id, 10);
  const isCustom = Number.isInteger(rawId) && rawId < 0;
  const f95Id = isCustom ? "" : String(toPositiveInt(rawId) || "");

  const executables = parseJsonArray(row.executables).map(cleanText).filter(Boolean);
  const install = resolveInstallPaths(executables);

  const installedVersion = cleanText(row.installed);
  const latestVersion = cleanText(row.version);
  // Prefer what the user actually has on disk; fall back to the thread's latest
  // so a tracked-but-not-installed row still carries a sensible version label.
  const version = installedVersion || latestVersion;

  const title = cleanText(row.name) || "Unknown";
  const creator = cleanText(row.developer) || "Unknown";

  const finishedVersion = cleanText(row.finished);
  const lastLaunched = Number.parseInt(row.last_launched, 10) || 0;
  const addedOn = Number.parseInt(row.added_on, 10) || 0;
  const rating = Number.parseInt(row.rating, 10) || 0;

  const labels = parseJsonArray(row.labels)
    .map((id) => labelsById.get(Number.parseInt(id, 10)))
    .filter(Boolean);
  const tab = tabsById.get(Number.parseInt(row.tab, 10)) || "";

  return {
    sourceType: "f95checker",
    externalSource: "f95checker",
    externalId: rawId,
    isCustomEntry: isCustom,

    atlasId: "",
    f95Id,
    title,
    lookupTitle: title,
    creator,
    engine: "Unknown",
    version,
    latestVersion,

    singleExecutable: install.singleExecutable,
    execPath: install.execPath,
    executables: install.singleExecutable
      ? [{ key: install.singleExecutable, value: install.singleExecutable }]
      : [],
    selectedValue: install.singleExecutable,
    singleVisible: install.singleExecutable ? "visible" : "hidden",
    multipleVisible: "hidden",
    folder: install.folder,
    // Games are left where they are (see the importer's in_place handling); an
    // external library import never moves or extracts anything.
    in_place: 1,
    inPlace: true,
    isArchive: false,

    results: [],
    resultSelectedValue: "",
    resultVisibility: "hidden",
    recordExist: false,
    existingRecordId: "",

    // Matching is deferred to resolve-import-matches, which looks up f95Id
    // first and falls back to title/creator — exactly what these rows need.
    scanStatus: "pendingMatch",
    scanMessage: "Pending match",

    externalState: {
      source: "f95checker",
      externalId: rawId,
      notes: cleanText(row.notes),
      // 0-5 in F95Checker, 0-10 in Atlas. Converted at write time using the
      // existing community-scale helper rather than a hardcoded doubling.
      rating: rating > 0 ? rating : null,
      lastPlayed: lastLaunched > 0 ? lastLaunched : null,
      dateAdded: addedOn > 0 ? addedOn : null,
      installedVersion,
      finishedVersion,
      // Only a version the user actually finished counts. Comparing against the
      // resolved version happens at write time, since the imported version can
      // be renamed for uniqueness.
      isFinished: Boolean(finishedVersion),
      labels,
      tab,
    },

    // Surfaced by the import step so a missing install path is visible before
    // anything is written, rather than showing up as a dead launch button later.
    installMissing: install.missing,
    recordedInstallPath: install.recordedPath || "",
  };
};

// Read a F95Checker database into importer rows.
//
// Archived rows are dropped here rather than in the UI so they can never reach
// the import writer, and the count is reported so the totals still add up for
// the user.
const readF95CheckerLibrary = async (dbPath) => {
  const resolved = path.resolve(cleanText(dbPath));
  const stat = await fsp.stat(resolved).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`F95Checker database not found at ${resolved}`);
  }

  const snapshot = await snapshotDatabase(resolved);
  let handle = null;
  try {
    handle = await openReadOnly(snapshot.target);

    const [gameRows, labelRows, tabRows] = await Promise.all([
      allRows(
        handle,
        `SELECT id, name, version, developer, url, added_on, last_launched,
                rating, finished, installed, archived, executables, labels,
                tab, notes
         FROM games`,
      ),
      allRows(handle, `SELECT id, name FROM labels`),
      allRows(handle, `SELECT id, name FROM tabs`),
    ]);

    const labelsById = new Map(
      labelRows
        .map((row) => [Number.parseInt(row.id, 10), cleanText(row.name)])
        .filter(([id, name]) => Number.isInteger(id) && name),
    );
    const tabsById = new Map(
      tabRows
        .map((row) => [Number.parseInt(row.id, 10), cleanText(row.name)])
        .filter(([id, name]) => Number.isInteger(id) && name),
    );

    const rows = [];
    let archivedCount = 0;
    let customCount = 0;
    let installedCount = 0;
    let missingInstallCount = 0;

    for (const row of gameRows) {
      // Their `archived` column is an INTEGER boolean, but create_table's
      // integer->text migration path can leave "True"/"False" strings behind,
      // so accept both spellings.
      const archivedRaw = String(row.archived ?? "").trim().toLowerCase();
      if (archivedRaw === "1" || archivedRaw === "true") {
        archivedCount += 1;
        continue;
      }
      const built = buildImportRow(row, { labelsById, tabsById });
      if (built.isCustomEntry) customCount += 1;
      if (built.folder) installedCount += 1;
      if (built.installMissing) missingInstallCount += 1;
      rows.push(built);
    }

    return {
      success: true,
      source: "f95checker",
      dbPath: resolved,
      rows,
      summary: {
        total: gameRows.length,
        imported: rows.length,
        archived: archivedCount,
        custom: customCount,
        installed: installedCount,
        missingInstall: missingInstallCount,
        withLabels: rows.filter((row) => row.externalState.labels.length > 0).length,
        withTab: rows.filter((row) => row.externalState.tab).length,
        withNotes: rows.filter((row) => row.externalState.notes).length,
        withRating: rows.filter((row) => row.externalState.rating).length,
        withFinished: rows.filter((row) => row.externalState.isFinished).length,
      },
      tabs: Array.from(new Set(rows.map((row) => row.externalState.tab).filter(Boolean))).sort(),
      // A journal sidecar means F95Checker is open (or was killed mid-write), so
      // the snapshot can be up to save_loop()'s 30s behind their UI.
      journalPresent: snapshot.journalPresent,
    };
  } finally {
    await closeQuietly(handle);
    await removeQuietly(snapshot.tempDir);
  }
};

module.exports = {
  DB_FILENAME,
  getCandidateDataDirs,
  locateDatabase,
  readF95CheckerLibrary,
  // Exported for scripts/check-external-library-parser.js
  parseJsonArray,
  resolveInstallPaths,
  buildImportRow,
};
