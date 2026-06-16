const fs = require("fs");
const path = require("path");
const {
  searchAtlas,
  searchAtlasByF95Id,
  checkRecordExist,
} = require("../db/index");

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

function normalizeExtensions(extensions) {
  const values = Array.isArray(extensions)
    ? extensions
    : String(extensions || "").split(",");

  return values
    .map((ext) => String(ext || "").trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

function isSupportedFile(filePath, extensions) {
  return (
    extensions.includes(path.extname(filePath).toLowerCase().slice(1)) &&
    !isBlacklisted(filePath)
  );
}

function hasAnyFile(root) {
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    const items = fs.readdirSync(current, { withFileTypes: true });

    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isFile()) return true;
      if (item.isDirectory()) stack.push(full);
    }
  }

  return false;
}

function getScanStats(games) {
  return {
    potential: games.filter((game) => game.scanStatus === "new").length,
    pendingMatch: games.filter((game) => game.scanStatus === "pendingMatch")
      .length,
    archives: games.filter(
      (game) => game.isArchive && game.scanStatus === "new",
    ).length,
    alreadyImported: games.filter(
      (game) => game.scanStatus === "alreadyImported",
    ).length,
    repairPath: games.filter((game) => game.scanStatus === "repairPath").length,
    missingLaunchable: games.filter(
      (game) => game.scanStatus === "missingLaunchable",
    ).length,
    emptyFolder: games.filter((game) => game.scanStatus === "emptyFolder")
      .length,
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

function cleanDisplayTitle(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripReleaseSuffixes(value) {
  const suffixPattern =
    /(?:[-_\s.]+(?:pc|win|win64|windows|windows64|linux|mac|patreon|public|elite|free|market|demo|fl|revamp|compressed|crunched|uncensored|steam|itch|fixed|hotfix|update))+$/i;
  let result = value;
  let next = result.replace(suffixPattern, "");
  while (next !== result) {
    result = next;
    next = result.replace(suffixPattern, "");
  }
  return result.replace(/[-_\s.]+$/g, "");
}

function parseNameMetadata(rawName) {
  const withoutExt = String(rawName || "")
    .replace(/\.(zip|rar|7z)$/i, "")
    .replace(/\[(.*?)\]/g, "$1")
    .trim();
  const normalized = stripReleaseSuffixes(withoutExt);
  const patterns = [
    /^(.*?)[-_\s.]*((?:ep|episode|ch|chapter)\.?\s*[_-]?\d+[a-z]*(?:[-_\s]*(?:part|p)\s*\d+)?)(?:[-_\s].*)?$/i,
    /^(.*?)[-_\s]+v?(\d+(?:\.\d+)*[a-z]*(?:[-_\s]*(?:part|p)\s*\d+)?)(?:[-_\s].*)?$/i,
    /^(.*?)[-_\s]+v?(\d+(?:\.\d+)*[a-z]*)(?:[-_\s].*)?$/i,
    /^(.*?)[-_\s]+(\d+(?:\.\d+)*[a-z]*)(?:[-_\s].*)?$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]?.trim() && match[2]?.trim()) {
      return {
        title: cleanDisplayTitle(match[1]),
        lookupTitle: cleanDisplayTitle(match[1]),
        version: match[2].replace(/\s+/g, ""),
      };
    }
  }

  return {
    title: cleanDisplayTitle(normalized || withoutExt),
    lookupTitle: cleanDisplayTitle(normalized || withoutExt),
    version: "Unknown",
  };
}

function normalizeFormatToken(value) {
  return String(value || "")
    .replace(/\{|\}/g, "")
    .trim()
    .toLowerCase();
}

function normalizeStructuredMapping(format, pathParts) {
  const mapping = {};
  const formatParts = String(format || "")
    .split("/")
    .map(normalizeFormatToken)
    .filter(Boolean);

  formatParts.forEach((part, index) => {
    mapping[part] = pathParts[index] || "";
  });

  return mapping;
}

function cleanIdValue(value) {
  return String(value || "")
    .trim()
    .replace(/^f95[-_\s]*/i, "")
    .replace(/^id[-_\s]*/i, "");
}

function createSkippedGame(folder, scanStatus, scanMessage) {
  const metadata = parseNameMetadata(path.basename(folder));
  return {
    atlasId: "",
    f95Id: "",
    title: metadata.title,
    lookupTitle: metadata.lookupTitle,
    creator: "Unknown",
    engine: "Unknown",
    version: metadata.version,
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
    scanStatus,
    scanMessage,
  };
}

function safeReadDir(folder) {
  try {
    return fs.readdirSync(folder, { withFileTypes: true });
  } catch (err) {
    console.warn(`Unable to read folder ${folder}:`, err.message);
    return [];
  }
}

function getRootFiles(root, extensions) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => path.join(root, item.name))
    .filter((file) => isSupportedFile(file, extensions));
}

async function startScan(params, window, cancelToken = {}) {
  const {
    folder,
    format,
    gameExt,
    archiveExt,
    isCompressed,
  } = params;
  const archiveExtensions = normalizeExtensions(archiveExt);
  const extensions = normalizeExtensions(isCompressed ? archiveExt : gameExt);
  const games = [];

  console.log(
    `Starting scan in folder: ${folder} with extensions: ${extensions.join(", ")}`,
  );

  if (isCompressed) {
    // Get all files recursively, including subdirectories
    const allFiles = getAllFiles(folder, extensions);
    const totalFiles = allFiles.length;
    let i = 0;
    for (const file of allFiles) {
      if (cancelToken.canceled) break;
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
    const rootArchives = getRootFiles(folder, archiveExtensions);

    // Check root folder for launchables (shallow only)
    const rootLaunchables = getRootFiles(folder, extensions);
    const scanTargets =
      rootLaunchables.length > 0 ? [folder, ...directories] : directories;
    const totalDirs = scanTargets.length + rootArchives.length;
    let ittr = 0;

    console.log(
      `Found ${totalDirs} game folders to scan: ${scanTargets.join(", ")}`,
    );

    for (const archive of rootArchives) {
      if (cancelToken.canceled) break;
      console.log(`Scanning archive file: ${archive}`);
      ittr++;
      const success = await findGame(
        archive,
        "",
        archiveExtensions,
        folder,
        5,
        true,
        games,
        window,
        { ...params, isCompressed: true },
        [],
      );
      if (success) {
        window.webContents.send("scan-complete", games[games.length - 1]);
      }
      sendScanProgress(window, ittr, totalDirs, games);
    }

    for (const target of scanTargets) {
      if (cancelToken.canceled) break;
      console.log(`Scanning game folder: ${target}`);
      ittr++;

      // ── Shallow check: look for launchables directly in this folder ──────
      const shallowLaunchables =
        target === folder
          ? rootLaunchables.map((f) => path.basename(f))
          : getRootFiles(target, extensions).map((f) => path.basename(f));

      if (shallowLaunchables.length > 0) {
        // Found launchables at this level — treat this as the game root
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
          shallowLaunchables,
        );
        if (res) {
          window.webContents.send("scan-complete", games[games.length - 1]);
        }
        sendScanProgress(window, ittr, totalDirs, games);
        continue;
      }

      // ── Deep check: nothing at top level, scan one level of subdirs ───────
      let foundInSubdir = false;
      const maxDepth = format && format.trim() !== "" ? 3 : Infinity;
      const subdirs = getAllSubdirs(target, folder, maxDepth);

      // If structured format, filter to expected depth only
      const formatParts =
        format && format.trim() !== ""
          ? format.split("/").map((part) => part.replace(/\{|\}/g, ""))
          : [];
      const expectedDepth = formatParts.length || 2;
      const versionDirs =
        format && format.trim() !== ""
          ? subdirs.filter((subdir) => {
              const relativePath = subdir.replace(`${folder}${path.sep}`, "");
              const pathParts = relativePath.split(path.sep);
              return pathParts.length === expectedDepth;
            })
          : subdirs;

      for (const subdir of versionDirs) {
        if (cancelToken.canceled) break;
        const subdirLaunchables = getRootFiles(subdir, extensions).map((f) =>
          path.basename(f),
        );
        if (subdirLaunchables.length > 0) {
          console.log(`Scanning version directory: ${subdir}`);
          const res = await findGame(
            subdir,
            format,
            extensions,
            folder,
            0,
            false,
            games,
            window,
            params,
            subdirLaunchables,
          );
          if (res) {
            foundInSubdir = true;
            window.webContents.send("scan-complete", games[games.length - 1]);
          }
        }
      }

      if (!foundInSubdir) {
        // Nothing found at any depth — report as missing/empty
        const hasFiles = hasAnyFile(target);
        const missingGame = createSkippedGame(
          target,
          hasFiles ? "missingLaunchable" : "emptyFolder",
          hasFiles ? "No supported launchable found" : "Empty folder",
        );
        games.push(missingGame);
        window.webContents.send("scan-complete", missingGame);
      }

      sendScanProgress(window, ittr, totalDirs, games);
    }
  }

  const stats = getScanStats(games);
  console.log(
    `Scan complete. Total rows: ${games.length}; new: ${stats.potential}; archives: ${stats.archives}; already imported: ${stats.alreadyImported}; missing launchable: ${stats.missingLaunchable}`,
  );
  window.webContents.send("scan-complete-final", games);
}

function getAllSubdirs(root, basePath, maxDepth = Infinity) {
  const dirs = [];
  const stack = [{ path: root, depth: 0 }];
  while (stack.length) {
    const { path: current, depth } = stack.pop();
    if (depth >= maxDepth) continue;
    const items = safeReadDir(current);
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        dirs.push(full);
        stack.push({ path: full, depth: depth + 1 });
      }
    }
  }
  return dirs;
}

function getAllFiles(root, extensions) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
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
        `Checking file ${t}, Extension: ${ext}, Blacklisted: ${isBlacklisted(t)}`,
      );
      if (!extensions.includes(ext) || isBlacklisted(t)) {
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
    let lookupTitle = "";
    let creator = "Unknown";
    let version = "";
    let atlasId = "";
    let f95Id = "";

    const relativePath = t.replace(`${rootPath}${path.sep}`, "");
    console.log(`Relative path: ${relativePath}, Format: ${format}`);
    if (format && format.trim() !== "") {
      const parsePath = isFile ? path.dirname(relativePath) : relativePath;
      const pathParts = parsePath.split(path.sep);
      console.log(`Path parts: ${pathParts.join(", ")}`);
      const formatParts = String(format || "")
        .split("/")
        .map(normalizeFormatToken)
        .filter(Boolean);
      if (pathParts.length >= formatParts.length) {
        const mapping = normalizeStructuredMapping(format, pathParts);
        creator = mapping.creator || "Unknown";
        title = mapping.title || "";
        lookupTitle = title;
        version = mapping.version || "";
        if (mapping.f95id) {
          f95Id = cleanIdValue(mapping.f95id);
        }
        if (mapping.atlasid) {
          atlasId = cleanIdValue(mapping.atlasid);
        }
        console.log(
          `Structured match: creator=${creator}, title=${title}, version=${version}, f95Id=${f95Id}, atlasId=${atlasId}`,
        );
      }
    }

    const canHydrateTitleFromId = Boolean(f95Id || atlasId);

    if ((!title || title.trim() === "") && !canHydrateTitleFromId) {
      let filename = isFile
        ? path.basename(t, path.extname(t))
        : path.basename(t);
      console.log(`Parsing filename: ${filename}`);
      const metadata = parseNameMetadata(filename);
      title = metadata.title;
      lookupTitle = metadata.lookupTitle;
      version = version || metadata.version;
      if (metadata.creator) creator = metadata.creator;
      console.log(`Parsed: title=${title}, version=${version}`);
      if (!title || title.trim() === "") {
        title = filename;
        version = version || "Unknown";
      }
    }

    if ((!title || title.trim() === "") && canHydrateTitleFromId) {
      title = f95Id ? `F95 ${f95Id}` : `Atlas ${atlasId}`;
      lookupTitle = title;
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
      data = params.deferMatching
        ? []
        : f95Id
          ? await searchAtlasByF95Id(f95Id)
          : await searchAtlas(lookupTitle || title, creator);
      console.log(`searchAtlas returned: ${JSON.stringify(data)}`);
    } catch (err) {
      console.error(`searchAtlas error for ${title}: ${err.message}`);
      data = [];
    }

    let results = [];
    if (data.length === 1) {
      atlasId = data[0].atlas_id || atlasId;
      f95Id = data[0].f95_id || f95Id;
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
    let importRecordStatus = null;
    try {
      importRecordStatus = null;
      recordExist = params.deferMatching
        ? false
        : importRecordStatus
          ? importRecordStatus.status === "alreadyImported"
          : await checkRecordExist(title, creator, engine, version, t);
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
      lookupTitle: lookupTitle || title,
      creator,
      engine,
      version,
      latestVersion:
        data.length === 1 ? data[0].latestVersion || data[0].version || "" : "",
      singleExecutable,
      executables: potentialExecutables.map((e) => ({ key: e, value: e })),
      selectedValue,
      singleVisible,
      multipleVisible,
      folder: isArchive || isFile ? path.dirname(t) : t,
      sourceFile: isArchive ? t : undefined,
      sourceRoot: rootPath,
      results,
      resultSelectedValue: results[0]?.key || "",
      resultVisibility: results.length > 0 ? "visible" : "hidden",
      recordExist,
      isArchive,
      existingRecordId: importRecordStatus?.recordId || "",
      scanStatus: params.deferMatching
        ? "pendingMatch"
        : recordExist
        ? "alreadyImported"
        : importRecordStatus?.status === "repairPath"
          ? "repairPath"
          : "new",
      scanMessage: params.deferMatching
        ? "Pending match"
        : recordExist
        ? "Already imported"
        : importRecordStatus?.status === "repairPath"
          ? "Repair path"
          : isArchive
            ? "Archive"
            : "Ready to import",
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
