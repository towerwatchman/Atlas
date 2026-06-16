'use strict'

const { ipcMain, dialog, BrowserWindow, app } = require('electron')
const { downloadImages, buildBannerBaseName } = require('../imageUtils')
const path = require('path')
const fs = require('fs')
const fsp = require('fs').promises
const cp = require('child_process')
const ini = require('ini')
const { Worker } = require('worker_threads')
const { getImportRecordStatus, getAtlasData, findExistingRecordForImport,
        checkRecordExist, checkPathExist } = require('../db/atlas')
const { getGame } = require('../db/versions')

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
  await fs.promises.rm(source, { recursive: true, force: true });
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

async function removeEmptyParentDirectories(startPath, stopAtPath) {
  if (!startPath || !stopAtPath) return;

  let current = path.dirname(path.resolve(startPath));
  const stopAt = path.resolve(stopAtPath);

  while (
    current &&
    current !== path.parse(current).root &&
    isPathInside(stopAt, current) &&
    normalizeForPathCompare(current) !== normalizeForPathCompare(stopAt)
  ) {
    const entries = await fs.promises.readdir(current).catch(() => null);
    if (!entries || entries.length > 0) break;

    await fs.promises.rmdir(current).catch(() => {});
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

    await fs.promises.rm(resolvedPath, { recursive: true, force: true });
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
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to remove incomplete import path ${targetPath}:`, err);
  }
}

async function replaceInstalledVersionAfterImport({
  recordId,
  newVersion,
  newGamePath,
  replaceVersion,
  sender = mainWindow,
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
      await fs.promises.rm(resolvedOldPath, { recursive: true, force: true });
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
      latestVersion: atlasData.latestVersion || "",
    };
  }

  const status = await getImportRecordStatus(updatedGame);
  const recordExist = status?.status === "alreadyImported";
  return {
    ...updatedGame,
    recordExist,
    existingRecordId: status?.recordId || "",
    scanStatus: recordExist
      ? "alreadyImported"
      : status?.status === "repairPath"
        ? "repairPath"
        : "new",
    scanMessage: recordExist
      ? "Already imported"
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
    if (["alreadyImported", "repairPath"].includes(candidate.scanStatus)) {
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
    addAtlasMapping, checkPathExist, findExistingRecordForImport,
    getImportRecordStatus, checkRecordExist, addGame, addVersion,
    upsertVersion, updateGame, updateFolderSize, getSteamIDbyRecord,
    addSteamMapping, getBannerUrl, getScreensUrlList,
    getVersionForRecord, getVersionPathsForRecord,
    deleteVersion, deleteGameCompletely, deleteTitleRecord,
    getTrustedVersion, isAllowedDeletionPath, isPathInside,
    normalizeForPathCompare, removeEmptyParentDirectories,
    showExecutableChooser, executableChooserWindow,
    startSteamScan, startScan, getAssetBasePath, getMediaStorageMode,
    recentlyDeletedGamePaths, db,
  } = ctx

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

ipcMain.handle("cancel-scan", async () => {
  if (ctx.activeScanSession) {
    ctx.activeScanSession.canceled = true;
  }
  return { success: true };
});

ipcMain.handle("get-steam-game-data", async (event, steamId) => {
  return await getSteamGameData(steamId);
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
          f95Id: data[0].f95_id || "",
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
          f95Id: "",
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
      ["new", "repairPath"].includes(game.scanStatus || "new") ||
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
            await fsp.rm(gamePath, { recursive: true, force: true });
          }
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
              await fsp.rm(target, { recursive: true, force: true });
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

      if (scanSize) {
        throwIfImportCanceled(session);
        size = getFolderSize(gamePath);
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
          await fsp.unlink(archiveToDeleteAfterImport);
          console.log(`Deleted archive after successful import: ${archiveToDeleteAfterImport}`);
          mainWindow.webContents.send("import-progress", {
            text: `Deleted original archive after importing ${game.title}`,
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
      results.push({ success: true, recordId, atlasId: game.atlasId });
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

  // Phase 2: Image downloads
  if (downloadBannerImages || downloadPreviewImages) {
    progress = 0;
    const gamesWithImages = results
      .filter((r) => r.success && r.atlasId)
      .map((r) => ({
        title:
          games.find((g) => g.atlasId === r.atlasId)?.title || "Unknown Game",
        atlasId: r.atlasId,
        recordId: r.recordId,
      }));
    const imageTotal = gamesWithImages.length;

    mainWindow.webContents.send("import-progress", {
      text: `Starting image download for ${imageTotal} games...`,
      progress,
      total: imageTotal,
      canCancel: true,
    });

    for (const game of gamesWithImages) {
      try {
        throwIfImportCanceled(session);
        const bannerUrl = await getBannerUrl(game.atlasId);
        const screenUrls = await getScreensUrlList(game.atlasId);
        const previewCount = downloadPreviewImages
          ? previewLimit === "Unlimited"
            ? screenUrls.length
            : Math.min(parseInt(previewLimit), screenUrls.length)
          : 0;
        const totalImages =
          (downloadBannerImages && bannerUrl ? 2 : 0) + previewCount;

        mainWindow.webContents.send("import-progress", {
          text: `Downloading images for '${game.title}' ${progress + 1}/${imageTotal}, 0/${totalImages}`,
          progress,
          total: imageTotal,
          canCancel: true,
        });

        await downloadImages(
          game.recordId,
          game.atlasId,
          (current, totalImages) => {
            mainWindow.webContents.send("import-progress", {
              text: `Downloading images for '${game.title}' ${progress + 1}/${imageTotal}, ${current}/${totalImages}`,
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
          getBannerUrl,
          getScreensUrlList,
          updateBanners,
          updatePreviews,
          { source: "f95" },
        );
        throwIfImportCanceled(session);

        mainWindow.webContents.send("game-updated", game.recordId);

        progress++;
        mainWindow.webContents.send("import-progress", {
          text: `Completed image download for '${game.title}' ${progress}/${imageTotal}, ${totalImages} images downloaded`,
          progress,
          total: imageTotal,
          canCancel: true,
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
        mainWindow.webContents.send("import-progress", {
          text: `Error downloading images for '${game.title}' ${progress}/${imageTotal}: ${err.message}`,
          progress,
          total: imageTotal,
          canCancel: true,
        });
      }
    }

    if (!session.cancelRequested) {
      mainWindow.webContents.send("import-progress", {
        text: `Image download complete for ${progress} games`,
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
    await getSteamGameData(steam_id);
    console.log("Steam Game data updated in database");
  } catch (err) {
    console.error("Error updating Steam Game Data:", err);
    throw err;
  }
});

ipcMain.handle("find-steam-id", async (event, title, developer) => {
  console.log("Handling find-steam-id:", title, developer);
  try {
    await findSteamId(title, developer);
    console.log("Steam Game id found");
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
