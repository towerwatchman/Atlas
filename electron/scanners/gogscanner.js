const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

// db/index exports `db` via a getter; read it live rather than trusting a
// reference captured at require time (which is null before init).
const dbIndex = require("../db/index");
const liveDb = () => dbIndex.db;

const { findExecutables } = require("./executableScanner");

// ── GOG image CDN ────────────────────────────────────────────────────────────
//
// GOG serves per-product art from images.gog-statics.com as protocol-relative
// template urls. The API hands back a template id; the caller appends a size
// suffix. Unlike Steam there is no hero/logo/capsule split — GOG exposes:
//   logo, background, galaxyBackground, boxArtImage, icon
// We best-fit map these onto Atlas's Steam-shaped columns:
//   background      -> library_hero   (tall key-art behind the details header)
//   logo            -> logo           (title treatment / wide capsule fallback)
//   boxArtImage     -> library_capsule (portrait grid art)
//   logo|background -> header          (wide banner)
const GOG_IMAGE_BASE = "https://images.gog-statics.com/";

// Normalize a GOG image template/url into a concrete https url at the given
// size suffix. GOG templates arrive as either a bare hash, a protocol-relative
// "//images..." url, or a full url; and may or may not already carry a suffix.
// Normalize any GOG image reference into a concrete, loadable https URL.
// GOG hands back images in several shapes across its endpoints:
//   1. Protocol-relative concrete file:  //images.gog-statics.com/<hash>.jpg
//   2. Protocol-relative with size stub:  //images.gog-statics.com/<hash>_glx_logo_2x.jpg
//   3. Bare hash (no scheme, no ext):     <hash>
//   4. Formatter template:                //images.gog.com/<hash>_{formatter}.jpg
//      or with .{ext}:                    //images.gog.com/<hash>.{formatter}
// `formatter` is the concrete size token to substitute into {formatter} for
// template URLs (screenshots use this); `suffix` is appended to a bare hash.
function gogImageUrl(template, { suffix = "", formatter = "" } = {}) {
  if (!template) return "";
  let value = String(template).trim();
  if (!value) return "";

  // Protocol-relative -> https
  if (value.startsWith("//")) value = "https:" + value;
  // Bare hash (no scheme, no slash) -> build a CDN url and append the size suffix
  else if (!/^https?:\/\//i.test(value)) {
    value = GOG_IMAGE_BASE + value.replace(/^\/+/, "");
    if (suffix && !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(value)) {
      value = value.replace(/(_\d+)?$/, "") + suffix;
    }
  }

  // Force https for mixed-content safety in the packaged renderer.
  value = value.replace(/^http:\/\//i, "https://");

  // Substitute the {formatter} / .{formatter} / {ext} placeholders GOG uses in
  // its screenshot/formatter_template_url form. Without this the raw literal
  // "{formatter}" ends up in the URL and the image 404s.
  if (formatter) {
    value = value
      .replace(/\{formatter\}/gi, formatter)
      .replace(/\{ext\}/gi, "jpg");
  } else {
    // No formatter given but the template still has a placeholder — pick a sane
    // default so the URL at least resolves rather than shipping "{formatter}".
    value = value
      .replace(/\{formatter\}/gi, "ggvgm_2x")
      .replace(/\{ext\}/gi, "jpg");
  }

  return value;
}

// ── GOG store/product API ────────────────────────────────────────────────────
//
// api.gog.com/products/{id}?expand=description,screenshots,videos gives the
// bulk of what we need. v2/games/{id} is richer for embedded images. We hit the
// v1 products endpoint (stable, keyless) and fall back gracefully.
async function getGogGameData(gogId) {
  const id = parseInt(gogId, 10);
  if (!id) return null;
  try {
    const res = await fetch(
      `https://api.gog.com/products/${id}?expand=description,screenshots,videos,downloads&locale=en-US`,
    );
    if (!res.ok) {
      console.log(`No valid GOG data for product ${id} (HTTP ${res.status})`);
      return null;
    }
    const data = await res.json();
    if (!data || !data.id) {
      console.log(`No valid GOG data for product ${id}`);
      return null;
    }

    // Description: GOG returns HTML in description.full / description.lead.
    const overview =
      (data.description && (data.description.full || data.description.lead)) || "";

    // OS support from content_system_compatibility.
    const compat = data.content_system_compatibility || {};
    const osArr = [];
    if (compat.windows) osArr.push("Windows");
    if (compat.osx) osArr.push("Mac");
    if (compat.linux) osArr.push("Linux");

    // Screenshots: array of { image_id, formatter_template_url } or template
    // strings depending on API shape. Normalize to concrete urls.
    const screenshots = Array.isArray(data.screenshots)
      ? data.screenshots
          .map((s) => {
            const tpl =
              (s && (s.formatter_template_url || s.image_id || s.url)) || s;
            if (typeof tpl !== "string") return "";
            // Screenshots come as a formatter_template_url with a {formatter}
            // placeholder — substitute a large concrete size.
            return gogImageUrl(tpl, { formatter: "ggvgm_2x" });
          })
          .filter(Boolean)
      : [];

    // Videos: GOG returns YouTube video ids under videos[].video_id (provider
    // "youtube"). Store the embed url + thumbnail so the lightbox can play them
    // inline via an <iframe>.
    const movies = Array.isArray(data.videos)
      ? data.videos
          .map((v) => {
            const vid = v && (v.video_id || v.id);
            if (!vid) return null;
            const provider = String(v.provider || "youtube").toLowerCase();
            if (provider !== "youtube") return null;
            return {
              url: `https://www.youtube.com/embed/${vid}`,
              thumbnail: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
              name: v.title || "",
              provider: "youtube",
              video_id: vid,
            };
          })
          .filter(Boolean)
      : [];

    // Images: v1 products has data.images { background, logo, logo2x, icon,
    // sidebarIcon, ... } as protocol-relative urls.
    const images = data.images || {};
    const background = gogImageUrl(images.background, { suffix: "_bg_crop_1920x655.jpg" });
    const logo = gogImageUrl(images.logo2x || images.logo, { suffix: "_glx_logo_2x.jpg" });
    const boxArt = gogImageUrl(images.boxArtImage || images.logo2x || images.logo, { suffix: "_glx_logo_2x.jpg" });

    console.log(
      `GOG ${id}: ${movies.length} trailer(s), ${screenshots.length} screenshot(s)`,
    );

    const game = {
      gog_id: id,
      title: data.title || "",
      type: data.game_type || data.product_type || "game",
      category: "",
      engine: "",
      developer: "", // v1 products omits dev/pub; enriched via v2 below if present
      publisher: "",
      overview,
      censored: "no",
      language: "",
      translations: "",
      genre: "",
      tags: "",
      voice: "",
      os: osArr.join(","),
      release_state: data.in_development && data.in_development.active ? "upcoming" : "released",
      release_date: (data.release_date || "").slice(0, 10) || "",
      // Best-fit image mapping (see header comment).
      header: logo || background || "",
      library_hero: background || "",
      library_capsule: boxArt || "",
      logo: logo || "",
      last_record_update: new Date().toISOString(),
    };

    // Best-effort enrichment from the v2 games endpoint (developers/publishers).
    try {
      const v2res = await fetch(`https://api.gog.com/v2/games/${id}?locale=en-US`);
      if (v2res.ok) {
        const v2 = await v2res.json();
        const emb = v2._embedded || {};
        if (Array.isArray(emb.developers))
          game.developer = emb.developers.map((d) => d.name).filter(Boolean).join(",");
        if (Array.isArray(emb.publisher ? [emb.publisher] : emb.publishers))
          game.publisher = (emb.publisher ? [emb.publisher] : emb.publishers)
            .map((p) => p.name).filter(Boolean).join(",");
        if (Array.isArray(emb.genres))
          game.genre = emb.genres.map((g) => g.name).filter(Boolean).join(",");
        if (Array.isArray(emb.tags))
          game.tags = emb.tags.map((t) => t.name).filter(Boolean).join(",");
        if (Array.isArray(emb.supportedOperatingSystems) && !game.os)
          game.os = emb.supportedOperatingSystems
            .map((o) => o.operatingSystem && o.operatingSystem.name).filter(Boolean).join(",");
      }
    } catch (e) {
      /* v2 enrichment is optional */
    }

    return { game, screenshots, movies };
  } catch (error) {
    console.error(`Error fetching GOG data for product ${gogId}:`, error);
    return null;
  }
}

async function insertGogData(db, data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO gog_data (
        gog_id, atlas_id, title, category, engine, developer, publisher, overview, censored, language, translations, genre, tags, voice, os, release_state, release_date, header, library_hero, library_capsule, logo, last_record_update, type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.gog_id,
        data.atlas_id || null,
        data.title,
        data.category,
        data.engine,
        data.developer,
        data.publisher,
        data.overview,
        data.censored,
        data.language,
        data.translations,
        data.genre,
        data.tags,
        data.voice,
        data.os,
        data.release_state,
        data.release_date,
        data.header,
        data.library_hero,
        data.library_capsule || null,
        data.logo,
        data.last_record_update,
        data.type || "",
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

async function insertGogScreens(db, gogId, screens) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO gog_screens (gog_id, screen_url) VALUES (?, ?)`,
      );
      for (const url of screens) stmt.run([gogId, url]);
      stmt.finalize();
      db.run("COMMIT", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function insertGogMovies(db, gogId, movies) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Defensive create for DBs predating the gog_movies migration.
      db.run(`
        CREATE TABLE IF NOT EXISTS gog_movies (
          gog_id INTEGER REFERENCES gog_data (gog_id),
          movie_url TEXT NOT NULL,
          thumbnail TEXT,
          name TEXT,
          provider TEXT,
          UNIQUE (gog_id, movie_url)
        )
      `);
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO gog_movies (gog_id, movie_url, thumbnail, name, provider) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const m of movies) {
        stmt.run([gogId, m.url, m.thumbnail || "", m.name || "", m.provider || "youtube"]);
      }
      stmt.finalize();
      db.run("COMMIT", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// ── Local install scanning ───────────────────────────────────────────────────
//
// Two strategies, merged and de-duped on gog product id:
//   1. GOG Galaxy's SQLite database (galaxy-2.0.db) — Galaxy-managed installs.
//   2. goggame-<id>.info JSON dropped into each install dir — covers standalone
//      (offline installer) games Galaxy doesn't know about.

function galaxyDbPath(overridePath = null) {
  if (overridePath) {
    return path.basename(overridePath).toLowerCase() === "galaxy-2.0.db"
      ? overridePath
      : path.join(overridePath, "galaxy-2.0.db");
  }
  if (process.platform === "win32") {
    return path.join("C:", "ProgramData", "GOG.com", "Galaxy", "storage", "galaxy-2.0.db");
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(), "Library", "Application Support", "GOG.com", "Galaxy", "storage", "galaxy-2.0.db",
    );
  }
  return path.join(os.homedir(), ".config", "GOG.com", "Galaxy", "storage", "galaxy-2.0.db");
}

// Read installed games out of galaxy-2.0.db. Opens a throwaway read-only
// connection so it never touches Atlas's own db handle. Best-effort: any schema
// drift or lock just yields [].
async function getGalaxyInstalledGames(overridePath = null) {
  const dbPath = galaxyDbPath(overridePath);
  if (!fs.existsSync(dbPath)) {
    console.log(`GOG Galaxy DB not found: ${dbPath}`);
    return [];
  }
  let sqlite3;
  try {
    sqlite3 = require("sqlite3");
  } catch {
    console.log("sqlite3 unavailable; skipping Galaxy DB scan");
    return [];
  }
  return new Promise((resolve) => {
    const conn = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.log(`Cannot open Galaxy DB: ${err.message}`);
        resolve([]);
      }
    });
    // InstalledBaseProducts holds productId; LimitedDetails carries the title;
    // InstalledBaseProductsDetails / GamePieces carry install path in various
    // Galaxy versions. We keep the query defensive and fall back to id-as-name.
    const sql = `
      SELECT ibp.productId AS productId,
             ld.title      AS title,
             ip.installationPath AS installPath
      FROM InstalledBaseProducts ibp
      LEFT JOIN LimitedDetails ld ON ld.productId = ibp.productId
      LEFT JOIN ProductsToReleaseKeys ptr ON ptr.gogId = ibp.productId
      LEFT JOIN InstalledProducts ip ON ip.productId = ibp.productId
    `;
    conn.all(sql, [], (err, rows) => {
      conn.close();
      if (err) {
        console.log(`Galaxy DB query failed: ${err.message}`);
        resolve([]);
        return;
      }
      const games = (rows || [])
        .filter((r) => r && r.productId)
        .map((r) => ({
          gogId: String(r.productId),
          name: r.title || `GOG ${r.productId}`,
          installDir: r.installPath || "",
          size: 0,
          source: "galaxy",
        }));
      console.log(`Galaxy DB: ${games.length} installed game(s)`);
      resolve(games);
    });
  });
}

// Default roots to walk for goggame-<id>.info files.
function defaultGogInstallRoots() {
  if (process.platform === "win32") {
    return ["C:\\GOG Games", "C:\\Program Files (x86)\\GOG Galaxy\\Games", "C:\\Program Files\\GOG Galaxy\\Games"];
  }
  if (process.platform === "darwin") {
    return [path.join(os.homedir(), "GOG Games")];
  }
  return [path.join(os.homedir(), "GOG Games"), path.join(os.homedir(), "Games")];
}

// Recursively (shallow, 2 levels) find goggame-<id>.info files and parse them.
async function getInfoFileGames(overridePath = null) {
  const roots = overridePath ? [overridePath] : defaultGogInstallRoots();
  const games = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let topEntries;
    try {
      topEntries = await fsPromises.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue;
      const gameDir = path.join(root, entry.name);
      let files;
      try {
        files = await fsPromises.readdir(gameDir);
      } catch {
        continue;
      }
      const info = files.find((f) => /^goggame-\d+\.info$/i.test(f));
      if (!info) continue;
      try {
        const raw = await fsPromises.readFile(path.join(gameDir, info), "utf8");
        const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
        const gogId = String(parsed.gameId || info.match(/goggame-(\d+)\.info/i)[1]);
        // The .info file lists launch tasks; the primary one (isPrimary) carries
        // the relative path to the game's main executable. Prefer it so imported
        // GOG games get a real, runnable exe rather than only the Galaxy handoff.
        let primaryExe = "";
        if (Array.isArray(parsed.playTasks)) {
          const primary =
            parsed.playTasks.find((t) => t && t.isPrimary && t.path) ||
            parsed.playTasks.find((t) => t && t.path);
          if (primary && primary.path) primaryExe = String(primary.path);
        }
        games.push({
          gogId,
          name: parsed.name || entry.name,
          installDir: gameDir,
          primaryExe,
          size: 0,
          source: "info",
        });
      } catch (e) {
        console.log(`Skipping malformed ${info}: ${e.message}`);
      }
    }
  }
  console.log(`goggame-*.info: ${games.length} installed game(s)`);
  return games;
}

// Merge both strategies, de-duped on gog product id. Galaxy rows win on
// conflict (they carry the canonical title) but an info-file install path
// backfills a missing Galaxy path.
async function getInstalledGogGames(overridePath = null) {
  const [galaxy, info] = await Promise.all([
    getGalaxyInstalledGames(overridePath),
    getInfoFileGames(overridePath),
  ]);
  const byId = new Map();
  for (const g of [...galaxy, ...info]) {
    const existing = byId.get(g.gogId);
    if (!existing) {
      byId.set(g.gogId, g);
    } else {
      if (!existing.installDir && g.installDir) existing.installDir = g.installDir;
      if (!existing.primaryExe && g.primaryExe) existing.primaryExe = g.primaryExe;
    }
  }
  const merged = [...byId.values()];
  console.log(`Found ${merged.length} GOG games (merged)`);
  return merged;
}

// Cache-only read during scan so repeat scans don't re-hit the network.
function getCachedGogData(db, gogId) {
  const database = db || liveDb();
  return new Promise((resolve) => {
    if (!database) {
      resolve(null);
      return;
    }
    database.get(
      `SELECT gog_id, title, developer, publisher, engine, type, header
       FROM gog_data WHERE gog_id = ?`,
      [gogId],
      (err, row) => resolve(err ? null : row || null),
    );
  });
}

// Fetch fresh metadata from the GOG API and persist it. Returns the normalized
// game object, or null on failure.
async function fetchAndStoreGogData(db, gogId) {
  const database = db || liveDb();
  const result = await getGogGameData(gogId);
  if (!result) return null;
  try {
    if (database) {
      await insertGogData(database, result.game);
      if (result.screenshots && result.screenshots.length > 0) {
        await insertGogScreens(database, parseInt(gogId, 10), result.screenshots);
      }
      if (result.movies && result.movies.length > 0) {
        await insertGogMovies(database, parseInt(gogId, 10), result.movies);
      }
    }
  } catch (err) {
    console.error(`Failed to persist gog_data for ${gogId}:`, err);
  }
  return result.game;
}

// Best-effort title -> product id lookup via GOG's store search. Used for
// cross-source matching (e.g. an f95 game that also has a GOG release).
async function findGogId(title) {
  const term = String(title || "").trim();
  if (!term) return null;
  try {
    const res = await fetch(
      `https://embed.gog.com/games/ajax/filtered?mediaType=game&search=${encodeURIComponent(term)}`,
    );
    const json = await res.json();
    const products = (json && json.products) || [];
    if (products.length === 0) return null;
    const norm = (s) => String(s || "").trim().toLowerCase();
    const exact = products.find((p) => norm(p.title) === norm(term));
    const chosen = exact || products[0];
    return chosen && chosen.id ? parseInt(chosen.id, 10) : null;
  } catch (err) {
    console.error(`findGogId failed for "${title}":`, err);
    return null;
  }
}

async function startGogScan(db, params, event) {
  try {
    const overridePath = params?.gogPath || null;
    const installedGames = await getInstalledGogGames(overridePath);
    if (!installedGames || installedGames.length === 0) {
      console.log("No GOG games found, sending prompt for directory");
      event.sender.send("prompt-gog-directory");
      return { success: false, error: "No GOG games found, prompting user" };
    }

    const gamesList = [];
    let value = 0;
    const total = installedGames.length;
    let potential = 0;
    event.sender.send("scan-progress", { value, total, potential });

    for (const gogGame of installedGames) {
      const gogId = parseInt(gogGame.gogId, 10);
      // Cache-only during scan; enrichment happens at import time.
      const meta = await getCachedGogData(db, gogId);

      // Resolve a real executable so the imported game runs directly (falling
      // back to the Galaxy protocol handoff at launch time if none is found).
      // Prefer the primary play-task path from goggame-*.info; otherwise scan
      // the install dir for a .exe.
      let relativeExec = "";
      let execPath = "";
      const installDir = gogGame.installDir || "";
      if (installDir) {
        if (gogGame.primaryExe) {
          const candidate = path.isAbsolute(gogGame.primaryExe)
            ? gogGame.primaryExe
            : path.join(installDir, gogGame.primaryExe);
          if (fs.existsSync(candidate)) {
            execPath = candidate;
            relativeExec = path.relative(installDir, candidate);
          }
        }
        if (!execPath) {
          try {
            const found = findExecutables(installDir, ["exe"]);
            if (found && found.length > 0) {
              relativeExec = found[0];
              execPath = path.join(installDir, found[0]);
            }
          } catch (e) {
            /* dir may be unreadable; fall back to Galaxy launch */
          }
        }
      }

      const executables = execPath
        ? [{ key: relativeExec, value: relativeExec }]
        : [{ key: "gog", value: "Launch via GOG" }];

      const game = {
        title: (meta && meta.title) || gogGame.name,
        creator: (meta && meta.developer) || (meta && meta.publisher) || "Unknown",
        engine: (meta && meta.engine) || "Unknown",
        version: "GOG",
        gogType: (meta && meta.type) || "game",
        sourceType: "gog",
        folder: installDir,
        execPath,
        exec_path: execPath,
        executables,
        selectedValue: execPath ? relativeExec : "gog",
        multipleVisible: "hidden",
        singleExecutable: execPath ? relativeExec : "Launch via GOG",
        atlasId: "",
        f95Id: "",
        gogId,
        gogUrl: `https://www.gog.com/game/${gogId}`,
        folderSize: gogGame.size,
        results: [{ key: "match", value: "No match found - Added as GOG game" }],
        resultVisibility: "hidden",
        resultSelectedValue: "match",
      };
      gamesList.push(game);
      event.sender.send("scan-complete", game);
      value++;
      potential++;
      event.sender.send("scan-progress", { value, total, potential });
    }
    event.sender.send("scan-complete-final", gamesList);
    return { success: true };
  } catch (error) {
    console.error("GOG scan error:", error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  gogImageUrl,
  getGogGameData,
  fetchAndStoreGogData,
  findGogId,
  insertGogData,
  insertGogScreens,
  insertGogMovies,
  getGalaxyInstalledGames,
  getInfoFileGames,
  getInstalledGogGames,
  startGogScan,
};
