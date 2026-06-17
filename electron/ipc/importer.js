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
const { fetchAndStoreSteamData, findSteamId } = require('../scanners/steamscanner')
const { findExecutables } = require("../scanners/executableScanner");
const { getDefaultRenpySaveRoot, scanRenpySaveFolders } = require("../scanners/renpySaveScanner");
const { findRecordBySteamId } = require('../db/steam')
const { deletePathWithElevationFallback } = require('../deleteUtils')

let ownerMainWindow = null

// ── Importer helper functions ──────────────────────────────────────

function sanitizePathSegment(value, fallback = "Unknown") {
  const sanitized = String(value || fallback)
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized && sanitized !== "." ? sanitized : fallback;
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
          if (key === "version") return game.version || "v1";
          if (key === "engine") return game.engine || "Unknown";
          if (key === "f95id") return game.f95Id || "Unknown";
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

const getConfiguredExtractionExtensions = (appConfig) =>
  String(appConfig?.Library?.extractionExtensions || "zip,7z,rar")
    .split(",")
    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

const isArchiveFilePath = (filePath, appConfig) => {
  const ext = path.extname(String(filePath || "")).toLowerCase().replace(/^\./, "");
  return ext ? getConfiguredExtractionExtensions(appConfig).includes(ext) : false;
};

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
  return String(catalog.latestVersion || catalog.latest_version || catalog.version || "Unknown").trim() || "Unknown";
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
            await fsp.rename(tempPath, finalPath);
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

async function extractRarArchive(archivePath, extractPath) {
  const { createExtractorFromFile } = require("node-unrar-js");
  const wasmPath = resolvePackagedModulePath(
    require.resolve("node-unrar-js/dist/js/unrar.wasm"),
  );
  const wasmBinary = await fs.promises.readFile(wasmPath);
  const extractor = await createExtractorFromFile({
    filepath: archivePath,
    targetPath: extractPath,
    wasmBinary,
  });
  const extracted = extractor.extract();
  let extractedCount = 0;

  for (const file of extracted.files) {
    if (!file.fileHeader.flags.directory) {
      extractedCount += 1;
    }
  }

  if (extractedCount === 0) {
    throw new Error("RAR extraction completed but no files were extracted");
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
      "C:\\Program Files\\7-Zip\\7za.exe",
      "C:\\Program Files (x86)\\7-Zip\\7za.exe",
      "C:\\Program Files\\7-Zip\\7zz.exe",
      "C:\\Program Files (x86)\\7-Zip\\7zz.exe",
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

  const bundledPath = getBundledSevenZipPath();
  if (bundledPath) {
    candidates.push({
      path: bundledPath,
      source: "bundled",
      message: "Using bundled 7-Zip",
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

  for (const command of ["7z", "7za", "7zz"]) {
    candidates.push({
      path: command,
      source: "PATH",
      message: "Using 7-Zip from PATH",
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

async function isAllowedDeletionPath(recordId, folderPath) {
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

  const libraryRoot = appConfig?.Library?.gameFolder;
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

async function replaceInstalledVersionAfterImport({
  recordId,
  newVersion,
  newGamePath,
  replaceVersion,
  sender = ownerMainWindow,
}) {
  const selectedReplaceVersion = String(replaceVersion || "").trim();
  if (!recordId || !selectedReplaceVersion) return { replaced: false };

  const normalizedNewVersion = String(newVersion || "").trim().toLowerCase();
  const normalizedReplaceVersion = selectedReplaceVersion.toLowerCase();

  if (normalizedNewVersion && normalizedNewVersion === normalizedReplaceVersion) {
    return {
      replaced: false,
      skipped: true,
      reason: "Replacement version matches the newly imported version",
    };
  }

  const oldVersion = await getVersionForRecord(recordId, selectedReplaceVersion);
  if (!oldVersion) {
    return {
      replaced: false,
      skipped: true,
      reason: "Replacement version was not found",
    };
  }

  const oldPath = oldVersion.game_path;
  if (!oldPath) {
    await deleteVersion(recordId, selectedReplaceVersion);
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
      reason: "Replacement path matches the newly imported path",
    };
  }

  const hadOldFiles = fs.existsSync(resolvedOldPath);
  if (hadOldFiles) {
    if (!(await isAllowedDeletionPath(recordId, resolvedOldPath))) {
      return {
        replaced: false,
        skipped: true,
        reason: "Replacement path is not allowed for deletion",
      };
    }

    const parsedPath = path.parse(resolvedOldPath);
    if (resolvedOldPath === parsedPath.root) {
      return {
        replaced: false,
        skipped: true,
        reason: "Refusing to delete a drive root",
      };
    }

    const stat = await fs.promises.stat(resolvedOldPath);
    if (!stat.isDirectory()) {
      return {
        replaced: false,
        skipped: true,
        reason: "Replacement path is not a directory",
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
          if (!(await isAllowedDeletionPath(recordId, candidatePath))) {
            throw new Error("Replacement path is not allowed for deletion");
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
      if (!deleteResult.success) {
        return {
          replaced: false,
          skipped: true,
          reason: deleteResult.canceled
            ? "Administrator delete was canceled"
            : deleteResult.error || "Failed to delete replacement files",
        };
      }
      await removeEmptyParentDirectories(
        resolvedOldPath,
        appConfig?.Library?.gameFolder,
      );
    } catch (err) {
      return {
        replaced: false,
        skipped: true,
        reason: `Failed to delete replacement files: ${err.message}`,
      };
    }
  }

  await deleteVersion(recordId, selectedReplaceVersion);

  sender?.webContents?.send("import-progress", {
    text: `Replaced old version ${selectedReplaceVersion}`,
    progress: 0,
    total: 0,
    canCancel: true,
  });

  return { replaced: true, deletedFiles: hadOldFiles };
}



const hydrateImportMatch = async (game, selectedValue) => {
  let updatedGame = { ...game, resultSelectedValue: selectedValue };
  const selected = game.results?.find((result) => result.key === selectedValue);

  if (selected && selectedValue !== "match") {
    const parts = selected.value.split(" | ");
    updatedGame = {
      ...updatedGame,
      atlasId: parts[0],
      f95Id: parts[1] || "",
      title: parts[2],
      creator: parts[3],
    };
    const atlasData = await getAtlasData(updatedGame.atlasId);
    updatedGame = {
      ...updatedGame,
      engine: atlasData.engine || updatedGame.engine || "Unknown",
      f95Id: updatedGame.f95Id || atlasData.f95_id || "",
      siteUrl: atlasData.siteUrl || atlasData.site_url || updatedGame.siteUrl || "",
      latestVersion: atlasData.latestVersion || "",
    };
  }

  const status = await getImportRecordStatus(updatedGame);
  const recordExist = status?.status === "alreadyImported";
  const isSteamVersion = status?.status === "steamVersion";
  return {
    ...updatedGame,
    recordExist,
    existingRecordId: status?.recordId || "",
    scanStatus: recordExist
      ? "alreadyImported"
      : isSteamVersion
        ? "steamVersion"
        : status?.status === "repairPath"
          ? "repairPath"
          : "new",
    scanMessage: recordExist
      ? "Already imported"
      : isSteamVersion
        ? "Add as Steam version"
        : status?.status === "repairPath"
          ? "Repair path"
          : updatedGame.isArchive
            ? "Archive"
            : "Ready to import",
  };
};

const chooseInstalledImportMatch = async (game, results) => {
  for (const result of results) {
    const candidate = await hydrateImportMatch({ ...game, results }, result.key);
    if (["alreadyImported", "repairPath", "steamVersion"].includes(candidate.scanStatus)) {
      return candidate;
    }
  }
  return hydrateImportMatch({ ...game, results }, results[0]?.key || "");
};

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
    recentlyDeletedGamePaths, db,
  } = ctx
  ownerMainWindow = mainWindow

ipcMain.handle("unzip-game", async (event, { zipPath, extractPath }) => {
  try {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const resolvedSevenZip = await resolveSevenZipExecutablePath({
      configuredPath: appConfig?.Library?.sevenZipPath,
      currentConfig: appConfig,
      currentConfigPath: configPath,
      ownerWindow,
    });
    if (!resolvedSevenZip?.path) {
      throw new Error(
        "7-Zip executable not found. Bundled 7zip was unavailable and no local 7-Zip installation could be detected.",
      );
    }
    const extraction = await extractArchive(
      zipPath,
      extractPath,
      resolvedSevenZip.path,
      null,
      ownerWindow,
    );
    return { success: true, extractPath: extraction.finalPath || extractPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("select-catalog-import-source", async (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const currentConfig = ctx.appConfig || appConfig || {};
  const archiveExtensions = getConfiguredExtractionExtensions(currentConfig);
  const gameExtensions = getConfiguredGameExtensions(currentConfig);
  const result = await showOpenDialog(ownerWindow, {
    title: "Choose game folder, archive, or executable",
    properties: ["openFile", "openDirectory"],
    filters: [
      { name: "Game files and archives", extensions: [...new Set([...archiveExtensions, ...gameExtensions])] },
      { name: "All files", extensions: ["*"] },
    ],
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
  const atlasId = toPositiveInteger(catalog.atlas_id ?? catalog.atlasId);
  const f95Id = toPositiveInteger(catalog.f95_id ?? catalog.f95Id);
  const steamId = toPositiveInteger(catalog.steam_id ?? catalog.steamId ?? catalog.steam_appid);

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

    const version = requestedVersion || inferCatalogImportVersion(sourcePath, catalog);
    const destinationFormat = currentConfig?.Library?.libraryFolderStructure || "{creator}/{title}/{version}";
    const importGame = {
      title: String(catalog.title || catalog.name || catalog.short_name || "Untitled").trim(),
      creator: String(catalog.creator || catalog.developer || catalog.steam_developer || "Unknown").trim(),
      engine: String(catalog.engine || "").trim(),
      description: String(catalog.overview || catalog.description || "").trim(),
      version,
      atlasId,
      f95Id,
      steamId,
    };

    let recordId = null;
    const mappingRow = await dbGet(
      db,
      `SELECT record_id FROM atlas_mappings WHERE ? IS NOT NULL AND atlas_id = ?
       UNION
       SELECT record_id FROM f95_zone_mappings WHERE ? IS NOT NULL AND f95_id = ?
       UNION
       SELECT record_id FROM steam_mappings WHERE ? IS NOT NULL AND steam_id = ?
       LIMIT 1`,
      [atlasId, atlasId, f95Id, f95Id, steamId, steamId],
    );
    if (mappingRow?.record_id) recordId = mappingRow.record_id;
    if (!recordId && steamId) recordId = await findRecordBySteamId(steamId);
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
    } else if (isArchiveFilePath(sourcePath, currentConfig)) {
      const resolvedSevenZip = await resolveSevenZipExecutablePath({
        configuredPath: currentConfig?.Library?.sevenZipPath,
        currentConfig,
        currentConfigPath: configPath,
        ownerWindow,
        notify: (text) => notify(text, 10),
      });
      if (!resolvedSevenZip?.path) throw new Error("7-Zip is required for archive import");
      notify(`Extracting ${importGame.title}...`, 15);
      const extraction = await extractArchive(sourcePath, targetBase, resolvedSevenZip.path, session, ownerWindow);
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
      recordId = await addGame({
        title: importGame.title,
        creator: importGame.creator,
        engine: importGame.engine,
        description: importGame.description,
      });
      if (importGame.description) {
        await updateGame({
          record_id: recordId,
          title: importGame.title,
          creator: importGame.creator,
          engine: importGame.engine,
          description: importGame.description,
        });
      }
    }

    if (atlasId) await addAtlasMapping(recordId, atlasId);
    if (f95Id) await dbRun(db, `INSERT OR IGNORE INTO f95_zone_mappings (record_id, f95_id) VALUES (?, ?)`, [recordId, f95Id]);
    if (steamId) await addSteamMapping(recordId, steamId);

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
    return {
      success: true,
      recordId,
      version,
      gamePath,
      execPath,
      game: refreshedGame,
      mappings: { atlasId, f95Id, steamId },
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
  const version = String(payload.version || "").trim();
  const replaceExisting = payload.replaceExisting === true;
  const replaceVersionId = toPositiveInteger(payload.replaceVersionId || payload.versionId);

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
    let targetLibrary = currentConfig?.Library?.gameFolder;
    if (!targetLibrary || !fs.existsSync(targetLibrary)) {
      const existingRoot = replaceRow?.game_path ? path.dirname(path.resolve(replaceRow.game_path)) : "";
      targetLibrary = existingRoot && fs.existsSync(existingRoot) ? existingRoot : path.join(dataDir, "games");
    }
    const destinationFormat = currentConfig?.Library?.libraryFolderStructure || "{creator}/{title}/{version}";
    const importGame = {
      title: gameRow.title || "Untitled",
      creator: gameRow.creator || "Unknown",
      engine: gameRow.engine || "Unknown",
      version,
    };
    const targetBase = getUniquePath(buildStructuredImportPath(targetLibrary, destinationFormat, importGame));
    const extensions = getConfiguredGameExtensions(currentConfig);
    const archiveExtensions = getConfiguredExtractionExtensions(currentConfig);

    if (stat.isFile() && !isArchiveFilePath(sourcePath, currentConfig)) {
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

    let gamePath = "";
    let execPath = "";
    let relativeExec = "";

    if (stat.isDirectory()) {
      await fsp.mkdir(path.dirname(targetBase), { recursive: true });
      await fsp.cp(sourcePath, targetBase, { recursive: true });
      gamePath = targetBase;
      const execs = findExecutables(gamePath, extensions);
      relativeExec = execs[0] || "";
      execPath = relativeExec ? path.join(gamePath, relativeExec) : "";
    } else if (isArchiveFilePath(sourcePath, currentConfig)) {
      const resolvedSevenZip = await resolveSevenZipExecutablePath({
        configuredPath: currentConfig?.Library?.sevenZipPath,
        currentConfig,
        currentConfigPath: configPath,
        ownerWindow,
        notify: () => {},
      });
      if (!resolvedSevenZip?.path) throw new Error("7-Zip is required for archive import");
      const extraction = await extractArchive(sourcePath, targetBase, resolvedSevenZip.path, session, ownerWindow);
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
    } else {
      await fsp.mkdir(targetBase, { recursive: true });
      const destFile = path.join(targetBase, path.basename(sourcePath));
      await fsp.copyFile(sourcePath, destFile);
      gamePath = targetBase;
      relativeExec = path.basename(destFile);
      execPath = destFile;
    }

    if (!gamePath) throw new Error("Import did not produce a game folder");
    if (!execPath) throw new Error("No launchable file was found in the imported source");

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

    const refreshedGame = await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode()).catch(() => null);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send("game-updated", refreshedGame || recordId);
    });
    return {
      success: true,
      recordId,
      version,
      gamePath,
      execPath,
      replaced: replaceExisting,
      game: refreshedGame,
    };
  } catch (err) {
    console.error("import-local-game-version error:", err);
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
  ctx.activeScanSession = { canceled: false };
  try {
    await startScan(params, window, ctx.activeScanSession);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    ctx.activeScanSession = null;
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
  const steamId = toPositiveInteger(game.steamId || game.steam_id);
  const title = String(game.title || "").trim();
  const creator = String(game.creator || "Unknown").trim() || "Unknown";
  const engine = String(game.engine || "Ren'Py").trim() || "Ren'Py";

  if (atlasId || f95Id || steamId) {
    const row = await dbGet(
      db,
      `SELECT record_id FROM atlas_mappings WHERE ? IS NOT NULL AND atlas_id = ?
       UNION
       SELECT record_id FROM f95_zone_mappings WHERE ? IS NOT NULL AND f95_id = ?
       UNION
       SELECT record_id FROM steam_mappings WHERE ? IS NOT NULL AND steam_id = ?
       LIMIT 1`,
      [atlasId, atlasId, f95Id, f95Id, steamId, steamId],
    );
    if (row?.record_id) return row;
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
  const rootPath = params.rootPath || getDefaultRenpySaveRoot();
  if (!rootPath || !fs.existsSync(rootPath)) {
    return {
      success: false,
      needsSelection: true,
      rootPath: rootPath || "",
      message: "Ren'Py save folder was not found. Select it manually.",
    };
  }

  try {
    const rows = await scanRenpySaveFolders(rootPath);
    const games = [];
    for (const row of rows) {
      games.push(await makeRenpyImportRow(row, searchAtlas, db));
    }
    return { success: true, rootPath, games };
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
  }
  return { success: true };
});

ipcMain.handle("get-steam-game-data", async (event, steamId) => {
  return await fetchAndStoreSteamData(db, steamId);
});

ipcMain.handle("search-atlas", async (event, params) => {
  return await searchAtlas(params.title, params.creator);
});

ipcMain.handle("resolve-import-matches", async (event, games = []) => {
  const searchCache = new Map();

  // ── Pre-warm search cache for all unique keys in parallel ──────────────
  const pending = games.filter(
    (g) => g && g.scanStatus === "pendingMatch",
  );

  const uniqueSearches = new Map();
  for (const game of pending) {
    const f95Id = String(game.f95Id || "").trim();
    const cacheKey = f95Id
      ? `f95:${f95Id}`
      : `atlas:${game.lookupTitle || game.title}|${game.creator}`;
    if (!uniqueSearches.has(cacheKey)) {
      uniqueSearches.set(cacheKey, { f95Id, game });
    }
  }

  await Promise.all(
    Array.from(uniqueSearches.entries()).map(async ([cacheKey, { f95Id, game }]) => {
      try {
        const data = f95Id
          ? await searchAtlasByF95Id(f95Id)
          : await searchAtlas(game.lookupTitle || game.title, game.creator);
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

    const f95Id = String(game.f95Id || "").trim();
    const cacheKey = f95Id
      ? `f95:${f95Id}`
      : `atlas:${game.lookupTitle || game.title}|${game.creator}`;

    try {
      const data = searchCache.get(cacheKey) || [];

      if (data.length === 1) {
        return await hydrateImportMatch({
          ...game,
          atlasId: String(data[0].atlas_id),
          f95Id: data[0].f95_id || game.f95Id || "",
          siteUrl: data[0].siteUrl || data[0].site_url || game.siteUrl || "",
          title: data[0].title,
          creator: data[0].creator,
          engine: data[0].engine || game.engine || "Unknown",
          latestVersion: data[0].latestVersion || "",
          results: [{ key: "match", value: "Match Found" }],
          resultSelectedValue: "match",
          resultVisibility: "visible",
        }, "match");
      } else if (data.length > 1) {
        const results = data.map((match) => ({
          key: String(match.atlas_id),
          value: `${match.atlas_id} | ${match.f95_id || ""} | ${match.title} | ${match.creator}`,
        }));
        return await chooseInstalledImportMatch({ ...game, results }, results);
      } else {
        return await hydrateImportMatch({
          ...game,
          atlasId: "",
          f95Id: game.f95Id || "",
          results: [],
          resultSelectedValue: "",
          resultVisibility: "hidden",
        }, "");
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
  console.log(`IPC search-atlas-by-f95-id received f95Id: ${f95Id}`);
  try {
    const result = await searchAtlasByF95Id(f95Id);
    console.log(
      `IPC search-atlas-by-f95-id result for ${f95Id}: ${JSON.stringify(result)}`,
    );
    return result;
  } catch (err) {
    console.error(`Error in search-atlas-by-f95-id for ${f95Id}:`, err);
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
    scanSize,
    downloadBannerImages,
    downloadPreviewImages,
    previewLimit,
    downloadVideos,
    gameExt,
    moveToDefaultFolder = false,
    forceReimport = false,
    libraryFormat,
  } = params;

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

  let targetLibrary = appConfig?.Library?.gameFolder;
  if (!targetLibrary || !fs.existsSync(targetLibrary)) {
    console.warn("No default library folder configured");
    mainWindow.webContents.send("import-warning", {
      message:
        "Default library folder not set — games will be imported to data/games",
    });
    targetLibrary = gamesDir; // fallback
  }

  // ────────────────────────────────────────────────────────────────
  //  Resolve 7-Zip once before archive extraction
  // ────────────────────────────────────────────────────────────────
  let sevenZipPath = null;

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

  }

  const results = [];

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

      let gamePath = game.folder;
      let execPath = game.selectedValue
        ? path.join(game.folder, game.selectedValue)
        : "";
      const sourceCleanupRoot = game.sourceRoot || sourceRoot;

      let size = 0;
      let archiveToDeleteAfterImport = null;

      // ── Structured move (non-archive) ───────────────────────────────────────
      if (moveToDefaultFolder && targetLibrary && !game.isArchive) {
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
          text: `${deleteAfter ? "Moving" : "Copying"} ${game.title} to library...`,
          progress,
          total,
          canCancel: true,
        });

        if (deleteAfter) {
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
              mainWindow.webContents.send("import-progress", {
                text: `Copied ${game.title}, but source files were not deleted: ${deleteResult.error || "permission denied"}`,
                progress,
                total,
                canCancel: true,
              });
            }
          }
          await removeEmptyParentDirectories(originalSourcePath, sourceCleanupRoot);
        } else {
          await fsp.cp(gamePath, destinationPath, { recursive: true });
        }

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
          const extraction = await extractArchive(
            zipPath,
            extractPath,
            sevenZipPath,
            session,
            mainWindow,
          );
          extractPath = extraction.finalPath || extractPath;
          session.cleanupPaths = [extractPath];
          archiveToDeleteAfterImport = deleteAfter ? zipPath : null;

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
      let recordId =
        shouldUpsertExisting && game.existingRecordId
          ? game.existingRecordId
          : shouldUpsertExisting
            ? await findExistingRecordForImport(game)
            : null;

      // Steam merge: if this install's appid already belongs to a record (a
      // prior steam import, or an Atlas/f95 title listing this appid in its
      // external_ids), attach to that record so it shows as an extra version
      // instead of a duplicate title — even when the names differ.
      if (!recordId && game.steamId) {
        const steamMergeRecordId =
          (game.existingRecordId &&
          ["steamVersion", "repairPath"].includes(String(game.scanStatus || ""))
            ? game.existingRecordId
            : null) || (await findRecordBySteamId(game.steamId));
        if (steamMergeRecordId) recordId = steamMergeRecordId;
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
      if (shouldUpsertExisting) {
        await upsertVersion(
          { ...game, folder: gamePath, execPath, folderSize: size },
          recordId,
        );
      } else {
        await addVersion(
          { ...game, folder: gamePath, execPath, folderSize: size },
          recordId,
        );
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

      // Steam-sourced rows carry a numeric appid. Persisting the mapping is what
      // wires up launch (steam://run via getSteamIDbyRecord) and the Steam CDN
      // banner/hero art resolved in mediaSources. Metadata enrichment of
      // steam_data happens in a later phase; the mapping alone is enough for the
      // game to appear, render art, and launch.
      if (game.steamId) {
        try {
          await addSteamMapping(recordId, parseInt(game.steamId, 10));
          console.log("steam mapping added");
        } catch (err) {
          console.error("Failed to add steam mapping:", err);
          throw err;
        }
      }

      if (size > 0) await updateFolderSize(recordId, game.version, size);
      if (game.replaceVersion) {
        const replacementResult = await replaceInstalledVersionAfterImport({
          recordId,
          newVersion: game.version,
          newGamePath: gamePath,
          replaceVersion: game.replaceVersion,
          sender: mainWindow,
        });

        if (replacementResult?.skipped) {
          console.warn(
            `Skipped replacement for ${game.title}: ${replacementResult.reason}`,
          );
          mainWindow.webContents.send("import-progress", {
            text: `Imported ${game.title}, but skipped replacement: ${replacementResult.reason}`,
            progress,
            total,
            canCancel: true,
          });
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
          console.warn(
            `Failed to delete archive ${archiveToDeleteAfterImport}: ${archiveDeleteErr.message}`,
          );
          mainWindow.webContents.send("import-progress", {
            text: `Imported ${game.title}, but kept original archive because deletion failed`,
            progress,
            total,
            canCancel: true,
          });
        }
      }
      results.push({
        success: true,
        title: game.title,
        recordId,
        atlasId: game.atlasId,
        steamId: game.steamId,
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
          await fetchAndStoreSteamData(null, r.steamId);
          mainWindow?.webContents?.send("game-updated", r.recordId);
        } catch (err) {
          console.error(`Background steam enrichment failed for ${r.steamId}:`, err);
        }
        await new Promise((res) => setTimeout(res, 800));
      }
    })();
  }

  // Phase 2: Image downloads
  if (shouldDownloadImportImages) {
    progress = 0;
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
    const isVideoUrl = (url) => /\.(mp4|webm|m4v)(\?|#|$)/i.test(String(url || ""));
    const inferMediaSource = (url) => {
      const value = String(url || "").toLowerCase();
      if (value.includes("steamstatic") || value.includes("akamaihd") || value.includes("steam")) return "steam";
      if (value.includes("f95")) return "f95";
      return "metadata";
    };
    const resolveImportMediaIdentifiers = async (recordId, importResult) => {
      const dbAtlasId = await GetAtlasIDbyRecord(recordId);
      const steamId = await getSteamIDbyRecord(recordId);
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

    for (const importedGame of successfulImports) {
      const title =
        importedGame.title ||
        games.find((g) => g.atlasId === importedGame.atlasId || g.steamId === importedGame.steamId)?.title ||
        "Imported game";
      try {
        throwIfImportCanceled(session);

        const recordId = importedGame.recordId;
        const ids = await resolveImportMediaIdentifiers(recordId, importedGame);
        const { dbAtlasId, f95Id, steamId } = ids;

        if (steamId) {
          try {
            await fetchAndStoreSteamData(null, steamId);
          } catch (steamErr) {
            console.warn(`Import media trace: Steam metadata refresh failed for ${steamId}:`, steamErr);
          }
        }

        if (!dbAtlasId && !steamId) {
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
          continue;
        }

        const bannerUrl = downloadBannerImages ? await getRemoteBannerUrl(recordId) : "";
        const rawPreviewUrls = downloadPreviewImages ? await getRemotePreviewUrls(recordId) : [];
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
          ? (await getAllDownloadableAssetUrlsForRecord(recordId, { downloadVideos }))
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
          continue;
        }

        mainWindow.webContents.send("import-progress", {
          text: `Downloading images for '${title}' ${progress + 1}/${imageTotal}, 0/${totalImages}`,
          progress,
          total: imageTotal,
          canCancel: true,
        });

        const downloadResult = await downloadImages(
          recordId,
          dbAtlasId || steamId || recordId,
          (current, totalImages) => {
            mainWindow.webContents.send("import-progress", {
              text: `Downloading images for '${title}' ${progress + 1}/${imageTotal}, ${current}/${totalImages}`,
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
          },
        );
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
          break;
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

  mainWindow.webContents.send("import-complete");
  ctx.activeImportSession = null;
  return results;
});

ipcMain.handle("get-steam-data", async (event, steam_id) => {
  console.log("Handling get-steam-data:", steam_id);
  try {
    const game = await fetchAndStoreSteamData(db, steam_id);
    console.log("Steam Game data updated in database");
    return game;
  } catch (err) {
    console.error("Error updating Steam Game Data:", err);
    throw err;
  }
});

ipcMain.handle("find-steam-id", async (event, title, developer) => {
  console.log("Handling find-steam-id:", title, developer);
  try {
    const steamId = await findSteamId(title, developer);
    console.log("Steam Game id found:", steamId);
    return steamId;
  } catch (err) {
    console.error("Error checking Steam ID:", err);
    throw err;
  }
});

ipcMain.handle("start-steam-scan", async (event, params) => {
  return await startSteamScan(db, params, event);
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
