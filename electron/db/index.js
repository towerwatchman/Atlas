'use strict'

const sqlite3 = require('sqlite3').verbose()
const path = require('path')
const fs = require('fs')

let db
let cachedFilterOptions = null
let atlasIdNameMigrationRan = false

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

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(`CREATE TABLE atlas_data_rebuild (${colDefs});`);
      db.run(
        `INSERT INTO atlas_data_rebuild (${colNames}) SELECT ${colNames} FROM atlas_data;`,
      );
      db.run(`DROP TABLE atlas_data;`);
      db.run(`ALTER TABLE atlas_data_rebuild RENAME TO atlas_data;`, (e) => {
        if (e) {
          db.run("ROLLBACK");
          console.error("atlas_data rebuild failed, rolled back:", e);
          return;
        }
        db.run("COMMIT", (commitErr) => {
          if (commitErr) {
            console.error("atlas_data rebuild commit failed:", commitErr);
            return;
          }
          // DROP TABLE removed its indexes; recreate them.
          db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_title ON atlas_data(title);`);
          db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_short_name ON atlas_data(short_name);`);
          db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_creator ON atlas_data(creator);`);
          db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_normalized_title ON atlas_data(normalized_title);`);
          console.log("atlas_data rebuilt without id_name UNIQUE constraint");
        });
      });
    });
  });
}

const initializeDatabase = (dataDir) => {
  const dbPath = path.join(dataDir, "data.db");
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database error:", err);
  });

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
        last_record_update STRING
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
        atlas_id INTEGER REFERENCES atlas_data (atlas_id) UNIQUE,
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
        f95_latest_order STRING
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
        downloads STRING
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
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_tags
      (
        tag_id INTEGER REFERENCES tags (tag_id),
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        UNIQUE (atlas_id, tag_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_tags
      (
        f95_id INTEGER REFERENCES f95_zone_data (f95_id),
        tag_id INTEGER REFERENCES tags (tag_id)
      );
    `);
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
    db.run(`
      CREATE TABLE IF NOT EXISTS emulators
      (
        extension TEXT PRIMARY KEY,
        program_path TEXT NOT NULL,
        parameters TEXT
      );
    `);
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
    db.run(`ALTER TABLE games ADD COLUMN is_favorite INTEGER DEFAULT 0;`, () => {});
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

    // Add pre-computed normalized_title column if it doesn't exist, then populate and index it
    db.run(`ALTER TABLE atlas_data ADD COLUMN normalized_title TEXT;`, () => {
      // Runs whether or not the column already existed — populate any nulls
      db.run(`
        UPDATE atlas_data SET normalized_title =
          UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            COALESCE(short_name, title),
            '-',''),'_',''),'/',''),'\\',''),':',''),';',''),'''',''),' ',''),'.',''))
        WHERE normalized_title IS NULL;
      `);
    });
    db.run(`CREATE INDEX IF NOT EXISTS idx_atlas_data_normalized_title ON atlas_data(normalized_title);`);

    // --- Migrations to match the refactored remote schema -----------------
    // New columns the scraper now emits. ALTER ADD COLUMN is idempotent here:
    // the callback swallows the "duplicate column" error on DBs that already
    // have them (same pattern as normalized_title above).
    db.run(`ALTER TABLE atlas_data ADD COLUMN external_ids STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN downloads STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN patches STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN extras STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN translations STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN thread_updated STRING;`, () => {});
    db.run(`ALTER TABLE f95_zone_data ADD COLUMN f95_latest_order STRING;`, () => {});
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
    db.run(`ALTER TABLE steam_data ADD COLUMN type STRING;`, () => {});
    db.run(`ALTER TABLE steam_data ADD COLUMN library_capsule TEXT;`, () => {});

    // Drop the legacy UNIQUE constraint on atlas_data.id_name. id_name is no
    // longer a key (the remote anchors on f95_id/atlas_id), and leaving it
    // UNIQUE makes INSERT OR REPLACE during an update delete an unrelated game
    // whenever two atlas rows share an id_name. SQLite can't drop an inline
    // constraint via ALTER, so rebuild the table without it — but only if the
    // old unique index is actually present.
    migrateDropAtlasIdNameUnique();
  });
};

// Rebuilds atlas_data without the inline UNIQUE on id_name, preserving every
// existing column and row. Guarded so it runs at most once (after the rebuild
// the unique index is gone, so the guard fails on subsequent launches).

module.exports = {
  db: null,  // populated after initializeDatabase()
  initializeDatabase,
}

Object.defineProperty(module.exports, 'db', { get: () => db })
