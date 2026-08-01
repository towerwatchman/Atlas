"use strict";

// Builds a throwaway database with F95Checker 11.1.3's exact `games` / `labels`
// / `tabs` schema, then asserts the reader turns it into the rows the importer
// expects. Covers the cases that are easy to get wrong by reading the schema
// alone: negative ids being custom entries rather than thread ids, `finished`
// and `installed` holding version strings rather than booleans, archived rows
// being dropped, and label/tab ids resolving to names.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

const { readF95CheckerLibrary, resolveInstallPaths, parseJsonArray } =
  require("../electron/scanners/externalLibrary/f95checker");

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

  await run(db, `INSERT INTO labels (id, name) VALUES (1, 'Favourites'), (2, 'To Try')`);
  await run(db, `INSERT INTO tabs (id, name, position) VALUES (1, 'Playing', 0), (2, 'Backlog', 1)`);

  const insert = `INSERT INTO games
    (id, name, version, developer, added_on, last_launched, rating, finished,
     installed, archived, executables, labels, tab, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // Installed, played, rated, finished at the installed version, labelled.
  await run(db, insert, [
    12345, "Test Game", "v1.3", "Test Dev", 1700000000, 1710000000, 4,
    "v1.2", "v1.2", 0, JSON.stringify([exePath]), JSON.stringify([1, 2]), 1,
    "Route B needs a guide.",
  ]);
  // Finished an OLDER build than the one installed — their "outdated finished"
  // state. Must not collapse into "finished the installed version".
  await run(db, insert, [
    23456, "Outdated Finish", "v3.0", "Dev Two", 1700000001, 0, 0,
    "v2.0", "v2.9", 0, "[]", "[]", 2, "",
  ]);
  // Tracked but never installed: no executables, no version installed.
  await run(db, insert, [
    34567, "Wishlisted", "v0.1", "Dev Three", 1700000002, 0, 0, "", "", 0,
    "[]", "[]", null, "",
  ]);
  // Archived — must be dropped entirely.
  await run(db, insert, [
    45678, "Archived Game", "v9.9", "Dev Four", 1700000003, 0, 5, "v9.9",
    "v9.9", 1, "[]", JSON.stringify([1]), 1, "should not appear",
  ]);
  // Custom (user-created) entry: negative id, must NOT become an f95Id.
  await run(db, insert, [
    -1, "Custom Entry", "v1.0", "Dev Five", 1700000004, 0, 3, "", "v1.0", 0,
    "[]", "[]", null, "local only",
  ]);
  // Recorded executable that no longer exists on disk.
  await run(db, insert, [
    56789, "Moved Game", "v2.0", "Dev Six", 1700000005, 0, 0, "", "v2.0", 0,
    JSON.stringify([path.join(dir, "gone", "missing.exe")]), "[]", null, "",
  ]);
  // The integer->text boolean migration in their create_table() can leave
  // "True"/"False" strings in `archived`. Also must be dropped.
  await run(db, `INSERT INTO games (id, name, archived) VALUES (67890, 'String Archived', 'True')`);

  await new Promise((resolve) => db.close(resolve));
  return { dbPath, exePath, installDir };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f95checker-fixture-"));
  try {
    const { dbPath, exePath, installDir } = await buildFixture(dir);
    const result = await readF95CheckerLibrary(dbPath);

    assert.strictEqual(result.success, true, "read should succeed");

    // Archived rows never reach the importer, but still count in the totals.
    assert.strictEqual(result.summary.total, 7, "total should count every row");
    assert.strictEqual(result.summary.archived, 2, "both archived spellings drop");
    assert.strictEqual(result.rows.length, 5, "five importable rows");
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
    assert.strictEqual(custom.externalId, -1);

    // ── Recorded-but-gone install path ──────────────────────────────────────
    const moved = byTitle.get("Moved Game");
    assert.strictEqual(moved.folder, "", "missing path is not used");
    assert.strictEqual(moved.installMissing, true, "flagged for the UI");
    assert.ok(moved.recordedInstallPath.endsWith("missing.exe"));

    // ── Summary counters drive the import step's preview ─────────────────────
    assert.strictEqual(result.summary.custom, 1);
    assert.strictEqual(result.summary.installed, 1);
    assert.strictEqual(result.summary.missingInstall, 1);
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
    });
    // A directory entry is a valid "executable" in F95Checker.
    assert.strictEqual(resolveInstallPaths([installDir]).folder, installDir);
    assert.strictEqual(resolveInstallPaths([installDir]).execPath, "");

    console.log("F95Checker parser checks passed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
