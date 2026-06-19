const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");
const {
  searchAtlas,
  getSteamIDbyRecord,
  getBannerUrl,
  getScreensUrlList,
  downloadAndConvertBanner,
  downloadAndConvertScreens,
} = require("../db/index");

// db/index exports `db` via a getter; reading it live (rather than trusting a
// reference captured/destructured elsewhere at require time, which is null) is
// the only reliable way to get the initialized connection.
const dbIndex = require("../db/index");
const liveDb = () => dbIndex.db;

function parseVDF(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line);
  const stack = [];
  let current = {};
  let root = current;
  let currentKey = null;

  for (let line of lines) {
    if (line === "{") {
      if (currentKey) {
        stack.push({ obj: current, key: currentKey });
        current[currentKey] = {};
        current = current[currentKey];
        currentKey = null;
      }
    } else if (line === "}") {
      if (stack.length > 0) {
        const parent = stack.pop();
        current = parent.obj;
        currentKey = parent.key;
      }
    } else if (line.startsWith('"')) {
      const parts =
        line.match(/["](.*?)["]\s*["](.*?)["]/) || line.match(/["](.*?)["]/);
      if (parts) {
        if (parts.length === 3) {
          const key = parts[1];
          const value = parts[2];
          current[key] = value;
        } else if (parts.length === 2) {
          currentKey = parts[1];
          current[currentKey] = {};
        }
      } else {
        console.log(`Skipping malformed VDF line: ${line}`);
      }
    }
  }
  return root;
}

// Steam serves canonical, hashed store art from this CDN. The IStoreBrowseService
// GetItems endpoint hands back exact filenames (incl. cache-buster ?t=hash) which
// we join onto this base — no guessing, no 404s, no mislabeled logo.
const STORE_ASSET_BASE = "https://shared.fastly.steamstatic.com/store_item_assets/";

// Resolve guaranteed-existing library art for an appid via the public (keyless)
// IStoreBrowseService/GetItems endpoint — the same call the Steam store front-end
// makes. Returns { header, hero, capsule, logo } of full https URLs; any field
// may be absent. Returns {} on any failure so callers fall back to convention
// URLs. NOTE: response shape assumed from the live store API — verify against a
// real response if fields come back empty.
async function fetchStoreItemAssets(appid) {
  const id = parseInt(appid, 10);
  if (!id) return {};
  try {
    const input = {
      ids: [{ appid: id }],
      context: { language: "english", country_code: "US" },
      data_request: { include_assets: true },
    };
    const res = await fetch(
      `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(
        JSON.stringify(input),
      )}`,
    );
    const json = await res.json();
    const item =
      json &&
      json.response &&
      Array.isArray(json.response.store_items) &&
      json.response.store_items[0];
    const assets = item && item.assets;
    if (!assets || !assets.asset_url_format) return {};

    // asset_url_format looks like "steam/apps/440/${FILENAME}". Each asset field
    // (library_hero, logo, …) is just the filename (with its ?t= cache-buster).
    const build = (filename) =>
      filename
        ? STORE_ASSET_BASE +
          assets.asset_url_format.replace(/\$\{FILENAME\}|\$\{filename\}|\{filename\}/, filename)
        : "";

    const pick = (...keys) => {
      for (const k of keys) if (assets[k]) return build(assets[k]);
      return "";
    };

    return {
      header: pick("header", "library_header"),
      // Prefer the 2x (higher-res) variants when present.
      hero: pick("library_hero_2x", "library_hero"),
      capsule: pick("library_capsule_2x", "library_capsule"),
      // The genuine transparent title treatment — fixes the long-standing bug of
      // storing the portrait capsule in the logo slot.
      logo: pick("logo_2x", "logo"),
    };
  } catch (err) {
    console.error(`fetchStoreItemAssets failed for ${appid}:`, err);
    return {};
  }
}

async function getSteamGameData(steamId) {
  try {
    const steamResponse = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${steamId}`,
    );
    const steamJson = await steamResponse.json();
    if (!steamJson[steamId] || !steamJson[steamId].success) {
      console.log(`No valid data for appid ${steamId}`);
      return null;
    }
    const data = steamJson[steamId].data;

    const spyResponse = await fetch(
      `https://steamspy.com/api.php?request=appdetails&appid=${steamId}`,
    );
    const spy = await spyResponse.json();

    const langHtml = data.supported_languages || "";
    const languages = langHtml
      .replace(/<strong>\*<\/strong>/g, "*")
      .split(",")
      .map((l) => l.trim());
    const voiceLangs = languages
      .filter((l) => l.endsWith("*"))
      .map((l) => l.replace(/\*$/, "").trim());
    const textLangs = languages.map((l) => l.replace(/\*$/, "").trim());

    const osArr = [];
    if (data.platforms.windows) osArr.push("Windows");
    if (data.platforms.mac) osArr.push("Mac");
    if (data.platforms.linux) osArr.push("Linux");

    const possibleEngines = ["Unity", "Unreal Engine", "Godot", "RPG Maker"];
    const engine =
      Object.keys(spy.tags || {}).find((tag) =>
        possibleEngines.includes(tag),
      ) || "";

    const censored =
      data.required_age > 0 ||
      (data.content_descriptors &&
        data.content_descriptors.ids &&
        data.content_descriptors.ids.length > 0)
        ? "yes"
        : "no";

    const screenshots = data.screenshots
      ? data.screenshots.map((s) => s.path_full)
      : [];

    // Steam returns movie + thumbnail URLs as http://; in a packaged build the
    // renderer runs in a secure context and will silently refuse to load mixed
    // (http) content, so force https:// on every Steam-served media URL.
    const forceHttps = (u) =>
      typeof u === "string" ? u.replace(/^http:\/\//i, "https://") : u;

    // Trailers: prefer the highest-quality mp4 (broadly supported), fall back
    // to webm. Each movie carries a thumbnail and name.
    const movies = (data.movies || [])
      .map((m) => {
        const url = forceHttps(
          (m.mp4 && (m.mp4.max || m.mp4["480"])) ||
            (m.webm && (m.webm.max || m.webm["480"])) ||
            "",
        );
        return url
          ? { url, thumbnail: forceHttps(m.thumbnail || ""), name: m.name || "" }
          : null;
      })
      .filter(Boolean);

    console.log(
      `Steam ${steamId}: ${movies.length} trailer(s), ${screenshots.length} screenshot(s)`,
    );

    // Canonical, hashed library art (keyless GetItems). Falls back to buildable
    // convention URLs on the live fastly CDN (NOT the dead akamaihd host).
    const assets = await fetchStoreItemAssets(steamId);
    const conventionAsset = (file) =>
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/${file}`;

    const game = {
      steam_id: parseInt(steamId),
      title: data.name || "",
      type: data.type || "",
      category: data.categories
        ? data.categories.map((c) => c.description).join(",")
        : "",
      engine: engine,
      developer: data.developers ? data.developers.join(",") : "",
      publisher: data.publishers ? data.publishers.join(",") : "",
      overview: data.detailed_description || "",
      censored: censored,
      language: textLangs.join(","),
      translations: textLangs.join(","),
      genre: data.genres ? data.genres.map((g) => g.description).join(",") : "",
      tags: spy.tags ? Object.keys(spy.tags).join(",") : "",
      voice: voiceLangs.join(","),
      os: osArr.join(","),
      release_state: data.release_date.coming_soon ? "upcoming" : "released",
      release_date: data.release_date.date || "",
      header: assets.header || data.header_image || conventionAsset("header.jpg"),
      library_hero: assets.hero || conventionAsset("library_hero.jpg"),
      // Portrait grid art (600x900) now lives in its own column.
      library_capsule: assets.capsule || conventionAsset("library_600x900.jpg"),
      // The transparent logo — the real one from GetItems, with a convention
      // fallback. (Previously this column wrongly held the portrait capsule.)
      logo: assets.logo || conventionAsset("logo.png"),
      last_record_update: new Date().toISOString(),
    };

    return { game, screenshots, movies };
  } catch (error) {
    console.error(`Error fetching game data for appid ${steamId}:`, error);
    return null;
  }
}

async function insertSteamData(db, data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO steam_data (
        steam_id, atlas_id, title, category, engine, developer, publisher, overview, censored, language, translations, genre, tags, voice, os, release_state, release_date, header, library_hero, library_capsule, logo, last_record_update, type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.steam_id,
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

async function insertSteamScreens(db, steamId, screens) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO steam_screens (steam_id, screen_url) VALUES (?, ?)`,
      );
      for (const url of screens) {
        stmt.run([steamId, url]);
      }
      stmt.finalize();
      db.run("COMMIT", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function insertSteamMovies(db, steamId, movies) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Defensive: older DBs created before the steam_movies migration shipped
      // may not have this table. Screenshots are inserted just before movies, so
      // without this a "no such table" error would silently drop every trailer
      // while screenshots still landed — exactly the "screens but no trailers"
      // symptom. CREATE IF NOT EXISTS is a no-op once the migration has run.
      db.run(`
        CREATE TABLE IF NOT EXISTS steam_movies (
          steam_id INTEGER REFERENCES steam_data (steam_id),
          movie_url TEXT NOT NULL,
          thumbnail TEXT,
          name TEXT,
          UNIQUE (steam_id, movie_url)
        )
      `);
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO steam_movies (steam_id, movie_url, thumbnail, name) VALUES (?, ?, ?, ?)`,
      );
      for (const movie of movies) {
        stmt.run([steamId, movie.url, movie.thumbnail || "", movie.name || ""]);
      }
      stmt.finalize();
      db.run("COMMIT", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function getSteamLibraryFolders(overridePath = null) {
  let steamPath;
  if (overridePath) {
    // The user may point us at the Steam root or directly at a steamapps
    // folder; normalize either into the Steam root.
    steamPath =
      path.basename(overridePath).toLowerCase() === "steamapps"
        ? path.dirname(overridePath)
        : overridePath;
  } else if (process.platform === "win32") {
    steamPath = path.join("C:", "Program Files (x86)", "Steam");
  } else if (process.platform === "darwin") {
    steamPath = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Steam",
    );
  } else if (process.platform === "linux") {
    steamPath = path.join(os.homedir(), ".steam", "steam");
  }
  const libraries = [];

  console.log(`Checking default Steam path: ${steamPath}`);
  if (fs.existsSync(steamPath)) {
    const vdfPath = path.join(steamPath, "steamapps", "libraryfolders.vdf");
    console.log(`Checking libraryfolders.vdf: ${vdfPath}`);
    if (fs.existsSync(vdfPath)) {
      const vdfContent = await fsPromises.readFile(vdfPath, "utf8");
      libraries.push(path.join(steamPath, "steamapps"));
      const parsed = parseVDF(vdfContent);
      console.log(
        "Parsed libraryfolders.vdf:",
        JSON.stringify(parsed, null, 2),
      );
      for (let key in parsed.libraryfolders) {
        if (!isNaN(parseInt(key))) {
          const lib = parsed.libraryfolders[key];
          if (lib.path) {
            const libPath = path.join(
              lib.path.replace(/\\\\/g, "\\"),
              "steamapps",
            );
            console.log(`Checking additional library path: ${libPath}`);
            if (fs.existsSync(libPath)) {
              libraries.push(libPath);
            } else {
              console.log(`Skipping invalid library path: ${libPath}`);
            }
          }
        }
      }
    } else {
      console.log(`libraryfolders.vdf not found at: ${vdfPath}`);
    }
  } else {
    console.log(`Default Steam path not found: ${steamPath}`);
  }

  // Modern Steam lists the default library inside libraryfolders.vdf as well,
  // so the default steamapps folder gets added both explicitly and again from
  // the VDF loop. De-duplicate by normalized absolute path so each library
  // (and therefore each game) is only scanned once.
  const uniqueLibraries = [];
  const seenLibraries = new Set();
  for (const lib of libraries) {
    const key = path.normalize(lib).toLowerCase();
    if (seenLibraries.has(key)) continue;
    seenLibraries.add(key);
    uniqueLibraries.push(lib);
  }

  return uniqueLibraries.length > 0 ? uniqueLibraries : null;
}

async function getInstalledSteamGames(overridePath = null) {
  const libraries = await getSteamLibraryFolders(overridePath);
  if (!libraries) {
    throw new Error("No valid Steam library folders found");
  }
  const games = [];
  const seenAppIds = new Set();
  for (const lib of libraries) {
    try {
      console.log(`Scanning library: ${lib}`);
      const files = await fsPromises.readdir(lib);
      for (const file of files) {
        if (file.startsWith("appmanifest_") && file.endsWith(".acf")) {
          const acfPath = path.join(lib, file);
          console.log(`Reading .acf file: ${acfPath}`);
          const acfContent = await fsPromises.readFile(acfPath, "utf8");
          const parsed = parseVDF(acfContent);
          console.log(
            `Parsed .acf content for ${file}:`,
            JSON.stringify(parsed, null, 2),
          );
          const appState = parsed.AppState;
          if (
            appState &&
            appState.appid &&
            appState.name &&
            appState.installdir
          ) {
            if (seenAppIds.has(appState.appid)) {
              console.log(`Skipping duplicate appid ${appState.appid}`);
              continue;
            }
            seenAppIds.add(appState.appid);
            const gameData = {
              appid: appState.appid,
              name: appState.name,
              installDir: path.join(lib, "common", appState.installdir),
              size: appState.SizeOnDisk ? parseInt(appState.SizeOnDisk) : 0,
              buildId: appState.buildid ? String(appState.buildid) : "",
            };
            console.log(`Adding game: ${JSON.stringify(gameData)}`);
            games.push(gameData);
          } else {
            console.log(
              `Skipping invalid .acf file ${file}: missing required fields`,
            );
          }
        }
      }
    } catch (err) {
      console.log(`Error reading library ${lib}:`, err.message);
      continue;
    }
  }
  console.log(`Found ${games.length} Steam games`);
  return games;
}

// Steam metadata is fetched lazily (at import time, in the background) rather
// than during the scan, so the scan never blocks on the network.

// Read a cached steam_data row so repeat scans don't re-hit the network.
function getCachedSteamData(db, steamId) {
  const database = db || liveDb();
  return new Promise((resolve) => {
    if (!database) {
      resolve(null);
      return;
    }
    database.get(
      `SELECT steam_id, title, developer, publisher, engine, type, header
       FROM steam_data WHERE steam_id = ?`,
      [steamId],
      (err, row) => resolve(err ? null : row || null),
    );
  });
}

// Fetch fresh metadata from the Steam store API and persist it (steam_data +
// screenshots). Returns the normalized game object, or null on failure.
async function fetchAndStoreSteamData(db, steamId) {
  const database = db || liveDb();
  const result = await getSteamGameData(steamId);
  if (!result) return null;
  try {
    if (database) {
      await insertSteamData(database, result.game);
      if (result.screenshots && result.screenshots.length > 0) {
        await insertSteamScreens(
          database,
          parseInt(steamId, 10),
          result.screenshots,
        );
      }
      if (result.movies && result.movies.length > 0) {
        await insertSteamMovies(
          database,
          parseInt(steamId, 10),
          result.movies,
        );
      }
    }
  } catch (err) {
    console.error(`Failed to persist steam_data for ${steamId}:`, err);
  }
  return result.game;
}

// Best-effort title -> appid lookup via the public store search endpoint. Used
// for cross-source matching (e.g. an f95 game that also has a Steam release).
async function findSteamId(title, developer = "") {
  const term = String(title || "").trim();
  if (!term) return null;
  try {
    const res = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
        term,
      )}&cc=us&l=en`,
    );
    const json = await res.json();
    const items = (json && json.items) || [];
    if (items.length === 0) return null;

    // Prefer an exact (case-insensitive) title match, else the first result.
    const norm = (s) => String(s || "").trim().toLowerCase();
    const exact = items.find((i) => norm(i.name) === norm(term));
    const chosen = exact || items[0];
    return chosen && chosen.id ? parseInt(chosen.id, 10) : null;
  } catch (err) {
    console.error(`findSteamId failed for "${title}":`, err);
    return null;
  }
}

async function startSteamScan(db, params, event) {
  try {
    const overridePath = params?.steamPath || null;
    const installedGames = await getInstalledSteamGames(overridePath);
    if (!installedGames || installedGames.length === 0) {
      console.log("No Steam games found, sending prompt for directory");
      event.sender.send("prompt-steam-directory");
      return { success: false, error: "No Steam games found, prompting user" };
    }

    const gamesList = [];
    let value = 0;
    const total = installedGames.length;
    let potential = 0;
    event.sender.send("scan-progress", { value, total, potential });

    for (const steamGame of installedGames) {
      const appId = parseInt(steamGame.appid, 10);

      // Cache-only during the scan: never hit the network here. Games already
      // in steam_data (from a prior import/scan) show full metadata instantly;
      // unknown games fall back to their .acf name and are enriched in the
      // background at import time.
      const meta = await getCachedSteamData(db, appId);

      const game = {
        title: (meta && meta.title) || steamGame.name,
        creator:
          (meta && meta.developer) || (meta && meta.publisher) || "Unknown",
        engine: (meta && meta.engine) || "Unknown",
        // Label the version with the .acf buildid when present so successive
        // Steam builds are distinguishable; fall back to a plain "Steam" label.
        // (Dedup/merge resolves by appid, not this label, so the format is safe
        // to vary — see getImportRecordStatus.)
        version: steamGame.buildId ? `Steam build ${steamGame.buildId}` : "Steam",
        steamType: (meta && meta.type) || "game",
        sourceType: "steam",
        folder: steamGame.installDir,
        executables: [{ key: "steam", value: "Launch via Steam" }],
        selectedValue: "steam",
        multipleVisible: "hidden",
        singleExecutable: "Launch via Steam",
        atlasId: "",
        f95Id: "",
        steamId: appId,
        steamUrl: `https://store.steampowered.com/app/${appId}/`,
        folderSize: steamGame.size,
        results: [
          { key: "match", value: "No match found - Added as Steam game" },
        ],
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
    console.error("Steam scan error:", error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getSteamGameData,
  fetchAndStoreSteamData,
  fetchStoreItemAssets,
  findSteamId,
  insertSteamData,
  insertSteamScreens,
  insertSteamMovies,
  getSteamLibraryFolders,
  getInstalledSteamGames,
  startSteamScan,
};
