'use strict'

const sqlite3 = require('sqlite3').verbose()
const path = require('path')
const fs = require('fs')
// The startup migrations below rebuild whole tables inside explicit transactions
// on the ONE shared sqlite connection. They must take the same write lock as
// every other transactional writer (see electron/db/atlas.js) or their BEGIN
// lands inside somebody else's open transaction and sqlite rejects it with
// "cannot start a transaction within a transaction" — and worse, their COMMIT
// can close a transaction they do not own.
const { withWriteLock } = require('./writeLock')

let db
let cachedFilterOptions = null
let atlasIdNameMigrationRan = false
let f95AtlasIdUniqueMigrationRan = false

function migrateDropAtlasIdNameUnique() {
  // initializeDatabase is re-invoked by several IPC handlers; only run this
  // potentially-destructive check once per process to avoid overlapping
  // rebuilds on the first post-upgrade launch.
  if (atlasIdNameMigrationRan) return;
  atlasIdNameMigrationRan = true;

  db.all(`PRAGMA index_list(atlas_data)`, (err, indexes) => {
    if (err || !Array.isArray(indexes)) return;
    const autoUnique = indexes.filter(
      (i) => i.unique && /^sqlite_autoindex_atlas_data/.test(i.name),
    );
    if (autoUnique.length === 0) return;

    let pending = autoUnique.length;
    let onIdName = false;
    autoUnique.forEach((idx) => {
      db.all(`PRAGMA index_info(${idx.name})`, (e2, cols) => {
        if (!e2 && Array.isArray(cols) && cols.some((c) => c.name === "id_name")) {
          onIdName = true;
        }
        if (--pending === 0 && onIdName) rebuildAtlasDataWithoutUnique();
      });
    });
  });
}

function rebuildAtlasDataWithoutUnique() {
  // Reconstruct column defs from the live table so we keep any columns added
  // by other migrations. table_info exposes name/type/notnull/default/pk but
  // NOT inline UNIQUE — so re-emitting from it naturally drops the constraint.
  db.all(`PRAGMA table_info(atlas_data)`, (err, cols) => {
    if (err || !Array.isArray(cols) || cols.length === 0) return;
    const colDefs = cols
      .map((c) => {
        let def = `${c.name} ${c.type || "STRING"}`;
        if (c.pk) def += " PRIMARY KEY";
        if (c.notnull) def += " NOT NULL";
        if (c.dflt_value !== null && c.dflt_value !== undefined)
          def += ` DEFAULT ${c.dflt_value}`;
        return def;
      })
      .join(", ");
    const colNames = cols.map((c) => c.name).join(", ");

    withWriteLock("migrate.rebuildAtlasData", () => new Promise((settle) => {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(`CREATE TABLE atlas_data_rebuild (${colDefs});`);
      db.run(
        `INSERT INTO atlas_data_rebuild (${colNames}) SELECT ${colNames} FROM atlas_data;`,
      );
      db.run(`DROP TABLE atlas_data;`);
      db.run(`ALTER TABLE atlas_data_rebuild RENAME TO atlas_data;`, (e) => {
        if (e) {
          db.run("ROLLBACK", () => settle());
          console.error("atlas_data rebuild failed, rolled back:", e);
          return;
        }
        db.run("COMMIT", (commitErr) => {
          if (commitErr) {
            console.error("atlas_data rebuild commit failed:", commitErr);
            settle();
            return;
          }
          // DROP TABLE removed its indexes; recreate them.
          db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_title ON atlas_data(title);`);
          db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_short_name ON atlas_data(short_name);`);
          db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_creator ON atlas_data(creator);`);
          db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_normalized_title ON atlas_data(normalized_title);`);
          console.log("atlas_data rebuilt without id_name UNIQUE constraint");
          settle();
        });
      });
    });
    }));
  });
}

function migrateDropF95AtlasIdUnique() {
  // Migration 002 on the server dropped UNIQUE(atlas_id) on f95_zone so many
  // f95 rows can share one atlas_id. The client's f95_zone_data still has the
  // old inline UNIQUE(atlas_id); left in place, INSERT OR REPLACE would delete
  // a sibling row on conflict and silently lose data. Rebuild without it.
  if (f95AtlasIdUniqueMigrationRan) return;
  f95AtlasIdUniqueMigrationRan = true;

  db.all(`PRAGMA index_list(f95_zone_data)`, (err, indexes) => {
    if (err || !Array.isArray(indexes)) return;
    // The atlas_id UNIQUE is an auto-index; the f95_id PK auto-index is fine.
    let pending = 0;
    let target = false;
    const autoUnique = indexes.filter(
      (i) => i.unique && /^sqlite_autoindex_f95_zone_data/.test(i.name),
    );
    if (autoUnique.length === 0) return;
    pending = autoUnique.length;
    autoUnique.forEach((idx) => {
      db.all(`PRAGMA index_info(${idx.name})`, (e2, cols) => {
        // Only the atlas_id unique needs dropping; leave the f95_id PK alone.
        if (!e2 && Array.isArray(cols) && cols.length === 1 && cols[0].name === "atlas_id") {
          target = true;
        }
        if (--pending === 0 && target) rebuildF95WithoutAtlasIdUnique();
      });
    });
  });
}

function rebuildF95WithoutAtlasIdUnique() {
  db.all(`PRAGMA table_info(f95_zone_data)`, (err, cols) => {
    if (err || !Array.isArray(cols) || cols.length === 0) return;
    // Re-emit column defs from table_info, which does NOT carry inline UNIQUE,
    // so the atlas_id UNIQUE is dropped. Keep the f95_id PRIMARY KEY.
    const colDefs = cols
      .map((c) => {
        let def = `${c.name} ${c.type || "STRING"}`;
        if (c.pk) def += " PRIMARY KEY";
        if (c.notnull) def += " NOT NULL";
        if (c.dflt_value !== null && c.dflt_value !== undefined)
          def += ` DEFAULT ${c.dflt_value}`;
        return def;
      })
      .join(", ");
    const colNames = cols.map((c) => c.name).join(", ");

    withWriteLock("migrate.rebuildF95ZoneData", () => new Promise((settle) => {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(`CREATE TABLE f95_zone_data_rebuild (${colDefs});`);
      db.run(
        `INSERT INTO f95_zone_data_rebuild (${colNames}) SELECT ${colNames} FROM f95_zone_data;`,
      );
      db.run(`DROP TABLE f95_zone_data;`);
      db.run(`ALTER TABLE f95_zone_data_rebuild RENAME TO f95_zone_data;`, (e) => {
        if (e) {
          db.run("ROLLBACK", () => settle());
          console.error("f95_zone_data rebuild failed, rolled back:", e);
          return;
        }
        db.run("COMMIT", (commitErr) => {
          if (commitErr) {
            console.error("f95_zone_data rebuild commit failed:", commitErr);
            settle();
            return;
          }
          console.log("f95_zone_data rebuilt without atlas_id UNIQUE constraint");
          settle();
        });
      });
    });
    }));
  });
}

let emulatorsCompositeKeyMigrationRunning = false;

// Widen the emulators key from (extension) to (match_type, extension).
//
// SQLite cannot alter a primary key in place, so this is a rebuild. It only
// matters for databases that predate file-name matching: without it, adding a
// launcher for a file called "sh" would REPLACE the launcher for ".sh"
// instead of sitting beside it.
//
// Guarded against overlapping runs rather than against ever running twice.
// initializeDatabase is re-invoked by several IPC handlers, and two rebuilds
// in flight would fight over the same table — but a run that never happened
// (the ALTER above had not landed yet) must still be able to happen later, so
// the flag clears rather than latching the way the atlas_data guard does.
function migrateEmulatorsCompositeKey() {
  if (emulatorsCompositeKeyMigrationRunning) return;
  emulatorsCompositeKeyMigrationRunning = true;
  const done = () => { emulatorsCompositeKeyMigrationRunning = false; };

  db.all(`PRAGMA table_info(emulators)`, (err, cols) => {
    if (err || !Array.isArray(cols) || cols.length === 0) return done();
    const matchType = cols.find((c) => c.name === 'match_type');
    // pk > 0 means the column is already part of the primary key, so this has
    // run before. A missing column means the ALTER has not been applied to
    // this file yet; leave it for the next launch rather than guessing.
    if (!matchType || matchType.pk > 0) return done();

    withWriteLock('migrate.rebuildEmulators', () => new Promise((settle) => {
      const finish = () => { done(); settle(); };
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(`
          CREATE TABLE emulators_rebuild
          (
            extension TEXT NOT NULL,
            program_path TEXT NOT NULL,
            parameters TEXT,
            match_type TEXT NOT NULL DEFAULT 'extension',
            PRIMARY KEY (match_type, extension)
          );
        `);
        db.run(`
          INSERT OR REPLACE INTO emulators_rebuild
            (extension, program_path, parameters, match_type)
          SELECT extension, program_path, parameters, COALESCE(match_type, 'extension')
          FROM emulators;
        `);
        db.run(`DROP TABLE emulators;`);
        db.run(`ALTER TABLE emulators_rebuild RENAME TO emulators;`, (e) => {
          if (e) {
            console.error("emulators rebuild failed, rolled back:", e);
            db.run("ROLLBACK", () => finish());
            return;
          }
          db.run("COMMIT", (commitErr) => {
            if (commitErr) {
              console.error("emulators rebuild commit failed:", commitErr);
              finish();
              return;
            }
            console.log("emulators rebuilt with a (match_type, extension) key");
            finish();
          });
        });
      });
    }));
  });
}

const initializeDatabase = (dataDir) => {
  const dbPath = path.join(dataDir, "data.db");
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database error:", err);
  });

  // WAL lets reads proceed without being blocked by the write side and makes
  // commits cheaper, so large background DB updates don't stall the UI's
  // queries as badly. NORMAL synchronous is safe under WAL. busy_timeout keeps
  // brief lock contention from erroring out.
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");

  // The catalog/Browse queries sort tens of thousands of rows and spill a temp
  // b-tree doing it. The defaults put that spill on disk and cap the page cache
  // at 2MB, which on a 200MB+ database means re-reading the same pages
  // constantly. These three are the cheapest wins available on a large library:
  //   temp_store  keeps ORDER BY / GROUP BY scratch in RAM instead of a temp file
  //   cache_size  negative = KiB, so -65536 is a 64MB page cache (was ~2MB)
  //   mmap_size   maps up to 256MB of the DB, avoiding a read() per page
  db.run("PRAGMA temp_store = MEMORY");
  db.run("PRAGMA cache_size = -65536");
  db.run("PRAGMA mmap_size = 268435456");

  db.serialize(() => {
    // Table creation migrations from C#
    db.run(`
      CREATE TABLE IF NOT EXISTS games
      (
        record_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        creator TEXT NOT NULL,
        engine TEXT,
        last_played_r DATE DEFAULT 0,
        total_playtime INTEGER DEFAULT 0,
        description TEXT,
        last_played_version TEXT,
        selected_version_id INTEGER,
        UNIQUE (title, creator, engine)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS versions
      (
        record_id INTEGER REFERENCES games (record_id),
        version TEXT,
        game_path TEXT,
        exec_path TEXT,
        in_place BOOLEAN,
        last_played DATE,
        version_playtime INTEGER,
        folder_size INTEGER,
        date_added INTEGER,
        UNIQUE (record_id, version)
      );
    `);
    db.run(`
      CREATE VIEW IF NOT EXISTS last_import_times (record_id, last_import) AS
      SELECT DISTINCT record_id, versions.date_added
      FROM games
      NATURAL JOIN versions
      ORDER BY versions.date_added DESC;
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_data
      (
        atlas_id INTEGER PRIMARY KEY,
        id_name STRING,
        short_name STRING,
        title STRING,
        original_name STRING,
        category STRING,
        engine STRING,
        status STRING,
        version STRING,
        developer STRING,
        creator STRING,
        overview STRING,
        censored STRING,
        language STRING,
        translations STRING,
        genre STRING,
        tags STRING,
        voice STRING,
        os STRING,
        release_date DATE,
        length STRING,
        banner STRING,
        banner_wide STRING,
        cover STRING,
        logo STRING,
        wallpaper STRING,
        previews STRING,
        external_ids STRING,
        last_record_update STRING,
        edited INTEGER NOT NULL DEFAULT 0,
        edited_at INTEGER,
        edited_by STRING,
        removed_from_server INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_previews
      (
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        preview_url STRING NOT NULL,
        UNIQUE (atlas_id, preview_url)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_mappings
      (
        record_id INTEGER REFERENCES games (record_id) PRIMARY KEY,
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        UNIQUE (record_id, atlas_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_data
      (
        f95_id INTEGER UNIQUE PRIMARY KEY,
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        banner_url STRING,
        site_url STRING,
        last_thread_comment STRING,
        thread_updated STRING,
        thread_publish_date STRING,
        last_record_update STRING,
        views STRING,
        likes STRING,
        tags STRING,
        rating STRING,
        screens STRING,
        downloads STRING,
        patches STRING,
        extras STRING,
        translations STRING,
        replies STRING,
        f95_latest_order STRING,
        floating INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_screens
      (
        f95_id INTEGER REFERENCES f95_zone_data (f95_id),
        screen_url TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS lewdcorner_data
      (
        lc_id INTEGER UNIQUE PRIMARY KEY,
        atlas_id INTEGER REFERENCES atlas_data(atlas_id),
        banner_url STRING,
        site_url STRING,
        register_date STRING,
        thread_updated STRING,
        last_record_update STRING,
        tier STRING,
        prefixes STRING,
        views STRING,
        likes STRING,
        tags STRING,
        rating STRING,
        screens STRING,
        downloads STRING,
        floating INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS updates
      (
        update_time INTEGER PRIMARY KEY,
        processed_time INTEGER,
        md5 BLOB
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS tags
      (
        tag_id INTEGER PRIMARY KEY,
        tag TEXT UNIQUE
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS tag_mappings
      (
        record_id INTEGER REFERENCES games (record_id),
        tag_id INTEGER REFERENCES tags (tag_id),
        UNIQUE (record_id, tag_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS game_metadata_overrides
      (
        record_id INTEGER PRIMARY KEY REFERENCES games (record_id) ON DELETE CASCADE,
        os TEXT,
        publisher TEXT,
        release_date TEXT,
        status TEXT,
        category TEXT,
        latest_version TEXT,
        censored TEXT,
        language TEXT,
        translations TEXT,
        genre TEXT,
        voice TEXT,
        rating TEXT,
        overview TEXT,
        updated_at INTEGER
      );
    `);
    // atlas_tags / f95_zone_tags were created here for years but never written
    // to and never read — the only other references anywhere were two orphan
    // DELETE statements in the update path (since removed). Catalog tag data
    // lives as delimited text on atlas_data.tags / f95_zone_data.tags /
    // lewdcorner_data.tags, and USER tags live in tags + tag_mappings (written
    // by db/games.js, joined by the library queries here) — those two are live
    // and must not be touched. Dropping only the dead pair.
    db.run(`DROP TABLE IF EXISTS atlas_tags;`, () => {});
    db.run(`DROP TABLE IF EXISTS f95_zone_tags;`, () => {});
    db.run(`
      CREATE TABLE IF NOT EXISTS previews
      (
        record_id INTEGER REFERENCES games (record_id),
        path TEXT UNIQUE,
        position INTEGER DEFAULT 256,
        UNIQUE (record_id, path)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS banners
      (
        record_id INTEGER REFERENCES games (record_id),
        path TEXT UNIQUE,
        type INTEGER,
        UNIQUE (record_id, path, type)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS media_assets
      (
        record_id INTEGER REFERENCES games (record_id),
        source TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        path TEXT NOT NULL,
        original_url TEXT,
        width INTEGER,
        height INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE (record_id, source, asset_type, original_url)
      );
    `);
    // Per-URL HTTP validators so a media refresh can ask the origin "has this
    // changed?" (If-None-Match / If-Modified-Since) and skip re-downloading +
    // re-encoding when the answer is 304. When the origin sends no validators we
    // fall back to comparing content_length, then content_hash of the bytes.
    db.run(`
      CREATE TABLE IF NOT EXISTS media_source_cache
      (
        record_id INTEGER REFERENCES games (record_id),
        original_url TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        content_length INTEGER,
        content_hash TEXT,
        checked_at INTEGER,
        UNIQUE (record_id, original_url)
      );
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_media_assets_record_type ON media_assets(record_id, asset_type);`);
    db.run(`
      CREATE TABLE IF NOT EXISTS wishlist_entries
      (
        wishlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        atlas_id INTEGER,
        f95_id INTEGER,
        steam_id INTEGER,
        title TEXT NOT NULL,
        creator TEXT,
        engine TEXT,
        status TEXT,
        latest_version TEXT,
        category TEXT,
        genre TEXT,
        rating TEXT,
        tags TEXT,
        overview TEXT,
        external_ids TEXT,
        steam_url TEXT,
        lc_id INTEGER,
        preview_urls TEXT,
        site_url TEXT,
        banner_url TEXT,
        flagged_at INTEGER NOT NULL,
        note TEXT
      );
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_wishlist_entries_flagged_at ON wishlist_entries(flagged_at);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_wishlist_entries_source ON wishlist_entries(source);`);
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN category TEXT;`, () => {});
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN genre TEXT;`, () => {});
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN rating TEXT;`, () => {});
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN tags TEXT;`, () => {});
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN overview TEXT;`, () => {});
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN external_ids TEXT;`, () => {});
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN steam_url TEXT;`, () => {});
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN lc_id INTEGER;`, () => {});
    db.run(`ALTER TABLE wishlist_entries ADD COLUMN preview_urls TEXT;`, () => {});
    // User-set manual source IDs (F95 / Steam / LewdCorner) entered from the
    // game properties Mappings tab. Stored as a JSON blob on the per-game
    // override row so it survives metadata refreshes and is independent of the
    // Atlas-linked source tables. Merged over the derived mapping ids in the
    // renderer (see MappingsTab.jsx).
    db.run(`ALTER TABLE game_metadata_overrides ADD COLUMN manual_external_ids TEXT;`, () => {});
    // Records what games.title / creator / engine held BEFORE the user first
    // edited them, as a JSON map of column -> previous value.
    //
    // These three are real games columns with no override column, so there is
    // otherwise no way to know the user changed one. Comparing against the
    // source chain is not enough: Steam and GOG rarely publish an engine and
    // many Atlas records lack it, so an edited engine with no source value to
    // differ from was invisible in the properties window. Storing the previous
    // value gives real intent (no false positives when a source changes
    // upstream) and a reliable revert target that does not depend on the source
    // still having a value.
    db.run(`ALTER TABLE game_metadata_overrides ADD COLUMN base_field_originals TEXT;`, () => {});
    // User tag list, overriding the catalog tags. NULL means "not overridden"
    // and inherits from atlas_data/f95_zone_data/lewdcorner_data; an empty
    // string means "overridden to no tags", which is a different thing.
    db.run(`ALTER TABLE game_metadata_overrides ADD COLUMN tags TEXT;`, () => {});
    // Marks an atlas record that is still referenced by the user (owned or
    // wishlisted) but no longer present in the latest full snapshot. 0 = present.
    db.run(`ALTER TABLE atlas_data ADD COLUMN removed_from_server INTEGER NOT NULL DEFAULT 0;`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_removed_from_server ON atlas_data(removed_from_server);`, () => {});
    db.run(`
      CREATE TABLE IF NOT EXISTS data_change
      (
        timestamp INTEGER,
        delta INTEGER
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_mappings
      (
        record_id INTEGER REFERENCES games(record_id),
        f95_id INTEGER REFERENCES f95_zone_data(f95_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS lewdcorner_mappings
      (
        record_id INTEGER REFERENCES games(record_id),
        lc_id INTEGER REFERENCES lewdcorner_data(lc_id),
        UNIQUE(record_id, lc_id)
      );
    `);
    // `extension` holds the match KEY, and match_type says how to read it:
    // 'extension' means a bare suffix ("sh"), 'filename' means a whole file
    // name ("game.sh"). Two mappings can legitimately share the same string —
    // a Linux build with no suffix can be named "sh" — so the key covers both
    // columns. Keyed on extension alone, adding one silently replaced the
    // other via INSERT OR REPLACE.
    db.run(`
      CREATE TABLE IF NOT EXISTS emulators
      (
        extension TEXT NOT NULL,
        program_path TEXT NOT NULL,
        parameters TEXT,
        match_type TEXT NOT NULL DEFAULT 'extension',
        PRIMARY KEY (match_type, extension)
      );
    `);
    // Databases created before file-name matching existed. The ALTER errors
    // harmlessly once the column is there; widening the key needs a rebuild,
    // which migrateEmulatorsCompositeKey() does below.
    db.run(`ALTER TABLE emulators ADD COLUMN match_type TEXT NOT NULL DEFAULT 'extension';`, () => {});
    db.run(`
  CREATE TABLE IF NOT EXISTS steam_data
  (
    steam_id INTEGER PRIMARY KEY,
    atlas_id INTEGER REFERENCES atlas_data (atlas_id),
    title TEXT,
    category TEXT,
    engine TEXT,
    developer TEXT,
    publisher TEXT,
    overview TEXT,
    censored TEXT,
    language TEXT,
    translations TEXT,
    genre TEXT,
    tags TEXT,
    voice TEXT,
    os TEXT,
    release_state TEXT,
    release_date TEXT,
    header TEXT,
    library_hero TEXT,
    library_capsule TEXT,
    logo TEXT,
    last_record_update TEXT
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS steam_screens
  (
    steam_id INTEGER REFERENCES steam_data (steam_id),
    screen_url TEXT NOT NULL,
    UNIQUE (steam_id, screen_url)
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS steam_movies
  (
    steam_id INTEGER REFERENCES steam_data (steam_id),
    movie_url TEXT NOT NULL,
    thumbnail TEXT,
    name TEXT,
    UNIQUE (steam_id, movie_url)
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS steam_mappings
  (
    record_id INTEGER REFERENCES games (record_id) PRIMARY KEY,
    steam_id INTEGER REFERENCES steam_data (steam_id),
    UNIQUE (record_id, steam_id)
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS gog_data
  (
    gog_id INTEGER PRIMARY KEY,
    atlas_id INTEGER REFERENCES atlas_data (atlas_id),
    title TEXT,
    category TEXT,
    engine TEXT,
    developer TEXT,
    publisher TEXT,
    overview TEXT,
    censored TEXT,
    language TEXT,
    translations TEXT,
    genre TEXT,
    tags TEXT,
    voice TEXT,
    os TEXT,
    release_state TEXT,
    release_date TEXT,
    header TEXT,
    library_hero TEXT,
    library_capsule TEXT,
    logo TEXT,
    last_record_update TEXT,
    type STRING,
    store_url TEXT
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS gog_screens
  (
    gog_id INTEGER REFERENCES gog_data (gog_id),
    screen_url TEXT NOT NULL,
    UNIQUE (gog_id, screen_url)
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS gog_movies
  (
    gog_id INTEGER REFERENCES gog_data (gog_id),
    movie_url TEXT NOT NULL,
    thumbnail TEXT,
    name TEXT,
    provider TEXT,
    UNIQUE (gog_id, movie_url)
  );
`);
    db.run(`
  CREATE TABLE IF NOT EXISTS gog_mappings
  (
    record_id INTEGER REFERENCES games (record_id) PRIMARY KEY,
    gog_id INTEGER REFERENCES gog_data (gog_id),
    UNIQUE (record_id, gog_id)
  );
`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_gog_data_atlas_id ON gog_data(atlas_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_gog_mappings_gog_id ON gog_mappings(gog_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_versions_game_path ON versions(game_path);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_versions_record_version ON versions(record_id, version);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_mappings_atlas_id ON atlas_mappings(atlas_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_banners_record_type ON banners(record_id, type);`);

    // Search performance indexes
    db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_title ON atlas_data(title);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_short_name ON atlas_data(short_name);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_creator ON atlas_data(creator);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_f95_zone_data_atlas_id ON f95_zone_data(atlas_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_lewdcorner_data_atlas_id ON lewdcorner_data(atlas_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_lewdcorner_mappings_lc_id ON lewdcorner_mappings(lc_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_lewdcorner_mappings_record_id ON lewdcorner_mappings(record_id);`);
    // Browse/catalog query performance — getCatalogGames() joins/correlates on
    // these columns for every row in the catalog (atlas_data ⨝ steam_data,
    // plus mapping lookups to determine install state). None of these had an
    // index, forcing a full table scan per row on a 3-way UNION ALL.
    db.run(`CREATE INDEX IF NOT EXISTS idx_steam_data_atlas_id ON steam_data(atlas_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_steam_mappings_steam_id ON steam_mappings(steam_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_f95_zone_mappings_f95_id ON f95_zone_mappings(f95_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_f95_zone_mappings_record_id ON f95_zone_mappings(record_id);`);
    db.run(`ALTER TABLE games ADD COLUMN is_favorite INTEGER DEFAULT 0;`, () => {});
    db.run(`ALTER TABLE games ADD COLUMN selected_version_id INTEGER;`, () => {});
    // Timestamp when the title record was created in the user's Atlas library.
    db.run(`ALTER TABLE games ADD COLUMN date_added INTEGER;`, () => {});
    // User playstate (finished/played/dropped/on_hold/planned). Per-version on
    // the versions table; per-title override on games (null = derive from
    // versions). Separate from atlas_data.status (developer/thread status).
    db.run(`ALTER TABLE games ADD COLUMN playstate TEXT;`, () => {});
    db.run(`ALTER TABLE versions ADD COLUMN playstate TEXT;`, () => {});
    // Free-form user notes. Entirely the user's own data — unlike description,
    // there is no source value to fall back to, so notes are NOT an override and
    // live directly on the row. Title-level notes are editable in the properties
    // window (Record tab) and are where an external-library import (F95Checker's
    // per-game `notes`) lands. The per-version column is written by nothing yet;
    // it exists so per-build notes don't need a second migration later.
    // Download queue. Created here with the rest of the schema so the manager
    // can assume it exists; see db/downloads.js for the state machine.
    db.run(require('./downloads').DOWNLOADS_DDL);
    for (const indexSql of require('./downloads').DOWNLOADS_INDEXES) db.run(indexSql);
    db.run(`ALTER TABLE games ADD COLUMN notes TEXT;`, () => {});
    db.run(`ALTER TABLE versions ADD COLUMN notes TEXT;`, () => {});
    // Per-version source identity. A single title can hold versions from
    // different providers (an F95 build alongside a Steam build, etc.). `source`
    // tags where the version came from ('steam' | 'gog' | 'f95' | 'lewdcorner' |
    // 'local' | null=legacy/unknown); `source_app_id` holds the provider's id
    // for that version (the Steam appid for a steam version). This lets
    // install/launch/uninstall act on the SELECTED version's provider rather
    // than a single title-level id.
    db.run(`ALTER TABLE versions ADD COLUMN source TEXT;`, () => {});
    db.run(`ALTER TABLE versions ADD COLUMN source_app_id TEXT;`, () => {});
    db.run(`
      CREATE TABLE IF NOT EXISTS game_personal_ratings
      (
        record_id INTEGER PRIMARY KEY REFERENCES games(record_id) ON DELETE CASCADE,
        story INTEGER,
        graphics INTEGER,
        gameplay INTEGER,
        fappability INTEGER,
        updated_at INTEGER
      );
    `);

    // Rating categories added after the table shipped. Driven off
    // ratingCategories.js so the list lives in one place; ALTER TABLE ADD COLUMN
    // errors harmlessly when the column is already there, which is the same
    // idempotent pattern used for the other added columns above.
    //
    // `fappability` is intentionally left in the CREATE above and never dropped:
    // DROP COLUMN rewrites the table and destroys the data irreversibly, and the
    // column is excluded from every read, write and average, so it is inert.
    try {
      const { PERSONAL_RATING_COLUMNS } = require("./ratingCategories");
      for (const column of PERSONAL_RATING_COLUMNS) {
        db.run(
          `ALTER TABLE game_personal_ratings ADD COLUMN ${column} INTEGER;`,
          () => {},
        );
      }
    } catch (err) {
      console.error("Failed to add personal rating columns:", err.message);
    }

    // Add pre-computed normalized_title column if it doesn't exist. It is
    // populated/corrected in JS (see recomputeNormalizedTitles), NOT here — the
    // old SQL expression only stripped a few ASCII punctuation chars and did not
    // strip accents/diacritics, so it diverged from the JS import matcher
    // (normalizeSearchKey) and broke title matching for accented / non-Latin
    // titles. Keep the column + index; JS fills the values.
    db.run(`ALTER TABLE atlas_data ADD COLUMN normalized_title TEXT;`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_normalized_title ON atlas_data(normalized_title);`);

    // --- Migrations to match the refactored remote schema -----------------
    // New columns the scraper now emits. ALTER ADD COLUMN is idempotent here:
    // the callback swallows the "duplicate column" error on DBs that already
    // have them (same pattern as normalized_title above).
    db.run(`ALTER TABLE atlas_data ADD COLUMN external_ids STRING;`, () => {});
    // Human-edit tracking columns the admin tool + scraper now emit.
    db.run(`ALTER TABLE atlas_data ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;`, () => {});
    db.run(`ALTER TABLE atlas_data ADD COLUMN edited_at INTEGER;`, () => {});
    db.run(`ALTER TABLE atlas_data ADD COLUMN edited_by STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN downloads STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN patches STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN extras STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN translations STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN thread_updated STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN f95_latest_order STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN floating INTEGER NOT NULL DEFAULT 0;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN atlas_id INTEGER REFERENCES atlas_data(atlas_id);`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN banner_url STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN site_url STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN register_date STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN thread_updated STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN last_record_update STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN tier STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN prefixes STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN views STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN likes STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN tags STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN rating STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN screens STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN downloads STRING;`, () => {});
    db.run(`ALTER TABLE lewdcorner_data ADD COLUMN floating INTEGER NOT NULL DEFAULT 0;`, () => {});
    db.run(`ALTER TABLE steam_data ADD COLUMN type STRING;`, () => {});
    db.run(`ALTER TABLE steam_data ADD COLUMN library_capsule TEXT;`, () => {});
    // Steam's logo placement over the hero (JSON: {pinned,widthPct,heightPct}).
    db.run(`ALTER TABLE steam_data ADD COLUMN logo_position TEXT;`, () => {});
    db.run(`ALTER TABLE gog_data ADD COLUMN store_url TEXT;`, () => {});

    // Drop the legacy UNIQUE constraint on atlas_data.id_name. id_name is no
    // longer a key (the remote anchors on f95_id/atlas_id), and leaving it
    // UNIQUE makes INSERT OR REPLACE during an update delete an unrelated game
    // whenever two atlas rows share an id_name. SQLite can't drop an inline
    // constraint via ALTER, so rebuild the table without it — but only if the
    // old unique index is actually present.
    migrateDropAtlasIdNameUnique();
    migrateDropF95AtlasIdUnique();
    migrateEmulatorsCompositeKey();
    sweepOrphanedRecords();

    // Browse-mode index tables. Required at boot rather than lazily: the steam
    // branch of getCatalogGames probes atlas_external_steam, and a missing table
    // errors the entire query instead of degrading. Created empty here — the
    // rows are filled in by the background build (see electron/db/catalogIndex.js
    // rebuildCatalogIndex), which is what getCatalogIndexStatus().ready gates on.
    //
    // Required lazily to keep the circular dependency harmless: catalogIndex.js
    // does require('./index') at load, and by the time initializeDatabase runs,
    // this module's exports (including the `db` getter) are fully in place.
    try {
      const { CATALOG_INDEX_DDL, CATALOG_INDEX_INDEXES } = require('./catalogIndex');
      for (const ddl of CATALOG_INDEX_DDL) db.run(ddl, () => {});
      for (const ddl of CATALOG_INDEX_INDEXES) db.run(ddl, () => {});
    } catch (err) {
      console.error('Failed to create catalog index schema:', err.message);
    }

    // User collections (Steam-style groupings of local titles). Same lazy
    // require rationale as the catalog index above.
    try {
      const { COLLECTIONS_DDL, COLLECTIONS_INDEXES } = require('./collections');
      for (const ddl of COLLECTIONS_DDL) db.run(ddl, () => {});
      for (const ddl of COLLECTIONS_INDEXES) db.run(ddl, () => {});
    } catch (err) {
      console.error('Failed to create collections schema:', err.message);
    }
  });
};

// One-time-per-launch integrity sweep. Historically some deletes did not clear
// every child table, and because record_id (an INTEGER PRIMARY KEY without
// AUTOINCREMENT) can be reused by SQLite, leftover child rows could bleed into a
// later game that reused the id. This removes any child row whose record_id no
// longer exists in games. Idempotent and cheap for a local library.
function sweepOrphanedRecords() {
  const childTables = [
    "versions",
    "atlas_mappings",
    "tag_mappings",
    "game_metadata_overrides",
    "previews",
    "banners",
    "media_assets",
    "f95_zone_mappings",
    "lewdcorner_mappings",
    "steam_mappings",
    "gog_mappings",
    "game_personal_ratings",
    "collection_games",
  ];
  for (const tbl of childTables) {
    db.run(
      `DELETE FROM ${tbl}
       WHERE record_id IS NOT NULL
         AND record_id NOT IN (SELECT record_id FROM games)`,
      function (err) {
        if (err) {
          // A missing table is an expected condition, not a problem: several
          // test fixtures and older databases build only part of the schema.
          // Anything else is worth surfacing.
          if (!/no such table/i.test(err.message || "")) {
            console.warn(`Orphan sweep skipped for ${tbl}:`, err.message);
          }
        } else if (this.changes) {
          console.log(`Orphan sweep: removed ${this.changes} stale row(s) from ${tbl}`);
        }
      },
    );
  }
};

// Rebuilds atlas_data without the inline UNIQUE on id_name, preserving every
// existing column and row. Guarded so it runs at most once (after the rebuild
// the unique index is gone, so the guard fails on subsequent launches).

module.exports = {
  db: null,  // populated after initializeDatabase()
  initializeDatabase,
}

Object.defineProperty(module.exports, 'db', { get: () => db })
