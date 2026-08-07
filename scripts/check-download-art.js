"use strict";

// ── Assertions for electron/db/downloadArt.js ────────────────────────────────
//
// The SQL is executed, not string-matched. Two of the three bugs this replaces
// were shapes a regex would have accepted:
//
//   * a download row silently DUPLICATED, because f95_zone_data.atlas_id and
//     lewdcorner_mappings are not one-to-one and a join multiplies rows. The
//     queue renders one card per row, so a duplicate is a visible bug rather
//     than a collapsed column. Only running the query catches it.
//   * `catalog:480` and `catalog:steam:480` resolving to the same art, because
//     'catalog:steam:480' also matches LIKE 'catalog:%'. They are unrelated
//     games. Only running the query catches this too.
//
// Uses node:sqlite (stdlib on the Node 22 in .nvmrc) rather than the app's
// sqlite3 binding, so this runs without a native build. The DDL below is a
// trimmed copy of the columns db/downloadArt.js actually reads — deliberately
// not an import of db/index.js, which opens a real database file on require.
//
// Run: node --no-warnings scripts/check-download-art.js

const assert = require("assert");
const { DatabaseSync } = require("node:sqlite");

const {
  DOWNLOAD_ART_CTE,
  DOWNLOAD_ART_JOIN,
  buildDownloadArtFields,
  downloadArtCandidates,
} = require("../electron/db/downloadArt");

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

const BASE = "C:/Atlas";

const schema = `
  CREATE TABLE downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER, title TEXT, creator TEXT, version TEXT,
    url TEXT, host TEXT, source TEXT, file_path TEXT, file_name TEXT,
    total_bytes INTEGER DEFAULT 0, received_bytes INTEGER DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'queued', error TEXT,
    on_complete TEXT NOT NULL DEFAULT 'replace', queue_order INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER, completed_at INTEGER,
    installed_at INTEGER, catalog_ref TEXT
  );
  CREATE TABLE games (record_id INTEGER PRIMARY KEY, title TEXT, creator TEXT);
  CREATE TABLE atlas_data (atlas_id INTEGER PRIMARY KEY, banner_wide TEXT, banner TEXT);
  CREATE TABLE f95_zone_data (f95_id INTEGER PRIMARY KEY, atlas_id INTEGER, banner_url TEXT);
  CREATE TABLE lewdcorner_data (lc_id INTEGER PRIMARY KEY, atlas_id INTEGER, banner_url TEXT);
  CREATE TABLE steam_data (steam_id INTEGER PRIMARY KEY, atlas_id INTEGER, header TEXT, library_hero TEXT);
  CREATE TABLE gog_data (gog_id INTEGER PRIMARY KEY, atlas_id INTEGER, header TEXT);
  CREATE TABLE atlas_mappings (record_id INTEGER PRIMARY KEY, atlas_id INTEGER);
  CREATE TABLE steam_mappings (record_id INTEGER PRIMARY KEY, steam_id INTEGER);
  CREATE TABLE gog_mappings (record_id INTEGER PRIMARY KEY, gog_id INTEGER);
  CREATE TABLE lewdcorner_mappings (record_id INTEGER, lc_id INTEGER, UNIQUE(record_id, lc_id));
  CREATE TABLE banners (record_id INTEGER, path TEXT UNIQUE, type TEXT);
  CREATE TABLE media_assets (record_id INTEGER, source TEXT, asset_type TEXT, path TEXT, created_at INTEGER);
`;

// One fixture covering every path, so a change that fixes one case and breaks
// another cannot pass. Ids are distinct across tables on purpose — a query that
// reads the right id from the wrong column would otherwise still line up.
const fixture = `
  INSERT INTO atlas_data (atlas_id, banner_wide, banner) VALUES
    (30956, 'https://cdn/atlas-wide.jpg', 'https://cdn/atlas.jpg'),
    (777,   NULL,                          'https://cdn/lc-atlas.jpg'),
    (888,   'https://cdn/steam-atlas.jpg', NULL);

  -- TWO f95 rows on one atlas_id. This is the shape that multiplies rows under a
  -- join: the constraint was dropped by a server migration and both rows are
  -- legitimate. MIN by f95_id is the tie-break, so 100 wins.
  INSERT INTO f95_zone_data (f95_id, atlas_id, banner_url) VALUES
    (100, 30956, 'https://f95/first.jpg'),
    (101, 30956, 'https://f95/second.jpg');

  INSERT INTO lewdcorner_data (lc_id, atlas_id, banner_url) VALUES
    (5001, 777, 'https://lc/banner.jpg');

  INSERT INTO steam_data (steam_id, atlas_id, header, library_hero) VALUES
    (480, 888, 'https://steam/header.jpg', 'https://steam/hero.jpg');

  INSERT INTO gog_data (gog_id, atlas_id, header) VALUES
    (1207658691, NULL, 'https://gog/header.jpg');

  -- Library record 42: atlas-mapped, and with a downloaded custom banner that
  -- must beat every remote source.
  INSERT INTO games (record_id, title, creator) VALUES (42, 'Mapped Game', 'Studio');
  INSERT INTO atlas_mappings (record_id, atlas_id) VALUES (42, 30956);
  INSERT INTO banners (record_id, path, type) VALUES
    (42, 'data/images/42/banner_custom_mc.webp', 'small'),
    (42, 'data/images/42/banner_source.webp',    'small');

  -- Library record 43: TWO lewdcorner mappings, the other shape that multiplies.
  INSERT INTO games (record_id, title, creator) VALUES (43, 'Multi Mapped', 'Studio');
  INSERT INTO lewdcorner_mappings (record_id, lc_id) VALUES (43, 5001), (43, 5002);

  INSERT INTO downloads (id, title, record_id, catalog_ref, state, queue_order) VALUES
    (1, 'From library',    42,   NULL,                        'ready', 0),
    (2, 'Atlas ref',       NULL, 'catalog:30956',             'ready', 1),
    (3, 'Steam ref',       NULL, 'catalog:steam:480',         'ready', 2),
    (4, 'LewdCorner ref',  NULL, 'catalog:lewdcorner:5001',   'ready', 3),
    (5, 'GOG ref',         NULL, 'catalog:gog:1207658691',    'ready', 4),
    (6, 'Nothing at all',  NULL, NULL,                        'ready', 5),
    (7, 'Multi mapping',   43,   NULL,                        'ready', 6),
    (8, 'Junk ref',        NULL, 'catalog:banana',            'ready', 7);
`;

const open = (basePath = BASE) => {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  db.exec(fixture);
  const sql = `
    WITH ${DOWNLOAD_ART_CTE}
    SELECT downloads.*,
${buildDownloadArtFields(basePath)}
      FROM downloads
      ${DOWNLOAD_ART_JOIN}
     ORDER BY downloads.queue_order ASC`;
  return { db, rows: db.prepare(sql).all() };
};

const { db, rows } = open();
const byId = new Map(rows.map((row) => [row.id, row]));

// ── The multiplication guard ────────────────────────────────────────────────

check("every download row appears exactly once", () => {
  assert.strictEqual(rows.length, 8, `expected 8 rows, got ${rows.length}`);
  assert.strictEqual(new Set(rows.map((row) => row.id)).size, 8, "duplicate download ids");
});

check("two f95 rows on one atlas id do not duplicate the download", () => {
  const matches = rows.filter((row) => row.id === 2);
  assert.strictEqual(matches.length, 1);
  // Lowest f95_id wins, deterministically — not "whichever the planner kept".
  assert.strictEqual(matches[0].art_banner_f95, "https://f95/first.jpg");
});

check("two lewdcorner mappings on one record do not duplicate the download", () => {
  assert.strictEqual(rows.filter((row) => row.id === 7).length, 1);
});

// ── Refs resolve to the right table ─────────────────────────────────────────

check("catalog:30956 reads atlas 30956, not steam 30956", () => {
  const row = byId.get(2);
  assert.strictEqual(row.art_banner_atlas_wide, "https://cdn/atlas-wide.jpg");
  assert.strictEqual(row.art_banner_f95, "https://f95/first.jpg");
  assert.strictEqual(row.art_banner_steam_header, null);
});

check("catalog:steam:480 is not mistaken for atlas 480", () => {
  const row = byId.get(3);
  assert.strictEqual(row.art_banner_steam_header, "https://steam/header.jpg");
  assert.strictEqual(row.art_banner_steam_hero, "https://steam/hero.jpg");
  // …and it still reaches the atlas art behind that appid, which is what the
  // Browse tile it came from shows.
  assert.strictEqual(row.art_banner_atlas_wide, "https://cdn/steam-atlas.jpg");
});

check("catalog:lewdcorner:5001 reads its own banner and its atlas sibling", () => {
  const row = byId.get(4);
  assert.strictEqual(row.art_banner_lewdcorner, "https://lc/banner.jpg");
  assert.strictEqual(row.art_banner_atlas, "https://cdn/lc-atlas.jpg");
});

check("catalog:gog:… resolves even with no atlas row behind it", () => {
  const row = byId.get(5);
  assert.strictEqual(row.art_banner_gog_header, "https://gog/header.jpg");
  assert.strictEqual(row.art_banner_atlas, null);
});

check("an unparseable ref yields no art rather than an error or a wrong row", () => {
  const row = byId.get(8);
  assert.strictEqual(downloadArtCandidates(row).length, 0);
});

check("a row with neither record nor ref still comes back, with no art", () => {
  const row = byId.get(6);
  assert.ok(row, "LEFT JOIN dropped a row it should have kept");
  assert.strictEqual(downloadArtCandidates(row).length, 0);
});

// ── Local art precedence ────────────────────────────────────────────────────

check("a custom banner beats a source banner and every remote url", () => {
  const chain = downloadArtCandidates(byId.get(1));
  assert.strictEqual(chain[0], "C:/Atlas/data/images/42/banner_custom_mc.webp");
});

check("remote art still follows the local file in the chain", () => {
  const chain = downloadArtCandidates(byId.get(1));
  // Same order db/helpers.js bannerUrlExpression resolves: f95, then atlas.
  assert.deepStrictEqual(chain.slice(1), [
    "https://f95/first.jpg",
    "https://cdn/atlas-wide.jpg",
    "https://cdn/atlas.jpg",
  ]);
});

check("no asset base path omits local art instead of rooting it at '/'", () => {
  const { db: bare, rows: bareRows } = open("");
  const row = bareRows.find((entry) => entry.id === 1);
  assert.strictEqual(row.art_banner_local, null);
  // The remote half is unaffected, so the card still shows something.
  assert.strictEqual(downloadArtCandidates(row)[0], "https://f95/first.jpg");
  bare.close();
});

// ── The reader ──────────────────────────────────────────────────────────────

check("candidates are deduped and empties dropped", () => {
  assert.deepStrictEqual(
    downloadArtCandidates({
      art_banner_local: "  ",
      art_banner_f95: "https://x/a.jpg",
      art_banner_lewdcorner: "https://x/a.jpg",
      art_banner_atlas: null,
      art_banner_atlas_wide: "https://x/b.jpg",
    }),
    ["https://x/a.jpg", "https://x/b.jpg"],
  );
});

check("candidates on a row with no art columns is empty, not undefined", () => {
  assert.deepStrictEqual(downloadArtCandidates({}), []);
  assert.deepStrictEqual(downloadArtCandidates(), []);
});

db.close();

if (!process.exitCode) console.log(`check-download-art: ${passed} checks passed`);
