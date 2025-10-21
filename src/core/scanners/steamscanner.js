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
} = require("../../database");

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

    const game = {
      steam_id: parseInt(steamId),
      title: data.name || "",
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
      header: data.header_image || "",
      library_hero: `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_hero.jpg`,
      logo: `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_600x900.jpg`,
      last_record_update: new Date().toISOString(),
    };

    return { game, screenshots };
  } catch (error) {
    console.error(`Error fetching game data for appid ${steamId}:`, error);
    return null;
  }
}

async function insertSteamData(db, data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO steam_data (
        steam_id, atlas_id, title, category, engine, developer, publisher, overview, censored, language, translations, genre, tags, voice, os, release_state, release_date, header, library_hero, logo, last_record_update
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        data.logo,
        data.last_record_update,
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

async function getSteamLibraryFolders() {
  let steamPath;
  if (process.platform === "win32") {
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

  return libraries.length > 0 ? libraries : null;
}

async function getInstalledSteamGames() {
  const libraries = await getSteamLibraryFolders();
  if (!libraries) {
    throw new Error("No valid Steam library folders found");
  }
  const games = [];
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
            const gameData = {
              appid: appState.appid,
              name: appState.name,
              installDir: path.join(lib, "common", appState.installdir),
              size: appState.SizeOnDisk ? parseInt(appState.SizeOnDisk) : 0,
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

async function startSteamScan(db, params, event) {
  try {
    const installedGames = await getInstalledSteamGames();
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
      // Use local .acf data only
      const game = {
        title: steamGame.name,
        creator: "Unknown",
        engine: "Unknown",
        version: "Steam",
        folder: steamGame.installDir,
        executables: [{ key: "steam", value: "Launch via Steam" }],
        selectedValue: "steam",
        multipleVisible: "hidden",
        singleExecutable: "Launch via Steam",
        atlasId: "",
        f95Id: "",
        steamId: parseInt(steamGame.appid),
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
  insertSteamData,
  insertSteamScreens,
  getSteamLibraryFolders,
  getInstalledSteamGames,
  startSteamScan,
};
