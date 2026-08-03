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
//                     A negative id must never reach f95_zone_mappings.f95_id.
//   games.custom      1 for those user-created entries, 0 otherwise. Read
//                     directly rather than inferred from the sign of the id.
//   games.url         The authoritative source link, and the reason a custom
//                     entry is NOT automatically unidentifiable: F95Checker
//                     lets you add a game by hand while still pointing it at a
//                     real forum thread, so the thread id usually survives in
//                     the URL even though the row id is synthetic. Parsed here
//                     for both f95zone.to and lewdcorner.com so those rows get
//                     an id-based catalog match instead of falling all the way
//                     through to fuzzy title matching.
//   games.version     Latest version known from the thread.
//   games.installed   Version string the USER has on disk ("" = not installed).
//   games.finished    Version string the USER completed ("" = not finished).
//                     Deliberately allowed to differ from `installed` — that is
//                     their "finished an older build" state, which maps onto
//                     Atlas's per-version playstate.
//   games.executables JSON array of paths to the installed game. NOT reliably
//                     absolute: F95Checker stores a path RELATIVE to
//                     settings.default_exe_dir whenever the executable lives
//                     under it, which in practice is nearly every row for
//                     anyone who set that option. Resolving them as-is makes an
//                     entire installed library look uninstalled, so the base
//                     directory is read from settings and joined on.
//   games.archived    User archived it ("hide and stop tracking").
//   games.rating      The user's own score, 0-5. Zero means unrated.
//   games.last_launched  Unix timestamp. NOTE: F95Checker stores no playtime
//                     anywhere, only this timestamp, so total_playtime and
//                     version_playtime have nothing to read from.
//   games.labels      JSON array of ids into their `labels` table (user tags).
//   settings.default_exe_dir
//                     JSON object keyed by their Os enum value -> base
//                     directory. See EXE_BASE_OS_KEYS below.
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

// The exact file paths detection tests, in order. Reported to the UI so a failed
// detection can say what it actually looked for rather than only where.
const getCandidatePaths = () =>
  getCandidateDataDirs().map((dir) => path.join(dir, DB_FILENAME));

// First existing db.sqlite3 across the candidate paths, or null.
const locateDatabase = () => {
  for (const candidate of getCandidatePaths()) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not there — try the next candidate.
    }
  }
  return null;
};

// settings.default_exe_dir is a JSON object keyed by F95Checker's Os enum
// value, not by platform name: 0 = Windows, 1 = MacOS, 2 = Linux in
// modules/structs.py. A database copied from another machine will only have the
// key for the machine that wrote it, so we try this machine's key first and
// then accept any populated value rather than giving up — a wrong-platform base
// path still tells us the shape of the tree, and a path that does not resolve
// is reported as missing instead of silently dropped.
const EXE_BASE_OS_KEYS = { win32: "0", darwin: "1", linux: "2" };

const parseExeBaseDirs = (raw) => {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const pickExeBaseDir = (raw, platform = process.platform) => {
  const dirs = parseExeBaseDirs(raw);
  const preferred = String(dirs[EXE_BASE_OS_KEYS[platform] ?? ""] ?? "").trim();
  if (preferred) return preferred;
  for (const value of Object.values(dirs)) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

// path.isAbsolute() only understands the host platform's rules, so on Linux it
// would call "D:\\Spice\\Game.exe" relative and mangle it into the base dir.
// Both spellings are checked explicitly so a Windows database read on any
// platform is classified correctly.
const isAbsolutePath = (value) =>
  /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{1,2}/.test(value) || path.isAbsolute(value);

const joinExeBase = (baseDir, entry) => {
  if (!entry) return "";
  if (isAbsolutePath(entry) || !baseDir) return entry;
  // F95Checker writes the relative fragment with forward slashes even on
  // Windows. Both separators work for stat(), but a path shown to the user
  // should not read "D:\Spice\Sakura Gozen/Game.exe", so the fragment is
  // rewritten to whatever the base directory uses.
  const separator = baseDir.includes("\\") ? "\\" : "/";
  const tail = entry.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator);
  return `${baseDir.replace(/[\\/]+$/, "")}${separator}${tail}`;
};

// Thread ids out of a source URL. XenForo renders threads as either
// /threads/12345 or /threads/some-slug.12345/, optionally with a trailing
// /post-N, so the numeric id is the last dot-separated segment before any
// trailing path. Both forums Atlas can match against are handled.
const THREAD_ID_PATTERNS = {
  f95: /(?:^|\/\/|\.)f95zone\.to\/threads\/(?:[^/?#]*\.)?(\d+)/i,
  lewdcorner: /(?:^|\/\/|\.)lewdcorner\.com\/threads\/(?:[^/?#]*\.)?(\d+)/i,
};

const extractThreadId = (url, forum) => {
  const match = THREAD_ID_PATTERNS[forum]?.exec(String(url ?? ""));
  const id = match ? Number.parseInt(match[1], 10) : NaN;
  return Number.isInteger(id) && id > 0 ? String(id) : "";
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

// Resolve the on-disk location for a row from its `executables` array. Entries
// can be absolute OR relative to `baseDir` (settings.default_exe_dir), can be
// either a file (the usual case) or a directory, and can point at something
// that no longer exists.
//
// When nothing resolves we report the FULLY RESOLVED path rather than the raw
// relative fragment, because "Sakura Gozen/Game.exe" tells the user nothing
// about where Atlas actually looked.
const resolveInstallPaths = (executables, { baseDir = "" } = {}) => {
  for (const entry of executables) {
    const candidate = joinExeBase(baseDir, cleanText(entry));
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
  // Recorded but gone: keep the first path, resolved, so the UI can say exactly
  // what it looked for and the user can see whether the base directory is the
  // problem (drive not mounted, library moved, database from another machine).
  const firstRaw = cleanText(executables[0] || "");
  const firstRecorded = joinExeBase(baseDir, firstRaw);
  return {
    folder: "",
    execPath: "",
    singleExecutable: "",
    missing: Boolean(firstRecorded),
    recordedPath: firstRecorded,
    recordedRawPath: firstRaw,
    wasRelative: Boolean(firstRaw) && !isAbsolutePath(firstRaw),
  };
};

// One F95Checker row -> one importer row. `externalState` carries the user data
// that only gets written after the record exists (see applyExternalLibraryState
// in ipc/importer.js); everything outside it is what the scan table and match
// resolver already understand.
const buildImportRow = (row, { labelsById, tabsById, exeBaseDir = "" }) => {
  const rawId = Number.parseInt(row.id, 10);
  // `custom` is authoritative; the negative-id rule is the fallback for
  // databases written before that column existed.
  const customFlag = String(row.custom ?? "").trim().toLowerCase();
  const isCustom =
    customFlag === "1" || customFlag === "true"
      ? true
      : customFlag === "0" || customFlag === "false"
        ? false
        : Number.isInteger(rawId) && rawId < 0;

  const url = cleanText(row.url);
  // A custom row's id is synthetic, but its URL usually still points at the
  // real thread — that link is the whole reason these games are findable.
  const urlF95Id = extractThreadId(url, "f95");
  const lcId = extractThreadId(url, "lewdcorner");
  const rowF95Id = isCustom ? "" : String(toPositiveInt(rawId) || "");
  const f95Id = rowF95Id || urlF95Id;
  const f95IdFromUrl = Boolean(!rowF95Id && urlF95Id);

  const executables = parseJsonArray(row.executables).map(cleanText).filter(Boolean);
  const install = resolveInstallPaths(executables, { baseDir: exeBaseDir });

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
    // Set only when the id came from the URL rather than the row id, so the
    // review table can show where the identification came from.
    f95IdFromUrl,
    lcId,
    lewdCornerId: lcId,
    sourceUrl: url,
    siteUrl: url,
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
    // The review table computes the visible label from whether the row
    // carries an id; this is the fallback for anywhere else it surfaces.
    scanMessage: "Matching against the catalog",

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
    recordedRawInstallPath: install.recordedRawPath || "",
    installPathWasRelative: Boolean(install.wasRelative),

    // ── Wishlist ───────────────────────────────────────────────────────────
    // A row F95Checker is tracking that Atlas cannot launch isn't a game the
    // user owns here — it's a game they're watching. Importing it as a library
    // record would create an entry with no version and no launch path, which is
    // exactly the dead row the review table flags as "Missing launchable".
    // Defaulted here, overridable per row (and in bulk) in the review table.
    //
    // The test is whether an EXECUTABLE resolved, not whether one was recorded.
    // An earlier rule asked only whether the row had no executables and no
    // installed version, which left two populations belonging to neither list:
    // a row whose recorded path no longer exists (library moved, or its drive is
    // not mounted), and a row with an `installed` version string but no
    // executable. Both failed the importer's launchable check AND the wishlist
    // check, so they were silently dropped by the import — which for anyone
    // whose games live on an unmounted drive is the entire library.
    //
    // Note this is about DISK, not about catalog matching: a wishlist entry
    // still wants its Atlas match so it can carry a banner and metadata.
    //
    // A directory-only entry counts as not launchable for the same reason: Atlas
    // needs an executable to write a version row, so a folder with nothing
    // resolvable beneath it cannot be imported either.
    isInstalled: Boolean(install.singleExecutable),
    wishlistCandidate: !install.singleExecutable,
    addToWishlist: !install.singleExecutable,
    // Why the row is going to the wishlist, so the import step can break the
    // count down instead of reporting one opaque number. "Not installed" is the
    // expected case; the other two mean something is wrong the user may want to
    // fix before importing.
    wishlistReason: install.singleExecutable
      ? ""
      : install.missing
        ? "install-path-missing"
        : executables.length > 0 || installedVersion
          ? "no-launchable"
          : "not-installed",
  };
};

// ── Mapping table for the import step ───────────────────────────────────────

// What goes where, with counts off the user's own library. Built here rather
// than in the UI so the step stays provider-agnostic and each reader describes
// its own mapping — including the parts it drops, since leaving those out would
// be the same as hiding them.
const buildMapping = (summary, tabs = []) => [
  {
    from: "Game + developer",
    to: "Title and creator",
    detail: "Matched against the Atlas catalog by thread ID",
    count: summary.imported,
  },
  {
    from: "Installed version + executable",
    to: "Version, game path, executable",
    detail: "Left where they are on disk — nothing is moved or copied",
    count: summary.installed,
  },
  {
    from: "Finished version",
    to: 'Playstate "finished"',
    detail: "Set on the matching version where possible",
    count: summary.withFinished,
  },
  {
    from: "Last launched",
    to: "Last played",
    detail: "F95Checker stores no playtime, so playtime stays empty",
    count: summary.imported,
    muted: true,
  },
  {
    from: "Rating (0-5)",
    to: "Story rating (0-10)",
    detail: "Doubled to the Atlas scale — see the note below",
    count: summary.withRating,
  },
  {
    from: "Notes",
    to: "Notes",
    detail: "Editable afterwards under the game\u2019s Record tab",
    count: summary.withNotes,
  },
  {
    from: "Labels",
    to: "Tags",
    detail: "Added alongside the catalog tags, not replacing them",
    count: summary.withLabels,
  },
  {
    from: "Tabs",
    to: "Collections",
    detail: tabs.length
      ? `${tabs.length} collection${tabs.length === 1 ? "" : "s"} will be created or reused`
      : "No tabs in this library",
    count: summary.withTab,
  },
  {
    from: "Nothing launchable on disk",
    to: "Wishlist",
    detail: "Pre-ticked on the review screen — untick any you want as library records",
    count: summary.wishlist,
  },
  {
    from: "Status, type, tags, description, score",
    to: "Not imported",
    detail: "Atlas already has these from its own catalog and keeps them updated",
    count: null,
    muted: true,
  },
];

// The mappings the user can decline. Only the two with consequences beyond the
// import itself: creating collections, and pinning a game's tag list.
const buildOptionalMappings = (tabs = []) => [
  {
    key: "importTabsAsCollections",
    label: "Recreate tabs as collections",
    detail: tabs.length > 0
      ? `Creates or reuses: ${tabs.join(", ")}`
      : "No tabs found in this library",
    default: true,
  },
  {
    key: "importLabelsAsTags",
    label: "Import labels as tags",
    detail:
      "Labels are added alongside the catalog tags. Because editing a game\u2019s tags "
      + "marks the list as yours, those games will stop picking up new tags from "
      + "catalog updates.",
    default: true,
  },
];

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

    const [gameRows, labelRows, tabRows, settingsRows] = await Promise.all([
      allRows(
        handle,
        `SELECT id, custom, name, version, developer, url, added_on, last_launched,
                rating, finished, installed, archived, executables, labels,
                tab, notes
         FROM games`,
      ),
      allRows(handle, `SELECT id, name FROM labels`),
      allRows(handle, `SELECT id, name FROM tabs`),
      // Pre-11 databases predate this column; a failed read just means no base
      // directory, which degrades to the old absolute-only behaviour.
      allRows(handle, `SELECT default_exe_dir FROM settings LIMIT 1`).catch(() => []),
    ]);

    const exeBaseDir = pickExeBaseDir(settingsRows[0]?.default_exe_dir);

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
    let recoveredIdCount = 0;
    let lewdCornerCount = 0;
    let unidentifiedCount = 0;
    let wishlistCount = 0;
    let relativePathCount = 0;
    // Broken down by reason: "not installed" is expected, the other two mean
    // something the user may want to fix before importing.
    const wishlistReasons = {
      "not-installed": 0,
      "install-path-missing": 0,
      "no-launchable": 0,
    };

    for (const row of gameRows) {
      // Their `archived` column is an INTEGER boolean, but create_table's
      // integer->text migration path can leave "True"/"False" strings behind,
      // so accept both spellings.
      const archivedRaw = String(row.archived ?? "").trim().toLowerCase();
      if (archivedRaw === "1" || archivedRaw === "true") {
        archivedCount += 1;
        continue;
      }
      const built = buildImportRow(row, { labelsById, tabsById, exeBaseDir });
      if (built.isCustomEntry) customCount += 1;
      // Counted by launchability rather than by a resolved folder, so the
      // "installed on disk" figure is the number of rows that will actually
      // become library records.
      if (built.isInstalled) installedCount += 1;
      if (built.installMissing) missingInstallCount += 1;
      if (built.f95IdFromUrl) recoveredIdCount += 1;
      if (built.lcId) lewdCornerCount += 1;
      if (!built.f95Id && !built.lcId) unidentifiedCount += 1;
      if (built.addToWishlist) {
        wishlistCount += 1;
        if (built.wishlistReason in wishlistReasons) {
          wishlistReasons[built.wishlistReason] += 1;
        }
      }
      if (built.installPathWasRelative) relativePathCount += 1;
      rows.push(built);
    }

    const tabs = Array.from(
      new Set(rows.map((row) => row.externalState.tab).filter(Boolean)),
    ).sort();

    const summary = {
      total: gameRows.length,
      imported: rows.length,
      archived: archivedCount,
      custom: customCount,
      installed: installedCount,
      missingInstall: missingInstallCount,
      // Custom rows rescued by parsing their thread URL — these would
      // otherwise reach the catalog with no identifier at all.
      recoveredIds: recoveredIdCount,
      lewdCorner: lewdCornerCount,
      unidentified: unidentifiedCount,
      wishlist: wishlistCount,
      // Rows going to the wishlist because their recorded install path did not
      // resolve, rather than because nothing was ever installed. A large number
      // here almost always means one shared cause — see exeBaseDir.
      wishlistMissingPath: wishlistReasons["install-path-missing"],
      wishlistNoLaunchable: wishlistReasons["no-launchable"],
      wishlistNotInstalled: wishlistReasons["not-installed"],
      relativePaths: relativePathCount,
      withLabels: rows.filter((row) => row.externalState.labels.length > 0).length,
      withTab: rows.filter((row) => row.externalState.tab).length,
      withNotes: rows.filter((row) => row.externalState.notes).length,
      withRating: rows.filter((row) => row.externalState.rating).length,
      withFinished: rows.filter((row) => row.externalState.isFinished).length,
      // Reported for parity with the XLibrary reader, whose mapping table shares
      // the same shape. F95Checker stores neither, so both are always zero.
      withPlaystate: 0,
      withPlaytime: 0,
    };

    return {
      success: true,
      source: "f95checker",
      dbPath: resolved,
      rows,
      // The base directory relative executables were resolved against. Shown in
      // the import step: if it is empty or points somewhere unmounted, every
      // "missing install" has one shared cause, and saying so up front is far
      // more useful than 900 individually-broken rows.
      exeBaseDir,
      summary,
      mapping: buildMapping(summary, tabs),
      optionalMappings: buildOptionalMappings(tabs),
      tabs,
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
  getCandidatePaths,
  locateDatabase,
  readF95CheckerLibrary,
  buildMapping,
  buildOptionalMappings,
  // Exported for scripts/check-f95checker-parser.js
  parseJsonArray,
  resolveInstallPaths,
  buildImportRow,
  pickExeBaseDir,
  joinExeBase,
  extractThreadId,
};
