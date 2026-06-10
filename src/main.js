const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const sharp = require("sharp");
const axios = require("axios");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const { Worker } = require("worker_threads");
const ini = require("ini");
const { isNewerVersion } = require("./core/versionUtils");
const {
  initializeDatabase,
  repairDoubledApostropheRows,
  repairStaleVersionExecutables,
  addGame,
  updateGame,
  addVersion,
  upsertVersion,
  updateVersion,
  recordGameLaunchStarted,
  recordGamePlaytime,
  addAtlasMapping,
  getGame,
  getGames,
  getGameRecordIds,
  removeGame,
  checkDbUpdates,
  updateFolderSize,
  getBannerUrl,
  getScreensUrlList,
  getEmulatorConfig,
  removeEmulatorConfig,
  saveEmulatorConfig,
  getEmulatorByExtension,
  GetAtlasIDbyRecord,
  getPreviews,
  getBanner,
  deleteBanner,
  deletePreviews,
  searchAtlas,
  searchAtlasByF95Id,
  findF95Id,
  checkPathExist,
  findExistingRecordForImport,
  getImportRecordStatus,
  updateBanners,
  updatePreviews,
  getAtlasData,
  getSteamIDbyRecord,
  countVersions,
  deleteVersion,
  deleteGameCompletely,
  getUniqueFilterOptions,
  getVersionForRecord,
  getVersionPathsForRecord,
  db,
} = require("./database");
const { Menu } = require("electron");
const cp = require("child_process");
const contextMenuData = new Map();
const recentlyDeletedGamePaths = new Map();

// SCANNERS
const { startSteamScan } = require("./core/scanners/steamscanner");
const { startScan } = require("./core/scanners/f95scanner");

let contextMenuId = 0;
let mainWindow;
let settingsWindow;
let importerWindow;
let importSourceDialog;
let executableChooserWindow = null;
let appConfig;
let activeImportSession = null;
let activeLibraryValidation = null;
let activeScanSession = null;

app.commandLine.appendSwitch("force-color-profile", "srgb");

// ────────────────────────────────────────────────
// WINDOW CREATION FUNCTIONS
// ────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 720,
    minWidth: 1400,
    minHeight: 720,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window-state-changed", "maximized");
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window-state-changed", "restored");
  });
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 850,
    height: 600,
    minWidth: 850,
    minHeight: 600,
    roundedCorners: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    center: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, "settings.html"));

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    settingsWindow.webContents.openDevTools();
  }

  settingsWindow.on("maximize", () => {
    settingsWindow.webContents.send("window-state-changed", "maximized");
  });
  settingsWindow.on("unmaximize", () => {
    settingsWindow.webContents.send("window-state-changed", "restored");
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createImporterWindow() {
  console.log("Creating importer window");
  importerWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  const filePath = path.join(__dirname, "core/ui/windows/importer.html");
  console.log("Loading importer file:", filePath);
  importerWindow
    .loadFile(filePath)
    .then(() => {
      console.log("importer.html loaded successfully");
    })
    .catch((err) => {
      console.error("Failed to load importer.html:", err);
    });

  importerWindow.on("maximize", () => {
    console.log("Importer window maximized");
    importerWindow.webContents.send("window-state-changed", "maximized");
  });
  importerWindow.on("unmaximize", () => {
    console.log("Importer window unmaximized");
    importerWindow.webContents.send("window-state-changed", "restored");
  });

  importerWindow.on("closed", () => {
    console.log("Importer window closed");
    importerWindow = null;
  });
}

function showExecutableChooser(title, version, executables) {
  if (executableChooserWindow && !executableChooserWindow.isDestroyed()) {
    executableChooserWindow.focus();
    return;
  }

  executableChooserWindow = new BrowserWindow({
    width: 520,
    height: 480,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    center: true,
    modal: true,
    parent: importerWindow || mainWindow,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"), // Ensure preload is correct
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  const filePath = path.join(
    __dirname,
    "core/ui/modals/executable-chooser.html",
  );
  executableChooserWindow.loadFile(filePath);

  executableChooserWindow.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      console.log("Modal loaded - sending executables:", executables);
      executableChooserWindow.webContents.send("init-chooser", {
        title: title || "Game",
        version: version || "",
        executables: executables || [],
      });
    }, 100); // small delay to ensure script runs
  });

  // Debug: open dev tools for modal
  // executableChooserWindow.webContents.openDevTools({ mode: 'detach' });

  executableChooserWindow.on("closed", () => {
    executableChooserWindow = null;
  });
}
// Maps a game-details window's webContents id to the recordId it should show,
// so the renderer can pull its data on demand (avoids the load-timing race).
const gameDetailsRecordMap = new Map();

function createGameDetailsWindow(recordId) {
  const gameDetailsWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1400,
    minHeight: 900,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  gameDetailsWindow.loadFile(path.join(__dirname, "gamedetails.html"));

  // Capture the id up front — in the "closed" handler the webContents is
  // already destroyed, so reading gameDetailsWindow.webContents there throws.
  const detailsWebContentsId = gameDetailsWindow.webContents.id;
  gameDetailsRecordMap.set(detailsWebContentsId, recordId);

  // Data is delivered via the pull-based "request-game-data" handler once the
  // renderer has mounted (see GameDetailsWindow.jsx), so no timed push here.

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    gameDetailsWindow.webContents.openDevTools();
  }

  gameDetailsWindow.on("maximize", () => {
    if (gameDetailsWindow.isDestroyed()) return;
    gameDetailsWindow.webContents.send("window-state-changed", "maximized");
  });
  gameDetailsWindow.on("unmaximize", () => {
    if (gameDetailsWindow.isDestroyed()) return;
    gameDetailsWindow.webContents.send("window-state-changed", "restored");
  });

  gameDetailsWindow.on("closed", () => {
    gameDetailsRecordMap.delete(detailsWebContentsId);
  });
}

function copyDirectoryIfMissing(source, target) {
  if (!source || !fs.existsSync(source)) return;

  if (fs.existsSync(target)) {
    const targetStats = fs.statSync(target);
    if (!targetStats.isDirectory() || fs.readdirSync(target).length > 0) return;
  }

  try {
    fs.cpSync(source, target, { recursive: true, errorOnExist: false });
    console.log(`Migrated ${source} to ${target}`);
  } catch (err) {
    console.error(`Failed to migrate ${source} to ${target}:`, err);
  }
}

function getLegacyResourcesPath() {
  return path.resolve(app.getAppPath(), "../../");
}

function getAssetBasePath() {
  return process.defaultApp ? app.getAppPath() : app.getPath("userData");
}

function getMediaStorageMode() {
  return appConfig?.Metadata?.mediaStorageMode === "download"
    ? "download"
    : "stream";
}

// Create data folders
const appDataRoot = process.defaultApp ? __dirname : app.getPath("userData");
const legacyResourcesPath = process.defaultApp ? null : getLegacyResourcesPath();
var dataDir = path.join(appDataRoot, "data");
var launcherDir = path.join(appDataRoot, "launchers");

fs.mkdirSync(appDataRoot, { recursive: true });

if (process.defaultApp) {
  console.log("Running in development");
} else {
  console.log("Running in release");
  copyDirectoryIfMissing(path.join(legacyResourcesPath, "data"), dataDir);
  copyDirectoryIfMissing(
    path.join(legacyResourcesPath, "launchers"),
    launcherDir,
  );
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(launcherDir, { recursive: true });
const updatesDir = path.join(dataDir, "updates");
if (!fs.existsSync(updatesDir)) {
  fs.mkdirSync(updatesDir, { recursive: true });
}
const imagesDir = path.join(dataDir, "images");
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const templatesDir = path.join(dataDir, "templates/banner");
if (!fs.existsSync(templatesDir)) {
  fs.mkdirSync(templatesDir, { recursive: true });
}

// Setup electron-updater events
autoUpdater.setFeedURL({
  provider: "github",
  owner: "towerwatchman",
  repo: "Atlas",
});
autoUpdater.autoDownload = false;
autoUpdater.allowDowngrade = false;
let updateInfo = null;
let updateDownloaded = false;
let lastUpdateStatus = { status: "idle" };

function sendUpdateStatus(status) {
  lastUpdateStatus = status;
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("update-status", status);
    }
  });
}

autoUpdater.on("checking-for-update", () => {
  console.log("Checking for updates...");
  sendUpdateStatus({ status: "checking" });
});
autoUpdater.on("update-available", (info) => {
  console.log(`Update available: ${info.version}`);
  updateInfo = info;
  updateDownloaded = false;
  sendUpdateStatus({
    status: "available",
    version: info.version,
  });
});
autoUpdater.on("update-not-available", (info) => {
  console.log("No updates available.");
  updateInfo = null;
  updateDownloaded = false;
  sendUpdateStatus({ status: "not-available" });
});
autoUpdater.on("download-progress", (progress) => {
  console.log(`Download progress: ${progress.percent}%`);
  sendUpdateStatus({
    status: "downloading",
    percent: progress.percent,
  });
});
autoUpdater.on("update-downloaded", (info) => {
  console.log(`Update downloaded: ${info.version}`);
  updateInfo = info;
  updateDownloaded = true;
  sendUpdateStatus({
    status: "downloaded",
    version: info.version,
  });
});
autoUpdater.on("error", (err) => {
  console.error("Updater error:", err);
  sendUpdateStatus({
    status: "error",
    error: err.message,
  });
});

// Initialize database
initializeDatabase(dataDir);

// Initialize config.ini
const configPath = path.join(dataDir, "config.ini");
const defaultConfig = {
  Interface: {
    language: "English",
    atlasStartup: "Do Nothing",
    gameStartup: "Do Nothing",
    showDebugConsole: false,
    minimizeToTray: false,
    checkForAppUpdatesOnStartup: true,
  },
  Library: {
    rootPath: dataDir,
    gameFolder: "",
    libraryFolderStructure: "{creator}/{title}/{version}",
  },
  Metadata: {
    downloadPreviews: false,
    mediaStorageMode: "stream",
  },
  Performance: {
    maxHeapSize: 4096,
  },
};

// ────────────────────────────────────────────────
// IPC HANDLERS
// ────────────────────────────────────────────────

ipcMain.handle("add-game", async (event, game) => {
  return addGame(game);
});

ipcMain.handle("count-versions", async (_, recordId) => {
  return await countVersions(recordId);
});

ipcMain.handle("delete-version", async (_, { recordId, version }) => {
  const countBefore = await countVersions(recordId);
  const result = await deleteVersion(recordId, version);
  const countAfter = countBefore - (result.changes > 0 ? 1 : 0);

  return {
    success: result.changes > 0,
    wasLastVersion: countAfter === 0,
  };
});

ipcMain.handle("delete-game-completely", async (_, recordId) => {
  const versionPaths = await getVersionPathsForRecord(recordId);
  const result = await deleteGameCompletely(
    recordId,
    getAssetBasePath(),
    process.defaultApp,
  );

  if (result.success) {
    recentlyDeletedGamePaths.set(recordId, versionPaths);
    setTimeout(() => recentlyDeletedGamePaths.delete(recordId), 5 * 60 * 1000);
    // Notify all renderer windows (main library + any open details)
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("game-deleted", recordId);
    });
  }

  return result;
});

ipcMain.handle("get-game", async (event, recordId) => {
  console.log("Default app state", app.getAppPath());
  return await getGame(
    recordId,
    getAssetBasePath(),
    process.defaultApp,
    getMediaStorageMode(),
  );
});

// Pull-based fetch for the game-details window. The renderer calls this once
// it has mounted, so delivery no longer depends on a timed push beating the
// renderer's listener registration (which caused the "stuck on loading" bug).
ipcMain.handle("request-game-data", async (event) => {
  const recordId = gameDetailsRecordMap.get(event.sender.id);
  if (recordId === undefined) {
    console.warn("request-game-data: no recordId mapped for this window");
    return null;
  }
  return await getGame(
    recordId,
    getAssetBasePath(),
    process.defaultApp,
    getMediaStorageMode(),
  );
});

ipcMain.handle("get-games", async (event, args = {}) => {
  const { offset, limit, includeUninstalled, options = {} } = args;
  return await getGames(
    getAssetBasePath(),
    process.defaultApp,
    offset,
    limit,
    {
      ...options,
      includeUninstalled: includeUninstalled === true,
      mediaStorageMode: getMediaStorageMode(),
    },
  );
});

ipcMain.handle("validate-library-paths", async (event) => {
  if (activeLibraryValidation?.running) {
    return { success: true, alreadyRunning: true };
  }

  const sender = event.sender;
  activeLibraryValidation = { running: true, canceled: false };

  setImmediate(async () => {
    try {
      const recordIds = await getGameRecordIds();
      let processed = 0;
      for (const recordId of recordIds) {
        if (activeLibraryValidation?.canceled) break;
        const game = await getGame(
          recordId,
          getAssetBasePath(),
          process.defaultApp,
          getMediaStorageMode(),
        );
        processed++;
        if (!sender.isDestroyed()) {
          sender.send("library-validation-progress", {
            processed,
            total: recordIds.length,
          });
          if (game) sender.send("game-updated", game);
        }
        if (processed % 25 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    } catch (err) {
      console.error("Library path validation failed:", err);
      if (!sender.isDestroyed()) {
        sender.send("library-validation-progress", {
          error: err.message,
          processed: 0,
          total: 0,
        });
      }
    } finally {
      activeLibraryValidation = null;
    }
  });

  return { success: true };
});

ipcMain.handle("remove-game", async (event, record_id) => {
  return removeGame(record_id);
});

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
  if (!sevenZipBin || !fs.existsSync(sevenZipBin)) {
    return { totalFiles: 0, totalUncompressedBytes: 0 };
  }
  return new Promise((resolve, reject) => {
    const child = cp.spawn(sevenZipBin, ["l", archivePath, "-y"]);
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

async function extractArchive(archivePath, finalPath, sevenZipBin, session) {
  const workerPath = resolvePackagedModulePath(
    path.join(__dirname, "workers/extractWorker.js"),
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("import-progress", {
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
          console.warn("[MAIN] mainWindow not available for progress send");
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
    );
  } else if (process.platform === "linux") {
    possiblePaths.push("/usr/bin/7z", "/usr/bin/7zz", "/usr/local/bin/7z");
  }
  return possiblePaths;
}

function saveSevenZipPath(sevenZipPath) {
  const newConfig = {
    ...appConfig,
    Library: { ...appConfig.Library, sevenZipPath },
  };
  fs.writeFileSync(configPath, ini.stringify(newConfig));
  appConfig = newConfig;
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

ipcMain.handle("unzip-game", async (event, { zipPath, extractPath }) => {
  try {
    const sevenZipBin = getSevenZipExecutablePath();
    const extraction = await extractArchive(zipPath, extractPath, sevenZipBin);
    return { success: true, extractPath: extraction.finalPath || extractPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("cancel-import", async () => {
  if (!activeImportSession) {
    return { success: false, message: "No import is currently running" };
  }

  activeImportSession.cancelRequested = true;
  activeImportSession.currentExtractionWorker?.postMessage("cancel");
  mainWindow?.webContents.send("import-progress", {
    text: "Cancel requested. Cleaning up current import...",
    progress: activeImportSession.progress || 0,
    total: activeImportSession.total || 0,
    canceling: true,
    canCancel: false,
  });
  return { success: true };
});

ipcMain.handle("check-updates", async () => {
  try {
    const response = await axios.get(
      "https://api.github.com/repos/towerwatchman/Atlas/releases/latest",
    );
    const latestVersion = response.data.tag_name;
    const currentVersion = app.getVersion();
    return {
      latestVersion,
      currentVersion,
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("check-app-update", async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (err) {
    sendUpdateStatus({ status: "error", error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-app-update-state", async () => {
  return lastUpdateStatus;
});

ipcMain.handle("download-app-update", async () => {
  try {
    if (!updateInfo) {
      return { success: false, error: "No app update is currently available" };
    }
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    sendUpdateStatus({ status: "error", error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle("install-app-update", async () => {
  if (!updateDownloaded) {
    return { success: false, error: "No downloaded app update is ready to install" };
  }

  autoUpdater.quitAndInstall();
  return { success: true };
});

ipcMain.handle("check-db-updates", async () => {
  return checkDbUpdates(updatesDir, mainWindow);
});

ipcMain.handle("minimize-window", () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) focusedWindow.minimize();
});

ipcMain.handle("maximize-window", () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    if (focusedWindow.isMaximized()) {
      focusedWindow.unmaximize();
    } else {
      focusedWindow.maximize();
    }
  }
});

ipcMain.handle("close-window", async (event) => {
  console.log("IPC close-window called from:", event.sender.getURL());

  try {
    // 1. Try to close the window that sent the request (most reliable)
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      console.log("Closing sender window:", senderWindow.getURL());
      senderWindow.close();
      return { success: true };
    }

    // 2. Fallback: close known importer window if it exists
    if (importerWindow && !importerWindow.isDestroyed()) {
      console.log("Closing known importer window");
      importerWindow.close();
      return { success: true };
    }

    // 3. Ultimate fallback: focused window
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && !focused.isDestroyed()) {
      console.log("Closing focused window as fallback:", focused.getURL());
      focused.close();
      return { success: true };
    }

    return { success: false, error: "No window to close" };
  } catch (err) {
    console.error("close-window error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("select-file", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  } catch (err) {
    console.error("Error selecting file:", err);
    return null;
  }
});

ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog(importerWindow || mainWindow, {
    properties: ["openDirectory"],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle("delete-folder-recursive", async (event, { recordId, folderPath }) => {
  try {
    if (!folderPath || typeof folderPath !== "string") {
      return { success: false, error: "Invalid folder path" };
    }
    if (!(await isAllowedDeletionPath(recordId, folderPath))) {
      return { success: false, error: "Folder is not linked to this game" };
    }

    const resolvedPath = path.resolve(folderPath);
    const parsedPath = path.parse(resolvedPath);
    if (resolvedPath === parsedPath.root) {
      return { success: false, error: "Refusing to delete a drive root" };
    }

    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isDirectory()) {
      return { success: false, error: "Path is not a directory" };
    }

    await fs.promises.rm(resolvedPath, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    console.error("Error deleting folder:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-version", () => app.getVersion());

ipcMain.handle("open-settings", () => {
  if (!settingsWindow) {
    createSettingsWindow();
  } else {
    settingsWindow.focus();
  }
});
ipcMain.handle("get-unique-filter-options", async () => {
  return await getUniqueFilterOptions();
});

ipcMain.handle("get-settings", async () => {
  return appConfig || defaultConfig;
});

ipcMain.handle("save-settings", async (event, settings) => {
  try {
    appConfig = settings;
    fs.writeFileSync(configPath, ini.stringify(settings));
    return { success: true };
  } catch (err) {
    console.error("Error writing to config.ini:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-importer", async () => {
  console.log("IPC open-importer called");
  try {
    createImporterWindow();
    return { success: true };
  } catch (err) {
    console.error("Error in open-importer:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("start-scan", async (event, params) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  activeScanSession = { canceled: false };
  try {
    await startScan(params, window, activeScanSession);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    activeScanSession = null;
  }
});

ipcMain.handle("cancel-scan", async () => {
  if (activeScanSession) {
    activeScanSession.canceled = true;
  }
  return { success: true };
});

ipcMain.handle("get-steam-game-data", async (event, steamId) => {
  return await getSteamGameData(steamId);
});

ipcMain.handle("search-atlas", async (event, params) => {
  return await searchAtlas(params.title, params.creator);
});

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

ipcMain.handle("get-import-record-status", async (event, game) => {
  try {
    return await getImportRecordStatus(game);
  } catch (err) {
    console.error("get-import-record-status error:", err);
    return { status: "new", recordId: null, exactPath: false };
  }
});

ipcMain.handle("log", async (event, message) => {
  console.log(`Renderer: ${message}`);
});

ipcMain.handle("update-progress", async (event, progress) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.webContents.send("update-progress", progress);
  }
});

// Banner Template Handlers
ipcMain.handle("get-available-banner-templates", async () => {
  const templatesDir = path.join(dataDir, "templates", "banner");
  try {
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
      console.log(`Created templates directory: ${templatesDir}`);
    }
    const files = fs
      .readdirSync(templatesDir)
      .filter((file) => file.endsWith(".js"));
    return files.map((file) => path.basename(file, ".js"));
  } catch (err) {
    console.error("Error reading templates directory:", err);
    return [];
  }
});

ipcMain.handle("get-selected-banner-template", async () => {
  const configPath = path.join(dataDir, "config.ini");
  try {
    if (!fs.existsSync(configPath)) {
      return "Default";
    }
    const configData = fs.readFileSync(configPath, "utf-8");
    const match = configData.match(/bannerTemplate=(.*)/);
    return match ? match[1].trim() : "Default";
  } catch (err) {
    console.error("Error reading selected banner template:", err);
    return "Default";
  }
});

ipcMain.handle("set-selected-banner-template", async (event, template) => {
  const configPath = path.join(dataDir, "config.ini");
  try {
    let configData = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, "utf-8")
      : "";

    configData = configData.replace(/bannerTemplate=.*/g, "").trim();
    configData += (configData ? "\n" : "") + `bannerTemplate=${template}`;

    fs.writeFileSync(configPath, configData.trim());
    return { success: true };
  } catch (err) {
    console.error("Error saving selected banner template:", err);
    return { success: false, error: err.message };
  }
});

// Open external URL
ipcMain.handle("open-external-url", async (event, url) => {
  try {
    if (!url || typeof url !== "string" || !url.startsWith("http")) {
      console.warn("Invalid URL attempted to open:", url);
      return { success: false, error: "Invalid URL" };
    }
    await shell.openExternal(url);
    console.log("Opened external URL:", url);
    return { success: true };
  } catch (err) {
    console.error("Error opening external URL:", url, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("launch-game", async (event, data) => {
  try {
    const selectedVersion = await getTrustedVersion(data?.recordId, data?.version);
    const execPath = selectedVersion.exec_path || "";
    const extension = execPath.includes(".")
      ? execPath.split(".").pop().toLowerCase()
      : "";
    await launchGame({
      execPath,
      extension,
      recordId: data.recordId,
      version: selectedVersion.version,
    });
    return { success: true };
  } catch (err) {
    console.error("Error launching game:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-game-folder", async (event, data) => {
  try {
    const selectedVersion = await getTrustedVersion(data?.recordId, data?.version);
    const targetPath = selectedVersion.game_path;
    const openPath =
      fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
        ? targetPath
        : path.dirname(targetPath);
    await shell.openPath(openPath);
    return { success: true };
  } catch (err) {
    console.error("Error opening game folder:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-game-properties", async (event, recordId) => {
  try {
    createGameDetailsWindow(recordId);
    return { success: true };
  } catch (err) {
    console.error("Error opening game properties:", err);
    return { success: false, error: err.message };
  }
});

// Default game folder management
ipcMain.handle("get-default-game-folder", async () => {
  return appConfig?.Library?.gameFolder || null;
});

ipcMain.handle("set-default-game-folder", async (event, newPath) => {
  if (!newPath || typeof newPath !== "string" || !fs.existsSync(newPath)) {
    return { success: false, error: "Invalid or non-existing path" };
  }

  try {
    if (!appConfig.Library) appConfig.Library = {};
    appConfig.Library.gameFolder = newPath;

    fs.writeFileSync(configPath, ini.stringify(appConfig));
    return { success: true, path: newPath };
  } catch (err) {
    console.error("Failed to save default game folder:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("save-emulator-config", async (event, emulator) => {
  try {
    await initializeDatabase(dataDir);
    await saveEmulatorConfig(emulator);
    return { success: true };
  } catch (err) {
    console.error("Error saving emulator config:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-emulator-config", async () => {
  try {
    await initializeDatabase(dataDir);
    return await getEmulatorConfig();
  } catch (err) {
    console.error("Error fetching emulator config:", err);
    return [];
  }
});

ipcMain.handle("remove-emulator-config", async (event, extension) => {
  try {
    await initializeDatabase(dataDir);
    await removeEmulatorConfig(extension);
    return { success: true };
  } catch (err) {
    console.error("Error removing emulator config:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("show-context-menu", (event, template) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) {
    console.error("No sender window found for context menu");
    return;
  }

  const processedTemplate = processTemplate(template, event.sender);
  const menu = Menu.buildFromTemplate(processedTemplate);
  menu.popup({ window: senderWindow });
});

ipcMain.handle("get-previews", async (event, recordId) => {
  console.log("Handling get-previews for recordId:", recordId);
  try {
    const previews = await getPreviews(
      recordId,
      getAssetBasePath(),
      process.defaultApp,
      getMediaStorageMode(),
    );
    return Array.isArray(previews) ? previews : [];
  } catch (err) {
    console.error("Error fetching preview URLs:", err);
    return [];
  }
});

ipcMain.handle("update-banners", async (event, recordId) => {
  console.log("Handling update-banners for recordId:", recordId);
  try {
    const atlas_id = await GetAtlasIDbyRecord(recordId);
    let progress = 0;
    let imageTotal = 1;
    await downloadImages(
      recordId,
      atlas_id,
      (current, totalImages) => {
        event.sender.send("game-details-import-progress", {
          text: `Downloading images ${progress + 1}/${imageTotal}`,
          progress,
          total: imageTotal,
        });
      },
      true,
      false,
      1,
      false,
    );

    const bannerPath = await getBanner(
      recordId,
      getAssetBasePath(),
      process.defaultApp,
      "large",
      "download",
    );
    event.sender.send("game-updated", recordId);
    progress++;
    event.sender.send("game-details-import-progress", {
      text: `Completed image download for ${progress}/${imageTotal}`,
      progress,
      total: imageTotal,
    });
    return bannerPath;
  } catch (err) {
    console.error("Error downloading banner:", err);
    throw err;
  }
});

ipcMain.handle("update-previews", async (event, recordId) => {
  console.log("Handling update-previews for recordId:", recordId);
  try {
    const atlasId = await GetAtlasIDbyRecord(recordId);
    let imageTotal = 1;
    await downloadImages(
      recordId,
      atlasId,
      (current, totalImages) => {
        imageTotal = totalImages || imageTotal;
        event.sender.send("game-details-import-progress", {
          text: `Downloading previews ${current}/${imageTotal}`,
          progress: current,
          total: imageTotal,
        });
      },
      false,
      true,
      "Unlimited",
      false,
    );

    const previewUrls = await getPreviews(
      recordId,
      getAssetBasePath(),
      process.defaultApp,
      "download",
    );
    event.sender.send("game-updated", recordId);
    event.sender.send("game-details-import-progress", {
      text: `Completed previews download`,
      progress: imageTotal,
      total: imageTotal,
    });
    return Array.isArray(previewUrls) ? previewUrls : [];
  } catch (err) {
    console.error("Error downloading previews:", err);
    throw err;
  }
});

ipcMain.handle(
  "convert-and-save-banner",
  async (event, { recordId, filePath }) => {
    console.log(
      "Handling convert-and-save-banner for recordId:",
      recordId,
      "filePath:",
      filePath,
    );
    try {
      const outputPath = path.join(
        appDataRoot,
        "data",
        "images",
        `${recordId}`,
        "banner_sc.webp",
      );
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await sharp(filePath).webp({ quality: 80 }).toFile(outputPath);
      console.log("Banner converted and saved:", outputPath);
      return `file://${outputPath}`;
    } catch (err) {
      console.error("Error converting and saving banner:", err);
      throw err;
    }
  },
);

ipcMain.handle("update-game", async (event, game) => {
  console.log("Handling update-game:", game);
  try {
    await updateGame(game);
    console.log("Game updated in database");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-updated", game.record_id);
    }
    return { success: true };
  } catch (err) {
    console.error("Error updating game:", err);
    throw err;
  }
});

ipcMain.handle("refresh-game-media", async (event, recordId) => {
  console.log("Handling refresh-game-media for recordId:", recordId);
  try {
    const game = await getGame(
      recordId,
      getAssetBasePath(),
      process.defaultApp,
      getMediaStorageMode(),
    );
    const bannerUrl = await getBanner(
      recordId,
      getAssetBasePath(),
      process.defaultApp,
      "large",
      getMediaStorageMode(),
    );
    const previewUrls = await getPreviews(
      recordId,
      getAssetBasePath(),
      process.defaultApp,
      getMediaStorageMode(),
    );

    event.sender.send("game-details-import-progress", {
      text: "Refreshed media links",
      progress: 1,
      total: 1,
    });
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("game-updated", recordId);
    });

    return {
      success: true,
      game,
      bannerUrl,
      previewUrls: Array.isArray(previewUrls) ? previewUrls : [],
    };
  } catch (err) {
    console.error("Error refreshing game media:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("update-version", async (event, version, record_id) => {
  console.log("Handling update-version:", version);
  try {
    await updateVersion(version, record_id);
    console.log("Version updated in database");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-updated", record_id);
    }
    return { success: true };
  } catch (err) {
    console.error("Error updating version:", err);
    throw err;
  }
});

ipcMain.handle("delete-banner", async (event, recordId) => {
  await initializeDatabase(dataDir);
  console.log("Handling delete-banner for recordId:", recordId);
  try {
    await deleteBanner(recordId, getAssetBasePath(), process.defaultApp);
    mainWindow.webContents.send("game-updated", recordId);
    return { success: true };
  } catch (err) {
    console.error("Error deleting banner:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("delete-previews", async (event, recordId) => {
  await initializeDatabase(dataDir);
  console.log("Handling delete-previews for recordId:", recordId);
  try {
    await deletePreviews(recordId, getAssetBasePath(), process.defaultApp);
    mainWindow.webContents.send("game-updated", recordId);
    return { success: true };
  } catch (err) {
    console.error("Error deleting previews:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-directory", async (event, path) => {
  try {
    console.log("Opening directory:", path);
    await shell.openPath(require("path").dirname(path));
    return { success: true };
  } catch (err) {
    console.error("Error opening directory:", err);
    return { success: false, error: err.message };
  }
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

// ────────────────────────────────────────────────
// FAST CROSS-DEVICE COPY WITH BATCHED PROGRESS & RATE
// ────────────────────────────────────────────────

async function copyFolderWithProgress(
  source,
  destination,
  onProgress,
  shouldCancel = () => false,
) {
  let totalBytes = 0;
  let copiedBytes = 0;
  let lastReportedPercent = 0;
  let startTime = Date.now();
  let lastReportTime = startTime;
  let lastCopiedBytes = 0;

  const MAX_CONCURRENT = 32; // Tune this: 16–64 depending on system
  const RETRY_DELAY = 100; // ms
  const MAX_RETRIES = 5;

  // Calculate total size
  async function calculateSize(dir) {
    if (shouldCancel()) throw createImportCancelledError();
    const stat = await fs.promises.stat(dir);
    if (stat.isFile()) {
      totalBytes += stat.size;
      return;
    }
    const files = await fsp.readdir(dir);
    await Promise.all(files.map((file) => calculateSize(path.join(dir, file))));
  }

  await calculateSize(source);
  onProgress?.({ type: "total", bytes: totalBytes });

  // Queue-based concurrent copy
  async function copyRecursive(src, dest) {
    if (shouldCancel()) throw createImportCancelledError();
    const stat = await fs.promises.stat(src);
    if (stat.isDirectory()) {
      await fsp.mkdir(dest, { recursive: true });
      const files = await fsp.readdir(src);
      // Process in batches to limit concurrency
      for (let i = 0; i < files.length; i += MAX_CONCURRENT) {
        const batch = files.slice(i, i + MAX_CONCURRENT);
        await Promise.all(
          batch.map((file) =>
            copyRecursive(path.join(src, file), path.join(dest, file)),
          ),
        );
      }
    } else {
      // File copy with retry on EMFILE
      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          return await new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(src);
            const writeStream = fs.createWriteStream(dest);

            readStream.on("data", (chunk) => {
              if (shouldCancel()) {
                const cancelErr = createImportCancelledError();
                readStream.destroy(cancelErr);
                writeStream.destroy(cancelErr);
                return;
              }
              copiedBytes += chunk.length;

              const currentPercent = Math.floor(
                (copiedBytes / totalBytes) * 100,
              );
              const now = Date.now();

              if (currentPercent > lastReportedPercent) {
                const elapsed = (now - startTime) / 1000;
                const currentSpeed =
                  elapsed > 0 ? (copiedBytes - lastCopiedBytes) / elapsed : 0;
                const speedText =
                  currentSpeed > 1024 * 1024 * 1024
                    ? `${(currentSpeed / 1024 ** 3).toFixed(2)} GB/s`
                    : currentSpeed > 1024 * 1024
                      ? `${(currentSpeed / 1024 ** 2).toFixed(1)} MB/s`
                      : `${(currentSpeed / 1024).toFixed(1)} KB/s`;

                onProgress?.({
                  type: "progress",
                  percent: currentPercent,
                  copied: copiedBytes,
                  total: totalBytes,
                  speed: speedText,
                });

                lastReportedPercent = currentPercent;
                lastReportTime = now;
                lastCopiedBytes = copiedBytes;
              }
            });

            readStream.on("end", () => resolve());
            readStream.on("error", reject);
            writeStream.on("error", reject);

            readStream.pipe(writeStream);
          });
        } catch (err) {
          if (err.code === "EMFILE" && retries < MAX_RETRIES) {
            retries++;
            console.warn(`EMFILE retry ${retries}/${MAX_RETRIES} for ${src}`);
            await new Promise((r) => setTimeout(r, RETRY_DELAY * retries)); // exponential backoff
            continue;
          }
          throw err;
        }
      }
    }
  }

  try {
    await copyRecursive(source, destination);
    const finalPercent = 100;
    const totalElapsed = (Date.now() - startTime) / 1000;
    const avgSpeed = totalElapsed > 0 ? copiedBytes / totalElapsed : 0;
    const avgSpeedText =
      avgSpeed > 1024 * 1024 * 1024
        ? `${(avgSpeed / 1024 ** 3).toFixed(2)} GB/s`
        : avgSpeed > 1024 * 1024
          ? `${(avgSpeed / 1024 ** 2).toFixed(1)} MB/s`
          : `${(avgSpeed / 1024).toFixed(1)} KB/s`;

    onProgress?.({
      type: "done",
      percent: finalPercent,
      copied: copiedBytes,
      total: totalBytes,
      speed: avgSpeedText,
    });
  } catch (err) {
    console.error("Copy failed:", err);
    onProgress?.({ type: "error", message: err.message });
    throw err;
  }
}

// ────────────────────────────────────────────────
// IMPORT GAMES HANDLER
// ────────────────────────────────────────────────

ipcMain.handle("import-games", async (event, params) => {
  if (activeImportSession) {
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
  activeImportSession = session;

  if (total === 0) {
    mainWindow.webContents.send("import-progress", {
      text: "No importable games selected",
      progress,
      total,
    });
    mainWindow.webContents.send("import-complete");
    activeImportSession = null;
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
  //  Prepare 7-Zip path – check once at the beginning
  // ────────────────────────────────────────────────────────────────
  let sevenZipPath = appConfig?.Library?.sevenZipPath;

  const needsExtraction = games.some((g) => g.isArchive === true);

  if (needsExtraction) {
    if (!sevenZipPath || !fs.existsSync(sevenZipPath)) {
      sevenZipPath = getBundledSevenZipPath();
      if (sevenZipPath) {
        mainWindow.webContents.send("import-progress", {
          text: `Using bundled 7-Zip: ${path.basename(sevenZipPath)}`,
          progress: 0,
          total: 0,
        });
      }
    }

    // Try to auto-detect if not set
    if (!sevenZipPath || !fs.existsSync(sevenZipPath)) {
      const possiblePaths = [];
      if (process.platform === "win32") {
        possiblePaths.push(
          "C:\\Program Files\\7-Zip\\7z.exe",
          "C:\\Program Files (x86)\\7-Zip\\7z.exe",
        );
      } else if (process.platform === "linux") {
        possiblePaths.push("/usr/bin/7z", "/usr/bin/7zz", "/usr/local/bin/7z");
      }

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          sevenZipPath = p;
          // Auto-save it
          saveSevenZipPath(p);
          mainWindow.webContents.send("import-progress", {
            text: `Auto-detected 7-Zip: ${path.basename(p)}`,
            progress: 0,
            total: 0,
          });
          break;
        }
      }
    }

    // Still not found → ask user
    if (!sevenZipPath || !fs.existsSync(sevenZipPath)) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select 7-Zip executable (7z or 7zz)",
        properties: ["openFile"],
        filters: [
          {
            name: "7-Zip Executable",
            extensions: process.platform === "win32" ? ["exe"] : ["*"],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!result.canceled && result.filePaths?.length > 0) {
        sevenZipPath = result.filePaths[0];
        // Save to config
        saveSevenZipPath(sevenZipPath);
        mainWindow.webContents.send("import-progress", {
          text: `Using selected 7-Zip: ${path.basename(sevenZipPath)}`,
          progress: 0,
          total: 0,
        });
      } else {
        // User cancelled → warn but continue (extraction will be skipped)
        mainWindow.webContents.send("import-progress", {
          text: "7-Zip not selected → archive extraction will be skipped",
          progress: 0,
          total: 0,
        });
        sevenZipPath = null;
      }
    }
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
        if (!sevenZipPath || !fs.existsSync(sevenZipPath)) {
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
        const { findExecutables } = require("./core/scanners/executableScanner");
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

      if (size > 0) await updateFolderSize(recordId, game.version, size);
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
    activeImportSession = null;
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
  activeImportSession = null;
  return results;
});

// ────────────────────────────────────────────────
// UTIL FUNCTIONS
// ────────────────────────────────────────────────

const engineMap = {
  rpgm: [
    "rpgmv.exe",
    "rpgmk.exe",
    "rpgvx.exe",
    "rpgvxace.exe",
    "rpgmktranspatch.exe",
  ],
  renpy: ["renpy.exe", "renpy.sh"],
  unity: ["unityplayer.dll", "unitycrashhandler64.exe"],
  html: ["index.html"],
  flash: [".swf"],
};

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, "utf8");
      appConfig = ini.parse(configData);
    } else {
      appConfig = defaultConfig;
      fs.writeFileSync(configPath, ini.stringify(appConfig));
    }
  } catch (err) {
    console.error("Error loading config.ini:", err);
    appConfig = defaultConfig;
  }
}

function getFolderSize(dir) {
  let size = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      fs.readdirSync(current).forEach((f) => stack.push(path.join(current, f)));
    } else {
      size += stat.size;
    }
  }
  return size;
}

function findExecutables(dir, extensions) {
  const blacklist = new Set(
    [
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
    ].map((name) => name.toLowerCase()),
  );
  const normalizedExtensions = extensions.map((ext) =>
    String(ext || "").trim().toLowerCase().replace(/^\./, ""),
  );
  const execs = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else {
        const ext = path.extname(item.name).toLowerCase().slice(1);
        const filename = path.basename(item.name).toLowerCase();
        if (normalizedExtensions.includes(ext) && !blacklist.has(filename)) {
          execs.push(full.replace(dir + path.sep, ""));
        }
      }
    }
  }
  return execs.sort((a, b) => {
    const depthDiff = a.split(path.sep).length - b.split(path.sep).length;
    if (depthDiff !== 0) return depthDiff;
    const extRank = (candidate) => {
      const ext = path.extname(candidate).replace(/^\./, "").toLowerCase();
      if (ext === "exe") return 0;
      if (ext === "html") return 1;
      return 2;
    };
    const rankDiff = extRank(a) - extRank(b);
    return rankDiff || a.localeCompare(b);
  });
}

async function downloadImages(
  recordId,
  atlasId,
  onImageProgress,
  downloadBannerImages,
  downloadPreviewImages,
  previewLimit,
  downloadVideos,
) {
  const imgDir = path.join(dataDir, "images", recordId.toString());
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  let imageProgress = 0;
  const bannerUrl = downloadBannerImages ? await getBannerUrl(atlasId) : null;
  const screenUrls = downloadPreviewImages
    ? await getScreensUrlList(atlasId)
    : [];
  const previewCount = downloadPreviewImages
    ? previewLimit === "Unlimited"
      ? screenUrls.length
      : Math.min(parseInt(previewLimit), screenUrls.length)
    : 0;
  const totalImages = (bannerUrl ? 3 : 0) + previewCount;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (bannerUrl) {
    console.log(`Downloading banner from URL: ${bannerUrl}`);
    try {
      const ext = path.extname(new URL(bannerUrl).pathname).toLowerCase();
      const baseName = path.basename("banner", ext);
      const imagePath = path.join(imgDir, baseName);
      const relativePath = path.join(
        "data",
        "images",
        recordId.toString(),
        baseName,
      );

      let imageBytes;
      let downloaded = false;
      if ([".gif", ".mp4", ".webm"].includes(ext) && downloadVideos) {
        const animatedPath = `${imagePath}${ext}`;
        if (!fs.existsSync(animatedPath)) {
          const response = await axios.get(bannerUrl, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          fs.writeFileSync(animatedPath, imageBytes);
          downloaded = true;
        }
        await updateBanners(recordId, `${relativePath}${ext}`, "animated");
        imageProgress++;
        onImageProgress(imageProgress, totalImages);
      }

      const highResPath = `${imagePath}_mc.webp`;
      if (!fs.existsSync(highResPath)) {
        if (!imageBytes) {
          const response = await axios.get(bannerUrl, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 1260, withoutEnlargement: true })
          .toFile(highResPath);
      }
      await updateBanners(recordId, `${relativePath}_mc.webp`, "small");
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      const lowResPath = `${imagePath}_sc.webp`;
      if (!fs.existsSync(lowResPath)) {
        if (!imageBytes) {
          const response = await axios.get(bannerUrl, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 600, withoutEnlargement: true })
          .toFile(lowResPath);
      }
      await updateBanners(recordId, `${relativePath}_sc.webp`, "large");
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      console.log("Banner images updated");
      if (downloaded) {
        require("electron")
          .webContents.getAllWebContents()
          .forEach((wc) => {
            wc.send("game-details-import-progress", {
              text: `Completed banner download ${imageProgress}/${totalImages}`,
              progress: imageProgress,
              total: totalImages,
            });
          });
        await delay(500);
      }
    } catch (err) {
      console.error("Error downloading or converting banner:", err);
    }
  }

  for (let i = 0; i < previewCount; i++) {
    const url = screenUrls[i]?.trim();
    if (!url) continue;

    console.log(`Downloading screen ${i + 1} from URL: ${url}`);
    try {
      const ext = path.extname(new URL(url).pathname).toLowerCase();
      const baseName = path.basename(url, ext);
      const imagePath = path.join(imgDir, baseName);
      const relativePath = path.join(
        "data",
        "images",
        recordId.toString(),
        baseName,
      );

      let imageBytes;
      let downloaded = false;
      if ([".gif", ".mp4", ".webm"].includes(ext) && downloadVideos) {
        const animatedPath = `${imagePath}${ext}`;
        if (!fs.existsSync(animatedPath)) {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          fs.writeFileSync(animatedPath, imageBytes);
          downloaded = true;
        }
        await updatePreviews(recordId, `${relativePath}${ext}`);
      }

      const targetPath = `${imagePath}_pr.webp`;
      if (!fs.existsSync(targetPath)) {
        if (!imageBytes) {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 1260, withoutEnlargement: true })
          .toFile(targetPath);
      }
      await updatePreviews(recordId, `${relativePath}_pr.webp`);
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      console.log(`Screen ${i + 1} updated`);
      if (downloaded) {
        require("electron")
          .webContents.getAllWebContents()
          .forEach((wc) => {
            wc.send("game-details-import-progress", {
              text: `Completed preview download ${imageProgress}/${totalImages}`,
              progress: imageProgress,
              total: totalImages,
            });
          });
        await delay(500);
      }
    } catch (err) {
      console.error(`Error downloading or converting screen ${i + 1}:`, err);
    }
  }
}

function emitGameUpdated(recordId) {
  if (!recordId) return;
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send("game-updated", recordId);
    }
  });
}

async function startPlaySession(recordId, version, trackPlaytime = true) {
  if (!recordId || !version) return null;
  const startedAtMs = Date.now();
  const startedAtSeconds = Math.floor(startedAtMs / 1000);
  await recordGameLaunchStarted(recordId, version, startedAtSeconds);
  emitGameUpdated(recordId);

  return {
    finish: async () => {
      if (!trackPlaytime) return;
      const elapsedMs = Math.max(0, Date.now() - startedAtMs);
      if (elapsedMs <= 0) return;
      const minutes = Math.max(1, Math.ceil(elapsedMs / 60000));
      await recordGamePlaytime(recordId, version, minutes);
      emitGameUpdated(recordId);
    },
  };
}

function trackChildPlaySession(child, session, recordId) {
  if (!child || !session) return;
  let finalized = false;
  const finalize = async () => {
    if (finalized) return;
    finalized = true;
    try {
      await session.finish();
    } catch (err) {
      console.error(`Failed to finalize play session for ${recordId}:`, err);
    }
  };

  child.once("exit", finalize);
  child.once("close", finalize);
  child.once("error", (err) => {
    if (finalized) return;
    finalized = true;
    console.error(`Tracked game process error for ${recordId}:`, err);
  });
}

async function launchGame({ execPath, extension, recordId, version }) {
  if (recordId) {
    const steamId = await getSteamIDbyRecord(recordId);
    if (steamId) {
      await startPlaySession(recordId, version, false);
      shell.openExternal(`steam://run/${steamId}`);
      return;
    }
  }
  if (!fs.existsSync(execPath)) {
    console.error(`Executable not found: ${execPath}`);
    throw new Error(`Executable not found: ${execPath}`);
  }
  const emulator = await getEmulatorByExtension(extension);
  if (emulator) {
    const args = emulator.parameters ? emulator.parameters.split(" ") : [];
    args.push(execPath);
    const child = cp.spawn(emulator.program_path, args, {
      detached: true,
      stdio: "ignore",
    });
    const session = await startPlaySession(recordId, version, true);
    trackChildPlaySession(child, session, recordId);
    child.unref();
  } else if (["exe", "bat", "cmd"].includes(extension)) {
    const child = cp.spawn(execPath, [], {
      cwd: path.dirname(execPath),
      detached: true,
      stdio: "ignore",
      shell: extension === "bat" || extension === "cmd",
    });
    const session = await startPlaySession(recordId, version, true);
    trackChildPlaySession(child, session, recordId);
    child.unref();
  } else {
    const openResult = await shell.openPath(execPath);
    if (openResult) {
      throw new Error(openResult);
    }
    await startPlaySession(recordId, version, false);
  }
}

function handleContextAction(data, sender) {
  if (!data || typeof data.action === "undefined") {
    console.error("handleContextAction: Invalid or missing data object", data);
    return;
  }

  switch (data.action) {
    case "launch":
      getTrustedVersion(data.recordId, data.version)
        .then((selectedVersion) => {
          const execPath = selectedVersion.exec_path || "";
          const extension = execPath.includes(".")
            ? execPath.split(".").pop().toLowerCase()
            : "";
          return launchGame({
            execPath,
            extension,
            recordId: data.recordId,
            version: selectedVersion.version,
          });
        })
        .catch((err) => console.error("Context launch failed:", err));
      break;
    case "openFolder":
      getTrustedVersion(data.recordId, data.version)
        .then((selectedVersion) => shell.openPath(selectedVersion.game_path))
        .catch((err) => console.error("Context open folder failed:", err));
      break;
    case "openUrl":
      shell.openExternal(data.url);
      break;
    case "properties":
      console.log("Creating GameDetailsWindow for recordId:", data.recordId);
      createGameDetailsWindow(data.recordId);
      break;
    default:
      console.error(`Unknown action: ${data.action}`);
  }
}

function processTemplate(items, sender) {
  return items.map((item) => {
    const newItem = { ...item };
    if (newItem.submenu) {
      newItem.submenu = processTemplate(newItem.submenu, sender);
    }
    if (newItem.data) {
      const id = contextMenuId++;
      contextMenuData.set(id, newItem.data);
      newItem.click = () => {
        const data = contextMenuData.get(id);
        handleContextAction(data, sender);
        contextMenuData.delete(id);
      };
      delete newItem.data;
    }
    return newItem;
  });
}

// ────────────────────────────────────────────────
// STEAM FUNCTIONS
// ────────────────────────────────────────────────

async function getSteamGameData(steamId) {
  try {
    const steamResponse = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${steamId}`,
    );
    const steamJson = await steamResponse.json();
    if (!steamJson[steamId] || !steamJson[steamId].success) {
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
      releaseState: data.release_date.coming_soon ? "upcoming" : "released",
      release_date: data.release_date.date || "",
      header: data.header_image || "",
      library_hero: `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_hero.jpg`,
      logo: `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_600x900.jpg`,
      screenshots: data.screenshots
        ? data.screenshots.map((s) => s.path_full).join(",")
        : "",
      last_record_update: new Date().toISOString(),
    };

    return game;
  } catch (error) {
    console.error("Error fetching game data:", error);
    return null;
  }
}

async function findSteamId(title, developer) {
  try {
    const query = encodeURIComponent(`${title} ${developer}`);
    const searchResponse = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${query}&l=english&cc=US`,
    );
    const searchJson = await searchResponse.json();

    if (searchJson.total === 0) {
      return null;
    }

    for (const item of searchJson.items) {
      if (item.name.toLowerCase() === title.toLowerCase()) {
        const detailsResponse = await fetch(
          `https://store.steampowered.com/api/appdetails?appids=${item.id}`,
        );
        const detailsJson = await detailsResponse.json();
        if (!detailsJson[item.id] || !detailsJson[item.id].success) {
          continue;
        }
        const data = detailsJson[item.id].data;
        if (
          data.developers &&
          data.developers.some(
            (d) => d.toLowerCase() === developer.toLowerCase(),
          )
        ) {
          return item.id;
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error finding Steam ID:", error);
    return null;
  }
}

// ────────────────────────────────────────────────
// APP LIFECYCLE
// ────────────────────────────────────────────────

app.whenReady().then(async () => {
  loadConfig();
  try {
    await repairDoubledApostropheRows();
  } catch (err) {
    console.error("Doubled apostrophe repair failed:", err);
  }
  try {
    await repairStaleVersionExecutables();
  } catch (err) {
    console.error("Stale executable repair failed:", err);
  }
  createWindow();
  if (appConfig?.Interface?.checkForAppUpdatesOnStartup !== false) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("Startup update check failed:", err);
      sendUpdateStatus({ status: "error", error: err.message });
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});