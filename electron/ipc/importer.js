'use strict'

const { ipcMain, dialog, BrowserWindow, app } = require('electron')
const { downloadImages, buildBannerBaseName } = require('../imageUtils')
const path = require('path')
const fs = require('fs')
const fsp = require('fs').promises
const cp = require('child_process')
const ini = require('ini')
const { Worker } = require('worker_threads')
const { calculatePathSize } = require('../pathSize')
const { getImportRecordStatus, getAtlasData, findExistingRecordForImport,
        checkRecordExist, checkPathExist } = require('../db/atlas')
const { getGame } = require('../db/versions')
const { fetchAndStoreSteamData, isSteamAppInstalled } = require('../scanners/steamscanner')
const { fetchAndStoreGogData, startGogScan } = require('../scanners/gogscanner')
const { findExecutables } = require("../scanners/executableScanner");
const { getDefaultRenpySaveRoot, scanRenpySaveFolders } = require("../scanners/renpySaveScanner");
const { findRecordBySteamId, recordHasSteamMapping, uniqueSteamVersionLabel, findAtlasBySteamId } = require('../db/steam')
const { findRecordByGogId, addGogMapping, getGogIDbyRecord } = require('../db/gog')
const {
  addLewdCornerMapping,
  findRecordByLewdCornerId,
  parseLewdCornerIdFromUrl,
  searchAtlasByLewdCornerId,
} = require('../db/lewdcorner')
const { deletePathWithElevationFallback } = require('../deleteUtils')

let ownerMainWindow = null
let nextScanId = 1

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const getMediaPerformanceSettings = (config) => {
  const performance = config?.Performance || {};
  return {
    mediaDownloadConcurrency: clampInteger(performance.mediaDownloadConcurrency, 3, 1, 8),
    mediaPerHostConcurrency: clampInteger(performance.mediaPerHostConcurrency, 2, 1, 5),
    mediaRequestDelayMs: clampInteger(performance.mediaRequestDelayMs, 100, 0, 5000),
  };
};

const createHostLimiter = () => {
  const runningByHost = new Map();
  const waitersByHost = new Map();

  const waitForHostSlot = async (host, limit) => {
    const key = host || "unknown";
    while ((runningByHost.get(key) || 0) >= limit) {
      await new Promise((resolve) => {
        const waiters = waitersByHost.get(key) || [];
        waiters.push(resolve);
        waitersByHost.set(key, waiters);
      });
    }
    runningByHost.set(key, (runningByHost.get(key) || 0) + 1);
    return () => {
      const nextCount = Math.max(0, (runningByHost.get(key) || 1) - 1);
      if (nextCount === 0) runningByHost.delete(key);
      else runningByHost.set(key, nextCount);
      const waiters = waitersByHost.get(key) || [];
      const nextWaiter = waiters.shift();
      if (waiters.length === 0) waitersByHost.delete(key);
      else waitersByHost.set(key, waiters);
      if (nextWaiter) nextWaiter();
    };
  };

  return { waitForHostSlot };
};

const runConcurrentQueue = async (items, concurrency, worker) => {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(workers);
};

const getUrlHost = (value) => {
  try {
    return new URL(String(value || "")).host.toLowerCase();
  } catch {
    return "";
  }
};

// ── Importer helper functions ──────────────────────────────────────

function sanitizePathSegment(value, fallback = "Unknown") {
  const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  let sanitized = String(value || fallback)
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!sanitized || sanitized === "." || windowsReservedName.test(sanitized)) {
    sanitized = windowsReservedName.test(sanitized) ? `_${sanitized}` : fallback;
  }
  return sanitized;
}

function normalizeVersionName(value, fallback = "Unknown") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function buildStructuredImportPath(targetLibrary, format, game) {
  const pathSegments = format
    .trim()
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) =>
      sanitizePathSegment(
        part.replace(/\{([^}]+)\}/g, (_, token) => {
          const key = String(token || "").trim().toLowerCase();
          if (key === "creator") return game.creator || "Unknown";
          if (key === "title") return game.title || "Untitled";
          if (key === "version") return normalizeVersionName(game.version);
          if (key === "engine") return game.engine || "Unknown";
          if (key === "f95id") return game.f95Id || "Unknown";
          if (key === "lcid" || key === "lewdcornerid") return game.lcId || game.lewdCornerId || "Unknown";
          return "Unknown";
        }),
      ),
    );

  return path.join(targetLibrary, ...pathSegments);
}

function resolveArchivePathForImport(game, archiveFilename) {
  const candidates = [];
  if (game?.folder) candidates.push(String(game.folder));
  if (game?.sourceFile) candidates.push(String(game.sourceFile));
  if (game?.folder && archiveFilename) {
    candidates.push(path.join(String(game.folder), archiveFilename));
  }

  const archivePath = candidates.find((candidate) => {
    try {
      return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  if (!archivePath) {
    throw new Error(
      `Archive not found: ${candidates.filter(Boolean).join(" or ") || "no archive path supplied"}`,
    );
  }

  return archivePath;
}

function getUniquePath(basePath) {
  let uniquePath = basePath;
  let counter = 1;
  while (fs.existsSync(uniquePath)) {
    uniquePath = `${basePath} (${counter++})`;
  }
  return uniquePath;
}

const toPositiveInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const getLewdCornerIdFromGame = (game = {}) =>
  toPositiveInteger(
    game.lcId ||
    game.lc_id ||
    game.lewdCornerId ||
    game.lewdcornerId ||
    game.lewdcorner_id ||
    parseLewdCornerIdFromUrl(game.lewdCornerSiteUrl || game.lewdcornerSiteUrl || game.siteUrl || game.site_url || game.sourceUrl || game.url),
  );

const getConfiguredExtractionExtensions = (appConfig) =>
  String(appConfig?.Library?.extractionExtensions || "zip,7z,rar")
    .split(",")
    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

const isArchiveFilePath = (filePath, appConfig) => {
  const ext = path.extname(String(filePath || "")).toLowerCase().replace(/^\./, "");
  return ext ? getConfiguredExtractionExtensions(appConfig).includes(ext) : false;
};

const isRarArchivePath = (filePath) =>
  path.extname(String(filePath || "")).toLowerCase() === ".rar";

function isSteamImportRow(game = {}) {
  return (
    game.sourceType === "steam" ||
    game.scanStatus === "steamVersion" ||
    Boolean(game.steamId || game.steam_id || game.steam_appid)
  );
}

const getSteamIdFromGame = (game = {}) =>
  toPositiveInteger(game.steamId || game.steam_id || game.steam_appid);

function isGogImportRow(game = {}) {
  return (
    game.sourceType === "gog" ||
    game.scanStatus === "gogVersion" ||
    Boolean(game.gogId || game.gog_id || game.gog_appid)
  );
}

const getGogIdFromGame = (game = {}) =>
  toPositiveInteger(game.gogId || game.gog_id || game.gog_appid);

const inferCatalogImportVersion = (sourcePath, catalog = {}) => {
  const candidates = [
    path.basename(String(sourcePath || ""), path.extname(String(sourcePath || ""))),
    path.basename(path.dirname(String(sourcePath || ""))),
    catalog.latestVersion,
    catalog.latest_version,
    catalog.version,
  ];
  const patterns = [
    /\bv(?:ersion)?[\s._-]*([0-9]+(?:[._-][0-9a-z]+){0,4})\b/i,
    /\b((?:ch|chapter)[\s._-]*[0-9]+[a-z]?)\b/i,
    /\b([0-9]+(?:\.[0-9a-z]+){1,4})\b/i,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match?.[1]) return match[0].startsWith("v") ? match[0] : match[1];
    }
  }
  return normalizeVersionName(catalog.latestVersion || catalog.latest_version || catalog.version);
};

const getConfiguredGameExtensions = (appConfig) =>
  String(appConfig?.Library?.gameExtensions || "exe,swf,flv,f4v,rag,cmd,bat,jar,html")
    .split(",")
    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const calculatePathSizeSafe = async (targetPath) => {
  try {
    const result = await calculatePathSize(targetPath);
    return result?.missing ? null : result?.sizeBytes ?? null;
  } catch (err) {
    console.warn(`Failed to calculate imported folder size for ${targetPath}:`, err.message || err);
    return null;
  }
};

function getUniqueTempPath(basePath) {
  return getUniquePath(`${basePath}.__atlas_extract_${Date.now()}`);
}

function getSingleDirectoryChild(dirPath) {
  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter(
      (entry) =>
        !entry.name.startsWith("__MACOSX") &&
        ![".DS_Store", "Thumbs.db", "desktop.ini"].includes(entry.name),
    );
  if (entries.length !== 1 || !entries[0].isDirectory()) return null;
  return path.join(dirPath, entries[0].name);
}

function getNormalizedArchiveRoot(extractPath, extensions) {
  const singleChildDir = getSingleDirectoryChild(extractPath);

  if (!singleChildDir) {
    return { rootPath: extractPath };
  }

  const childExecs = findExecutables(singleChildDir, extensions);
  if (childExecs.length === 0) {
    return { rootPath: extractPath };
  }

  return { rootPath: singleChildDir };
}

async function moveFolderFast(source, destination, onProgress, shouldCancel) {
  if (shouldCancel()) throw createImportCancelledError();
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  try {
    await fs.promises.rename(source, destination);
    onProgress?.({ type: "done", percent: 100, copied: 0, total: 0 });
    return "rename";
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }

  await copyFolderWithProgress(source, destination, onProgress, shouldCancel);
  const deleteResult = await deletePathWithElevationFallback(source, {
    recursive: true,
    force: true,
    description: "Delete original source folder",
    window: ownerMainWindow,
  });
  if (!deleteResult.success) throw new Error(deleteResult.error || "Source cleanup skipped");
  return "copy";
}

async function getArchiveInfo(archivePath, sevenZipBin) {
  if (!sevenZipBin || (!isPathCommand(sevenZipBin) && !fs.existsSync(sevenZipBin))) {
    return { totalFiles: 0, totalUncompressedBytes: 0 };
  }
  return new Promise((resolve, reject) => {
    const child = cp.spawn(sevenZipBin, ["l", archivePath, "-y"], {
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`7z l failed with code ${code}\nOutput:\n${output}`));
        return;
      }
      let totalFiles = 0;
      let totalUncompressedBytes = 0;
      const lines = output.split("\n");
      for (const line of lines) {
        // Match summary line: "12345 files, 67890 bytes"
        const summaryMatch = line.match(/(\d+)\s+files?,\s+(\d+)\s+bytes/i);
        if (summaryMatch) {
          totalFiles = parseInt(summaryMatch[1], 10);
          totalUncompressedBytes = parseInt(summaryMatch[2], 10);
          break;
        }
        // Match individual file lines (columns: Date Time Attr Size Compressed Name)
        const fileMatch = line.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+(\d+)\s+\d+\s+/);
        if (fileMatch) {
          totalUncompressedBytes += parseInt(fileMatch[1], 10);
          totalFiles++;
        }
      }
      resolve({ totalFiles, totalUncompressedBytes });
    });
  });
}

async function extractArchive(
  archivePath,
  finalPath,
  sevenZipBin,
  session,
  progressWindow,
  useBundledRarExtractor = false,
) {
  const workerPath = resolvePackagedModulePath(
    path.join(__dirname, "../../workers/extractWorker.js"),
  );
  const tempPath = getUniqueTempPath(finalPath);
  console.log("Worker path:", workerPath);
  if (!fs.existsSync(workerPath)) {
    throw new Error(`Worker file not found: ${workerPath}`);
  }

  await fsp.mkdir(tempPath, { recursive: true });
  session?.cleanupPaths?.push(tempPath);

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerPath, {
      workerData: {
        archivePath,
        extractPath: tempPath,
        sevenZipBin,
        useBundledRarExtractor,
        rarWasmPath: useBundledRarExtractor
          ? resolvePackagedModulePath(require.resolve("node-unrar-js/dist/js/unrar.wasm"))
          : null,
      },
    });
    if (session) session.currentExtractionWorker = worker;

    const cleanupWorker = () => {
      if (session?.currentExtractionWorker === worker) {
        session.currentExtractionWorker = null;
      }
      worker.terminate().catch(() => {});
    };

    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanupWorker();
      callback();
    };
    worker.on("message", (msg) => {
      if (msg.type === "progress") {
        if (progressWindow && !progressWindow.isDestroyed()) {
          progressWindow.webContents.send("import-progress", {
            text: msg.text,
            progress:
              typeof msg.percent === "number"
                ? msg.percent
                : session?.progress || 0,
            total: 100,
            phase: msg.phase,
            canCancel: true,
          });
        } else {
          console.warn("[MAIN] import progress window not available");
        }
      } else if (msg.type === "done") {
        settle(async () => {
          if (!msg.success) {
            await removePathIfExists(tempPath);
            if (msg.canceled) reject(createImportCancelledError());
            else reject(new Error(msg.error || "Extraction failed"));
            return;
          }

          try {
            throwIfImportCanceled(session);
            await fsp.mkdir(path.dirname(finalPath), { recursive: true });
            if (fs.existsSync(finalPath)) {
              finalPath = getUniquePath(finalPath);
            }
            await moveDirWithRetry(tempPath, finalPath);
            resolve({ success: true, finalPath });
          } catch (err) {
            await removePathIfExists(tempPath);
            reject(err);
          }
        });
      }
    });
    worker.on("error", (err) => {
      settle(async () => {
        await removePathIfExists(tempPath);
        reject(err);
      });
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        settle(async () => {
          await removePathIfExists(tempPath);
          reject(new Error(`Worker stopped with exit code ${code}`));
        });
      }
    });

    if (session?.cancelRequested) {
      worker.postMessage("cancel");
    }
  });
}

// Wraps extractArchive with a one-time recovery path. If a RAR fails to
// extract with the bundled node-unrar-js engine (the source of the
// "cannot read properties of null" / "no end of archive" issues on some
// archives), prompt the user to locate a 7-Zip executable and retry the
// extraction through the (hardened) 7-Zip spawn path instead. The chosen
// 7-Zip path is persisted to config by resolveSevenZipExecutablePath, so
// subsequent imports reuse it automatically.
async function extractArchiveWithFallback({
  archivePath,
  finalPath,
  sevenZipBin,
  session,
  progressWindow,
  useBundledRarExtractor,
  currentConfig,
  currentConfigPath,
  ownerWindow,
  notify,
}) {
  try {
    return await extractArchive(
      archivePath,
      finalPath,
      sevenZipBin,
      session,
      progressWindow,
      useBundledRarExtractor,
    );
  } catch (err) {
    // Never interfere with cancellation, and only offer the fallback for the
    // case it actually helps: a RAR that failed via the bundled extractor.
    if (
      isImportCancelledError(err) ||
      session?.cancelRequested ||
      !isRarArchivePath(archivePath) ||
      !useBundledRarExtractor
    ) {
      throw err;
    }

    console.warn(
      `[Importer] Bundled RAR extraction failed for ${archivePath}: ${
        err?.message || err
      }. Offering 7-Zip fallback.`,
    );

    const choice = await showMessageBox(ownerWindow, {
      type: "warning",
      buttons: ["Locate 7-Zip and retry", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      title: "Extraction failed",
      message: `Atlas could not extract this RAR archive with its built-in extractor.`,
      detail:
        `${path.basename(archivePath)}\n\n` +
        `You can point Atlas at a 7-Zip executable (7z, 7za, or 7zz) to ` +
        `retry. This path will be saved for future imports.\n\n` +
        `Error: ${err?.message || err}`,
    });

    if (choice.response !== 0) {
      throw err;
    }

    const resolved = await resolveSevenZipExecutablePath({
      configuredPath: currentConfig?.Library?.sevenZipPath,
      currentConfig,
      currentConfigPath,
      ownerWindow,
      notify,
      allowManualSelection: true,
    });

    if (!resolved?.path) {
      // User dismissed the picker or chose an invalid binary; surface the
      // original extraction error rather than a confusing secondary one.
      throw err;
    }

    notify?.(`Retrying extraction with ${getSevenZipDisplayName(resolved.path)}...`);
    // Force the 7-Zip spawn path (useBundledRarExtractor = false) regardless
    // of the resolved source, since the bundled engine already failed.
    return await extractArchive(
      archivePath,
      finalPath,
      resolved.path,
      session,
      progressWindow,
      false,
    );
  }
}

function resolvePackagedModulePath(modulePath) {
  if (app.isPackaged && modulePath.includes(`${path.sep}app.asar${path.sep}`)) {
    return modulePath.replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`,
    );
  }
  return modulePath;
}

function getSevenZipExecutablePath() {
  return resolvePackagedModulePath(require("7zip-bin").path7za);
}

function getCommonSevenZipPaths() {
  const possiblePaths = [];
  if (process.platform === "win32") {
    possiblePaths.push(
      "C:\\Program Files\\7-Zip\\7z.exe",
      "C:\\Program Files (x86)\\7-Zip\\7z.exe",
      "C:\\Program Files\\7-Zip\\7zz.exe",
      "C:\\Program Files (x86)\\7-Zip\\7zz.exe",
      "C:\\Program Files\\7-Zip\\7za.exe",
      "C:\\Program Files (x86)\\7-Zip\\7za.exe",
    );
  } else if (process.platform === "linux") {
    possiblePaths.push("/usr/bin/7z", "/usr/bin/7zz", "/usr/local/bin/7z");
  } else if (process.platform === "darwin") {
    possiblePaths.push(
      "/usr/local/bin/7z",
      "/opt/homebrew/bin/7z",
      "/usr/local/bin/7zz",
      "/opt/homebrew/bin/7zz",
    );
  }
  return possiblePaths;
}

function saveSevenZipPath(sevenZipPath, currentConfig, currentConfigPath) {
  if (!currentConfigPath) return currentConfig;
  const newConfig = {
    ...currentConfig,
    Library: { ...(currentConfig?.Library || {}), sevenZipPath },
  };
  fs.writeFileSync(currentConfigPath, ini.stringify(newConfig));
  return newConfig;
}

function getBundledSevenZipPath() {
  try {
    const bundledPath = getSevenZipExecutablePath();
    return bundledPath && fs.existsSync(bundledPath) ? bundledPath : null;
  } catch (err) {
    console.warn("Bundled 7-Zip unavailable:", err.message);
    return null;
  }
}

function isExistingFile(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  } catch {
    return false;
  }
}

function isPathCommand(candidate) {
  return Boolean(
    candidate &&
      !path.isAbsolute(candidate) &&
      !candidate.includes(path.sep) &&
      !candidate.includes("/") &&
      !candidate.includes("\\"),
  );
}

function getSevenZipDisplayName(candidate) {
  return isPathCommand(candidate) ? candidate : path.basename(candidate);
}

function showOpenDialog(ownerWindow, options) {
  return ownerWindow
    ? dialog.showOpenDialog(ownerWindow, options)
    : dialog.showOpenDialog(options);
}

function showMessageBox(ownerWindow, options) {
  return ownerWindow
    ? dialog.showMessageBox(ownerWindow, options)
    : dialog.showMessageBox(options);
}

function canSpawnSevenZip(candidate) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (usable) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(usable);
    };

    let child = null;
    try {
      child = cp.spawn(candidate, ["i"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      finish(false);
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish(false);
    }, 5000);

    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

async function testSevenZipCandidate(candidate) {
  const normalized = String(candidate || "").trim();
  if (!normalized) return false;
  if (!isPathCommand(normalized) && !isExistingFile(normalized)) return false;
  return canSpawnSevenZip(normalized);
}

async function resolveSevenZipExecutablePath({
  configuredPath,
  currentConfig,
  currentConfigPath,
  ownerWindow,
  notify,
  allowManualSelection = true,
} = {}) {
  const candidates = [];

  if (configuredPath) {
    candidates.push({
      path: configuredPath,
      source: "configured",
      message: "Using configured 7-Zip",
    });
  }

  for (const candidate of getCommonSevenZipPaths()) {
    candidates.push({
      path: candidate,
      source: "local install",
      message: "Auto-detected 7-Zip",
      persist: true,
    });
  }

  for (const command of ["7z", "7zz", "7za"]) {
    candidates.push({
      path: command,
      source: "PATH",
      message: "Using 7-Zip from PATH",
    });
  }

  const bundledPath = getBundledSevenZipPath();
  if (bundledPath) {
    candidates.push({
      path: bundledPath,
      source: "bundled",
      message: "Using bundled 7-Zip fallback",
    });
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const candidatePath = String(candidate.path || "").trim();
    const key = candidatePath.toLowerCase();
    if (!candidatePath || seen.has(key)) continue;
    seen.add(key);

    if (await testSevenZipCandidate(candidatePath)) {
      if (candidate.persist) {
        saveSevenZipPath(candidatePath, currentConfig, currentConfigPath);
      }
      notify?.(`${candidate.message}: ${getSevenZipDisplayName(candidatePath)}`);
      console.log(`[Importer] ${candidate.message} (${candidate.source}): ${candidatePath}`);
      return { path: candidatePath, source: candidate.source };
    }

    if (candidate.source === "configured") {
      console.warn(`[Importer] Configured 7-Zip is not usable: ${candidatePath}`);
    }
  }

  if (!allowManualSelection) return null;

  const result = await showOpenDialog(ownerWindow, {
    title: "Select 7-Zip executable (7z, 7za, or 7zz)",
    properties: ["openFile"],
    filters: [
      {
        name: "7-Zip Executable",
        extensions: process.platform === "win32" ? ["exe"] : ["*"],
      },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths?.length) return null;

  const selectedPath = result.filePaths[0];
  if (!(await testSevenZipCandidate(selectedPath))) {
    await showMessageBox(ownerWindow, {
      type: "error",
      title: "Invalid 7-Zip executable",
      message:
        "Atlas could not run the selected 7-Zip executable. Please choose a valid 7z, 7za, or 7zz executable.",
    });
    console.warn(`[Importer] Selected 7-Zip is not usable: ${selectedPath}`);
    return null;
  }

  saveSevenZipPath(selectedPath, currentConfig, currentConfigPath);
  notify?.(`Using selected 7-Zip: ${getSevenZipDisplayName(selectedPath)}`);
  console.log(`[Importer] Using selected 7-Zip (manual): ${selectedPath}`);
  return { path: selectedPath, source: "manual" };
}

function extractArchiveWithSevenZip(archivePath, extractPath) {
  return new Promise((resolve, reject) => {
    const sevenZipPath = getSevenZipExecutablePath();
    const child = cp.spawn(
      sevenZipPath,
      ["x", archivePath, `-o${extractPath}`, "-y"],
      { windowsHide: true },
    );
    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `7-Zip extraction failed with exit code ${code}: ${
            stderr || stdout || "No output"
          }`,
        ),
      );
    });
  });
}

function createImportCancelledError() {
  const err = new Error("Import canceled by user");
  err.code = "IMPORT_CANCELED";
  return err;
}

function isImportCancelledError(err) {
  return err?.code === "IMPORT_CANCELED";
}

function throwIfImportCanceled(session) {
  if (session?.cancelRequested) throw createImportCancelledError();
}

function normalizeForPathCompare(targetPath) {
  return path.resolve(targetPath).toLowerCase();
}

function isPathInside(parentPath, childPath) {
  const parent = normalizeForPathCompare(parentPath);
  const child = normalizeForPathCompare(childPath);
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function validateSourceCleanupPath(targetPath, sourceRoot) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedSourceRoot = sourceRoot ? path.resolve(sourceRoot) : "";
  if (resolvedTarget === path.parse(resolvedTarget).root) {
    throw new Error("Refusing to delete a drive root");
  }
  if (resolvedSourceRoot) {
    if (normalizeForPathCompare(resolvedTarget) === normalizeForPathCompare(resolvedSourceRoot)) {
      throw new Error("Refusing to delete the scan source root");
    }
    if (!isPathInside(resolvedSourceRoot, resolvedTarget)) {
      throw new Error("Refusing to delete outside the scan source root");
    }
  }
}

async function removeEmptyParentDirectories(startPath, stopAtPath) {
  if (!startPath || !stopAtPath) return;

  const resolvedStart = path.resolve(startPath);
  const startStat = await fs.promises.lstat(resolvedStart).catch(() => null);
  let current =
    startStat?.isDirectory() && !startStat.isSymbolicLink()
      ? resolvedStart
      : path.dirname(resolvedStart);
  const stopAt = path.resolve(stopAtPath);

  while (
    current &&
    current !== path.parse(current).root &&
    isPathInside(stopAt, current) &&
    normalizeForPathCompare(current) !== normalizeForPathCompare(stopAt)
  ) {
    const stat = await fs.promises.lstat(current).catch((err) => {
      console.warn(`Empty parent cleanup stopped; cannot stat ${current}: ${err.message}`);
      return null;
    });
    if (!stat) break;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      console.warn(`Empty parent cleanup stopped; not a normal directory: ${current}`);
      break;
    }

    const entries = await fs.promises.readdir(current).catch((err) => {
      console.warn(`Empty parent cleanup stopped; cannot read ${current}: ${err.message}`);
      return null;
    });
    if (!entries || entries.length > 0) break;

    try {
      await fs.promises.rmdir(current);
      console.log(`Deleted empty parent folder: ${current}`);
    } catch (err) {
      console.warn(`Empty parent cleanup stopped; failed to remove ${current}: ${err.message}`);
      break;
    }
    current = path.dirname(current);
  }
}

function dedupeDeletionPaths(paths = []) {
  const seen = new Set();
  return paths
    .filter(Boolean)
    .map((p) => path.resolve(p))
    .filter((p) => {
      const key = normalizeForPathCompare(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.length - a.length);
}

async function deleteLinkedGameFolders(recordId, versionPaths) {
  const pathsToDelete = dedupeDeletionPaths(versionPaths);

  for (const targetPath of pathsToDelete) {
    const resolvedPath = path.resolve(targetPath);
    const parsedPath = path.parse(resolvedPath);

    if (resolvedPath === parsedPath.root) {
      throw new Error("Refusing to delete a drive root");
    }

    if (!(await isAllowedDeletionPath(recordId, resolvedPath))) {
      throw new Error(`Folder is not linked to this game: ${resolvedPath}`);
    }

    const stat = await fs.promises.stat(resolvedPath).catch(() => null);
    if (!stat) continue;

    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedPath}`);
    }

    const deleteResult = await deletePathWithElevationFallback(resolvedPath, {
      recursive: true,
      force: true,
      description: "Delete game folder",
      window: ownerMainWindow,
      validatePath: async (candidatePath) => {
        if (candidatePath === path.parse(candidatePath).root) {
          throw new Error("Refusing to delete a drive root");
        }
        if (!(await isAllowedDeletionPath(recordId, candidatePath))) {
          throw new Error(`Folder is not linked to this game: ${candidatePath}`);
        }
      },
    });
    if (!deleteResult.success) throw new Error(deleteResult.error || "Delete skipped");
    await removeEmptyParentDirectories(
      resolvedPath,
      appConfig?.Library?.gameFolder,
    );
  }
}

async function deleteTitleRecord(recordId, { deleteFiles = false } = {}) {
  if (!recordId) {
    return { success: false, error: "Missing record id" };
  }

  try {
    const versionPaths = await getVersionPathsForRecord(recordId);

    if (deleteFiles) {
      await deleteLinkedGameFolders(recordId, versionPaths);
    }

    const result = await deleteGameCompletely(
      recordId,
      getAssetBasePath(),
      process.defaultApp,
    );

    if (!result.success) return result;

    recentlyDeletedGamePaths.set(recordId, versionPaths);
    setTimeout(() => recentlyDeletedGamePaths.delete(recordId), 5 * 60 * 1000);

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("game-deleted", recordId);
      }
    });

    return { success: true };
  } catch (err) {
    console.error("delete-title failed:", err);
    return { success: false, error: err.message };
  }
}

async function getTrustedVersion(recordId, version) {
  if (!recordId) {
    throw new Error("Missing record id");
  }

  const selectedVersion = await getVersionForRecord(recordId, version);
  if (!selectedVersion) {
    throw new Error("Version not found");
  }
  if (!selectedVersion.isInstalled) {
    throw new Error("Version is not installed or its paths are missing");
  }
  return selectedVersion;
}

async function isAllowedDeletionPath(recordId, folderPath, libraryRoot = null) {
  if (!recordId || !folderPath || typeof folderPath !== "string") return false;

  const resolvedPath = path.resolve(folderPath);
  const knownVersionPaths = await getVersionPathsForRecord(recordId);
  const recentlyDeletedPaths = recentlyDeletedGamePaths.get(recordId) || [];
  if (
    [...knownVersionPaths, ...recentlyDeletedPaths].some(
      (knownPath) => normalizeForPathCompare(knownPath) === normalizeForPathCompare(resolvedPath),
    )
  ) {
    return true;
  }

  return Boolean(
    libraryRoot &&
      fs.existsSync(libraryRoot) &&
      isPathInside(libraryRoot, resolvedPath),
  );
}

async function removePathIfExists(targetPath) {
  if (!targetPath) return;
  try {
    await deletePathWithElevationFallback(targetPath, {
      recursive: true,
      force: true,
      description: "Remove incomplete import files",
      window: ownerMainWindow,
    });
  } catch (err) {
    console.error(`Failed to remove incomplete import path ${targetPath}:`, err);
  }
}

// Move a directory robustly. On Windows fs.rename frequently fails with EPERM /
// EBUSY / EACCES even when the destination doesn't exist, because antivirus,
// Search Indexer, or a lingering file handle is momentarily holding the freshly
// extracted files. Retry with backoff, then fall back to copy + delete (which
// also covers cross-volume moves). ENOTEMPTY is handled by the existing
// getUniquePath check before this is called, but is retried here too for safety.
async function moveDirWithRetry(src, dest, { attempts = 6, baseDelayMs = 150 } = {}) {
  const retryableCodes = ["EPERM", "EACCES", "EBUSY", "ENOTEMPTY", "EEXIST"];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fsp.rename(src, dest);
      return;
    } catch (err) {
      const isRetryable = retryableCodes.includes(err.code) || err.code === "EXDEV";
      const lastAttempt = attempt === attempts;
      if (!isRetryable) throw err;
      if (lastAttempt || err.code === "EXDEV") {
        // Final fallback (or cross-device): copy then remove the source. cp with
        // force overwrites anything a partially-failed rename may have created.
        await fsp.cp(src, dest, { recursive: true, force: true });
        await removePathIfExists(src);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}

async function replaceInstalledVersionAfterImport({
  recordId,
  newVersion,
  newGamePath,
  replaceVersion,
  replaceVersionId,
  oldVersionSnapshot = null,
  trustedOldPath = null,
  deleteDatabaseRow = true,
  libraryRoot = null,
  auditDataDir = null,
  sender = ownerMainWindow,
}) {
  const selectedReplaceVersion = String(replaceVersion || "").trim();
  if (!recordId || !selectedReplaceVersion) return { replaced: false };
  const audit = (stage, details = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      stage,
      recordId,
      replaceVersion: selectedReplaceVersion,
      replaceVersionId: replaceVersionId || null,
      newVersion: String(newVersion || ""),
      newGamePath: newGamePath || "",
      ...details,
    };
    console.log("[ReplacementAudit]", JSON.stringify(entry));
    try {
      fs.appendFileSync(
        path.join(auditDataDir || process.cwd(), "replacement-audit.jsonl"),
        `${JSON.stringify(entry)}\n`,
        "utf8",
      );
    } catch (auditErr) {
      console.warn("Failed to write replacement audit:", auditErr.message);
    }
  };
  audit("start");

  const normalizedNewVersion = String(newVersion || "").trim().toLowerCase();
  const normalizedReplaceVersion = selectedReplaceVersion.toLowerCase();

  if (normalizedNewVersion && normalizedNewVersion === normalizedReplaceVersion) {
    audit("skipped-same-version-label");
    return {
      replaced: false,
      skipped: true,
      reason: "Replacement version matches the newly imported version",
    };
  }

  const selectedVersionId = Number.parseInt(replaceVersionId, 10);
  const oldVersion = oldVersionSnapshot || (Number.isInteger(selectedVersionId) && selectedVersionId > 0
    ? await dbGet(
        db,
        `SELECT rowid AS version_id, version, game_path, exec_path
         FROM versions WHERE rowid = ? AND record_id = ? LIMIT 1`,
        [selectedVersionId, recordId],
      )
    : await getVersionForRecord(recordId, selectedReplaceVersion));
  if (!oldVersion) {
    audit("selected-version-not-found");
    return {
      replaced: false,
      skipped: true,
      reason: "Replacement version was not found",
    };
  }

  const oldPath = oldVersion.game_path;
  audit("selected-version-resolved", {
    resolvedVersionId: oldVersion.version_id || null,
    resolvedVersion: oldVersion.version || "",
    oldPath: oldPath || "",
  });
  if (!oldPath) {
    if (oldVersion.version_id) {
      await dbRun(db, `DELETE FROM versions WHERE rowid = ? AND record_id = ?`, [oldVersion.version_id, recordId]);
    } else {
      await deleteVersion(recordId, selectedReplaceVersion);
    }
    return { replaced: true, deletedFiles: false };
  }

  const resolvedOldPath = path.resolve(oldPath);
  const resolvedNewPath = newGamePath ? path.resolve(newGamePath) : "";

  if (
    resolvedNewPath &&
    normalizeForPathCompare(resolvedOldPath) ===
      normalizeForPathCompare(resolvedNewPath)
  ) {
    return {
      replaced: false,
      skipped: true,
      reason: `Replacement path matches the newly imported path: ${resolvedOldPath}`,
    };
  }

  const hadOldFiles = fs.existsSync(resolvedOldPath);
  const oldPathAllowed = trustedOldPath === null
    ? await isAllowedDeletionPath(recordId, resolvedOldPath, libraryRoot)
    : trustedOldPath === true;
  audit("path-check", {
    resolvedOldPath,
    resolvedNewPath,
    hadOldFiles,
    allowedDeletionPath: hadOldFiles ? oldPathAllowed : null,
    trustCapturedBeforeVersionUpdate: trustedOldPath !== null,
  });
  if (hadOldFiles) {
    if (!oldPathAllowed) {
      return {
        replaced: false,
        skipped: true,
        reason: `Replacement path is not allowed for deletion: ${resolvedOldPath}`,
      };
    }

    const parsedPath = path.parse(resolvedOldPath);
    if (resolvedOldPath === parsedPath.root) {
      return {
        replaced: false,
        skipped: true,
        reason: `Refusing to delete a drive root: ${resolvedOldPath}`,
      };
    }

    const stat = await fs.promises.stat(resolvedOldPath);
    if (!stat.isDirectory()) {
      return {
        replaced: false,
        skipped: true,
        reason: `Replacement path is not a directory: ${resolvedOldPath}`,
      };
    }

    try {
      const deleteResult = await deletePathWithElevationFallback(resolvedOldPath, {
        recursive: true,
        force: true,
        description: `Delete old version ${selectedReplaceVersion}`,
        window: sender,
        validatePath: async (candidatePath) => {
          if (candidatePath === path.parse(candidatePath).root) {
            throw new Error("Refusing to delete a drive root");
          }
          if (normalizeForPathCompare(candidatePath) !== normalizeForPathCompare(resolvedOldPath)) {
            throw new Error("Replacement delete target changed");
          }
          if (!oldPathAllowed) {
            throw new Error("Replacement path was not trusted before the version update");
          }
        },
        onProgress: (text) => {
          sender?.webContents?.send("import-progress", {
            text,
            progress: 0,
            total: 0,
            canCancel: true,
          });
        },
      });
      audit("file-delete-result", {
        resolvedOldPath,
        deleteResult,
        existsAfterDelete: fs.existsSync(resolvedOldPath),
      });
      if (!deleteResult.success) {
        return {
          replaced: false,
          skipped: true,
          reason: deleteResult.canceled
            ? "Administrator delete was canceled"
            : deleteResult.error || `Failed to delete replacement files: ${resolvedOldPath}`,
        };
      }
      await removeEmptyParentDirectories(
        resolvedOldPath,
        libraryRoot,
      );
    } catch (err) {
      return {
        replaced: false,
        skipped: true,
          reason: `Failed to delete replacement files at ${resolvedOldPath}: ${err.message}`,
      };
    }
  }

  if (deleteDatabaseRow && oldVersion.version_id) {
    const deleteRowResult = await dbRun(db, `DELETE FROM versions WHERE rowid = ? AND record_id = ?`, [oldVersion.version_id, recordId]);
    audit("database-delete-result", {
      resolvedVersionId: oldVersion.version_id,
      changes: deleteRowResult?.changes ?? null,
    });
  } else if (deleteDatabaseRow) {
    const deleteRowResult = await deleteVersion(recordId, selectedReplaceVersion);
    audit("database-delete-result", {
      resolvedVersionId: null,
      changes: deleteRowResult?.changes ?? null,
    });
  }

  sender?.webContents?.send("import-progress", {
    text: `Replaced old version ${selectedReplaceVersion}`,
    progress: 0,
    total: 0,
    canCancel: true,
  });

  audit("complete", { deletedFiles: hadOldFiles, databaseRowUpdatedInPlace: !deleteDatabaseRow });
  return { replaced: true, deletedFiles: hadOldFiles };
}



const normalizeImportMatchState = (game = {}) => {
  const results = Array.isArray(game.results) ? game.results : [];
  if (results.length === 1 && results[0]?.key === "match") {
    return { ...game, results, resultSelectedValue: "match", resultVisibility: "visible" };
  }
  if (results.length > 1) {
    const selectedValue = results.some((result) => result.key === game.resultSelectedValue)
      ? game.resultSelectedValue
      : results[0]?.key || "";
    return { ...game, results, resultSelectedValue: selectedValue, resultVisibility: "visible" };
  }
  return { ...game, results: [], resultSelectedValue: "", resultVisibility: "hidden" };
};

const normalizeF95IdInput = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const threadMatch = raw.match(/f95zone\.to\/threads\/(?:[^/?#]*\.)?(\d+)(?:[/?#]|$)/i);
  if (threadMatch) return threadMatch[1];
  const prefixedMatch = raw.match(/\bf95[\s_-]*(\d+)\b/i);
  if (prefixedMatch) return prefixedMatch[1];
  return /^\d+$/.test(raw) ? raw : "";
};

const normalizeLewdCornerIdInput = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const prefixedMatch = raw.match(/\b(?:lc|lewdcorner|lewd\s*corner)[\s_-]*(\d+)\b/i);
  if (prefixedMatch) return prefixedMatch[1];
  const parsedUrlId = parseLewdCornerIdFromUrl(raw);
  if (parsedUrlId) return String(parsedUrlId);
  return /^\d+$/.test(raw) && Number(raw) > 0 ? raw : "";
};

const hydrateImportMatch = async (game, selectedValue) => {
  let updatedGame = normalizeImportMatchState({ ...game, resultSelectedValue: selectedValue });
  const selected = game.results?.find((result) => result.key === selectedValue);

  if (selected && selectedValue !== "match") {
    const parts = String(selected.value || "").split(" | ");
    updatedGame = {
      ...updatedGame,
      atlasId: selected.atlasId || parts[0],
      f95Id: selected.f95Id || parts[1] || updatedGame.f95Id || "",
      lcId: selected.lcId || updatedGame.lcId || updatedGame.lewdCornerId || "",
      lewdCornerId: selected.lcId || updatedGame.lewdCornerId || updatedGame.lcId || "",
      lewdCornerSiteUrl: selected.lewdCornerSiteUrl || updatedGame.lewdCornerSiteUrl || "",
      title: selected.title || parts[2],
      creator: selected.creator || parts[3],
      engine: selected.engine || updatedGame.engine,
      latestVersion: selected.latestVersion || updatedGame.latestVersion || "",
    };
    const atlasData = await getAtlasData(updatedGame.atlasId);
    updatedGame = {
      ...updatedGame,
      engine: atlasData.engine || updatedGame.engine || "Unknown",
      f95Id: atlasData.f95_id || updatedGame.f95Id || "",
      siteUrl: atlasData.siteUrl || atlasData.site_url || updatedGame.siteUrl || "",
      latestVersion: atlasData.latestVersion || "",
    };
  }

  const status = await getImportRecordStatus(updatedGame);
  const recordExist = status?.status === "alreadyImported";
  const isSteamVersion = status?.status === "steamVersion";
  const isLewdCornerVersion = status?.status === "lewdCornerVersion";
  return normalizeImportMatchState({
    ...updatedGame,
    recordExist,
    existingRecordId: status?.recordId || "",
    scanStatus: recordExist
      ? "alreadyImported"
      : isSteamVersion
        ? "steamVersion"
        : isLewdCornerVersion
          ? "lewdCornerVersion"
          : status?.status === "repairPath"
            ? "repairPath"
            : "new",
    scanMessage: recordExist
      ? "Already imported"
      : isSteamVersion
        ? "Add as Steam version"
        : isLewdCornerVersion
          ? "Add as LewdCorner version"
          : status?.status === "repairPath"
            ? "Repair path"
            : updatedGame.isArchive
              ? "Archive"
              : "Ready to import",
  });
};

const chooseInstalledImportMatch = async (game, results) => {
  const baseGame = normalizeImportMatchState({ ...game, results });
  for (const result of results) {
    const candidate = await hydrateImportMatch(baseGame, result.key);
    if (["alreadyImported", "repairPath", "steamVersion", "lewdCornerVersion"].includes(candidate.scanStatus)) {
      return candidate;
    }
  }
  return hydrateImportMatch(baseGame, baseGame.resultSelectedValue || results[0]?.key || "");
};

const buildImportMatchResult = (match) => ({
  key: String(match.atlas_id || match.atlasId || ""),
  value: `${match.atlas_id || match.atlasId || ""} | ${match.f95_id || match.f95Id || ""} | ${match.title || ""} | ${match.creator || ""}`,
  atlasId: String(match.atlas_id || match.atlasId || ""),
  f95Id: match.f95_id || match.f95Id || "",
  lcId: match.lc_id || match.lcId || match.lewdCornerId || "",
  lewdCornerSiteUrl: match.lewdCornerSiteUrl || match.lewdcornerSiteUrl || "",
  title: match.title || "",
  creator: match.creator || "",
  engine: match.engine || "",
  latestVersion: match.latestVersion || "",
});

const applyImportMatchData = (game, match, { f95Id = "", lcId = "" } = {}) => ({
  ...game,
  atlasId: String(match.atlas_id || match.atlasId || ""),
  f95Id: match.f95_id || match.f95Id || f95Id || game.f95Id || "",
  lcId: match.lc_id || match.lcId || match.lewdCornerId || lcId || game.lcId || game.lewdCornerId || "",
  lewdCornerId: match.lc_id || match.lcId || match.lewdCornerId || lcId || game.lewdCornerId || game.lcId || "",
  lewdCornerSiteUrl: match.lewdCornerSiteUrl || match.lewdcornerSiteUrl || game.lewdCornerSiteUrl || "",
  siteUrl: match.siteUrl || match.site_url || game.siteUrl || "",
  title: match.title || game.title,
  creator: match.creator || game.creator,
  engine: match.engine || game.engine || "Unknown",
  latestVersion: match.latestVersion || game.latestVersion || "",
});

// ── IPC Handlers ───────────────────────────────────────────────────

module.exports = function registerImporterHandlers(ctx) {
  const {
    mainWindow, importerWindow, appConfig, configPath, dataDir,
    searchAtlas, searchAtlasByF95Id, findF95Id, getAtlasData,
    addAtlasMapping, GetAtlasIDbyRecord, checkPathExist, findExistingRecordForImport,
    getImportRecordStatus, checkRecordExist, addGame, addVersion,
    upsertVersion, updateVersion, updateGame, updateFolderSize, getSteamIDbyRecord,
    addSteamMapping, getBannerUrl, getScreensUrlList,
    updateBanners, updatePreviews,
    getRemoteBannerUrl, getRemotePreviewUrls,
    getAllDownloadableAssetUrlsForRecord, upsertMediaAsset,
    getVersionForRecord, getVersionPathsForRecord,
    deleteVersion, deleteGameCompletely, deleteTitleRecord,
    getTrustedVersion, isAllowedDeletionPath, isPathInside,
    normalizeForPathCompare, removeEmptyParentDirectories,
    showExecutableChooser, executableChooserWindow,
    startSteamScan, startScan, getAssetBasePath, getMediaStorageMode,
    getMetadataSourceOrder,
    recentlyDeletedGamePaths, db,
  } = ctx
  ownerMainWindow = mainWindow

  // ── Phase 3: import owned Steam games (incl. not installed) ────────────────
  //
  // Creates a metadata-only library record for an owned Steam game the user
  // hasn't installed. Reuses the existing Steam Store metadata pipeline
  // (fetchAndStoreSteamData) and the same games/steam_mappings/versions helpers
  // the installed-scan uses. The key difference: the version row is written with
  // an empty game_path, which the version reader already maps to
  // isInstalled:false / installState:"missing" — so the record shows up as
  // not-installed everywhere and the detail page's Steam INSTALL button targets
  // it. Installing later (via steam://install) fills in the real path on rescan.
  //
  // Idempotent: if a record already owns this appid, we return it untouched
  // rather than duplicating.
  const importOwnedSteamGame = async (appid, name, installDir = '', assetSourceOrder = null) => {
    const steamId = String(appid || '').trim()
    if (!/^\d+$/.test(steamId)) {
      return { ok: false, appid, error: 'Invalid Steam appid.' }
    }
    const dir = String(installDir || '').trim()

    // Pull Store metadata + art FIRST. This also (re)writes steam_data for this
    // appid including its server-provided atlas_id, which the record resolution
    // below relies on to group seasons: several Steam appids can map to one
    // atlas_id, and we want the new appid to attach to whichever record already
    // represents that atlas rather than spawning a duplicate tile. Non-fatal if
    // it fails — we can still create a minimal record from the owned-games name.
    // assetSourceOrder, when provided, overrides the configured default (used by
    // the UI's "retry with CDN" fallback after a GetItems rate-limit).
    let meta = null
    try {
      meta = await fetchAndStoreSteamData(
        db,
        steamId,
        assetSourceOrder || ctx.appConfig?.Metadata?.steamAssetSourceOrder,
      )
    } catch (err) {
      console.warn(`Phase3: metadata fetch failed for ${steamId}:`, err.message)
    }

    // Resolve the target record AFTER metadata is stored, so atlas grouping can
    // see this appid's atlas_id. findRecordBySteamId matches, in order: an
    // existing steam_mapping for this appid, an atlas/f95 record listing it in
    // external_ids, or any record already mapped to this appid's atlas_id.
    const existing = await findRecordBySteamId(steamId)

    // Independently resolve which ATLAS this appid belongs to (via
    // atlas_data.external_ids / steam_appids[]). This is what lets a first-time
    // import attach to the right catalog game and use the atlas's canonical
    // title, instead of creating a standalone record from the Steam title that
    // then has to be mapped by hand.
    const atlasMatch = await findAtlasBySteamId(steamId)

    // Title preference: the atlas canonical title (so all seasons share one
    // tile named like the catalog) > the Steam store title > the owned-games
    // name > a last-resort placeholder.
    const title = String(
      (atlasMatch && atlasMatch.title) || meta?.title || name || `Steam App ${steamId}`
    ).trim()
    const creator = String(meta?.developer || 'Unknown').trim()
    const engine = String(meta?.engine || '').trim()

    // Reuse the resolved record if we have one, else create it. addGame also
    // dedups by title/creator.
    const recordId = existing || (await addGame({ title, creator, engine }))

    // Map the record to the atlas so it groups with any other seasons and pulls
    // atlas metadata. Safe/idempotent: only maps when we found an atlas and the
    // record isn't already mapped to one.
    if (atlasMatch && atlasMatch.atlasId != null) {
      try {
        const currentAtlas = await GetAtlasIDbyRecord(recordId)
        if (!currentAtlas) {
          await addAtlasMapping(recordId, atlasMatch.atlasId)
        }
      } catch (mapErr) {
        console.warn(`Phase3: atlas mapping failed for record ${recordId} -> atlas ${atlasMatch.atlasId}:`, mapErr.message)
      }
    }

    // steam_mappings.record_id is the PRIMARY KEY, so a record can hold only one
    // title-level appid. Per the season design, versions.source_app_id is the
    // source of truth for per-version identity; steam_mappings is kept only as a
    // legacy title-level pointer. Set it only when the record has none yet (the
    // first appid wins and stays), so adding Season 2 doesn't repoint the tile.
    const hasMapping = await recordHasSteamMapping(recordId)
    if (!hasMapping) {
      await addSteamMapping(recordId, steamId)
    }

    // Version label = this appid's own Steam title (e.g. "Lust Theory Season 2"),
    // so each season is a distinct, human-named version under the shared atlas
    // tile — even though the record/tile itself is named with the atlas title.
    // Falls back to the atlas/record title only if Steam gave us nothing.
    const seasonTitle = String(meta?.title || name || `Steam App ${steamId}`).trim()
    const versionLabel = await uniqueSteamVersionLabel(recordId, seasonTitle, steamId)

    // Version path: if the game is locally installed, use its real Steam install
    // directory (…/steamapps/common/<game>) so the version reader recognizes it
    // as installed and it shows in the banner/library view + launches via
    // steam://run. If not installed, keep the path empty — the record then reads
    // as not-installed and appears under the All/Uninstalled install-state
    // filter. upsertVersion (keyed on record_id + version) updates the same
    // version in place on re-add rather than duplicating.
    await upsertVersion({ version: versionLabel, folder: dir, execPath: '', folderSize: 0, source: 'steam', sourceAppId: steamId }, recordId)

    return {
      ok: true,
      appid: steamId,
      recordId,
      title,
      versionLabel,
      rateLimited: meta?.__rateLimited === true,
      installed: Boolean(dir),
      alreadyPresent: Boolean(existing),
    }
  }

  // Single add.
  ipcMain.handle('steam-add-owned-game', async (event, { appid, name, installDir, assetSourceOrder } = {}) => {
    try {
      const result = await importOwnedSteamGame(appid, name, installDir, assetSourceOrder)
      // Tell every window to refresh its library so the new/updated record shows
      // up immediately (reuses the same signal a normal import emits).
      if (result?.ok) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send('import-complete')
        })
      }
      return result
    } catch (err) {
      console.error('steam-add-owned-game error:', err)
      return { ok: false, appid, error: err.message || 'Could not add game.' }
    }
  })

  // Which of the given appids already have an actual Steam VERSION in Atlas.
  // Keyed on a steam-tagged version (source='steam' + matching appid), not just
  // a title-level mapping or a cross-source external_id — so an F95 title that
  // merely references the appid still shows as needing its Steam version added.
  ipcMain.handle('steam-owned-existing', async (event, { appids = [] } = {}) => {
    const present = []
    try {
      for (const appid of Array.isArray(appids) ? appids : []) {
        const id = String(appid)
        const row = await dbGet(
          db,
          `SELECT 1 FROM versions WHERE source = 'steam' AND source_app_id = ? LIMIT 1`,
          [id],
        )
        if (row) present.push(id)
      }
      return { ok: true, present }
    } catch (err) {
      console.error('steam-owned-existing error:', err)
      return { ok: false, present: [], error: err.message }
    }
  })

  // Detail-page install poll. Given a record_id (or appid), check whether its
  // Steam game is now installed on disk. If it just became installed, heal the
  // version path so the record reads as installed, and return the refreshed
  // game. Cheap enough to call on a timer. Returns:
  //   { ok, installed, changed, game? }
  ipcMain.handle('steam-check-installed', async (event, { recordId, appid, version } = {}) => {
    try {
      let steamId = String(appid || '').trim()
      if (!steamId && recordId != null) {
        steamId = String((await getSteamIDbyRecord(recordId)) || '').trim()
      }
      if (!/^\d+$/.test(steamId)) {
        return { ok: false, installed: false, changed: false, error: 'No Steam appid for this game.' }
      }

      const { installed, installDir } = await isSteamAppInstalled(steamId)

      // Resolve the record if we only got an appid.
      let rid = recordId
      if (rid == null) rid = await findRecordBySteamId(steamId)

      let changed = false
      let game = null
      if (rid != null) {
        // Read current install state from the DB record.
        const current = await getGame(rid, getAssetBasePath(), process.defaultApp, getMediaStorageMode()).catch(() => null)
        const wasInstalled = current?.hasInstalledVersion === true
        if (installed && !wasInstalled) {
          // Heal the specific Steam version (by name when known, else 'Steam'),
          // keeping its source tag so it stays identifiable.
          await upsertVersion(
            { version: version || 'Steam', folder: installDir || '', execPath: '', folderSize: 0, source: 'steam', sourceAppId: steamId },
            rid,
          )
          changed = true
          // Notify all windows so the library refreshes too.
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('import-complete')
          })
        }
        game = await getGame(rid, getAssetBasePath(), process.defaultApp, getMediaStorageMode()).catch(() => null)
      }

      return { ok: true, installed, changed, game }
    } catch (err) {
      console.error('steam-check-installed error:', err)
      return { ok: false, installed: false, changed: false, error: err.message }
    }
  })

  // Bulk add. `games` is [{ appid, name }]. Runs sequentially to stay gentle on
  // the Steam Store API (which rate-limits) and emits progress to the importer
  // window. Returns a per-game summary.
  ipcMain.handle('steam-add-owned-bulk', async (event, { games = [], assetSourceOrder = null } = {}) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const list = Array.isArray(games) ? games : []
    const results = { added: 0, skipped: 0, failed: 0, total: list.length, errors: [], rateLimited: false, processed: 0 }

    const emit = (text, done) => {
      ownerWindow?.webContents?.send('steam-bulk-progress', {
        text,
        done,
        total: list.length,
      })
    }

    for (let i = 0; i < list.length; i++) {
      const g = list[i]
      emit(`Adding ${g?.name || g?.appid} (${i + 1}/${list.length})`, i)
      try {
        const r = await importOwnedSteamGame(g?.appid, g?.name, g?.installDir, assetSourceOrder)
        if (r.ok && r.alreadyPresent) results.skipped++
        else if (r.ok) results.added++
        else {
          results.failed++
          results.errors.push({ appid: g?.appid, error: r.error })
        }
        // If Steam started rate-limiting the image API, stop early rather than
        // hammering it — the records added past this point would get poor art
        // anyway. Report it so the UI can offer a fallback source.
        if (r.rateLimited) {
          results.rateLimited = true
          results.processed = i + 1
          emit(`Stopped: Steam rate-limited image requests`, i + 1)
          break
        }
      } catch (err) {
        results.failed++
        results.errors.push({ appid: g?.appid, error: err.message })
      }
      results.processed = i + 1
      // Small courtesy delay between Store API hits.
      await new Promise((res) => setTimeout(res, 250))
    }

    if (!results.rateLimited) emit('Done', list.length)
    // Refresh every window's library once the batch finishes.
    if (results.added > 0 || results.skipped > 0) {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('import-complete')
      })
    }
    return { ok: true, ...results }
  })


ipcMain.handle("select-catalog-import-source", async (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const currentConfig = ctx.appConfig || appConfig || {};
  const archiveExtensions = getConfiguredExtractionExtensions(currentConfig);
  const gameExtensions = getConfiguredGameExtensions(currentConfig);
  const sourceType = await dialog.showMessageBox(ownerWindow, {
    type: "question",
    title: "Choose import source",
    message: "What do you want to import?",
    buttons: ["Folder", "Archive or executable", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (sourceType.response === 2) return null;
  const result = await showOpenDialog(ownerWindow, {
    title: sourceType.response === 0 ? "Choose game folder" : "Choose archive or executable",
    properties: [sourceType.response === 0 ? "openDirectory" : "openFile"],
    ...(sourceType.response === 0 ? {} : {
      filters: [
        { name: "Game files and archives", extensions: [...new Set([...archiveExtensions, ...gameExtensions])] },
        { name: "All files", extensions: ["*"] },
      ],
    }),
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("import-catalog-entry", async (event, payload = {}) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (ctx.activeImportSession) {
    return { success: false, error: "Another import is already running" };
  }

  const catalog = payload.catalog || {};
  const rawSourcePath = String(payload.sourcePath || "").trim();
  const requestedVersion = String(payload.version || "").trim();
  const conflictMode = String(payload.conflictMode || "check");
  const deleteSourceArchiveAfterImport = payload.deleteSourceArchiveAfterImport === true;
  const atlasId = toPositiveInteger(catalog.atlas_id ?? catalog.atlasId);
  const f95Id = toPositiveInteger(catalog.f95_id ?? catalog.f95Id);
  const lcId = getLewdCornerIdFromGame(catalog);
  const steamId = toPositiveInteger(catalog.steam_id ?? catalog.steamId ?? catalog.steam_appid);
  const gogId = toPositiveInteger(catalog.gog_id ?? catalog.gogId ?? catalog.gog_appid);

  try {
    if (!rawSourcePath) {
      return { success: false, error: "Dropped path was empty" };
    }
    const sourcePath = path.resolve(rawSourcePath);
    const stat = await fsp.stat(sourcePath).catch((err) => {
      if (err?.code === "ENOENT") return null;
      throw err;
    });
    if (!stat) {
      return { success: false, error: "Dropped path does not exist" };
    }
    if (!stat.isDirectory() && !stat.isFile()) {
      return { success: false, error: "Import source must be a folder or file" };
    }

    const currentConfig = ctx.appConfig || appConfig || {};
    let targetLibrary = currentConfig?.Library?.gameFolder;
    if (!targetLibrary || !fs.existsSync(targetLibrary)) {
      const pick = await showOpenDialog(ownerWindow, {
        title: "Choose Library folder for this import",
        properties: ["openDirectory", "createDirectory"],
      });
      if (pick.canceled || !pick.filePaths?.length) {
        return { success: false, canceled: true, error: "Library folder is required" };
      }
      targetLibrary = pick.filePaths[0];
      const nextConfig = {
        ...currentConfig,
        Library: {
          ...(currentConfig?.Library || {}),
          gameFolder: targetLibrary,
        },
      };
      fs.writeFileSync(configPath, ini.stringify(nextConfig));
      ctx.appConfig = nextConfig;
    }

    const version = normalizeVersionName(requestedVersion || inferCatalogImportVersion(sourcePath, catalog));
    const destinationFormat = currentConfig?.Library?.libraryFolderStructure || "{creator}/{title}/{version}";
    const importGame = {
      title: String(catalog.title || catalog.name || catalog.short_name || "Untitled").trim(),
      creator: String(catalog.creator || catalog.developer || catalog.steam_developer || "Unknown").trim(),
      engine: String(catalog.engine || "").trim(),
      description: String(catalog.overview || catalog.description || "").trim(),
      version,
      atlasId,
      f95Id,
      lcId,
      steamId,
    };

    let recordId = null;
    const mappingRow = await dbGet(
      db,
      `SELECT record_id FROM atlas_mappings WHERE ? IS NOT NULL AND atlas_id = ?
       UNION
       SELECT record_id FROM lewdcorner_mappings WHERE ? IS NOT NULL AND lc_id = ?
       UNION
       SELECT record_id FROM f95_zone_mappings WHERE ? IS NOT NULL AND f95_id = ?
       UNION
       SELECT record_id FROM steam_mappings WHERE ? IS NOT NULL AND steam_id = ?
       UNION
       SELECT record_id FROM gog_mappings WHERE ? IS NOT NULL AND gog_id = ?
       LIMIT 1`,
      [atlasId, atlasId, lcId, lcId, f95Id, f95Id, steamId, steamId, gogId, gogId],
    );
    if (mappingRow?.record_id) recordId = mappingRow.record_id;
    if (!recordId && lcId) recordId = await findRecordByLewdCornerId(lcId);
    if (!recordId && steamId) recordId = await findRecordBySteamId(steamId);
    if (!recordId && gogId) recordId = await findRecordByGogId(gogId);
    if (!recordId) {
      const titleRow = await dbGet(
        db,
        `SELECT record_id FROM games WHERE title = ? AND creator = ? LIMIT 1`,
        [importGame.title, importGame.creator],
      );
      if (titleRow?.record_id) recordId = titleRow.record_id;
    }

    if (recordId) {
      const existingVersion = await dbGet(
        db,
        `SELECT rowid AS version_id, version FROM versions WHERE record_id = ? AND version = ? LIMIT 1`,
        [recordId, version],
      );
      if (existingVersion && conflictMode === "check") {
        let counter = 2;
        let suggestedVersion = `${version} (${counter})`;
        while (await dbGet(db, `SELECT 1 FROM versions WHERE record_id = ? AND version = ? LIMIT 1`, [recordId, suggestedVersion])) {
          counter++;
          suggestedVersion = `${version} (${counter})`;
        }
        return {
          success: false,
          conflict: true,
          recordId,
          existingVersion: existingVersion.version,
          suggestedVersion,
          message: `Version "${version}" already exists for this title.`,
        };
      }
      if (existingVersion && conflictMode === "cancel") {
        return { success: false, canceled: true, conflict: true };
      }
    }

    const session = {
      cancelRequested: false,
      progress: 0,
      total: 100,
      cleanupPaths: [],
      currentExtractionWorker: null,
    };
    ctx.activeImportSession = session;
    const notify = (text, progress = 0, total = 100) => {
      ownerWindow?.webContents?.send("import-progress", {
        text,
        progress,
        total,
        canCancel: false,
      });
    };

    let gamePath = "";
    let execPath = "";
    let relativeExec = "";
    const targetBase = getUniquePath(buildStructuredImportPath(targetLibrary, destinationFormat, importGame));
    const extensions = getConfiguredGameExtensions(currentConfig);
    const archiveExtensions = getConfiguredExtractionExtensions(currentConfig);
    const sourceIsArchive = stat.isFile() && isArchiveFilePath(sourcePath, currentConfig);
    if (stat.isFile() && !isArchiveFilePath(sourcePath, currentConfig)) {
      const ext = path.extname(sourcePath).toLowerCase().replace(/^\./, "");
      if (archiveExtensions.length > 0 && ["zip", "7z", "rar"].includes(ext) && !archiveExtensions.includes(ext)) {
        return { success: false, error: `Archive type .${ext} is not enabled in extraction extensions` };
      }
      if (!extensions.includes(ext)) {
        return { success: false, error: `Dropped path is not a supported folder/archive/launchable file: .${ext || "unknown"}` };
      }
    }

    notify(`Importing ${importGame.title}...`, 5);

    if (stat.isDirectory()) {
      notify(`Copying ${importGame.title} to Library...`, 20);
      await fsp.mkdir(path.dirname(targetBase), { recursive: true });
      await fsp.cp(sourcePath, targetBase, { recursive: true });
      gamePath = targetBase;
      const execs = findExecutables(gamePath, extensions);
      relativeExec = execs[0] || "";
      execPath = relativeExec ? path.join(gamePath, relativeExec) : "";
    } else if (sourceIsArchive) {
      const resolvedSevenZip = await resolveSevenZipExecutablePath({
        configuredPath: currentConfig?.Library?.sevenZipPath,
        currentConfig,
        currentConfigPath: configPath,
        ownerWindow,
        notify: (text) => notify(text, 10),
      });
      if (!resolvedSevenZip?.path) throw new Error("7-Zip is required for archive import");
      notify(`Extracting ${importGame.title}...`, 15);
      const extraction = await extractArchiveWithFallback({
        archivePath: sourcePath,
        finalPath: targetBase,
        sevenZipBin: resolvedSevenZip.path,
        session,
        progressWindow: ownerWindow,
        useBundledRarExtractor:
          isRarArchivePath(sourcePath) && resolvedSevenZip.source === "bundled",
        currentConfig,
        currentConfigPath: configPath,
        ownerWindow,
        notify: (text) => notify(text, 15),
      });
      gamePath = extraction.finalPath || targetBase;

      const items = await fsp.readdir(gamePath, { withFileTypes: true }).catch(() => []);
      const dirs = items.filter((item) => item.isDirectory());
      const files = items.filter((item) => item.isFile());
      if (dirs.length === 1 && files.length === 0) {
        const subPath = path.join(gamePath, dirs[0].name);
        const subItems = await fsp.readdir(subPath);
        for (const item of subItems) {
          await fsp.rename(path.join(subPath, item), path.join(gamePath, item));
        }
        await fsp.rmdir(subPath).catch(() => {});
      }

      const execs = findExecutables(gamePath, extensions);
      relativeExec = execs[0] || "";
      execPath = relativeExec ? path.join(gamePath, relativeExec) : "";
    } else if (stat.isFile()) {
      notify(`Copying ${path.basename(sourcePath)}...`, 25);
      await fsp.mkdir(targetBase, { recursive: true });
      const destFile = path.join(targetBase, path.basename(sourcePath));
      await fsp.copyFile(sourcePath, destFile);
      gamePath = targetBase;
      relativeExec = path.basename(destFile);
      execPath = destFile;
    }

    if (!gamePath) throw new Error("Import did not produce a game folder");

    if (!recordId) {
      // Blank fields are kept blank on the scan rows (task: don't show
      // "Unknown" in the table); the "Unknown"/"Untitled" fallbacks are applied
      // here, at import time, so the DB never stores an empty title/creator.
      const importEngine = (importGame.engine && String(importGame.engine).trim()) || "Unknown";
      const importCreator = (importGame.creator && String(importGame.creator).trim()) || "Unknown";
      const importTitle = (importGame.title && String(importGame.title).trim()) || "Untitled";
      recordId = await addGame({
        title: importTitle,
        creator: importCreator,
        engine: importEngine,
        description: importGame.description,
      });
      if (importGame.description) {
        await updateGame({
          record_id: recordId,
          title: importTitle,
          creator: importCreator,
          engine: importEngine,
          description: importGame.description,
        });
      }
    }

    if (atlasId) await addAtlasMapping(recordId, atlasId);
    if (lcId) await addLewdCornerMapping(recordId, lcId);
    if (f95Id) await dbRun(db, `INSERT OR IGNORE INTO f95_zone_mappings (record_id, f95_id) VALUES (?, ?)`, [recordId, f95Id]);
    if (steamId) await addSteamMapping(recordId, steamId);
    if (gogId) await addGogMapping(recordId, gogId);

    notify(`Saving ${importGame.title} ${version}...`, 85);
    await upsertVersion(
      {
        version,
        folder: gamePath,
        execPath,
        selectedValue: relativeExec,
      },
      recordId,
    );

    notify(`Imported ${importGame.title}`, 100);
    const refreshedGame = await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode()).catch(() => null);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send("game-updated", refreshedGame || recordId);
    });
    let sourceArchiveDeleted = false;
    let sourceArchiveDeleteError = "";
    if (deleteSourceArchiveAfterImport && sourceIsArchive) {
      const sourceCleanupRoot = path.dirname(sourcePath);
      try {
        const deleteResult = await deletePathWithElevationFallback(sourcePath, {
          recursive: false,
          force: true,
          description: `Delete source archive for ${importGame.title}`,
          window: ownerWindow,
          validatePath: (candidatePath) =>
            validateSourceCleanupPath(candidatePath, sourceCleanupRoot),
        });
        if (deleteResult.success) {
          sourceArchiveDeleted = true;
        } else {
          sourceArchiveDeleteError = deleteResult.error || "Source archive delete was skipped.";
        }
      } catch (deleteErr) {
        sourceArchiveDeleteError = deleteErr.message || String(deleteErr);
      }
    }
    return {
      success: true,
      recordId,
      version,
      gamePath,
      execPath,
      game: refreshedGame,
      sourceArchiveDeleted,
      sourceArchiveDeleteError,
      mappings: { atlasId, f95Id, lcId, steamId },
    };
  } catch (err) {
    console.error("import-catalog-entry error:", err);
    return { success: false, error: err.message || String(err) };
  } finally {
    ctx.activeImportSession = null;
  }
});

ipcMain.handle("import-local-game-version", async (event, payload = {}) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (ctx.activeImportSession) {
    return { success: false, error: "Another import is already running" };
  }

  const recordId = toPositiveInteger(payload.recordId || payload.record_id);
  const rawSourcePath = String(payload.sourcePath || "").trim();
  const version = normalizeVersionName(payload.version, "");
  const replaceExisting = payload.replaceExisting === true;
  const replaceVersionId = toPositiveInteger(payload.replaceVersionId || payload.versionId);
  const deleteSourceArchiveAfterImport = payload.deleteSourceArchiveAfterImport === true;

  let gamePath = "";
  let importCommitted = false;
  try {
    if (!recordId) return { success: false, error: "Missing local game record" };
    if (!rawSourcePath) return { success: false, error: "Dropped path was empty" };
    if (!version) return { success: false, error: "Version is required" };

    const gameRow = await dbGet(db, `SELECT record_id, title, creator, engine FROM games WHERE record_id = ? LIMIT 1`, [recordId]);
    if (!gameRow) return { success: false, error: "Local game record was not found" };

    const sourcePath = path.resolve(rawSourcePath);
    const stat = await fsp.stat(sourcePath).catch((err) => {
      if (err?.code === "ENOENT") return null;
      throw err;
    });
    if (!stat) return { success: false, error: "Dropped path does not exist" };
    if (!stat.isDirectory() && !stat.isFile()) {
      return { success: false, error: "Import source must be a folder or file" };
    }

    let replaceRow = null;
    if (replaceExisting) {
      if (!replaceVersionId) return { success: false, error: "No replacement version selected" };
      replaceRow = await dbGet(
        db,
        `SELECT rowid AS version_id, record_id, version, game_path, exec_path
         FROM versions
         WHERE rowid = ? AND record_id = ?
         LIMIT 1`,
        [replaceVersionId, recordId],
      );
      if (!replaceRow) return { success: false, error: "Replacement version does not belong to this game" };
    } else {
      const existingVersion = await dbGet(
        db,
        `SELECT rowid AS version_id FROM versions WHERE record_id = ? AND version = ? LIMIT 1`,
        [recordId, version],
      );
      if (existingVersion) {
        return {
          success: false,
          conflict: true,
          error: "Version already exists. Enable replacement or choose a different version name.",
        };
      }
    }

    if (replaceExisting) {
      const conflict = await dbGet(
        db,
        `SELECT rowid AS version_id FROM versions
         WHERE record_id = ? AND version = ? AND rowid != ?
         LIMIT 1`,
        [recordId, version, replaceVersionId],
      );
      if (conflict) {
        return { success: false, conflict: true, error: "Another version already uses that name." };
      }
    }

    const currentConfig = ctx.appConfig || appConfig || {};
    const destinationFormat = currentConfig?.Library?.libraryFolderStructure || "{creator}/{title}/{version}";
    const importGame = {
      title: gameRow.title || "Untitled",
      creator: gameRow.creator || "Unknown",
      engine: gameRow.engine || "Unknown",
      version,
    };

    let targetBase;
    if (replaceExisting && replaceRow?.game_path) {
      // Replacing an existing version: place the new files in the SAME folder
      // that holds the version being replaced (its parent = the title folder),
      // named for the new version. Previously this derived a "library root" from
      // the old path via path.dirname() and then re-applied
      // {creator}/{title}/{version}, which double-nested creator/title
      // (e.g. E:\Games\W.M\Dogma\W.M\Dogma\v0.4 S2) and pushed files past the
      // Windows path limit so the executable scan came up empty.
      const titleFolder = path.dirname(path.resolve(replaceRow.game_path));
      targetBase = getUniquePath(path.join(titleFolder, sanitizePathSegment(version)));
    } else {
      let targetLibrary = currentConfig?.Library?.gameFolder;
      if (!targetLibrary || !fs.existsSync(targetLibrary)) {
        targetLibrary = path.join(dataDir, "games");
      }
      targetBase = getUniquePath(buildStructuredImportPath(targetLibrary, destinationFormat, importGame));
    }
    const extensions = getConfiguredGameExtensions(currentConfig);
    const archiveExtensions = getConfiguredExtractionExtensions(currentConfig);
    const sourceIsArchive = stat.isFile() && isArchiveFilePath(sourcePath, currentConfig);
    console.log("[LocalImport] Starting import", {
      recordId,
      sourcePath,
      version,
      replaceExisting,
      replaceVersionId,
      sourceIsArchive,
      deleteSourceArchiveAfterImport,
      targetBase,
    });

    if (stat.isFile() && !sourceIsArchive) {
      const ext = path.extname(sourcePath).toLowerCase().replace(/^\./, "");
      if (archiveExtensions.length > 0 && ["zip", "7z", "rar"].includes(ext) && !archiveExtensions.includes(ext)) {
        return { success: false, error: `Archive type .${ext} is not enabled in extraction extensions` };
      }
      if (!extensions.includes(ext)) {
        return { success: false, error: `Dropped path is not a supported folder/archive/launchable file: .${ext || "unknown"}` };
      }
    }

    const session = {
      cancelRequested: false,
      progress: 0,
      total: 100,
      cleanupPaths: [],
      currentExtractionWorker: null,
    };
    ctx.activeImportSession = session;

    let execPath = "";
    let relativeExec = "";

    if (stat.isDirectory()) {
      await fsp.mkdir(path.dirname(targetBase), { recursive: true });
      await fsp.cp(sourcePath, targetBase, { recursive: true });
      gamePath = targetBase;
      const execs = findExecutables(gamePath, extensions);
      console.log("[LocalImport] Folder executable scan", { gamePath, execCount: execs.length, execs });
      relativeExec = execs[0] || "";
      execPath = relativeExec ? path.join(gamePath, relativeExec) : "";
    } else if (sourceIsArchive) {
      const resolvedSevenZip = await resolveSevenZipExecutablePath({
        configuredPath: currentConfig?.Library?.sevenZipPath,
        currentConfig,
        currentConfigPath: configPath,
        ownerWindow,
        notify: () => {},
      });
      if (!resolvedSevenZip?.path) throw new Error("7-Zip is required for archive import");
      const extraction = await extractArchiveWithFallback({
        archivePath: sourcePath,
        finalPath: targetBase,
        sevenZipBin: resolvedSevenZip.path,
        session,
        progressWindow: ownerWindow,
        useBundledRarExtractor:
          isRarArchivePath(sourcePath) && resolvedSevenZip.source === "bundled",
        currentConfig,
        currentConfigPath: configPath,
        ownerWindow,
        notify: () => {},
      });
      gamePath = extraction.finalPath || targetBase;
      console.log("[LocalImport] Archive extracted", { sourcePath, gamePath });
      const items = await fsp.readdir(gamePath, { withFileTypes: true }).catch(() => []);
      const dirs = items.filter((item) => item.isDirectory());
      const files = items.filter((item) => item.isFile());
      if (dirs.length === 1 && files.length === 0) {
        const subPath = path.join(gamePath, dirs[0].name);
        const subItems = await fsp.readdir(subPath);
        for (const item of subItems) {
          await fsp.rename(path.join(subPath, item), path.join(gamePath, item));
        }
        await fsp.rmdir(subPath).catch(() => {});
        console.log("[LocalImport] Flattened single archive root", { gamePath, subPath });
      }
      const execs = findExecutables(gamePath, extensions);
      console.log("[LocalImport] Archive executable scan", { gamePath, execCount: execs.length, execs });
      relativeExec = execs[0] || "";
      execPath = relativeExec ? path.join(gamePath, relativeExec) : "";
    } else {
      await fsp.mkdir(targetBase, { recursive: true });
      const destFile = path.join(targetBase, path.basename(sourcePath));
      await fsp.copyFile(sourcePath, destFile);
      gamePath = targetBase;
      relativeExec = path.basename(destFile);
      execPath = destFile;
    }

    if (!gamePath) throw new Error("Import did not produce a game folder");
    if (!execPath) {
      const sourceKind = sourceIsArchive ? "archive" : stat.isDirectory() ? "folder" : "file";
      throw new Error(
        `No launchable file was found in the imported ${sourceKind}. Source: ${sourcePath}. Imported folder: ${gamePath}`,
      );
    }

    const oldVersionPath = replaceRow?.game_path ? path.resolve(replaceRow.game_path) : "";
    const oldVersionExists = oldVersionPath ? fs.existsSync(oldVersionPath) : false;
    const oldVersionAllowed = oldVersionPath ? await isAllowedDeletionPath(recordId, oldVersionPath) : false;
    const newVersionPath = path.resolve(gamePath);
    console.log("[LocalImport] Replacement cleanup check", {
      recordId,
      replaceExisting,
      oldVersionPath,
      oldVersionExists,
      oldVersionAllowed,
      newVersionPath,
    });

    if (replaceExisting) {
      await updateVersion(
        {
          version_id: replaceVersionId,
          previousVersion: replaceRow.version,
          version,
          game_path: gamePath,
          exec_path: execPath,
        },
        recordId,
      );
      const folderSize = await calculatePathSizeSafe(gamePath);
      if (folderSize !== null) await updateFolderSize(recordId, version, folderSize);
    } else {
      await upsertVersion({ version, folder: gamePath, execPath, selectedValue: relativeExec }, recordId);
    }
    importCommitted = true;

    const refreshedGame = await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode()).catch(() => null);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send("game-updated", refreshedGame || recordId);
    });

    let oldVersionDeleted = false;
    let oldVersionDeleteError = "";
    if (replaceExisting && oldVersionPath) {
      try {
        if (normalizeForPathCompare(oldVersionPath) === normalizeForPathCompare(newVersionPath)) {
          console.log("[LocalImport] Skipping old version cleanup because old and new paths match", { oldVersionPath });
        } else if (!oldVersionExists) {
          console.log("[LocalImport] Skipping old version cleanup because old path no longer exists", { oldVersionPath });
        } else if (!oldVersionAllowed) {
          oldVersionDeleteError = "Old version files were not deleted because the old path is not trusted for deletion.";
        } else {
          const parsedPath = path.parse(oldVersionPath);
          const oldStat = await fsp.stat(oldVersionPath).catch(() => null);
          if (oldVersionPath === parsedPath.root) {
            oldVersionDeleteError = "Old version files were not deleted because Atlas refused to delete a drive root.";
          } else if (!oldStat?.isDirectory()) {
            oldVersionDeleteError = "Old version files were not deleted because the old path is not a folder.";
          } else {
            const deleteResult = await deletePathWithElevationFallback(oldVersionPath, {
              recursive: true,
              force: true,
              description: `Delete old version ${replaceRow.version || ""}`.trim(),
              window: ownerWindow,
              validatePath: async (candidatePath) => {
                if (candidatePath === path.parse(candidatePath).root) throw new Error("Refusing to delete a drive root");
                if (normalizeForPathCompare(candidatePath) !== normalizeForPathCompare(oldVersionPath)) {
                  throw new Error("Refusing to delete a path other than the replaced version folder");
                }
                if (!oldVersionAllowed) throw new Error("Old version path is not trusted for deletion");
                if (normalizeForPathCompare(candidatePath) === normalizeForPathCompare(newVersionPath)) {
                  throw new Error("Refusing to delete the newly imported version folder");
                }
              },
            });
            if (deleteResult.success) {
              oldVersionDeleted = true;
              await removeEmptyParentDirectories(oldVersionPath, currentConfig?.Library?.gameFolder);
            } else {
              oldVersionDeleteError = deleteResult.error || "Old version delete was skipped.";
            }
          }
        }
      } catch (deleteErr) {
        oldVersionDeleteError = deleteErr.message || String(deleteErr);
      }
      if (oldVersionDeleteError) {
        console.warn("[LocalImport] Old version cleanup failed:", oldVersionDeleteError);
      }
    }

    let sourceArchiveDeleted = false;
    let sourceArchiveDeleteError = "";
    if (deleteSourceArchiveAfterImport && sourceIsArchive) {
      try {
        const sourceCleanupRoot = path.dirname(sourcePath);
        const deleteResult = await deletePathWithElevationFallback(sourcePath, {
          recursive: false,
          force: true,
          description: `Delete source archive for ${gameRow.title || "imported game"}`,
          window: ownerWindow,
          validatePath: (candidatePath) =>
            validateSourceCleanupPath(candidatePath, sourceCleanupRoot),
        });
        if (deleteResult.success) {
          sourceArchiveDeleted = true;
          await removeEmptyParentDirectories(sourcePath, sourceCleanupRoot);
        } else {
          sourceArchiveDeleteError = deleteResult.error || "Source archive delete was skipped.";
        }
      } catch (deleteErr) {
        sourceArchiveDeleteError = deleteErr.message || String(deleteErr);
      }
      if (sourceArchiveDeleteError) {
        console.warn("[LocalImport] Source archive cleanup failed:", sourceArchiveDeleteError);
      }
    }

    ownerWindow?.webContents?.send("import-progress", {
      text: `${replaceExisting ? "Replacement" : "Import"} complete`,
      progress: 100,
      total: 100,
      canCancel: false,
      complete: true,
      done: true,
      phase: "done",
    });
    ownerWindow?.webContents?.send("import-complete");
    return {
      success: true,
      recordId,
      version,
      gamePath,
      execPath,
      replaced: replaceExisting,
      oldVersionDeleted,
      oldVersionDeleteError,
      sourceArchiveDeleted,
      sourceArchiveDeleteError,
      game: refreshedGame,
    };
  } catch (err) {
    console.error("import-local-game-version error:", err);
    if (gamePath && !importCommitted) {
      await removePathIfExists(gamePath);
    }
    ownerWindow?.webContents?.send("import-progress", {
      text: `Import failed: ${err.message || String(err)}`,
      progress: 100,
      total: 100,
      canCancel: false,
      complete: true,
      phase: "failed",
    });
    return { success: false, error: err.message || String(err) };
  } finally {
    ctx.activeImportSession = null;
  }
});

ipcMain.handle("cancel-import", async () => {
  if (!ctx.activeImportSession) {
    return { success: false, message: "No import is currently running" };
  }

  ctx.activeImportSession.cancelRequested = true;
  ctx.activeImportSession.currentExtractionWorker?.postMessage("cancel");
  mainWindow?.webContents.send("import-progress", {
    text: "Cancel requested. Cleaning up current import...",
    progress: ctx.activeImportSession.progress || 0,
    total: ctx.activeImportSession.total || 0,
    canceling: true,
    canCancel: false,
  });
  return { success: true };
});

ipcMain.handle("start-scan", async (event, params) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (ctx.activeScanSession && !ctx.activeScanSession.finished) {
    return { success: false, error: "Another scan is already running" };
  }

  const session = {
    scanId: params?.scanId || `scan-${Date.now()}-${nextScanId++}`,
    canceled: false,
    cancelRequested: false,
    startedAt: Date.now(),
    finished: false,
  };
  ctx.activeScanSession = session;
  try {
    await startScan(params, window, session);
    session.finished = true;
    return { success: true, canceled: false, scanId: session.scanId };
  } catch (err) {
    session.finished = true;
    if (err?.canceled || err?.code === "SCAN_CANCELED") {
      return { success: false, canceled: true, error: "Scan canceled", scanId: session.scanId };
    }
    return { success: false, canceled: false, error: err.message, scanId: session.scanId };
  } finally {
    session.finished = true;
    if (ctx.activeScanSession?.scanId === session.scanId) {
      ctx.activeScanSession = null;
    }
  }
});

const makeRenpyImportRow = async (saveRow, searchAtlas, db) => {
  const base = {
    ...saveRow,
    title: saveRow.inferredTitle || saveRow.saveId || "Unknown",
    creator: "Unknown",
    engine: "Ren'Py",
    version: "No version",
    selectedValue: "",
    singleExecutable: "N/A",
    multipleVisible: "hidden",
    executables: [],
    isArchive: false,
    scanStatus: "new",
    scanMessage: "Ready as Uninstalled",
    resultVisibility: "hidden",
    results: [],
    resultSelectedValue: "",
    atlasId: "",
    f95Id: "",
    steamId: "",
    gogId: "",
  };

  let matches = [];
  try {
    matches = await searchAtlas(base.title, "");
  } catch (err) {
    console.warn("Ren'Py save metadata match failed:", err.message || err);
  }

  if (matches.length === 1) {
    const match = matches[0];
    base.atlasId = String(match.atlas_id || "");
    base.f95Id = match.f95_id || "";
    base.title = match.title || base.title;
    base.creator = match.creator || base.creator;
    base.engine = match.engine || base.engine;
    base.description = match.overview || match.description || "";
    base.siteUrl = match.siteUrl || match.site_url || "";
    base.results = [{ key: "match", value: "Match Found" }];
    base.resultSelectedValue = "match";
    base.resultVisibility = "visible";
  } else if (matches.length > 1) {
    base.results = matches.map((match) => ({
      key: String(match.atlas_id),
      value: `${match.atlas_id} | ${match.f95_id || ""} | ${match.title} | ${match.creator}`,
    }));
    base.resultSelectedValue = base.results[0]?.key || "";
    base.resultVisibility = "visible";
  }

  const existing = await findExistingRenpyRecord(base, db).catch(() => null);
  if (existing?.record_id) {
    base.recordId = existing.record_id;
    base.existingRecordId = existing.record_id;
    base.scanMessage = "Already in Library";
  }

  return base;
};

const findExistingRenpyRecord = async (game, db) => {
  const atlasId = toPositiveInteger(game.atlasId || game.atlas_id);
  const f95Id = toPositiveInteger(game.f95Id || game.f95_id);
  const lcId = getLewdCornerIdFromGame(game);
  const steamId = toPositiveInteger(game.steamId || game.steam_id);
  const gogId = toPositiveInteger(game.gogId || game.gog_id);
  const title = String(game.title || "").trim();
  const creator = String(game.creator || "Unknown").trim() || "Unknown";
  const engine = String(game.engine || "Ren'Py").trim() || "Ren'Py";

  if (atlasId || f95Id || lcId || steamId || gogId) {
    const row = await dbGet(
      db,
      `SELECT record_id FROM atlas_mappings WHERE ? IS NOT NULL AND atlas_id = ?
       UNION
       SELECT record_id FROM lewdcorner_mappings WHERE ? IS NOT NULL AND lc_id = ?
       UNION
       SELECT record_id FROM f95_zone_mappings WHERE ? IS NOT NULL AND f95_id = ?
       UNION
       SELECT record_id FROM steam_mappings WHERE ? IS NOT NULL AND steam_id = ?
       UNION
       SELECT record_id FROM gog_mappings WHERE ? IS NOT NULL AND gog_id = ?
       LIMIT 1`,
      [atlasId, atlasId, lcId, lcId, f95Id, f95Id, steamId, steamId, gogId, gogId],
    );
    if (row?.record_id) return row;
    if (lcId) {
      const recordId = await findRecordByLewdCornerId(lcId);
      if (recordId) return { record_id: recordId };
    }
  }

  if (!title) return null;
  return await dbGet(
    db,
    `SELECT record_id FROM games
     WHERE (title = ? AND creator = ?)
        OR (title = ? AND creator = 'Unknown' AND engine = ?)
        OR (title = ? AND engine = ?)
     ORDER BY
       CASE
         WHEN title = ? AND creator = ? THEN 0
         WHEN title = ? AND creator = 'Unknown' AND engine = ? THEN 1
         ELSE 2
       END
     LIMIT 1`,
    [title, creator, title, engine, title, engine, title, creator, title, engine],
  );
};

ipcMain.handle("select-renpy-save-directory", async (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await showOpenDialog(ownerWindow, {
    title: "Select Ren'Py save folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("scan-renpy-saves", async (event, params = {}) => {
  const rootPath = params.rootPath || getDefaultRenpySaveRoot(app);
  const appDataPath = (() => {
    try { return app.getPath("appData"); } catch { return ""; }
  })();
  const rootExists = Boolean(rootPath && fs.existsSync(rootPath));
  console.log("Ren'Py save scan starting", {
    platform: process.platform,
    envAPPDATA: process.env.APPDATA || "",
    appDataPath,
    rootPath: rootPath || "",
    rootExists,
  });
  if (!rootPath || !rootExists) {
    return {
      success: false,
      needsSelection: true,
      canSelectManually: true,
      rootPath: rootPath || "",
      error: "Ren'Py save folder was not found",
      message: "Ren'Py save folder was not found. Select it manually.",
    };
  }

  try {
    const scanResult = await scanRenpySaveFolders(rootPath);
    const rows = scanResult.rows || [];
    console.log("Ren'Py save scan folders", {
      rootPath: scanResult.rootPath,
      totalFolders: scanResult.totalFolders,
      skippedFolders: scanResult.skippedFolders,
      sampleFolders: scanResult.sampleFolders,
    });
    const games = [];
    for (const row of rows) {
      games.push(await makeRenpyImportRow(row, searchAtlas, db));
    }
    return {
      success: true,
      rootPath: scanResult.rootPath || rootPath,
      games,
      rows: games,
      totalFolders: scanResult.totalFolders,
      skippedFolders: scanResult.skippedFolders,
      warning: scanResult.totalFolders === 0 ? `Found 0 folders in ${scanResult.rootPath || rootPath}` : "",
    };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle("import-renpy-save-games", async (event, games = []) => {
  const rows = Array.isArray(games) ? games : [];
  const results = [];
  for (const row of rows) {
    try {
      const savePath = path.resolve(String(row.savePath || row.folder || ""));
      const stat = await fsp.stat(savePath).catch(() => null);
      if (!stat?.isDirectory()) {
        results.push({ success: false, title: row.title, error: "Ren'Py save path is not a folder" });
        continue;
      }

      const importGame = {
        title: String(row.title || row.inferredTitle || row.saveId || "Unknown").trim() || "Unknown",
        creator: String(row.creator || "Unknown").trim() || "Unknown",
        engine: "Ren'Py",
        description: row.description || row.overview || null,
      };
      let recordId = row.recordId || row.existingRecordId || null;
      if (!recordId) {
        const existing = await findExistingRenpyRecord({ ...row, ...importGame }, db);
        if (existing?.record_id) recordId = existing.record_id;
      }
      if (!recordId) recordId = await addGame(importGame);
      if (importGame.description) {
        await updateGame({ ...importGame, record_id: recordId });
      }
      if (row.atlasId) await addAtlasMapping(recordId, row.atlasId);
      const rowLcId = getLewdCornerIdFromGame(row);
      if (rowLcId) await addLewdCornerMapping(recordId, rowLcId);
      if (row.f95Id) {
        await dbRun(
          db,
          `INSERT INTO f95_zone_mappings (record_id, f95_id)
           SELECT ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM f95_zone_mappings WHERE record_id = ? AND f95_id = ?
           )`,
          [recordId, row.f95Id, recordId, row.f95Id],
        );
      }
      if (row.steamId) await addSteamMapping(recordId, parseInt(row.steamId, 10));
      if (row.gogId) await addGogMapping(recordId, parseInt(row.gogId, 10));

      const refreshedGame = await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode()).catch(() => null);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send("game-updated", refreshedGame || recordId);
      });
      results.push({ success: true, recordId, title: importGame.title });
    } catch (err) {
      results.push({ success: false, title: row.title, error: err.message || String(err) });
    }
  }
  return { success: true, results };
});

ipcMain.handle("cancel-scan", async () => {
  if (ctx.activeScanSession) {
    ctx.activeScanSession.canceled = true;
    ctx.activeScanSession.cancelRequested = true;
    return { success: true, scanId: ctx.activeScanSession.scanId };
  }
  return { success: false, error: "No scan is currently running" };
});

ipcMain.handle("get-steam-game-data", async (event, steamId) => {
  return await fetchAndStoreSteamData(db, steamId, ctx.appConfig?.Metadata?.steamAssetSourceOrder);
});

ipcMain.handle("get-gog-game-data", async (event, gogId) => {
  return await fetchAndStoreGogData(db, gogId);
});

ipcMain.handle("search-atlas", async (event, params) => {
  return await searchAtlas(params.title, params.creator);
});

ipcMain.handle("resolve-import-matches", async (event, games = []) => {
  const searchCache = new Map();

  const resolveSearchData = async (game = {}) => {
    const f95Id = normalizeF95IdInput(game.f95Id);
    if (f95Id) {
      const byF95 = await searchAtlasByF95Id(f95Id);
      return byF95;
    }
    const lcId = normalizeLewdCornerIdInput(game.lcId || game.lewdCornerId);
    if (lcId) {
      return await searchAtlasByLewdCornerId(lcId);
    }
    return await searchAtlas(game.lookupTitle || game.title, game.creator);
  };

  // ── Pre-warm search cache for all unique keys in parallel ──────────────
  const pending = games.filter(
    (g) => g && g.scanStatus === "pendingMatch",
  );

  const uniqueSearches = new Map();
  for (const game of pending) {
    const f95Id = normalizeF95IdInput(game.f95Id);
    const lcId = normalizeLewdCornerIdInput(game.lcId || game.lewdCornerId);
    const cacheKey = f95Id
      ? `f95:${f95Id}`
      : lcId
        ? `lc:${lcId}`
        : `atlas:${game.lookupTitle || game.title}|${game.creator}`;
    if (!uniqueSearches.has(cacheKey)) {
      uniqueSearches.set(cacheKey, { f95Id, lcId, game });
    }
  }

  await Promise.all(
    Array.from(uniqueSearches.entries()).map(async ([cacheKey, { game }]) => {
      try {
        const data = await resolveSearchData(game);
        searchCache.set(cacheKey, data);
      } catch (err) {
        console.error("resolve-import-matches pre-warm failed:", err);
        searchCache.set(cacheKey, []);
      }
    }),
  );

  // ── Resolve all games in parallel using the warmed cache ───────────────
  const resolveGame = async (game) => {
    if (!game || game.scanStatus !== "pendingMatch") {
      return game;
    }

    const f95Id = normalizeF95IdInput(game.f95Id);
    const lcId = normalizeLewdCornerIdInput(game.lcId || game.lewdCornerId);
    const cacheKey = f95Id
      ? `f95:${f95Id}`
      : lcId
        ? `lc:${lcId}`
        : `atlas:${game.lookupTitle || game.title}|${game.creator}`;

    try {
      const data = searchCache.get(cacheKey) || [];

      if (data.length === 1) {
        return await hydrateImportMatch({
          ...applyImportMatchData(game, data[0], { f95Id, lcId }),
          results: [{ key: "match", value: "Match Found" }],
          resultSelectedValue: "match",
          resultVisibility: "visible",
        }, "match");
      } else if (data.length > 1) {
        const results = data.map(buildImportMatchResult).filter((result) => result.key);
        return await chooseInstalledImportMatch({ ...game, results }, results);
      } else {
        const unmatchedGame = await hydrateImportMatch({
          ...game,
          atlasId: "",
          f95Id: f95Id || "",
          lcId: lcId || game.lcId || game.lewdCornerId || "",
          lewdCornerId: lcId || game.lewdCornerId || game.lcId || "",
          results: [],
          resultSelectedValue: "",
          resultVisibility: "hidden",
        }, "");
        return f95Id
          ? { ...unmatchedGame, f95Id, scanMessage: "No F95 match found" }
          : lcId
            ? { ...unmatchedGame, lcId, lewdCornerId: lcId, scanMessage: "No LewdCorner match found" }
          : unmatchedGame;
      }
    } catch (err) {
      console.error("resolve-import-matches row failed:", err);
      return {
        ...game,
        scanStatus: "new",
        scanMessage: game.isArchive ? "Archive" : "Ready to import",
      };
    }
  };

  return Promise.all(games.map(resolveGame));
});

ipcMain.handle("search-atlas-by-f95-id", async (event, f95Id) => {
  const normalizedF95Id = normalizeF95IdInput(f95Id);
  console.log(`IPC search-atlas-by-f95-id received f95Id: ${f95Id}`);
  if (!normalizedF95Id) return [];
  try {
    const result = await searchAtlasByF95Id(normalizedF95Id);
    console.log(
      `IPC search-atlas-by-f95-id result for ${normalizedF95Id}: ${JSON.stringify(result)}`,
    );
    return result;
  } catch (err) {
    console.error(`Error in search-atlas-by-f95-id for ${normalizedF95Id}:`, err);
    return [];
  }
});

ipcMain.handle("search-atlas-by-lewdcorner-id", async (event, lcId) => {
  const normalizedLcId = normalizeLewdCornerIdInput(lcId);
  console.log(`IPC search-atlas-by-lewdcorner-id received lcId: ${lcId}`);
  if (!normalizedLcId) return [];
  try {
    const result = await searchAtlasByLewdCornerId(normalizedLcId);
    console.log(
      `IPC search-atlas-by-lewdcorner-id result for ${normalizedLcId}: ${JSON.stringify(result)}`,
    );
    return result;
  } catch (err) {
    console.error(`Error in search-atlas-by-lewdcorner-id for ${normalizedLcId}:`, err);
    return [];
  }
});

ipcMain.handle("add-atlas-mapping", async (event, { recordId, atlasId }) => {
  try {
    return await addAtlasMapping(recordId, atlasId);
  } catch (err) {
    console.error("Error in add-atlas-mapping:", err);
    return [];
  }
});

ipcMain.handle("find-f95-id", async (event, atlasId) => {
  try {
    return await findF95Id(atlasId);
  } catch (err) {
    console.error("Error in find-f95-id:", err);
    return "";
  }
});

ipcMain.handle("get-atlas-data", async (event, atlasId) => {
  try {
    return await getAtlasData(atlasId);
  } catch (err) {
    console.error("Error in get-atlas-data:", err);
    return {};
  }
});

ipcMain.handle("get-import-record-status", async (event, game) => {
  try {
    return await getImportRecordStatus(game);
  } catch (err) {
    console.error("get-import-record-status error:", err);
    return { status: "new", recordId: null, exactPath: false };
  }
});

ipcMain.handle("import-games", async (event, params) => {
  if (ctx.activeImportSession) {
    return {
      success: false,
      error: "Another import is already running",
    };
  }

  const {
    games: submittedGames,
    sourceRoot,
    deleteAfter,
    deleteSourceArchiveAfterImport,
    scanSize,
    downloadBannerImages,
    downloadPreviewImages,
    previewLimit,
    downloadVideos,
    gameExt,
    forceReimport = false,
    moveFoldersToLibrary = false,
    libraryFormat,
  } = params;
  const shouldDeleteSourceArchive =
    deleteSourceArchiveAfterImport === true || (deleteSourceArchiveAfterImport === undefined && deleteAfter === true);
  const auditImportCleanup = (stage, details = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      stage,
      deleteSourceArchiveAfterImport,
      shouldDeleteSourceArchive,
      ...details,
    };
    console.log("[ImportCleanupAudit]", JSON.stringify(entry));
    try {
      fs.appendFileSync(
        path.join(dataDir, "replacement-audit.jsonl"),
        `${JSON.stringify(entry)}\n`,
        "utf8",
      );
    } catch (auditErr) {
      console.warn("Failed to write import cleanup audit:", auditErr.message);
    }
  };
  auditImportCleanup("import-options", { sourceRoot, submittedGameCount: submittedGames.length });

  const games = submittedGames.filter(
    (game) =>
      ["new", "repairPath", "steamVersion"].includes(game.scanStatus || "new") ||
      (forceReimport && game.scanStatus === "alreadyImported"),
  );
  const destinationFormat =
    libraryFormat ||
    appConfig?.Library?.libraryFolderStructure ||
    defaultConfig.Library.libraryFolderStructure;
  const gamesDir = path.join(dataDir, "games");
  if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });

  const total = games.length;
  let progress = 0;
  const session = {
    cancelRequested: false,
    progress,
    total,
    cleanupPaths: [],
    currentExtractionWorker: null,
  };
  ctx.activeImportSession = session;

  if (total === 0) {
    mainWindow.webContents.send("import-progress", {
      text: "No importable games selected",
      progress,
      total,
    });
    mainWindow.webContents.send("import-complete");
    ctx.activeImportSession = null;
    return [];
  }

  mainWindow.webContents.send("import-progress", {
    text: `Starting import of ${total} games...`,
    progress: 0,
    total,
    canCancel: true,
  });

  const importNeedsLibrary = games.some((game) => game.isArchive || (moveFoldersToLibrary && !isSteamImportRow(game)));
  let targetLibrary = appConfig?.Library?.gameFolder;
  if ((!targetLibrary || !fs.existsSync(targetLibrary)) && importNeedsLibrary) {
    console.warn("No default library folder configured");
    mainWindow.webContents.send("import-progress", {
      text: "Choose a library folder to continue",
      progress,
      total,
      canCancel: false,
    });
    ctx.activeImportSession = null;
    return { success: false, error: "Default library folder is not set" };
  }
  if (!targetLibrary || !fs.existsSync(targetLibrary)) targetLibrary = null;

  // ────────────────────────────────────────────────────────────────
  //  Resolve 7-Zip once before archive extraction
  // ────────────────────────────────────────────────────────────────
  let sevenZipPath = null;
  let sevenZipSource = null;

  const needsExtraction = games.some((g) => g.isArchive === true);

  if (needsExtraction) {
    const resolvedSevenZip = await resolveSevenZipExecutablePath({
      configuredPath: appConfig?.Library?.sevenZipPath,
      currentConfig: appConfig,
      currentConfigPath: configPath,
      ownerWindow: mainWindow,
      notify: (text) =>
        mainWindow.webContents.send("import-progress", {
          text,
          progress: 0,
          total: 0,
        }),
    });

    if (!resolvedSevenZip?.path) {
      throw new Error(
        "7-Zip executable not found. Bundled 7zip was unavailable and no local 7-Zip installation could be detected.",
      );
    }

    sevenZipPath = resolvedSevenZip.path;
    sevenZipSource = resolvedSevenZip.source;

  }

  const results = [];
  const deferredSizeJobs = [];

  for (const game of games) {
    try {
      throwIfImportCanceled(session);
      session.cleanupPaths = [];
      session.progress = progress;
      mainWindow.webContents.send("import-progress", {
        text: `Processing ${game.title} (${progress + 1}/${total})`,
        progress,
        total,
        canCancel: true,
      });

      game.version = normalizeVersionName(game.version);
      const steamImport = isSteamImportRow(game);
      const steamId = getSteamIdFromGame(game);
      const gogImport = isGogImportRow(game);
      const gogId = getGogIdFromGame(game);
      let gamePath = game.folder;
      let execPath = (steamImport || gogImport)
        ? game.execPath || game.exec_path || ""
        : game.selectedValue
        ? path.join(game.folder, game.selectedValue)
        : "";
      const sourceCleanupRoot = game.sourceRoot || sourceRoot;

      let archiveToDeleteAfterImport = null;

      // ── Structured move (non-archive) ───────────────────────────────────────
      if (moveFoldersToLibrary && targetLibrary && !game.isArchive && !steamImport && !gogImport) {
        let destinationPath = buildStructuredImportPath(
          targetLibrary,
          destinationFormat,
          game,
        );
        if (fs.existsSync(destinationPath)) {
          destinationPath = getUniquePath(destinationPath);
        }

        const originalSourcePath = gamePath;
        await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
        mainWindow.webContents.send("import-progress", {
          text: `Moving ${game.title} to library...`,
          progress,
          total,
          canCancel: true,
        });

        try {
          await fsp.rename(gamePath, destinationPath);
        } catch (moveErr) {
          if (moveErr.code !== "EXDEV") throw moveErr;
          await fsp.cp(gamePath, destinationPath, { recursive: true });
          const deleteResult = await deletePathWithElevationFallback(gamePath, {
            recursive: true,
            force: true,
            description: `Delete original source folder for ${game.title}`,
            window: mainWindow,
            validatePath: (candidatePath) =>
              validateSourceCleanupPath(candidatePath, sourceCleanupRoot),
            onProgress: (text) =>
              mainWindow.webContents.send("import-progress", {
                text,
                progress,
                total,
                canCancel: true,
              }),
          });
          if (!deleteResult.success) {
            throw new Error(`Moved copy was created, but source cleanup failed: ${deleteResult.error || "permission denied"}`);
          }
        }
        await removeEmptyParentDirectories(originalSourcePath, sourceCleanupRoot);

        const selectedValue = game.selectedValue || "";
        gamePath = destinationPath;
        execPath = selectedValue ? path.join(gamePath, selectedValue) : "";
      }

      // ── Archive extraction ───────────────────────────────────────
      if (game.isArchive) {
        if (!sevenZipPath) {
          throw new Error("7-Zip is required for archive extraction");
        }

        const archiveFilename =
          game.executables?.[0]?.value || game.executables?.[0]?.key;
        if (!archiveFilename) {
          throw new Error("No archive file specified");
        }

        const zipPath = resolveArchivePathForImport(game, archiveFilename);

        let extractPath = buildStructuredImportPath(
          targetLibrary,
          destinationFormat,
          game,
        );
        if (fs.existsSync(extractPath)) {
          const originalPath = extractPath;
          extractPath = getUniquePath(extractPath);
          mainWindow.webContents.send("import-progress", {
            text: `Target exists. Extracting ${game.title} to ${path.basename(extractPath)} instead of overwriting.`,
            progress,
            total,
            canCancel: true,
          });
          console.log(`Archive target exists: ${originalPath}. Using ${extractPath}`);
        }

        mainWindow.webContents.send("import-progress", {
          text: `Preparing extraction for ${game.title}...`,
          progress: 0,
          total: 100,
        });

        try {
          const extraction = await extractArchiveWithFallback({
            archivePath: zipPath,
            finalPath: extractPath,
            sevenZipBin: sevenZipPath,
            session,
            progressWindow: mainWindow,
            useBundledRarExtractor:
              isRarArchivePath(zipPath) && sevenZipSource === "bundled",
            currentConfig: appConfig,
            currentConfigPath: configPath,
            ownerWindow: mainWindow,
            notify: (text) =>
              mainWindow.webContents.send("import-progress", {
                text,
                progress: 0,
                total: 0,
              }),
          });
          extractPath = extraction.finalPath || extractPath;
          session.cleanupPaths = [extractPath];
          archiveToDeleteAfterImport = shouldDeleteSourceArchive ? zipPath : null;
          auditImportCleanup("archive-extracted", {
            title: game.title,
            sourceArchive: zipPath,
            sourceCleanupRoot,
            archiveExists: fs.existsSync(zipPath),
            scheduledForDeletion: Boolean(archiveToDeleteAfterImport),
          });

          mainWindow?.webContents.send("import-progress", {
            text: `Extraction complete — 100% (${game.title})`,
            progress: 100,
            total: 100,
          });

          if (!archiveToDeleteAfterImport) {
            mainWindow?.webContents.send("import-progress", {
              text: `Kept original archive (${game.title})`,
              progress: 100,
              total: 100,
              canCancel: true,
            });
          }
        } catch (err) {
          throw err;
        }

        gamePath = extractPath;

        // ── Find executables after extraction ────────────────────────────────
        const { findExecutables } = require("../scanners/executableScanner");
        let execs = findExecutables(extractPath, gameExt);

        // Clean up common unwanted root-level folders
        const foldersToRemove = ["__MACOSX", "__LINUX"];
        for (const folderName of foldersToRemove) {
          const target = path.join(extractPath, folderName);
          try {
            const stat = await fsp.stat(target).catch(() => null);
            if (stat && stat.isDirectory()) {
              console.log(`Removing unwanted folder: ${folderName}`);
              await deletePathWithElevationFallback(target, {
                recursive: true,
                force: true,
                description: `Delete extracted ${folderName} folder`,
                window: mainWindow,
                validatePath: (candidatePath) => {
                  if (!isPathInside(extractPath, candidatePath)) {
                    throw new Error("Refusing to delete outside the extraction folder");
                  }
                },
              });
            }
          } catch (err) {
            console.warn(`Failed to remove ${folderName}: ${err.message}`);
          }
        }

        // Handle common single-subfolder case (flatten nested root)
        const items = await fsp.readdir(extractPath, { withFileTypes: true });
        const dirs = items.filter((i) => i.isDirectory());
        const files = items.filter((i) => i.isFile());

        if (dirs.length === 1 && files.length === 0) {
          const subPath = path.join(extractPath, dirs[0].name);
          const subItems = await fsp.readdir(subPath);
          for (const item of subItems) {
            await fsp.rename(
              path.join(subPath, item),
              path.join(extractPath, item),
            );
          }
          try {
            await fsp.rmdir(subPath);
          } catch {}

          // Re-scan executables after flattening
          execs = findExecutables(extractPath, gameExt);
        }

        // ── Executable selection ─────────────────────────────────────────────
        let selectedExec = null;
        if (execs.length === 0) {
          mainWindow.webContents.send("import-progress", {
            text: `Extracted ${game.title} – no executables found`,
            progress,
            total,
          });
          game.selectedValue = null;
          execPath = null;
        } else if (execs.length === 1) {
          selectedExec = execs[0];
          console.log(`Auto-selected single executable for ${game.title}: ${selectedExec}`);
          mainWindow.webContents.send("import-progress", {
            text: `Using single executable: ${selectedExec}`,
            progress: 100,
            total: 100,
          });
        } else {
          selectedExec = await new Promise((resolve) => {
            showExecutableChooser(game.title, game.version || "", execs);
            const onChosen = (event, data) => {
              ipcMain.removeAllListeners("executable-chosen");
              resolve(data.selectedExecutable || null);
            };
            ipcMain.once("executable-chosen", onChosen);
            executableChooserWindow.on("closed", () => {
              ipcMain.removeAllListeners("executable-chosen");
              resolve(null);
            });
          });

          if (!selectedExec) {
            await removePathIfExists(extractPath);
            session.cleanupPaths = [];
            mainWindow.webContents.send("import-progress", {
              text: `Skipped ${game.title} – no executable selected`,
              progress,
              total,
            });
            continue;
          }
        }

        if (selectedExec) {
          execPath = path.join(extractPath, selectedExec);
          game.selectedValue = selectedExec;
          console.log(execs);
          console.log(execPath);
          game.executables = execs.map((e) => ({ key: e, value: e }));
        }
      }

      const add = {
        title: game.title,
        creator: game.creator,
        engine: game.engine,
        description: game.description || "Imported game",
      };

      console.log("Adding Game");
      throwIfImportCanceled(session);
      const shouldUpsertExisting = forceReimport;
      // A replace attaches a new version to an EXISTING record and removes the old
      // one. It must resolve to that record regardless of forceReimport — the old
      // code left recordId null when forceReimport was off, so addGame() below
      // created a duplicate title and the replacement then found nothing to delete.
      const isReplaceOperation = Boolean(String(game.replaceVersion || "").trim());
      let recordId =
        (shouldUpsertExisting || isReplaceOperation) && game.existingRecordId
          ? game.existingRecordId
          : shouldUpsertExisting || isReplaceOperation
            ? await findExistingRecordForImport(game)
            : null;

      // Steam merge: if this install's appid already belongs to a record (a
      // prior steam import, or an Atlas/f95 title listing this appid in its
      // external_ids), attach to that record so it shows as an extra version
      // instead of a duplicate title — even when the names differ.
      if (!recordId && steamId) {
        const steamMergeRecordId =
          (game.existingRecordId &&
          ["steamVersion", "repairPath"].includes(String(game.scanStatus || ""))
            ? game.existingRecordId
            : null) || (await findRecordBySteamId(steamId));
        if (steamMergeRecordId) recordId = steamMergeRecordId;
      }

      // GOG merge: mirror the Steam behavior above for GOG product ids.
      if (!recordId && gogId) {
        const gogMergeRecordId =
          (game.existingRecordId &&
          ["gogVersion", "repairPath"].includes(String(game.scanStatus || ""))
            ? game.existingRecordId
            : null) || (await findRecordByGogId(gogId));
        if (gogMergeRecordId) recordId = gogMergeRecordId;
      }

      // Safety net: a replace whose existing record can't be resolved must NOT
      // fall through to addGame() (that is exactly what produced duplicate
      // titles). Skip it with a clear message instead.
      if (isReplaceOperation && !recordId) {
        console.warn(`Skipping replace for '${game.title}': existing record not found`);
        results.push({
          success: false,
          skipped: true,
          error: "Could not find the existing game to replace",
        });
        progress++;
        session.progress = progress;
        mainWindow.webContents.send("import-progress", {
          text: `Skipped replace for '${game.title}' ${progress}/${total}: existing game not found`,
          progress,
          total,
          canCancel: true,
        });
        continue;
      }

      if (game.scanStatus === "alreadyImported" && !recordId) {
        console.warn(
          `Skipping already imported row without resolvable record: ${game.title}`,
        );
        results.push({
          success: false,
          skipped: true,
          error: "Existing record could not be resolved",
        });
        progress++;
        session.progress = progress;
        mainWindow.webContents.send("import-progress", {
          text: `Skipped existing game '${game.title}' ${progress}/${total}: record could not be resolved`,
          progress,
          total,
          canCancel: true,
        });
        continue;
      }
      if (!recordId) {
        recordId = await addGame(add);
      }
      console.log("game added");
      console.log("adding version");
      const versionGame = {
        ...game,
        folder: gamePath,
        execPath,
        folderSize: game.folderSize || game.folder_size || null,
        deferFolderSizeCalculation: true,
        in_place: (steamImport || gogImport) ? 1 : game.in_place,
        inPlace: (steamImport || gogImport) ? true : game.inPlace || (!game.isArchive && !moveFoldersToLibrary),
        sourceType: steamImport ? "steam" : gogImport ? "gog" : game.sourceType,
        steamId: steamId || game.steamId,
        gogId: gogId || game.gogId,
      };
      let bulkReplaceRow = null;
      let bulkReplacePathAllowed = null;
      if (isReplaceOperation) {
        const selectedVersionId = Number.parseInt(game.replaceVersionId, 10);
        bulkReplaceRow = Number.isInteger(selectedVersionId) && selectedVersionId > 0
          ? await dbGet(
              db,
              `SELECT rowid AS version_id, record_id, version, game_path, exec_path
               FROM versions WHERE rowid = ? AND record_id = ? LIMIT 1`,
              [selectedVersionId, recordId],
            )
          : await getVersionForRecord(recordId, game.replaceVersion);
        if (!bulkReplaceRow) {
          throw new Error(`Selected replacement version ${game.replaceVersion} was not found`);
        }
        bulkReplacePathAllowed = bulkReplaceRow.game_path
          ? await isAllowedDeletionPath(
              recordId,
              path.resolve(bulkReplaceRow.game_path),
              ctx.appConfig?.Library?.gameFolder,
            )
          : false;
      }
      let savedVersionResult = null;
      if (bulkReplaceRow) {
        savedVersionResult = await updateVersion(
          {
            ...versionGame,
            version_id: bulkReplaceRow.version_id,
            previousVersion: bulkReplaceRow.version,
            version: game.version,
            game_path: gamePath,
            exec_path: execPath,
          },
          recordId,
        );
      } else if (shouldUpsertExisting) {
        savedVersionResult = await upsertVersion(versionGame, recordId);
      } else {
        savedVersionResult = await addVersion(versionGame, recordId);
      }
      const savedVersion = savedVersionResult?.version || game.version;
      if (!Number(game.folderSize || game.folder_size || 0) && gamePath) {
        deferredSizeJobs.push({
          recordId,
          version: savedVersion,
          gamePath,
          title: game.title,
        });
      }
      console.log("added version");
      console.log("adding mapping");
      console.log("recordId:", recordId, "atlasId:", game.atlasId);
      if (game.atlasId) {
        try {
          await addAtlasMapping(recordId, game.atlasId);
          console.log("mapping added");
        } catch (err) {
          console.error("Failed to add atlas mapping:", err);
          throw err;
        }
      }
      if (game.f95Id) {
        try {
          await dbRun(
            db,
            `INSERT INTO f95_zone_mappings (record_id, f95_id)
             SELECT ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM f95_zone_mappings WHERE record_id = ? AND f95_id = ?
             )`,
            [recordId, game.f95Id, recordId, game.f95Id],
          );
          console.log("f95 mapping added");
        } catch (err) {
          console.error("Failed to add F95 mapping:", err);
          throw err;
        }
      }
      const lcId = getLewdCornerIdFromGame(game);
      if (lcId) {
        try {
          await addLewdCornerMapping(recordId, lcId);
          console.log("lewdcorner mapping added");
        } catch (err) {
          console.error("Failed to add LewdCorner mapping:", err);
          throw err;
        }
      }

      // Steam-sourced rows carry a numeric appid. Persisting the mapping is what
      // wires up launch (steam://run via getSteamIDbyRecord) and the Steam CDN
      // banner/hero art resolved in mediaSources. Metadata enrichment of
      // steam_data happens in a later phase; the mapping alone is enough for the
      // game to appear, render art, and launch.
      if (steamId) {
        try {
          await addSteamMapping(recordId, steamId);
          console.log("steam mapping added");
        } catch (err) {
          console.error("Failed to add steam mapping:", err);
          throw err;
        }
      }

      // GOG-sourced rows carry a numeric product id. The mapping wires up
      // launch, CDN art (mediaSources gogImages), and browse/detail rendering.
      if (gogId) {
        try {
          await addGogMapping(recordId, gogId);
          console.log("gog mapping added");
        } catch (err) {
          console.error("Failed to add gog mapping:", err);
          throw err;
        }
      }

      if (game.replaceVersion) {
        const replacementResult = await replaceInstalledVersionAfterImport({
          recordId,
          newVersion: savedVersion,
          newGamePath: gamePath,
          replaceVersion: game.replaceVersion,
          replaceVersionId: game.replaceVersionId,
          oldVersionSnapshot: bulkReplaceRow,
          trustedOldPath: bulkReplacePathAllowed,
          deleteDatabaseRow: false,
          libraryRoot: ctx.appConfig?.Library?.gameFolder || null,
          auditDataDir: dataDir,
          sender: mainWindow,
        });

        if (replacementResult?.skipped) {
          throw new Error(
            `Imported ${game.title}, but could not remove selected version ${game.replaceVersion}: ${replacementResult.reason}`,
          );
        }
      }
      if (archiveToDeleteAfterImport) {
        try {
          const deleteResult = await deletePathWithElevationFallback(archiveToDeleteAfterImport, {
            recursive: false,
            force: true,
            description: `Delete original archive for ${game.title}`,
            window: mainWindow,
            validatePath: (candidatePath) =>
              validateSourceCleanupPath(candidatePath, sourceCleanupRoot),
            onProgress: (text) =>
              mainWindow.webContents.send("import-progress", {
                text,
                progress,
                total,
                canCancel: true,
              }),
          });
          auditImportCleanup("source-archive-delete-result", {
            title: game.title,
            sourceArchive: archiveToDeleteAfterImport,
            sourceCleanupRoot,
            deleteResult,
            existsAfterDelete: fs.existsSync(archiveToDeleteAfterImport),
          });
          if (!deleteResult.success) {
            throw new Error(deleteResult.error || "Archive delete skipped");
          }
          await removeEmptyParentDirectories(archiveToDeleteAfterImport, sourceCleanupRoot);
          console.log(`Deleted archive after successful import: ${archiveToDeleteAfterImport}`);
          mainWindow.webContents.send("import-progress", {
            text: deleteResult.elevated
              ? `Deleted original archive with administrator approval after importing ${game.title}`
              : `Deleted original archive after importing ${game.title}`,
            progress,
            total,
            canCancel: true,
          });
        } catch (archiveDeleteErr) {
          auditImportCleanup("source-archive-delete-failed", {
            title: game.title,
            sourceArchive: archiveToDeleteAfterImport,
            sourceCleanupRoot,
            error: archiveDeleteErr.message || String(archiveDeleteErr),
            existsAfterDelete: fs.existsSync(archiveToDeleteAfterImport),
          });
          console.warn(
            `Failed to delete archive ${archiveToDeleteAfterImport}: ${archiveDeleteErr.message}`,
          );
          throw new Error(
            `Imported ${game.title}, but could not delete source archive ${archiveToDeleteAfterImport}: ${archiveDeleteErr.message}`,
          );
        }
      }
      results.push({
        success: true,
        title: game.title,
        recordId,
        atlasId: game.atlasId,
        steamId: steamId || game.steamId,
        gogId: gogId || game.gogId,
        version: savedVersion,
      });
      session.cleanupPaths = [];

      progress++;
      session.progress = progress;
      mainWindow.webContents.send("import-progress", {
        text: `Imported game '${game.title}' ${progress}/${total}`,
        progress,
        total,
        canCancel: true,
      });
      mainWindow.webContents.send("game-imported", recordId);
      mainWindow.webContents.send("game-updated", recordId);
    } catch (err) {
      if (isImportCancelledError(err)) {
        await Promise.all(
          [...session.cleanupPaths].reverse().map((targetPath) =>
            removePathIfExists(targetPath),
          ),
        );
        session.cleanupPaths = [];
        mainWindow.webContents.send("import-progress", {
          text: `Import canceled. Kept ${results.filter((r) => r.success).length} completed game(s).`,
          progress,
          total,
          canceled: true,
          canCancel: false,
        });
        break;
      }
      console.error("Error importing game:", err);
      results.push({ success: false, error: err.message });
      progress++;
      session.progress = progress;
      mainWindow.webContents.send("import-progress", {
        text: `Error importing game '${game.title}' ${progress}/${total}: ${err.message}`,
        progress,
        total,
        canCancel: true,
      });
    }
  }

  if (session.cancelRequested) {
    mainWindow.webContents.send("import-complete");
    ctx.activeImportSession = null;
    return results;
  }

  mainWindow.webContents.send("import-progress", {
    text: `Game import complete: ${results.filter((r) => r.success).length} successful`,
    progress,
    total,
    canCancel: false,
  });

  const shouldDownloadImportImages = downloadBannerImages || downloadPreviewImages;

  // Enrich imported Steam games in the background so the import itself never
  // blocks on per-game network calls. Only touches games actually imported,
  // throttled gently, emitting game-updated as each row's metadata lands.
  const steamToEnrich = results.filter((r) => r.success && r.steamId);
  if (steamToEnrich.length > 0 && !shouldDownloadImportImages) {
    ;(async () => {
      for (const r of steamToEnrich) {
        try {
          await fetchAndStoreSteamData(null, r.steamId, ctx.appConfig?.Metadata?.steamAssetSourceOrder);
          mainWindow?.webContents?.send("game-updated", r.recordId);
        } catch (err) {
          console.error(`Background steam enrichment failed for ${r.steamId}:`, err);
        }
        await new Promise((res) => setTimeout(res, 800));
      }
    })();
  }

  // GOG equivalent of the Steam background enrichment above.
  const gogToEnrich = results.filter((r) => r.success && r.gogId);
  if (gogToEnrich.length > 0 && !shouldDownloadImportImages) {
    ;(async () => {
      for (const r of gogToEnrich) {
        try {
          await fetchAndStoreGogData(null, r.gogId);
          mainWindow?.webContents?.send("game-updated", r.recordId);
        } catch (err) {
          console.error(`Background gog enrichment failed for ${r.gogId}:`, err);
        }
        await new Promise((res) => setTimeout(res, 800));
      }
    })();
  }

  // Phase 2: Image downloads
  // Image downloads run in the BACKGROUND so the importer window can close as
  // soon as the DB records exist (matching the deferred-size and Steam/GOG
  // enrichment pattern). We intentionally do NOT await this before returning —
  // banners/previews fill in afterwards, each emitting 'game-updated' so the
  // library refreshes that row. The importer window is likely already closed.
  const runImageDownloads = async () => {
  if (shouldDownloadImportImages) {
    progress = 0;
    // Shared across the whole import's image phase: once a source is rate-
    // limited we stop pulling from it and notify, continuing with others.
    const blockedSources = new Set();
    const onRateLimited = (source, retryAfterMs) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send("media-rate-limited", { source, retryAfterMs });
        }
      } catch { /* window may be closed already */ }
    };
    const successfulImports = results.filter((r) => r.success && r.recordId);
    const imageTotal = successfulImports.length;
    const imageSummary = {
      processed: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      filesWritten: 0,
      dbRowsWritten: 0,
    };
    const isVideoUrl = (url) => /\.(mp4|webm|m4v|mpd)(\?|#|$)/i.test(String(url || ""));
    const inferMediaSource = (url) => {
      const value = String(url || "").toLowerCase();
      if (value.includes("steamstatic") || value.includes("akamaihd") || value.includes("steam")) return "steam";
      if (value.includes("f95")) return "f95";
      return "metadata";
    };
    const resolveImportMediaIdentifiers = async (recordId, importResult) => {
      const dbAtlasId = await GetAtlasIDbyRecord(recordId);
      const steamId = await getSteamIDbyRecord(recordId);
      const gogId = await getGogIDbyRecord(recordId);
      let f95Id = null;
      if (dbAtlasId) {
        try {
          f95Id = await findF95Id(dbAtlasId);
        } catch (err) {
          console.warn(`Image identifier trace: failed to resolve F95 id for atlas ${dbAtlasId}:`, err);
        }
      }
      return {
        recordId,
        resultAtlasId: importResult.atlasId || null,
        dbAtlasId,
        f95Id,
        steamId,
        gogId,
      };
    };
    const sendImageTrace = (trace) => {
      const message = [
        `Images trace '${trace.title}'`,
        `recordId=${trace.recordId}`,
        `resultAtlasId=${trace.resultAtlasId || "none"}`,
        `dbAtlasId=${trace.dbAtlasId || "none"}`,
        `f95Id=${trace.f95Id || "none"}`,
        `steamId=${trace.steamId || "none"}`,
        `banner=${trace.downloadBannerImages} previews=${trace.downloadPreviewImages} limit=${trace.previewLimit} videos=${trace.downloadVideos}`,
        `bannerUrls=${trace.bannerUrlCount}`,
        `previewUrls=${trace.previewUrlCount}`,
        `attempts=${trace.attempted || 0}`,
        `writes=${trace.filesWritten || 0}`,
        `existing=${trace.filesExisting || 0}`,
        `dbBanners=${trace.bannerRowsWritten || 0}`,
        `dbPreviews=${trace.previewRowsWritten || 0}`,
        `imageDir=${trace.imageDir || "none"}`,
        trace.reason ? `reason=${trace.reason}` : null,
      ].filter(Boolean).join(" | ");
      console.log(message);
      mainWindow.webContents.send("import-progress", {
        text: message,
        progress,
        total: imageTotal,
        canCancel: true,
      });
    };

    console.log(
      `Import image flags | banner=${downloadBannerImages} previews=${downloadPreviewImages} ` +
      `limit=${previewLimit} videos=${downloadVideos} importedRows=${games.length} successfulImports=${successfulImports.length}`,
    );
    mainWindow.webContents.send("import-progress", {
      text:
        `Image flags: banner=${downloadBannerImages}, previews=${downloadPreviewImages}, ` +
        `limit=${previewLimit}, videos=${downloadVideos}, successful imports=${successfulImports.length}`,
      progress,
      total: imageTotal,
      canCancel: true,
    });

    if (imageTotal === 0) {
      mainWindow.webContents.send("import-progress", {
        text: "Image download skipped: no successful imports with record IDs",
        progress: 0,
        total: 0,
        canCancel: false,
      });
    }

    if (imageTotal > 0) {
      mainWindow.webContents.send("import-progress", {
        text: `Starting image download for ${imageTotal} imported games...`,
        progress,
        total: imageTotal,
        canCancel: true,
      });
    }

    const hostLimiter = createHostLimiter();
    const processImportedGameImages = async (importedGame) => {
      const title =
        importedGame.title ||
        games.find((g) => g.atlasId === importedGame.atlasId || g.steamId === importedGame.steamId)?.title ||
        "Imported game";
      try {
        throwIfImportCanceled(session);

        const recordId = importedGame.recordId;
        const ids = await resolveImportMediaIdentifiers(recordId, importedGame);
        const { dbAtlasId, f95Id, steamId, gogId } = ids;

        if (steamId) {
          try {
            await fetchAndStoreSteamData(null, steamId, ctx.appConfig?.Metadata?.steamAssetSourceOrder);
          } catch (steamErr) {
            console.warn(`Import media trace: Steam metadata refresh failed for ${steamId}:`, steamErr);
          }
        }

        if (gogId) {
          try {
            await fetchAndStoreGogData(null, gogId);
          } catch (gogErr) {
            console.warn(`Import media trace: GOG metadata refresh failed for ${gogId}:`, gogErr);
          }
        }

        if (!dbAtlasId && !steamId && !gogId) {
          progress++;
          imageSummary.processed++;
          imageSummary.skipped++;
          sendImageTrace({
            title,
            downloadBannerImages,
            downloadPreviewImages,
            downloadVideos,
            previewLimit,
            ...ids,
            bannerUrlCount: 0,
            previewUrlCount: 0,
            imageDir: path.join(dataDir, "images", recordId.toString()),
            reason: "skipped: no Atlas/F95/Steam mapping",
          });
          return;
        }

        const currentMediaSettings = getMediaPerformanceSettings(ctx.appConfig || appConfig);
        const sourceOrder = getMetadataSourceOrder();
        const bannerUrl = downloadBannerImages ? await getRemoteBannerUrl(recordId, { sourceOrder }) : "";
        const rawPreviewUrls = downloadPreviewImages ? await getRemotePreviewUrls(recordId, { sourceOrder }) : [];
        const screenUrls = rawPreviewUrls
          .map((url) => String(url || "").trim())
          .filter(Boolean)
          .filter((url) => downloadVideos || !isVideoUrl(url))
          .map((url) => ({ url, source: inferMediaSource(url) }));
        const previewCount = downloadPreviewImages
          ? previewLimit === "Unlimited"
            ? screenUrls.length
            : Math.min(parseInt(previewLimit), screenUrls.length)
          : 0;
        const additionalAssets = (downloadBannerImages || downloadPreviewImages)
          ? (await getAllDownloadableAssetUrlsForRecord(recordId, { downloadVideos, sourceOrder }))
              .filter((asset) => asset.targetKind !== "preview" && asset.url !== bannerUrl)
          : [];
        const totalImages =
          (downloadBannerImages && bannerUrl ? 2 : 0) + previewCount + additionalAssets.length;

        if (!bannerUrl && previewCount === 0 && additionalAssets.length === 0) {
          progress++;
          imageSummary.processed++;
          imageSummary.skipped++;
          sendImageTrace({
            title,
            downloadBannerImages,
            downloadPreviewImages,
            downloadVideos,
            previewLimit,
            ...ids,
            bannerUrlCount: bannerUrl ? 1 : 0,
            previewUrlCount: screenUrls.length,
            mediaAssetUrlCount: additionalAssets.length,
            imageDir: path.join(dataDir, "images", recordId.toString()),
            reason: "skipped: no banner/preview/media asset URLs found",
          });
          return;
        }

        const primaryHost =
          getUrlHost(bannerUrl) ||
          getUrlHost(screenUrls[0]?.url) ||
          getUrlHost(additionalAssets[0]?.url);
        const releaseHostSlot = await hostLimiter.waitForHostSlot(
          primaryHost,
          currentMediaSettings.mediaPerHostConcurrency,
        );

        mainWindow.webContents.send("import-progress", {
          text: `Downloading images for '${title}', 0/${totalImages}`,
          progress,
          total: imageTotal,
          canCancel: true,
        });

        let downloadResult;
        try {
          downloadResult = await downloadImages(
            recordId,
            dbAtlasId || steamId || recordId,
            (current, totalImages) => {
              mainWindow.webContents.send("import-progress", {
                text: `Downloading images for '${title}', ${current}/${totalImages}`,
                progress,
                total: imageTotal,
                canCancel: true,
              });
            },
            downloadBannerImages,
            downloadPreviewImages,
            previewLimit,
            downloadVideos,
            dataDir,
            async () => bannerUrl,
            async () => screenUrls,
            updateBanners,
            updatePreviews,
            {
              source: inferMediaSource(bannerUrl),
              additionalAssets,
              upsertMediaAsset,
              requestDelayMs: currentMediaSettings.mediaRequestDelayMs,
              blockedSources,
              onRateLimited,
            },
          );
        } finally {
          releaseHostSlot();
        }
        throwIfImportCanceled(session);

        mainWindow.webContents.send("game-updated", recordId);

        progress++;
        imageSummary.processed++;
        imageSummary.filesWritten += downloadResult.filesWritten || 0;
        imageSummary.dbRowsWritten +=
          (downloadResult.bannerRowsWritten || 0) +
          (downloadResult.previewRowsWritten || 0) +
          (downloadResult.mediaAssetRowsWritten || 0);
        const urlCount =
          downloadResult.bannerUrlCount +
          downloadResult.previewUrlCount +
          downloadResult.mediaAssetUrlCount;
        const failedWithUrls = urlCount > 0 && downloadResult.downloaded === 0 && downloadResult.errors.length > 0;
        if (failedWithUrls || !downloadResult.success) imageSummary.failed++;
        else if ((downloadResult.filesWritten || 0) > 0 || (downloadResult.filesExisting || 0) > 0) imageSummary.downloaded++;
        else imageSummary.skipped++;
        const statusText = downloadResult.success && !failedWithUrls
          ? `Downloaded images for '${title}': ${downloadResult.filesWritten} file(s) written, ${downloadResult.attempted} attempted`
          : `Image download failed for '${title}': ${downloadResult.filesWritten} file(s) written, ${downloadResult.attempted} attempted, first error: ${downloadResult.errors[0] || "unknown"}`;
        mainWindow.webContents.send("import-progress", {
          text: statusText,
          progress,
          total: imageTotal,
          canCancel: true,
        });
        sendImageTrace({
          title,
          downloadBannerImages,
          downloadPreviewImages,
          downloadVideos,
          previewLimit,
          ...ids,
          ...downloadResult,
          reason: downloadResult.errors.length > 0
            ? downloadResult.errors.join("; ")
            : ((downloadResult.filesWritten || 0) > 0 || (downloadResult.filesExisting || 0) > 0)
              ? "downloaded"
              : "skipped: no local files written",
        });
      } catch (err) {
        if (isImportCancelledError(err)) {
          mainWindow.webContents.send("import-progress", {
            text: `Import canceled. Kept ${results.filter((r) => r.success).length} completed game(s).`,
            progress,
            total: imageTotal,
            canceled: true,
            canCancel: false,
          });
          session.cancelRequested = true;
          return;
        }
        console.error("Error downloading images for game:", err);
        progress++;
        imageSummary.processed++;
        imageSummary.failed++;
        mainWindow.webContents.send("import-progress", {
          text: `Error downloading images for '${title}' ${progress}/${imageTotal}: ${err.message}`,
          progress,
          total: imageTotal,
          canCancel: true,
        });
      }
    }

    const initialMediaSettings = getMediaPerformanceSettings(ctx.appConfig || appConfig);
    await runConcurrentQueue(
      successfulImports,
      initialMediaSettings.mediaDownloadConcurrency,
      async (importedGame) => {
        if (session.cancelRequested) return;
        await processImportedGameImages(importedGame);
      },
    );

    if (!session.cancelRequested && imageTotal > 0) {
      const zeroFilesMessage = imageSummary.filesWritten === 0
        ? " Image download phase completed with zero local files written. Check per-row image traces above."
        : "";
      mainWindow.webContents.send("import-progress", {
        text:
          `Image download phase finished: processed=${imageSummary.processed}, ` +
          `downloaded=${imageSummary.downloaded}, skipped=${imageSummary.skipped}, ` +
          `failed=${imageSummary.failed}, filesWritten=${imageSummary.filesWritten}, ` +
          `dbRows=${imageSummary.dbRowsWritten}.${zeroFilesMessage}`,
        progress,
        total: imageTotal,
        canCancel: false,
      });
    }
  }
  };
  // Fire-and-forget; don't block the handler's return on image downloads. When
  // the background image work finishes it emits a final import-complete so any
  // late listeners settle, but the importer window has already closed via the
  // handler returning results below.
  runImageDownloads()
    .catch((err) => console.warn("Background image downloads failed:", err?.message || err))
    .finally(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send("import-images-complete");
        }
      } catch (err) {
        console.warn("Failed to send import-images-complete:", err.message || err);
      }
    });

  // Folder-size calculation is deferred and run in the BACKGROUND so the
  // importer window can close as soon as the DB records exist. We intentionally
  // do NOT await this loop before returning — sizes fill in afterwards, each
  // emitting a 'game-updated' so the library refreshes that row. All sends are
  // guarded because the importer window is likely already closed by now.
  const runDeferredSizeJobs = async () => {
    if (session.cancelRequested || deferredSizeJobs.length === 0) return
    const safeSend = (channel, payload) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send(channel, payload)
        }
      } catch (err) {
        console.warn(`Deferred size job: failed to send ${channel}:`, err.message || err)
      }
    }
    for (const job of deferredSizeJobs) {
      try {
        const folderSize = await calculatePathSizeSafe(job.gamePath)
        if (folderSize !== null) {
          await updateFolderSize(job.recordId, job.version, folderSize)
          safeSend("game-updated", job.recordId)
        }
      } catch (err) {
        console.warn(`Deferred size calculation failed for ${job.gamePath}:`, err.message || err)
      }
    }
  }
  // Fire-and-forget; don't block the handler's return on size calculation.
  runDeferredSizeJobs()

  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("import-complete");
    }
  } catch (err) {
    console.warn("Failed to send import-complete:", err.message || err)
  }
  ctx.activeImportSession = null;
  return results;
});

ipcMain.handle("start-steam-scan", async (event, params) => {
  return await startSteamScan(db, params, event);
});

ipcMain.handle("start-gog-scan", async (event, params) => {
  return await startGogScan(db, params, event);
});

ipcMain.handle("select-gog-directory", async () => {
  console.log("IPC select-gog-directory called");
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select GOG Games or Galaxy storage folder",
      defaultPath: process.platform === "win32" ? "C:\\GOG Games" : undefined,
    });
    if (result.canceled) {
      console.log("User canceled GOG directory selection");
      return null;
    }
    const selectedPath = result.filePaths[0];
    console.log(`User selected GOG directory: ${selectedPath}`);
    return selectedPath;
  } catch (err) {
    console.error("Error selecting GOG directory:", err);
    return null;
  }
});

ipcMain.handle("select-steam-directory", async () => {
  console.log("IPC select-steam-directory called");
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Steam Directory",
      defaultPath: path.join("C:", "Program Files (x86)", "Steam"),
    });
    if (result.canceled) {
      console.log("User canceled Steam directory selection");
      return null;
    }
    const selectedPath = result.filePaths[0];
    console.log(`User selected Steam directory: ${selectedPath}`);
    return selectedPath;
  } catch (err) {
    console.error("Error selecting Steam directory:", err);
    return null;
  }
});


ipcMain.handle(
  "check-record-exist",
  async (event, { title, creator, engine, version, path }) => {
    try {
      const existsByDetails = await checkRecordExist(
        title,
        creator,
        engine,
        version,
        path,
      );
      if (existsByDetails) return true;
      return await checkPathExist(path, title);
    } catch (err) {
      console.error("check-record-exist error:", err);
      return false;
    }
  },
);

}

// Test-only surface: pure, side-effect-free import helpers exposed so the
// regression suite can assert their behaviour directly. Attached as a property
// on the exported handler so the default export (registerImporterHandlers) is
// unchanged. Not for production use.
module.exports.__testables = {
  clampInteger,
  getUrlHost,
  sanitizePathSegment,
  normalizeVersionName,
  buildStructuredImportPath,
  toPositiveInteger,
  isSteamImportRow,
  getSteamIdFromGame,
  isGogImportRow,
  getGogIdFromGame,
  inferCatalogImportVersion,
  isArchiveFilePath,
  isRarArchivePath,
  getConfiguredExtractionExtensions,
  getConfiguredGameExtensions,
};
