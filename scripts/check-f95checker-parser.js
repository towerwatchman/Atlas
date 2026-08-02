"use strict";

// Builds a throwaway database with F95Checker 11.1.3's exact `games` / `labels`
// / `tabs` schema, then asserts the reader turns it into the rows the importer
// expects. Covers the cases that are easy to get wrong by reading the schema
// alone: negative ids being custom entries rather than thread ids (while their
// URL may still carry a real one), executables stored RELATIVE to
// settings.default_exe_dir, `finished` and `installed` holding version strings
// rather than booleans, archived rows being dropped, and label/tab ids
// resolving to names.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

const {
  readF95CheckerLibrary,
  resolveInstallPaths,
  parseJsonArray,
  pickExeBaseDir,
  joinExeBase,
  extractThreadId,
} = require("../electron/scanners/externalLibrary/f95checker");

const run = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });

// Column definitions copied verbatim from F95Checker modules/db.py so a schema
// drift on their side shows up here as a failing query rather than as silently
// missing data at import time.
const GAMES_DDL = `
  CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    custom INTEGER DEFAULT NULL,
    name TEXT DEFAULT "",
    version TEXT DEFAULT "Unchecked",
    developer TEXT DEFAULT "",
    type INTEGER DEFAULT 23,
    status INTEGER DEFAULT 5,
    url TEXT DEFAULT "",
    added_on INTEGER DEFAULT 0,
    last_updated INTEGER DEFAULT 0,
    last_full_check INTEGER DEFAULT 0,
    last_check_version TEXT DEFAULT "",
    last_launched INTEGER DEFAULT 0,
    score REAL DEFAULT 0,
    votes INTEGER DEFAULT 0,
    rating INTEGER DEFAULT 0,
    finished TEXT DEFAULT "",
    installed TEXT DEFAULT "",
    updated INTEGER DEFAULT NULL,
    archived INTEGER DEFAULT 0,
    executables TEXT DEFAULT "[]",
    description TEXT DEFAULT "",
    changelog TEXT DEFAULT "",
    tags TEXT DEFAULT "[]",
    unknown_tags TEXT DEFAULT "[]",
    unknown_tags_flag INTEGER DEFAULT 0,
    labels TEXT DEFAULT "[]",
    tab INTEGER DEFAULT NULL,
    notes TEXT DEFAULT "",
    image_url TEXT DEFAULT "",
    previews_urls TEXT DEFAULT "[]",
    downloads TEXT DEFAULT "[]",
    reviews_total INTEGER DEFAULT 0,
    reviews TEXT DEFAULT "[]"
  )
`;

async function buildFixture(dir) {
  // A real install path so the executable-resolution branch is exercised
  // against the filesystem rather than mocked.
  const installDir = path.join(dir, "Games", "Test Game-v1.2");
  fs.mkdirSync(installDir, { recursive: true });
  const exePath = path.join(installDir, "TestGame.exe");
  fs.writeFileSync(exePath, "stub");

  const dbPath = path.join(dir, "db.sqlite3");
  const db = new sqlite3.Database(dbPath);

  await run(db, GAMES_DDL);
  await run(db, `CREATE TABLE labels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT "", color TEXT DEFAULT "#696969")`);
  await run(db, `CREATE TABLE tabs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT "", icon TEXT DEFAULT "", color TEXT DEFAULT NULL, position INTEGER DEFAULT 0)`);
  await run(db, `CREATE TABLE settings (_ INTEGER PRIMARY KEY CHECK (_=0), default_exe_dir TEXT DEFAULT "{}")`);
  // Keyed by F95Checker's Os enum value, not by platform name. The fixture
  // writes the key for THIS platform so the relative-path row resolves against
  // a directory that actually exists here.
  const osKey = process.platform === "win32" ? "0" : process.platform === "darwin" ? "1" : "2";
  await run(db, `INSERT INTO settings (_, default_exe_dir) VALUES (0, ?)`, [
    JSON.stringify({ [osKey]: path.join(dir, "Games") }),
  ]);

  await run(db, `INSERT INTO labels (id, name) VALUES (1, 'Favourites'), (2, 'To Try')`);
  await run(db, `INSERT INTO tabs (id, name, position) VALUES (1, 'Playing', 0), (2, 'Backlog', 1)`);

  const insert = `INSERT INTO games
    (id, custom, name, version, developer, url, added_on, last_launched, rating,
     finished, installed, archived, executables, labels, tab, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // Installed, played, rated, finished at the installed version, labelled.
  await run(db, insert, [
    12345, 0, "Test Game", "v1.3", "Test Dev", "https://f95zone.to/threads/12345",
    1700000000, 1710000000, 4, "v1.2", "v1.2", 0, JSON.stringify([exePath]),
    JSON.stringify([1, 2]), 1, "Route B needs a guide.",
  ]);
  // Finished an OLDER build than the one installed — their "outdated finished"
  // state. Must not collapse into "finished the installed version".
  await run(db, insert, [
    23456, 0, "Outdated Finish", "v3.0", "Dev Two", "", 1700000001, 0, 0,
    "v2.0", "v2.9", 0, "[]", "[]", 2, "",
  ]);
  // Tracked but never installed: no executables, no version installed.
  await run(db, insert, [
    34567, 0, "Wishlisted", "v0.1", "Dev Three", "", 1700000002, 0, 0, "", "", 0,
    "[]", "[]", null, "",
  ]);
  // Archived — must be dropped entirely.
  await run(db, insert, [
    45678, 0, "Archived Game", "v9.9", "Dev Four", "", 1700000003, 0, 5, "v9.9",
    "v9.9", 1, "[]", JSON.stringify([1]), 1, "should not appear",
  ]);
  // Custom (user-created) entry with NO source link: the negative id must not
  // become an f95Id and there is nothing to recover, so it falls through to
  // title/creator matching.
  await run(db, insert, [
    -1, 1, "Custom Entry", "v1.0", "Dev Five", "", 1700000004, 0, 3, "", "v1.0",
    0, "[]", "[]", null, "local only",
  ]);
  // Custom entry that DOES link to a real thread, in XenForo's slug form. The
  // id in the URL is authoritative even though the row id is synthetic — this
  // is the case that made real games look unmatchable.
  await run(db, insert, [
    -2, 1, "Custom With Link", "v2.0", "Dev Seven",
    "https://f95zone.to/threads/some-game-slug.98765/post-12", 1700000006, 0, 0,
    "", "v2.0", 0, "[]", "[]", null, "",
  ]);
  // Custom entry linking to LewdCorner instead — Atlas can match on lc_id.
  await run(db, insert, [
    -3, 1, "Custom LewdCorner", "v1.0", "Dev Eight",
    "https://lewdcorner.com/threads/another-game.4242/", 1700000007, 0, 0, "",
    "v1.0", 0, "[]", "[]", null, "",
  ]);
  // Executable stored RELATIVE to settings.default_exe_dir, which is how
  // F95Checker records anything under its games folder. Must resolve.
  await run(db, insert, [
    78901, 0, "Relative Path Game", "v1.0", "Dev Nine",
    "https://f95zone.to/threads/78901", 1700000008, 0, 0, "", "v1.0", 0,
    JSON.stringify(["Test Game-v1.2/TestGame.exe"]), "[]", null, "",
  ]);
  // Recorded executable that no longer exists on disk.
  await run(db, insert, [
    56789, 0, "Moved Game", "v2.0", "Dev Six", "", 1700000005, 0, 0, "", "v2.0",
    0, JSON.stringify([path.join(dir, "gone", "missing.exe")]), "[]", null, "",
  ]);
  // The integer->text boolean migration in their create_table() can leave
  // "True"/"False" strings in `archived`. Also must be dropped.
  await run(db, `INSERT INTO games (id, name, archived) VALUES (67890, 'String Archived', 'True')`);

  await new Promise((resolve) => db.close(resolve));
  return { dbPath, exePath, installDir, baseDir: path.join(dir, "Games") };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f95checker-fixture-"));
  try {
    const { dbPath, exePath, installDir, baseDir } = await buildFixture(dir);
    const result = await readF95CheckerLibrary(dbPath);

    assert.strictEqual(result.success, true, "read should succeed");

    // Archived rows never reach the importer, but still count in the totals.
    assert.strictEqual(result.summary.total, 10, "total should count every row");
    assert.strictEqual(result.summary.archived, 2, "both archived spellings drop");
    assert.strictEqual(result.rows.length, 8, "eight importable rows");
    assert.ok(
      !result.rows.some((row) => /Archived/.test(row.title)),
      "no archived row survives",
    );

    const byTitle = new Map(result.rows.map((row) => [row.title, row]));

    // ── Installed + played + rated + finished ───────────────────────────────
    const installed = byTitle.get("Test Game");
    assert.strictEqual(installed.f95Id, "12345", "positive id becomes the f95Id");
    assert.strictEqual(installed.isCustomEntry, false);
    assert.strictEqual(installed.creator, "Test Dev");
    assert.strictEqual(installed.version, "v1.2", "installed version wins over latest");
    assert.strictEqual(installed.latestVersion, "v1.3");
    assert.strictEqual(installed.folder, installDir);
    assert.strictEqual(installed.execPath, exePath);
    assert.strictEqual(installed.singleExecutable, "TestGame.exe");
    assert.strictEqual(installed.in_place, 1, "external imports stay in place");
    assert.strictEqual(installed.scanStatus, "pendingMatch");
    assert.strictEqual(installed.externalState.rating, 4);
    assert.strictEqual(installed.externalState.lastPlayed, 1710000000);
    assert.strictEqual(installed.externalState.dateAdded, 1700000000);
    assert.strictEqual(installed.externalState.isFinished, true);
    assert.strictEqual(installed.externalState.finishedVersion, "v1.2");
    assert.strictEqual(installed.externalState.notes, "Route B needs a guide.");
    assert.deepStrictEqual(
      installed.externalState.labels,
      ["Favourites", "To Try"],
      "label ids resolve to names",
    );
    assert.strictEqual(installed.externalState.tab, "Playing");

    // ── finished != installed must survive as two distinct versions ──────────
    const outdated = byTitle.get("Outdated Finish");
    assert.strictEqual(outdated.version, "v2.9", "version is what's installed");
    assert.strictEqual(outdated.externalState.finishedVersion, "v2.0");
    assert.strictEqual(outdated.externalState.isFinished, true);
    assert.strictEqual(outdated.externalState.tab, "Backlog");

    // ── Tracked, never installed ────────────────────────────────────────────
    const wishlisted = byTitle.get("Wishlisted");
    assert.strictEqual(wishlisted.folder, "", "no install path");
    assert.strictEqual(wishlisted.version, "v0.1", "falls back to thread version");
    assert.strictEqual(wishlisted.externalState.isFinished, false);
    assert.strictEqual(wishlisted.externalState.rating, null, "0 means unrated");
    assert.strictEqual(wishlisted.externalState.lastPlayed, null, "0 means never");
    assert.strictEqual(wishlisted.installMissing, false, "nothing was recorded");

    // ── Custom entries must never be treated as thread ids ──────────────────
    const custom = byTitle.get("Custom Entry");
    assert.strictEqual(custom.isCustomEntry, true);
    assert.strictEqual(custom.f95Id, "", "negative id must not become an f95Id");
    assert.strictEqual(custom.f95IdFromUrl, false);
    assert.strictEqual(custom.externalId, -1);

    // ── ...but their URL still carries the real one ─────────────────────────
    const linked = byTitle.get("Custom With Link");
    assert.strictEqual(linked.isCustomEntry, true, "still a custom entry");
    assert.strictEqual(linked.externalId, -2, "the synthetic id is preserved");
    assert.strictEqual(linked.f95Id, "98765", "slug-form thread id is recovered");
    assert.strictEqual(linked.f95IdFromUrl, true, "flagged as URL-derived");

    const lc = byTitle.get("Custom LewdCorner");
    assert.strictEqual(lc.lcId, "4242", "LewdCorner thread id is recovered");
    assert.strictEqual(lc.f95Id, "", "a LewdCorner link is not an F95 id");

    // ── Executables relative to settings.default_exe_dir ────────────────────
    // The bug this guards: treating these as absolute makes an entire installed
    // library resolve to nothing and import as uninstalled.
    const relative = byTitle.get("Relative Path Game");
    assert.strictEqual(relative.folder, installDir, "relative path resolves");
    assert.strictEqual(relative.execPath, exePath);
    assert.strictEqual(relative.singleExecutable, "TestGame.exe");
    assert.strictEqual(relative.installMissing, false);
    assert.strictEqual(relative.isInstalled, true);

    // ── Watchlist defaults ──────────────────────────────────────────────────
    // Nothing on disk -> watchlist; anything installed -> library.
    assert.strictEqual(wishlisted.watchlistCandidate, true, "nothing on disk");
    assert.strictEqual(wishlisted.addToWatchlist, true, "pre-ticked for review");
    assert.strictEqual(installed.addToWatchlist, false, "installed goes to library");
    assert.strictEqual(
      byTitle.get("Moved Game").addToWatchlist,
      false,
      "a recorded-but-missing path is a broken install, not a watchlist entry",
    );

    // ── Recorded-but-gone install path ──────────────────────────────────────
    const moved = byTitle.get("Moved Game");
    assert.strictEqual(moved.folder, "", "missing path is not used");
    assert.strictEqual(moved.installMissing, true, "flagged for the UI");
    assert.ok(moved.recordedInstallPath.endsWith("missing.exe"));
    assert.strictEqual(moved.installPathWasRelative, false, "it was absolute");

    // ── Summary counters drive the import step's preview ─────────────────────
    assert.strictEqual(result.summary.custom, 3);
    assert.strictEqual(result.summary.installed, 2, "absolute + relative both resolve");
    assert.strictEqual(result.summary.missingInstall, 1);
    assert.strictEqual(result.summary.recoveredIds, 1, "one id came from a URL");
    assert.strictEqual(result.summary.lewdCorner, 1);
    assert.strictEqual(result.summary.unidentified, 1, "only the custom entry with no link");
    assert.strictEqual(result.summary.watchlist, 1, "only the row with nothing on disk");
    assert.strictEqual(result.summary.relativePaths, 0, "the relative one resolved");
    assert.strictEqual(result.exeBaseDir, baseDir, "base dir read from settings");
    assert.strictEqual(result.summary.withNotes, 2);
    assert.strictEqual(result.summary.withRating, 2);
    assert.strictEqual(result.summary.withFinished, 2);
    assert.strictEqual(result.summary.withLabels, 1);
    assert.strictEqual(result.summary.withTab, 2);
    assert.deepStrictEqual(result.tabs, ["Backlog", "Playing"]);

    // ── Helpers ─────────────────────────────────────────────────────────────
    assert.deepStrictEqual(parseJsonArray('["a","b"]'), ["a", "b"]);
    assert.deepStrictEqual(parseJsonArray(""), []);
    // Their sql_to_py() treats unparseable text as a single-element list.
    assert.deepStrictEqual(parseJsonArray("C:/games/game.exe"), ["C:/games/game.exe"]);
    assert.deepStrictEqual(resolveInstallPaths([]), {
      folder: "",
      execPath: "",
      singleExecutable: "",
      missing: false,
      recordedPath: "",
      recordedRawPath: "",
      wasRelative: false,
    });
    // A directory entry is a valid "executable" in F95Checker.
    assert.strictEqual(resolveInstallPaths([installDir]).folder, installDir);
    assert.strictEqual(resolveInstallPaths([installDir]).execPath, "");

    // A relative entry that resolves nowhere reports the RESOLVED path, so the
    // user can see which base directory was tried.
    const unresolved = resolveInstallPaths(["Nope/Missing.exe"], { baseDir: "D:\\Spice" });
    assert.strictEqual(unresolved.missing, true);
    assert.strictEqual(unresolved.recordedPath, "D:\\Spice\\Nope\\Missing.exe");
    assert.strictEqual(unresolved.recordedRawPath, "Nope/Missing.exe");
    assert.strictEqual(unresolved.wasRelative, true);

    // ── Base directory selection ────────────────────────────────────────────
    // Keyed by their Os enum: 0 Windows, 1 MacOS, 2 Linux.
    assert.strictEqual(pickExeBaseDir('{"0":"D:\\\\Spice"}', "win32"), "D:\\Spice");
    assert.strictEqual(pickExeBaseDir('{"2":"/home/u/games"}', "linux"), "/home/u/games");
    // A database copied from another machine only has the other machine's key;
    // using it still beats treating every path as absolute.
    assert.strictEqual(pickExeBaseDir('{"0":"D:\\\\Spice"}', "linux"), "D:\\Spice");
    assert.strictEqual(pickExeBaseDir("{}", "win32"), "");
    assert.strictEqual(pickExeBaseDir("not json", "win32"), "");

    // Absolute entries are never rewritten, including Windows paths read on a
    // POSIX host, where path.isAbsolute() alone would get it wrong.
    assert.strictEqual(joinExeBase("D:\\Spice", "C:\\Other\\g.exe"), "C:\\Other\\g.exe");
    assert.strictEqual(joinExeBase("D:\\Spice", "/usr/bin/g"), "/usr/bin/g");
    assert.strictEqual(joinExeBase("", "Game/g.exe"), "Game/g.exe");
    // Separators follow the base directory so the result is displayable.
    assert.strictEqual(joinExeBase("D:\\Spice\\", "Game/g.exe"), "D:\\Spice\\Game\\g.exe");
    assert.strictEqual(joinExeBase("/games", "Game/g.exe"), "/games/Game/g.exe");

    // ── Thread id extraction ────────────────────────────────────────────────
    assert.strictEqual(extractThreadId("https://f95zone.to/threads/37378", "f95"), "37378");
    assert.strictEqual(extractThreadId("https://f95zone.to/threads/37378/", "f95"), "37378");
    assert.strictEqual(extractThreadId("https://f95zone.to/threads/a-slug.243406/post-9", "f95"), "243406");
    assert.strictEqual(extractThreadId("https://lewdcorner.com/threads/x.13917/", "lewdcorner"), "13917");
    // Cross-forum links must not leak into the wrong id.
    assert.strictEqual(extractThreadId("https://lewdcorner.com/threads/x.13917/", "f95"), "");
    assert.strictEqual(extractThreadId("https://www.ryuugames.com/some-game-rj01415588/", "f95"), "");
    assert.strictEqual(extractThreadId("", "f95"), "");

    console.log("F95Checker parser checks passed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
