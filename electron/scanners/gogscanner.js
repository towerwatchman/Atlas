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

  // Fetch both endpoints. v2 is the richer, authoritative source (real logo,
  // galaxy background, box art, templated banner + screenshots, dev/publisher,
  // tags, OS, ratings); v1 is a fallback for anything v2 lacks.
  let v1 = null;
  let v2 = null;
  try {
    const v1res = await fetch(
      `https://api.gog.com/products/${id}?expand=description,screenshots,videos,downloads&locale=en-US`,
    );
    if (v1res.ok) v1 = await v1res.json();
  } catch (e) {
    /* v1 optional */
  }
  try {
    const v2res = await fetch(`https://api.gog.com/v2/games/${id}?locale=en-US`);
    if (v2res.ok) v2 = await v2res.json();
  } catch (e) {
    /* v2 optional */
  }

  if ((!v1 || !v1.id) && !v2) {
    console.log(`No valid GOG data for product ${id}`);
    return null;
  }

  try {
    const v2Links = (v2 && v2._links) || {};
    const emb = (v2 && v2._embedded) || {};
    const product = emb.product || {};
    const productLinks = product._links || {};

    // Resolve a concrete URL from a v2 templated _links entry (href + formatters
    // list). `pick` chooses the first matching formatter from the preference
    // list, else the first formatter offered, and substitutes it into {formatter}.
    const resolveTemplated = (linkObj, preferred = []) => {
      if (!linkObj || !linkObj.href) return "";
      const href = linkObj.href;
      if (!/\{formatter\}/i.test(href)) return gogImageUrl(href);
      const formatters = Array.isArray(linkObj.formatters) ? linkObj.formatters : [];
      let chosen = preferred.find((p) => formatters.includes(p));
      if (!chosen) chosen = formatters[0];
      if (!chosen) return "";
      return gogImageUrl(href, { formatter: chosen });
    };
    // Concrete (non-templated) v2 link href.
    const linkHref = (obj) => gogImageUrl(obj && obj.href);

    // ── Description / overview (HTML) ──────────────────────────────────────
    // v2 carries description + overview at the top level; v1 nests it under
    // description.full. Prefer the richer v2 text.
    const overview =
      (v2 && (v2.description || v2.overview)) ||
      (v1 && v1.description && (v1.description.full || v1.description.lead)) ||
      "";

    // ── OS support ─────────────────────────────────────────────────────────
    let osArr = [];
    if (Array.isArray(emb.supportedOperatingSystems) && emb.supportedOperatingSystems.length) {
      osArr = emb.supportedOperatingSystems
        .map((o) => {
          const name = o && o.operatingSystem && (o.operatingSystem.versions || o.operatingSystem.name);
          return name ? String(name) : "";
        })
        .filter(Boolean);
    } else if (v1 && v1.content_system_compatibility) {
      const compat = v1.content_system_compatibility;
      if (compat.windows) osArr.push("Windows");
      if (compat.osx) osArr.push("Mac");
      if (compat.linux) osArr.push("Linux");
    }

    // ── Images ─────────────────────────────────────────────────────────────
    // Logo + background come from v2 _links when present (the "real" ones), with
    // v1 images as fallback. Header/banner is the templated product image at a
    // wide size (formatter "800"). Box art (portrait) is v2 boxArtImage.
    const v1images = (v1 && v1.images) || {};
    const v1logo = gogImageUrl(v1images.logo2x || v1images.logo);
    const v1bg = gogImageUrl(v1images.background);

    const logo = linkHref(v2Links.logo) || v1logo || "";
    const heroBg =
      linkHref(v2Links.galaxyBackgroundImage) ||
      linkHref(v2Links.backgroundImage) ||
      v1bg ||
      "";
    const boxArt = linkHref(v2Links.boxArtImage) || "";
    // Banner/header: the templated product image (wide). Use formatter "800"
    // (or the first offered) per real API shape.
    const banner =
      resolveTemplated(productLinks.image, ["800", "1600", "product_630_2x", "product_630"]) ||
      logo ||
      heroBg ||
      "";

    // ── Screenshots ────────────────────────────────────────────────────────
    // v2: _embedded.screenshots[]._links.self is templated; use the first *_2x
    // formatter (largest retina). v1 fallback: formatted_images[] concrete urls.
    let screenshots = [];
    if (Array.isArray(emb.screenshots) && emb.screenshots.length) {
      screenshots = emb.screenshots
        .map((s) => {
          const self = s && s._links && s._links.self;
          if (!self || !self.href) return "";
          const formatters = Array.isArray(self.formatters) ? self.formatters : [];
          // Prefer the first formatter whose name ends in _2x, else the largest
          // numeric, else the first.
          const twoX = formatters.find((f) => /_2x$/i.test(f));
          const numeric = formatters
            .filter((f) => /^\d+$/.test(f))
            .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))[0];
          const chosen = twoX || numeric || formatters[0];
          if (!chosen) return "";
          return gogImageUrl(self.href, { formatter: chosen });
        })
        .filter(Boolean);
    }
    if (screenshots.length === 0 && v1 && Array.isArray(v1.screenshots)) {
      const SIZE_PREF = ["ggvgl_2x", "ggvgl", "ggvgm_2x", "ggvgm", "ggvgt_2x", "ggvgt"];
      screenshots = v1.screenshots
        .map((s) => {
          if (s && Array.isArray(s.formatted_images) && s.formatted_images.length) {
            for (const size of SIZE_PREF) {
              const hit = s.formatted_images.find((fi) => fi.formatter_name === size && fi.image_url);
              if (hit) return gogImageUrl(hit.image_url);
            }
            const first = s.formatted_images.find((fi) => fi.image_url);
            if (first) return gogImageUrl(first.image_url);
          }
          const tpl = s && (s.formatter_template_url || s.url);
          if (typeof tpl === "string") return gogImageUrl(tpl, { formatter: "ggvgl_2x" });
          return "";
        })
        .filter(Boolean);
    }

    // ── Videos / trailers (YouTube) ───────────────────────────────────────
    const rawVideos =
      (Array.isArray(emb.videos) && emb.videos.length ? emb.videos : null) ||
      (v1 && Array.isArray(v1.videos) ? v1.videos : []);
    const movies = rawVideos
      .map((v) => {
        // v2 video entries expose provider + videoId (or an external url); v1
        // uses video_id/provider.
        const vid =
          v && (v.videoId || v.video_id || v.id || (v.href && (v.href.match(/[?&]v=([\w-]+)/) || [])[1]));
        if (!vid) return null;
        const provider = String(v.provider || "youtube").toLowerCase();
        if (provider !== "youtube") return null;
        return {
          url: `https://www.youtube.com/embed/${vid}`,
          thumbnail: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
          name: v.title || v.name || "",
          provider: "youtube",
          video_id: vid,
        };
      })
      .filter(Boolean);

    // ── Scalar metadata ────────────────────────────────────────────────────
    const title = (v1 && v1.title) || product.title || (v2 && v2.title) || "";
    const type =
      (v2 && (v2.productType || product.category)) || (v1 && v1.game_type) || "game";

    const developers = Array.isArray(emb.developers)
      ? emb.developers.map((d) => d && (d.name || d.title)).filter(Boolean)
      : [];
    const publishers = Array.isArray(emb.publishers)
      ? emb.publishers.map((p) => p && (p.name || p.title)).filter(Boolean)
      : emb.publisher && (emb.publisher.name || emb.publisher.title)
        ? [emb.publisher.name || emb.publisher.title]
        : [];
    const tags = Array.isArray(emb.tags)
      ? emb.tags.map((t) => t && (t.name || t.title)).filter(Boolean)
      : [];
    // GOG has no explicit "genre" list; its top-level tags/properties are the
    // closest. Prefer properties (curated) for genre, tags for the tag column.
    const properties = Array.isArray(emb.properties)
      ? emb.properties.map((p) => p && (p.name || p.title)).filter(Boolean)
      : [];
    const genre = (properties.length ? properties : tags).join(",");

    // Languages from v2 localizations (audio vs text scopes).
    let textLangs = [];
    let voiceLangs = [];
    if (Array.isArray(emb.localizations)) {
      for (const loc of emb.localizations) {
        const le = loc && loc._embedded;
        const name = le && le.language && le.language.name;
        const scope = le && le.localizationScope && le.localizationScope.type;
        if (!name) continue;
        if (scope === "audio" && !voiceLangs.includes(name)) voiceLangs.push(name);
        if (scope === "text" && !textLangs.includes(name)) textLangs.push(name);
      }
    }
    if (textLangs.length === 0 && v1 && v1.languages && typeof v1.languages === "object") {
      textLangs = Object.values(v1.languages);
    }

    // Release date: v2 product globalReleaseDate/gogReleaseDate, else v1.
    const releaseRaw =
      product.globalReleaseDate ||
      product.gogReleaseDate ||
      (v1 && v1.release_date) ||
      "";
    const release_date = String(releaseRaw).slice(0, 10);

    const inDev =
      (v2 && v2.inDevelopment && v2.inDevelopment.active) ||
      (v1 && v1.in_development && v1.in_development.active) ||
      false;

    // Real store page URL (slug-based). GOG does NOT resolve /game/{numericId};
    // it needs the slug, which v2 provides under _links.store, or v1 under
    // purchase_link / links.product_card.
    const storeUrl =
      (v2Links.store && v2Links.store.href) ||
      (v1 && v1.links && (v1.links.product_card || v1.links.purchase_link)) ||
      (v1 && v1.purchase_link) ||
      "";

    // Censored: infer from ESRB/USK adult ratings when present.
    const esrbAge = emb.esrbRating && emb.esrbRating.ageRating;
    const uskAge = emb.uskRating && emb.uskRating.ageRating;
    const censored = (esrbAge && esrbAge >= 17) || (uskAge && uskAge >= 16) ? "yes" : "no";

    console.log(
      `GOG ${id}: ${movies.length} trailer(s), ${screenshots.length} screenshot(s), banner=${banner ? "y" : "n"} hero=${heroBg ? "y" : "n"} box=${boxArt ? "y" : "n"} logo=${logo ? "y" : "n"}`,
    );

    const game = {
      gog_id: id,
      title,
      type,
      category: genre,
      engine: "",
      developer: developers.join(","),
      publisher: publishers.join(","),
      overview,
      censored,
      language: textLangs.join(","),
      translations: textLangs.join(","),
      genre,
      tags: tags.join(","),
      voice: voiceLangs.join(","),
      os: osArr.join(","),
      release_state: inDev ? "upcoming" : "released",
      release_date,
      // Best-fit mapping onto the Steam-shaped columns:
      //   header  = wide banner (templated product image)
      //   hero    = galaxy background (full-bleed key art)
      //   capsule = portrait box art
      //   logo    = transparent logo treatment
      header: banner || "",
      library_hero: heroBg || banner || "",
      library_capsule: boxArt || heroBg || logo || "",
      logo: logo || "",
      store_url: storeUrl || "",
      last_record_update: new Date().toISOString(),
    };

    return { game, screenshots, movies };
  } catch (error) {
    console.error(`Error building GOG data for product ${gogId}:`, error);
    return null;
  }
}

async function insertGogData(db, data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO gog_data (
        gog_id, atlas_id, title, category, engine, developer, publisher, overview, censored, language, translations, genre, tags, voice, os, release_state, release_date, header, library_hero, library_capsule, logo, last_record_update, type, store_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        data.store_url || null,
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
