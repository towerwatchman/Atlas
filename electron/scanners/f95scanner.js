const fs = require("fs");
const path = require("path");
const {
  searchAtlas,
  searchAtlasByF95Id,
  checkRecordExist,
} = require("../db/index");
const { findGlInfosForGameFolder } = require("./glInfosParser");
const { findExecutables } = require("./executableScanner");
const { isImportBlacklisted } = require("./importBlacklist");

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

function isBlacklisted(filePath) {
  return isImportBlacklisted(filePath);
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

class ScanCanceledError extends Error {
  constructor() {
    super("Scan canceled");
    this.name = "ScanCanceledError";
    this.code = "SCAN_CANCELED";
    this.canceled = true;
  }
}

function isScanCanceled(cancelToken = {}) {
  return cancelToken.canceled === true || cancelToken.cancelRequested === true;
}

function throwIfScanCanceled(cancelToken = {}) {
  if (isScanCanceled(cancelToken)) throw new ScanCanceledError();
}

async function yieldToCancelHandler() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function hasAnyFile(root, cancelToken) {
  const stack = [root];
  let visited = 0;

  while (stack.length) {
    throwIfScanCanceled(cancelToken);
    const current = stack.pop();
    const items = safeReadDir(current);
    if (++visited % 100 === 0) await yieldToCancelHandler();

    for (const item of items) {
      throwIfScanCanceled(cancelToken);
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

function withScanId(payload, cancelToken) {
  return cancelToken?.scanId ? { ...payload, scanId: cancelToken.scanId } : payload;
}

function sendScanProgress(window, value, total, games, cancelToken) {
  window.webContents.send("scan-progress", {
    scanId: cancelToken?.scanId,
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

function normalizeVersionName(value, fallback = "Unknown") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseStructuredSegment(formatPart, pathPart) {
  const tokens = [];
  let pattern = "^";
  let cursor = 0;
  const tokenPattern = /\{([^}]+)\}/g;
  let match;
  while ((match = tokenPattern.exec(formatPart)) !== null) {
    pattern += escapeRegExp(formatPart.slice(cursor, match.index));
    tokens.push(normalizeFormatToken(match[1]));
    pattern += "(.+?)";
    cursor = match.index + match[0].length;
  }
  pattern += `${escapeRegExp(formatPart.slice(cursor))}$`;
  if (tokens.length === 0) return {};
  const values = String(pathPart || "").match(new RegExp(pattern, "i"));
  if (!values) return {};
  return tokens.reduce((result, token, index) => {
    result[token] = String(values[index + 1] || "").trim();
    return result;
  }, {});
}

function normalizeStructuredMapping(format, pathParts) {
  const mapping = {};
  const formatParts = String(format || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  formatParts.forEach((part, index) => {
    Object.assign(mapping, parseStructuredSegment(part, pathParts[index] || ""));
  });

  return mapping;
}

// Parse a relative folder/file path with a user-supplied regex. The regex is
// expected to use named capture groups (creator, title, version, engine,
// f95id, lcid, atlasid). Path separators are normalized to "/" before
// matching so a single pattern works across platforms. Returns null when the
// regex is empty, invalid, or does not match (callers then fall back to the
// token-based structured mapping).
function parseWithCustomRegex(customRegex, relativePath) {
  const pattern = String(customRegex || "").trim();
  if (!pattern) return null;
  let regex;
  try {
    regex = new RegExp(pattern, "i");
  } catch (err) {
    console.warn(`Invalid custom folder regex "${pattern}": ${err.message}`);
    return null;
  }
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const match = normalized.match(regex);
  if (!match) return null;
  const groups = match.groups || {};
  const pick = (...names) => {
    for (const name of names) {
      const value = groups[name];
      if (value != null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  };
  return {
    creator: pick("creator"),
    title: pick("title"),
    version: pick("version"),
    engine: pick("engine"),
    f95id: pick("f95id", "f95Id"),
    lcid: pick("lcid", "lcId"),
    atlasid: pick("atlasid", "atlasId"),
  };
}

function cleanIdValue(value) {
  return String(value || "")
    .trim()
    .replace(/^f95[-_\s]*/i, "")
    .replace(/^id[-_\s]*/i, "");
}

// Parse a folder path against the active scheme (custom regex first, then the
// token format). Returns the mapping when it yields at least one usable field,
// otherwise null. Shared so both the main scan path and the skipped-row path
// derive metadata from the scheme the same way.
function parseSchemeFields(format, customRegex, rootPath, folderPath) {
  const relativePath = String(folderPath || "").replace(`${rootPath}${path.sep}`, "");
  let mapping = parseWithCustomRegex(customRegex, relativePath);
  const customMatched = Boolean(mapping && (mapping.title || mapping.creator || mapping.version));
  if (!customMatched && format && format.trim() !== "") {
    const pathParts = relativePath.split(path.sep);
    const formatParts = String(format || "")
      .split("/")
      .map(normalizeFormatToken)
      .filter(Boolean);
    if (pathParts.length >= formatParts.length) {
      mapping = normalizeStructuredMapping(format, pathParts);
    }
  }
  return mapping && (mapping.title || mapping.creator || mapping.version) ? mapping : null;
}

function createSkippedGame(folder, scanStatus, scanMessage, schemeContext = {}) {
  const { format, customRegex, rootPath } = schemeContext;
  // Prefer the user's scheme so a missing-launchable / empty row still shows the
  // correct Title/Creator/Version instead of a mangled cleaned folder name.
  const scheme = rootPath ? parseSchemeFields(format, customRegex, rootPath, folder) : null;
  const metadata = parseNameMetadata(path.basename(folder));
  const title = (scheme?.title || "").trim() || metadata.title;
  return {
    atlasId: cleanIdValue(scheme?.atlasid || ""),
    f95Id: cleanIdValue(scheme?.f95id || ""),
    title,
    lookupTitle: title,
    creator: (scheme?.creator || "").trim() || "Unknown",
    engine: (scheme?.engine || "").trim() || "Unknown",
    version: normalizeVersionName(scheme?.version || metadata.version),
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
  return safeReadDir(root)
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
  } = params;
  const archiveExtensions = normalizeExtensions(archiveExt);
  const extensions = normalizeExtensions(gameExt);
  const games = [];

  console.log(
    `Starting scan in folder: ${folder} with extensions: ${extensions.join(", ")}`,
  );

  try {
    throwIfScanCanceled(cancelToken);
      const directories = safeReadDir(folder)
        .filter((d) => d.isDirectory())
        .map((d) => path.join(folder, d.name));
      const rootArchives = getRootFiles(folder, archiveExtensions);

      const rootLaunchables = getRootFiles(folder, extensions);
      const scanTargets =
        rootLaunchables.length > 0 ? [folder, ...directories] : directories;
      const totalDirs = scanTargets.length + rootArchives.length;
      let ittr = 0;

      console.log(
        `Found ${totalDirs} game folders to scan: ${scanTargets.join(", ")}`,
      );

      for (const archive of rootArchives) {
        throwIfScanCanceled(cancelToken);
        console.log(`Scanning archive file: ${archive}`);
        ittr++;
        if (ittr % 25 === 0) {
          await yieldToCancelHandler();
          throwIfScanCanceled(cancelToken);
        }
        const success = await findGame(
          archive,
          "",
          archiveExtensions,
          folder,
          5,
          true,
          games,
          window,
          { ...params, isArchiveSource: true },
          [],
          cancelToken,
        );
        throwIfScanCanceled(cancelToken);
        if (success) {
          window.webContents.send("scan-complete", withScanId(games[games.length - 1], cancelToken));
        }
        sendScanProgress(window, ittr, totalDirs, games, cancelToken);
      }

      for (const target of scanTargets) {
        throwIfScanCanceled(cancelToken);
        console.log(`Scanning game folder: ${target}`);
        ittr++;
        if (ittr % 25 === 0) {
          await yieldToCancelHandler();
          throwIfScanCanceled(cancelToken);
        }

        const shallowLaunchables =
          target === folder
            ? rootLaunchables.map((f) => path.basename(f))
            : getRootFiles(target, extensions).map((f) => path.basename(f));

        if (shallowLaunchables.length > 0) {
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
            cancelToken,
          );
          throwIfScanCanceled(cancelToken);
          if (res) {
            window.webContents.send("scan-complete", withScanId(games[games.length - 1], cancelToken));
          }
          sendScanProgress(window, ittr, totalDirs, games, cancelToken);
          continue;
        }

        // Single-segment scheme (e.g. "{Engine} - {Title}[{Version}][{Creator}]"):
        // the scanned folder itself is the game folder, and its launchable may be
        // nested in a subfolder. Search the folder recursively so a nested exe is
        // found and the scheme is applied to the folder name — instead of falling
        // through to a mismatched "missing launchable" row. Multi-segment schemes
        // (with "/") keep using the depth-based version-dir logic below.
        const schemeSegmentCount =
          format && format.trim() !== ""
            ? format.split("/").map((p) => p.trim()).filter(Boolean).length
            : 0;
        if (schemeSegmentCount === 1 && target !== folder) {
          const nestedLaunchables = findExecutables(target, extensions);
          if (nestedLaunchables.length > 0) {
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
              nestedLaunchables,
              cancelToken,
            );
            throwIfScanCanceled(cancelToken);
            if (res) {
              window.webContents.send("scan-complete", withScanId(games[games.length - 1], cancelToken));
            }
            sendScanProgress(window, ittr, totalDirs, games, cancelToken);
            continue;
          }

          // No extracted executable inside the game folder — the game may be a
          // nested archive (zip/7z/rar) instead. When archive scanning is enabled
          // emit each nested archive as an importable archive row. findGame parses
          // the archive's PARENT directory against the scheme (isFile sources use
          // dirname), so the scheme still applies to the game-folder name.
          if (archiveExtensions.length > 0) {
            const nestedArchives = await getAllFiles(target, archiveExtensions, cancelToken);
            throwIfScanCanceled(cancelToken);
            let emittedArchive = false;
            for (const archive of nestedArchives) {
              throwIfScanCanceled(cancelToken);
              const res = await findGame(
                archive,
                format,
                archiveExtensions,
                folder,
                5,
                true,
                games,
                window,
                { ...params, isArchiveSource: true },
                [],
                cancelToken,
              );
              throwIfScanCanceled(cancelToken);
              if (res) {
                emittedArchive = true;
                window.webContents.send("scan-complete", withScanId(games[games.length - 1], cancelToken));
              }
            }
            if (emittedArchive) {
              sendScanProgress(window, ittr, totalDirs, games, cancelToken);
              continue;
            }
          }
        }

        let foundInSubdir = false;
        const maxDepth = format && format.trim() !== "" ? 3 : Infinity;
        const subdirs = await getAllSubdirs(target, folder, maxDepth, cancelToken);

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
          throwIfScanCanceled(cancelToken);
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
              cancelToken,
            );
            throwIfScanCanceled(cancelToken);
            if (res) {
              foundInSubdir = true;
              window.webContents.send("scan-complete", withScanId(games[games.length - 1], cancelToken));
            }
          }
        }

        if (!foundInSubdir) {
          const hasFiles = await hasAnyFile(target, cancelToken);
          throwIfScanCanceled(cancelToken);
          const missingGame = createSkippedGame(
            target,
            hasFiles ? "missingLaunchable" : "emptyFolder",
            hasFiles ? "No supported launchable found" : "Empty folder",
            { format, customRegex: params.customRegex, rootPath: folder },
          );
          games.push(missingGame);
          window.webContents.send("scan-complete", withScanId(missingGame, cancelToken));
        }

        sendScanProgress(window, ittr, totalDirs, games, cancelToken);
      }

    const stats = getScanStats(games);
    console.log(
      `Scan complete. Total rows: ${games.length}; new: ${stats.potential}; archives: ${stats.archives}; already imported: ${stats.alreadyImported}; missing launchable: ${stats.missingLaunchable}`,
    );
    window.webContents.send("scan-complete-final", withScanId({ games, canceled: false }, cancelToken));
    return { games, canceled: false };
  } catch (err) {
    if (err?.canceled || err?.code === "SCAN_CANCELED") {
      console.log(`Scan canceled. Rows before cancel: ${games.length}`);
      window.webContents.send("scan-complete-final", withScanId({ games, canceled: true }, cancelToken));
      throw err;
    }
    throw err;
  }
}

async function getAllSubdirs(root, basePath, maxDepth = Infinity, cancelToken) {
  const dirs = [];
  const stack = [{ path: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    throwIfScanCanceled(cancelToken);
    const { path: current, depth } = stack.pop();
    if (depth >= maxDepth) continue;
    const items = safeReadDir(current);
    if (++visited % 100 === 0) await yieldToCancelHandler();
    for (const item of items) {
      throwIfScanCanceled(cancelToken);
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        dirs.push(full);
        stack.push({ path: full, depth: depth + 1 });
      }
    }
  }
  return dirs;
}

async function getAllFiles(root, extensions, cancelToken) {
  const files = [];
  const stack = [root];
  let visited = 0;
  while (stack.length) {
    throwIfScanCanceled(cancelToken);
    const current = stack.pop();
    const items = safeReadDir(current);
    if (++visited % 100 === 0) await yieldToCancelHandler();
    for (const item of items) {
      throwIfScanCanceled(cancelToken);
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
  cancelToken,
) {
  throwIfScanCanceled(cancelToken);
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
      isArchive = params.isArchiveSource === true;
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
    let glInfos = null;

    if (!isFile) {
      glInfos = findGlInfosForGameFolder(t, selectedValue);
      if (glInfos) {
        console.log(`Using GL_Infos.ini metadata for ${t}: ${JSON.stringify({
          version: glInfos.version,
          f95Id: glInfos.f95Id,
          title: glInfos.title,
          threadUrl: glInfos.threadUrl,
        })}`);
      }
    }

    const relativePath = t.replace(`${rootPath}${path.sep}`, "");
    console.log(`Relative path: ${relativePath}, Format: ${format}`);
    let structuredTitleFound = false;
    // schemeProvided: the user enabled a folder scheme (token format and/or a
    // custom regex) for this scan. schemeMatched: that scheme actually produced
    // usable fields for THIS path. When a scheme is provided but does not match,
    // we must NOT silently fall through with empty fields (the old code did, by
    // treating an empty {} mapping as a successful match) — instead we leave the
    // fields untouched and let the row be flagged as a scheme mismatch below.
    const schemeProvided = Boolean(
      (format && format.trim() !== "") ||
      (params.customRegex && String(params.customRegex).trim() !== ""),
    );
    let schemeMatched = false;
    if (format && format.trim() !== "") {
      const parsePath = isFile ? path.dirname(relativePath) : relativePath;
      const pathParts = parsePath.split(path.sep);
      console.log(`Path parts: ${pathParts.join(", ")}`);
      const formatParts = String(format || "")
        .split("/")
        .map(normalizeFormatToken)
        .filter(Boolean);
      // A user-supplied regex (when enabled) takes priority over the
      // token-derived mapping. If it fails to match, fall back to tokens.
      let mapping = parseWithCustomRegex(params.customRegex, parsePath);
      const customMatched = Boolean(mapping && (mapping.title || mapping.creator || mapping.version));
      if (!customMatched && pathParts.length >= formatParts.length) {
        mapping = normalizeStructuredMapping(format, pathParts);
      }
      // A real match must yield at least one usable field. An empty {} mapping
      // (regex/token pattern did not match the folder name) is a mismatch, not a
      // match — so we no longer enter the assignment branch for it.
      const tokenMatched = Boolean(mapping && (mapping.title || mapping.creator || mapping.version));
      if (customMatched || tokenMatched) {
        creator = mapping.creator || "Unknown";
        title = mapping.title || "";
        lookupTitle = title;
        version = normalizeVersionName(mapping.version, "");
        structuredTitleFound = Boolean(title);
        schemeMatched = true;
        if (mapping.f95id) {
          f95Id = cleanIdValue(mapping.f95id);
        }
        if (mapping.atlasid) {
          atlasId = cleanIdValue(mapping.atlasid);
        }
        console.log(
          `Structured match: creator=${creator}, title=${title}, version=${version}, f95Id=${f95Id}, atlasId=${atlasId}`,
        );
      } else {
        console.warn(
          `Scan scheme did not match folder "${parsePath}" (format "${format}"` +
          `${params.customRegex ? `, regex "${params.customRegex}"` : ""}).`,
        );
      }
    }

    if (glInfos?.f95Id) {
      f95Id = glInfos.f95Id;
    }
    if (normalizeVersionName(glInfos?.version, "")) {
      version = normalizeVersionName(glInfos.version);
    }
    if (glInfos?.title && (!structuredTitleFound || !title || title.trim() === "")) {
      title = glInfos.title;
      lookupTitle = glInfos.title;
    }

    const canHydrateTitleFromId = Boolean(f95Id || atlasId);

    // Records whether we had to derive the title from the raw folder/file name
    // (the "clean the folder name" fallback). Combined with schemeProvided /
    // !schemeMatched below, this is what tells the UI a scheme was set but
    // silently produced nothing usable for this row.
    let usedFilenameFallback = false;
    if ((!title || title.trim() === "") && !canHydrateTitleFromId) {
      usedFilenameFallback = true;
      let filename = isFile
        ? path.basename(t, path.extname(t))
        : path.basename(t);
      console.log(`Parsing filename: ${filename}`);
      const metadata = parseNameMetadata(filename);
      title = metadata.title;
      lookupTitle = metadata.lookupTitle;
      version = normalizeVersionName(version, "") || normalizeVersionName(metadata.version);
      if (metadata.creator) creator = metadata.creator;
      console.log(`Parsed: title=${title}, version=${version}`);
      if (!title || title.trim() === "") {
        title = filename;
        version = version || "Unknown";
      }
    }

    if (glInfos?.title && !structuredTitleFound) {
      title = glInfos.title;
      lookupTitle = glInfos.title;
    }
    if (normalizeVersionName(glInfos?.version, "")) {
      version = normalizeVersionName(glInfos.version);
    }
    if (glInfos?.f95Id) {
      f95Id = glInfos.f95Id;
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
      throwIfScanCanceled(cancelToken);
      if (params.deferMatching) {
        data = [];
      } else if (f95Id) {
        data = await searchAtlasByF95Id(f95Id);
        throwIfScanCanceled(cancelToken);
        if (data.length === 0) {
          data = await searchAtlas(lookupTitle || title, creator);
        }
      } else {
        data = await searchAtlas(lookupTitle || title, creator);
      }
      throwIfScanCanceled(cancelToken);
      console.log(`searchAtlas returned: ${JSON.stringify(data)}`);
    } catch (err) {
      if (err?.canceled || err?.code === "SCAN_CANCELED") throw err;
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
      throwIfScanCanceled(cancelToken);
      console.log(
        `checkRecordExist for ${title}, ${creator}, ${version}, ${t}: ${recordExist}`,
      );
    } catch (err) {
      if (err?.canceled || err?.code === "SCAN_CANCELED") throw err;
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
      version: normalizeVersionName(version),
      latestVersion:
        data.length === 1 ? data[0].latestVersion || data[0].version || "" : "",
      siteUrl: data.length === 1 ? data[0].siteUrl || data[0].site_url || "" : glInfos?.threadUrl || "",
      f95Url: glInfos?.threadUrl || "",
      metadataSource: glInfos?.source || "",
      hasGlInfos: glInfos?.hasGlInfos === true,
      glInfosPath: glInfos?.filePath || "",
      // True when the user set a folder scheme (token format and/or custom regex)
      // but it did not match this folder, so the title was derived from the raw
      // folder name instead. The importer surfaces this as a "Scheme didn't match
      // folder" status so the fallback is no longer silent.
      schemeMismatch: schemeProvided && !schemeMatched && usedFilenameFallback,
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
            ? "Archive detected - will extract on import"
            : "Ready to import",
    };
    console.log(`Adding game to list: ${JSON.stringify(gd)}`);
    games.push(gd);
    return true;
  } catch (err) {
    if (err?.canceled || err?.code === "SCAN_CANCELED") throw err;
    console.error(`Error processing ${t}: ${err.message}, Stack: ${err.stack}`);
    return false;
  }
}

module.exports = { startScan, isScanCanceled, throwIfScanCanceled, ScanCanceledError };
