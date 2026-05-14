const fs = require("fs");
const path = require("path");
const { searchAtlas, findF95Id, checkRecordExist } = require("../../database");

const engineMap = {
  rpgm: [
    "rpgmv.exe",
    "rpgmk.exe",
    "rpgvx.exe",
    "rpgvxace.exe",
    "rpgmktranspatch.exe",
  ],
  renpy: ["renpy.exe", "renpy.sh"],
  unity: ["unityplayer.dll"],
  html: ["index.html"],
  flash: [".swf"],
};

const blacklist = [
  "UnityCrashHandler64.exe",
  "UnityCrashHandler32.exe",
  "payload.exe",
  "nwjc.exe",
  "notification_helper.exe",
  "nacl64.exe",
  "chromedriver.exe",
  "Squirrel.exe",
  "zsync.exe",
  "zsyncmake.exe",
  "cmake.exe",
  "pythonw.exe",
  "python.exe",
  "dxwebsetup.exe",
  "README.html",
  "manual.htm",
  "unins000.exe",
  "UE4PrereqSetup_X64.exe",
  "UEPrereqSetup_x64.exe",
  "credits.html",
  "LICENSES.chromium.html",
  "Uninstall.exe",
  "CONFIG_dl.exe",
];

function isBlacklisted(filePath) {
  const filename = path.basename(filePath).toLowerCase();
  return blacklist.some((entry) => entry.toLowerCase() === filename);
}

function isSupportedFile(filePath, extensions) {
  return (
    extensions.includes(path.extname(filePath).toLowerCase().slice(1)) &&
    !isBlacklisted(filePath)
  );
}

function getRelativePath(baseDir, targetPath) {
  return path.relative(baseDir, targetPath).replace(/\\/g, "/");
}

function findLaunchables(root, extensions) {
  const launchables = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    const items = fs.readdirSync(current, { withFileTypes: true });

    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else if (item.isFile() && isSupportedFile(full, extensions)) {
        launchables.push(getRelativePath(root, full));
      }
    }
  }

  return launchables.sort((a, b) => a.localeCompare(b));
}

function getScanStats(games) {
  return {
    potential: games.filter((game) => game.scanStatus === "new").length,
    alreadyImported: games.filter(
      (game) => game.scanStatus === "alreadyImported",
    ).length,
    missingLaunchable: games.filter(
      (game) => game.scanStatus === "missingLaunchable",
    ).length,
    totalFound: games.length,
  };
}

function sendScanProgress(window, value, total, games) {
  window.webContents.send("scan-progress", {
    value,
    total,
    ...getScanStats(games),
  });
}

function createMissingLaunchableGame(folder) {
  return {
    atlasId: "",
    f95Id: "",
    title: path.basename(folder),
    creator: "Unknown",
    engine: "Unknown",
    version: "Unknown",
    singleExecutable: "",
    executables: [],
    selectedValue: "",
    singleVisible: "hidden",
    multipleVisible: "hidden",
    folder,
    results: [],
    resultSelectedValue: "",
    resultVisibility: "hidden",
    recordExist: false,
    isArchive: false,
    scanStatus: "missingLaunchable",
    scanMessage: "No supported launchable found",
  };
}

async function startScan(params, window) {
  const {
    folder,
    format,
    gameExt,
    archiveExt,
    isCompressed,
    deleteAfter,
    scanSize,
    downloadBannerImages,
    downloadPreviewImages,
    previewLimit,
    downloadVideos,
  } = params;
  const extensions = isCompressed ? archiveExt : gameExt;
  const games = [];

  console.log(
    `Starting scan in folder: ${folder} with extensions: ${extensions.join(", ")}`,
  );

  if (isCompressed) {
    // Get all files recursively, including subdirectories
    const allFiles = getAllFiles(folder, params.archiveExt);
    const totalFiles = allFiles.length;
    let i = 0;
    for (const file of allFiles) {
      i++;
      console.log(`Scanning file: ${file} (isFile: true)`);
      const success = await findGame(
        file,
        format,
        extensions,
        folder,
        5,
        true,
        games,
        window,
        params,
        [],
      );
      if (success) {
        window.webContents.send("scan-complete", games[games.length - 1]); // Send each game incrementally
      }
      sendScanProgress(window, i, totalFiles, games);
    }
  } else {
    const directories = fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(folder, d.name));
    const rootLaunchables = findLaunchables(folder, extensions).filter(
      (launchable) => !launchable.includes("/"),
    );
    const scanTargets =
      rootLaunchables.length > 0 ? [folder, ...directories] : directories;
    const totalDirs = scanTargets.length;
    let ittr = 0;

    console.log(
      `Found ${totalDirs} game folders to scan: ${scanTargets.join(", ")}`,
    );

    for (const target of scanTargets) {
      console.log(`Scanning game folder: ${target}`);
      ittr++;

      const launchables =
        target === folder ? rootLaunchables : findLaunchables(target, extensions);

      if (launchables.length === 0) {
        const missingGame = createMissingLaunchableGame(target);
        games.push(missingGame);
        window.webContents.send("scan-complete", missingGame);
        sendScanProgress(window, ittr, totalDirs, games);
        continue;
      }

      const res = await findGame(
        target,
        format,
        extensions,
        folder,
        0,
        false,
        games,
        window,
        params,
        launchables,
      );
      if (res) {
        window.webContents.send("scan-complete", games[games.length - 1]);
      }
      sendScanProgress(window, ittr, totalDirs, games);
    }
  }

  const stats = getScanStats(games);
  console.log(
    `Scan complete. Total rows: ${games.length}; new: ${stats.potential}; already imported: ${stats.alreadyImported}; missing launchable: ${stats.missingLaunchable}`,
  );
  window.webContents.send("scan-complete-final", games);
}

function getAllFiles(root, extensions) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    console.log(`Exploring directory for files: ${current}`);
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else if (item.isFile() && isSupportedFile(full, extensions)) {
        files.push(full);
      }
    }
  }
  console.log(`Found ${files.length} archive files: ${files.join(", ")}`);
  return files;
}

async function findGame(
  t,
  format,
  extensions,
  rootPath,
  stopLevel,
  isFile,
  games,
  window,
  params,
  executables,
) {
  console.log(
    `Finding game in: ${t} (isFile: ${isFile}) with extensions: ${extensions.join(", ")}`,
  );
  let potentialExecutables = executables || [];
  let singleExecutable = "";
  let selectedValue = "";
  let singleVisible = "hidden";
  let multipleVisible = "hidden";
  let gameEngine = "";
  let isArchive = false;

  try {
    if (!isFile) {
      if (potentialExecutables.length === 0) {
        console.log(`No executable files provided for ${t}`);
        return false;
      }
      potentialExecutables = potentialExecutables
        .map((f) => f.replace(/\\/g, "/"))
        .filter((f) => !path.basename(f).includes("-32")); // Exclude files with "-32" in the name
      for (const exec of potentialExecutables) {
        const execName = path.basename(exec);
        for (const [engine, patterns] of Object.entries(engineMap)) {
          if (patterns.some((p) => execName.toLowerCase().includes(p))) {
            gameEngine = engine;
            console.log(`Matched engine ${gameEngine} for ${exec}`);
            break;
          }
        }
        if (gameEngine) break;
      }
      if (potentialExecutables.length === 1) {
        singleExecutable = potentialExecutables[0];
        selectedValue = singleExecutable;
        singleVisible = "visible";
      } else if (potentialExecutables.length > 1) {
        multipleVisible = "visible";
        selectedValue = potentialExecutables[0];
      }
    } else {
      const ext = path.extname(t).toLowerCase().slice(1);
      console.log(
        `Checking file ${t}, Extension: ${ext}, Blacklisted: ${blacklist.includes(path.basename(t))}`,
      );
      if (!extensions.includes(ext) || blacklist.includes(path.basename(t))) {
        console.log(
          `File ${t} has unsupported extension ${ext} or is blacklisted`,
        );
        return false;
      }
      isArchive = params.isCompressed;
      singleExecutable = path.basename(t);
      selectedValue = singleExecutable;
      singleVisible = "visible";
      potentialExecutables = [singleExecutable];
    }

    let title = "";
    let creator = "Unknown";
    let version = "";

    const relativePath = t.replace(`${rootPath}${path.sep}`, "");
    console.log(`Relative path: ${relativePath}, Format: ${format}`);
    if (format && format.trim() !== "") {
      const parsePath = isFile ? path.dirname(relativePath) : relativePath;
      const pathParts = parsePath.split(path.sep);
      console.log(`Path parts: ${pathParts.join(", ")}`);
      const formatParts = format
        .split("/")
        .map((part) => part.replace(/\{|\}/g, ""));
      if (pathParts.length >= formatParts.length) {
        const mapping = {};
        formatParts.forEach((part, index) => {
          mapping[part] = pathParts[index] || "";
        });
        creator = mapping.creator || "Unknown";
        title = mapping.title || "";
        version = mapping.version || "";
        console.log(
          `Structured match: creator=${creator}, title=${title}, version=${version}`,
        );
      }
    }

    if (!title || title.trim() === "") {
      let filename = isFile
        ? path.basename(t, path.extname(t))
        : path.basename(t);
      console.log(`Parsing filename: ${filename}`);
      filename = filename
        .replace(/[^\w\s.-]/g, "")
        .replace(/\[(.*?)\]/g, "$1")
        .trim();
      const parts = filename.split("-").map((p) => p.trim());
      if (parts.length > 0) {
        let versionIndex = -1;
        for (let i = parts.length - 1; i >= 0; i--) {
          if (/^\d+(\.\d+)?$/.test(parts[i])) {
            versionIndex = i;
            break;
          }
        }
        if (versionIndex >= 0) {
          version = parts[versionIndex];
          title = parts.slice(0, versionIndex).join(" ");
        } else {
          title = parts.join(" ");
          version = "1.0";
        }
        console.log(`Parsed: title=${title}, version=${version}`);
      }
      if (!title || title.trim() === "") {
        title = filename;
        version = "Unknown";
      }
    }

    if (!title || title.trim() === "") {
      console.log(`No valid title extracted from ${t}, parsing failed`);
      return false;
    }

    console.log(
      `Processing game: ${title}, Creator: ${creator}, Version: ${version}, Engine: ${gameEngine}`,
    );
    let data;
    try {
      data = await searchAtlas(title, creator);
      console.log(`searchAtlas returned: ${JSON.stringify(data)}`);
    } catch (err) {
      console.error(`searchAtlas error for ${title}: ${err.message}`);
      data = [];
    }

    let atlasId = "";
    let f95Id = "";
    let results = [];
    if (data.length === 1) {
      atlasId = data[0].atlas_id;
      f95Id = data[0].f95_id || "";
      title = data[0].title;
      creator = data[0].creator;
      gameEngine = data[0].engine || gameEngine;
      results = [{ key: "match", value: "Match Found" }];
    } else if (data.length > 1) {
      results = data.map((d) => ({
        key: String(d.atlas_id),
        value: `${d.atlas_id} | ${d.f95_id || ""} | ${d.title} | ${d.creator}`,
      }));
    }
    const engine = gameEngine || "Unknown";
    let recordExist = false;
    try {
      recordExist = await checkRecordExist(title, creator, engine, version, t);
      console.log(
        `checkRecordExist for ${title}, ${creator}, ${version}, ${t}: ${recordExist}`,
      );
    } catch (err) {
      console.error(`checkRecordExist error for ${title}: ${err.message}`);
      return false;
    }

    const gd = {
      atlasId,
      f95Id,
      title,
      creator,
      engine,
      version,
      singleExecutable,
      executables: potentialExecutables.map((e) => ({ key: e, value: e })),
      selectedValue,
      singleVisible,
      multipleVisible,
      folder: isFile ? path.dirname(t) : t,
      results,
      resultSelectedValue: results[0]?.key || "",
      resultVisibility: results.length > 0 ? "visible" : "hidden",
      recordExist,
      isArchive,
      scanStatus: recordExist ? "alreadyImported" : "new",
      scanMessage: recordExist ? "Already imported" : "Ready to import",
    };
    console.log(`Adding game to list: ${JSON.stringify(gd)}`);
    games.push(gd);
    return true;
  } catch (err) {
    console.error(`Error processing ${t}: ${err.message}, Stack: ${err.stack}`);
    return false;
  }
}

module.exports = { startScan };
