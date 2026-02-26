const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const axios = require("axios");
const { autoUpdater } = require("electron-updater");
const ini = require("ini");
const {
  initializeDatabase,
  addGame,
  updateGame,
  addVersion,
  updateVersion,
  addAtlasMapping,
  getGame,
  getGames,
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
  updateBanners,
  updatePreviews,
  getAtlasData,
  countVersions,
  deleteVersion,
  deleteGameCompletely,
  getUniqueFilterOptions,
  db,
} = require("./database");
const { Menu } = require("electron");
const cp = require("child_process");
const contextMenuData = new Map();

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
      nodeIntegration: true,
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
  const importerWindow = new BrowserWindow({
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
  });
}

function showExecutableChooser(recordId, gameTitle, gameVersion, executables) {
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
      preload: path.join(__dirname, "renderer.js"),
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
    executableChooserWindow.webContents.send("init-chooser", {
      title: gameTitle,
      version: gameVersion || "",
      executables,
    });
    // Pass recordId via a global-like property (since preload exposes ipcRenderer)
    executableChooserWindow.webContents.executeJavaScript(`
      window.recordId = ${JSON.stringify(recordId)};
    `);
  });

  executableChooserWindow.on("closed", () => {
    executableChooserWindow = null;
  });

  // Optional debug
  // executableChooserWindow.webContents.openDevTools({ mode: 'detach' });
}

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

  gameDetailsWindow.webContents.on("did-finish-load", () => {
    console.log("Fetching game data for recordId:", recordId);
    getGame(recordId, app.getAppPath(), process.defaultApp)
      .then((game) => {
        setTimeout(() => {
          gameDetailsWindow.webContents.send("send-game-data", game);
        }, 400);
      })
      .catch((err) => {
        console.error("Failed to fetch game data:", err);
        gameDetailsWindow.webContents.send("send-game-data", null);
      });
  });

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    gameDetailsWindow.webContents.openDevTools();
  }

  gameDetailsWindow.on("maximize", () => {
    gameDetailsWindow.webContents.send("window-state-changed", "maximized");
  });
  gameDetailsWindow.on("unmaximize", () => {
    gameDetailsWindow.webContents.send("window-state-changed", "restored");
  });

  gameDetailsWindow.on("closed", () => {
    //gameDetailsWindow = null;
  });
}

// Create data folders
var dataDir = "";
var launcherDir = "";
if (process.defaultApp) {
  console.log("Running in development");
  dataDir = path.join(__dirname, "data");
  launcherDir = path.join(__dirname, "launchers");
} else {
  const resourcesPath = path.resolve(app.getAppPath(), "../../");
  dataDir = path.join(resourcesPath, "data");
  launcherDir = path.join(resourcesPath, "launchers");
  console.log(`Running in release`);
}

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(launcherDir)) {
  fs.mkdirSync(launcherDir, { recursive: true });
}
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
autoUpdater.allowDowngrade = true;
autoUpdater.on("checking-for-update", () => {
  console.log("Checking for updates...");
  mainWindow.webContents.send("update-status", { status: "checking" });
});
autoUpdater.on("update-available", (info) => {
  console.log(`Update available: ${info.version}`);
  mainWindow.webContents.send("update-status", {
    status: "available",
    version: info.version,
  });
});
autoUpdater.on("update-not-available", (info) => {
  console.log("No updates available.");
  mainWindow.webContents.send("update-status", { status: "not-available" });
});
autoUpdater.on("download-progress", (progress) => {
  console.log(`Download progress: ${progress.percent}%`);
  mainWindow.webContents.send("update-status", {
    status: "downloading",
    percent: progress.percent,
  });
});
autoUpdater.on("update-downloaded", (info) => {
  console.log(`Update downloaded: ${info.version}`);
  mainWindow.webContents.send("update-status", {
    status: "downloaded",
    version: info.version,
  });
  autoUpdater.quitAndInstall();
});
autoUpdater.on("error", (err) => {
  console.error("Updater error:", err);
  mainWindow.webContents.send("update-status", {
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
  },
  Library: {
    rootPath: dataDir,
    gameFolder: "",
  },
  Metadata: {
    downloadPreviews: false,
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
  const result = await deleteGameCompletely(
    recordId,
    app.getAppPath(),
    process.defaultApp,
  );

  if (result.success) {
    // Notify all renderer windows (main library + any open details)
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("game-deleted", recordId);
    });
  }

  return result;
});

ipcMain.handle("get-game", async (event, recordId) => {
  console.log("Default app state", app.getAppPath());
  return await getGame(recordId, app.getAppPath(), process.defaultApp);
});

ipcMain.handle("get-games", async (event, { offset, limit }) => {
  return await getGames(app.getAppPath(), process.defaultApp, offset, limit);
});

ipcMain.handle("remove-game", async (event, record_id) => {
  return removeGame(record_id);
});

ipcMain.handle("unzip-game", async (event, { zipPath, extractPath }) => {
  const AdmZip = require("adm-zip");
  const Seven = require("node-7z");
  const Unrar = require("unrar");
  try {
    const ext = path.extname(zipPath).toLowerCase();
    if (ext === ".zip") {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractPath, true);
    } else if (ext === ".rar") {
      const unrar = new Unrar(zipPath);
      unrar.extract(extractPath);
    } else if (ext === ".7z") {
      await Seven.extractFull(zipPath, extractPath);
    } else {
      throw new Error("Unsupported file format");
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("check-updates", async () => {
  try {
    const response = await axios.get(
      "https://api.github.com/repos/towerwatchman/Atlas-Electron/releases/latest",
    );
    const latestVersion = response.data.tag_name;
    return { latestVersion, currentVersion: app.getVersion() };
  } catch (err) {
    return { success: false, error: err.message };
  }
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

ipcMain.handle("close-window", async () => {
  console.log("IPC close-window called");
  try {
    const windows = BrowserWindow.getAllWindows();
    const importSourceWindow = windows.find((w) =>
      w.webContents.getURL().includes("import-source.html"),
    );
    if (importSourceWindow) {
      console.log("Closing import-source window");
      importSourceWindow.close();
      console.log("import-source window closed");
      return { success: true };
    }
    console.log("No import-source window found, closing focused window");
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.close();
      console.log("Focused window closed");
      return { success: true };
    }
    return {
      success: false,
      error: "No import-source or focused window found",
    };
  } catch (err) {
    console.error("Error in close-window:", err);
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
  const result = await dialog.showOpenDialog(importerWindow, {
    properties: ["openDirectory"],
  });
  return result.filePaths[0] || null;
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
  try {
    await startScan(params, window);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-steam-game-data", async (event, steamId) => {
  return await getSteamGameData(steamId);
});

ipcMain.handle("search-atlas", async (event, params) => {
  return await searchAtlas(params.title, params.creator);
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
      app.getAppPath(),
      process.defaultApp,
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
      app.getAppPath(),
      process.defaultApp,
      "large",
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
    let progress = 0;
    let imageTotal = 1;
    await downloadImages(
      recordId,
      atlasId,
      (current, totalImages) => {
        event.sender.send("game-details-import-progress", {
          text: `Downloading previews  ${current}/${totalImages}`,
          current,
          total: totalImages,
        });
      },
      false,
      true,
      100,
      false,
    );

    const previewUrls = await getPreviews(
      recordId,
      app.getAppPath(),
      process.defaultApp,
    );
    event.sender.send("game-updated", recordId);
    progress++;
    event.sender.send("game-details-import-progress", {
      text: `Completed previews download`,
      progress,
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
        app.getAppPath(),
        "src",
        "data",
        "images",
        `${recordId}`,
        "banner_sc.webp",
      );
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
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
  } catch (err) {
    console.error("Error updating game:", err);
    throw err;
  }
});

ipcMain.handle("update-version", async (event, version, record_id) => {
  console.log("Handling update-version:", version);
  try {
    await updateVersion(version, record_id);
    console.log("Version updated in database");
  } catch (err) {
    console.error("Error updating version:", err);
    throw err;
  }
});

ipcMain.handle("delete-banner", async (event, recordId) => {
  await initializeDatabase(dataDir);
  console.log("Handling delete-banner for recordId:", recordId);
  try {
    await deleteBanner(recordId, app.getAppPath(), process.defaultApp);
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
    await deletePreviews(recordId, app.getAppPath(), process.defaultApp);
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

async function copyFolderWithProgress(source, destination, onProgress) {
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
    const stat = await fs.promises.stat(dir);
    if (stat.isFile()) {
      totalBytes += stat.size;
      return;
    }
    const files = await fs.promises.readdir(dir);
    await Promise.all(files.map((file) => calculateSize(path.join(dir, file))));
  }

  await calculateSize(source);
  onProgress?.({ type: "total", bytes: totalBytes });

  // Queue-based concurrent copy
  async function copyRecursive(src, dest) {
    const stat = await fs.promises.stat(src);
    if (stat.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      const files = await fs.promises.readdir(src);
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
  const {
    games,
    deleteAfter,
    scanSize,
    downloadBannerImages,
    downloadPreviewImages,
    previewLimit,
    downloadVideos,
    gameExt,
    moveToDefaultFolder = false,
    format = "",
  } = params;

  const gamesDir = path.join(dataDir, "games");
  if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });

  const total = games.length;
  let progress = 0;

  mainWindow.webContents.send("import-progress", {
    text: `Starting import of ${total} games...`,
    progress,
    total,
  });

  let targetLibrary = null;
  targetLibrary = appConfig?.Library?.gameFolder;
  if (!targetLibrary || !fs.existsSync(targetLibrary)) {
    console.warn("No default library folder configured in settings");
    mainWindow.webContents.send("import-warning", {
      message: "You need to set the default library before import can complete",
    });
  }

  const results = [];

  for (const game of games) {
    try {
      mainWindow.webContents.send("import-progress", {
        text: `Importing game '${game.title}' ${progress + 1}/${total}`,
        progress,
        total,
      });

      let gamePath = game.folder;
      let execPath = game.selectedValue
        ? path.join(gamePath, game.selectedValue)
        : "";
      let size = 0;

      // ── Structured move if requested ──
      // ── Structured move if requested ──
      if (moveToDefaultFolder && targetLibrary && format.trim()) {
        try {
          const formatStr = format.trim();
          const parts = formatStr
            .split("/")
            .map((p) => p.replace(/[{}]/g, "").trim());

          const pathSegments = [];
          for (const part of parts) {
            let value = "";
            if (part.toLowerCase() === "creator")
              value = game.creator || "Unknown";
            else if (part.toLowerCase() === "title")
              value = game.title || "Untitled";
            else if (part.toLowerCase() === "version")
              value = game.version || "v1";
            else if (part.toLowerCase() === "engine")
              value = game.engine || "Unknown";
            else value = "Unknown";

            value = value
              .replace(/[\/\\:*?"<>|]/g, "_")
              .replace(/\s+/g, " ")
              .trim();

            if (!value || value === ".") value = "Unknown";

            pathSegments.push(value);
          }

          const relativeDest = path.join(...pathSegments);
          let destPath = path.join(targetLibrary, relativeDest);

          // Handle name conflict
          let counter = 1;
          const originalDest = destPath;
          while (fs.existsSync(destPath)) {
            destPath = `${originalDest} (${counter++})`;
          }

          await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

          // Preserve ORIGINAL source path
          const originalSource = gamePath;

          let copySuccess = false;

          // Copy with progress
          await copyFolderWithProgress(originalSource, destPath, (prog) => {
            let text = `Moving ${game.title}`;
            if (prog.type === "total") {
              text += ` (${(prog.bytes / 1024 ** 3).toFixed(2)} GB total)`;
            } else if (prog.type === "progress") {
              text += `: ${prog.percent}% (${(prog.copied / 1024 ** 3).toFixed(2)} / ${(prog.total / 1024 ** 3).toFixed(2)} GB)`;
            } else if (prog.type === "done") {
              text += ` — complete`;
              copySuccess = true; // Flag success for delete
            } else if (prog.type === "error") {
              text += ` — error: ${prog.message}`;
              copySuccess = false;
            }

            mainWindow.webContents.send("import-progress", {
              text,
              progress,
              total,
              subProgress: prog.percent || 0,
              subTotal: 100,
            });
          });

          // Only delete if copy reached 100% success
          if (deleteAfter && copySuccess) {
            try {
              if (
                await fs.promises
                  .access(originalSource)
                  .then(() => true)
                  .catch(() => false)
              ) {
                await fs.promises.rm(originalSource, {
                  recursive: true,
                  force: true,
                });
                console.log(
                  `Deleted original source after 100% copy: ${originalSource}`,
                );
                mainWindow.webContents.send("import-progress", {
                  text: `Moved ${game.title} and deleted original folder`,
                  progress,
                  total,
                });
              } else {
                console.log(`Original source already gone: ${originalSource}`);
              }
            } catch (delErr) {
              console.error(
                `Failed to delete original source ${originalSource}:`,
                delErr,
              );
              mainWindow.webContents.send("import-progress", {
                text: `Moved ${game.title} but failed to delete original: ${delErr.message}`,
                progress,
                total,
              });
            }
          } else if (deleteAfter && !copySuccess) {
            console.log(
              `Delete skipped — copy was not 100% successful for ${game.title}`,
            );
            mainWindow.webContents.send("import-progress", {
              text: `Moved ${game.title} (partial copy — original kept)`,
              progress,
              total,
            });
          } else {
            mainWindow.webContents.send("import-progress", {
              text: `Moved ${game.title} (original kept)`,
              progress,
              total,
            });
          }

          // Update gamePath to new location for DB
          gamePath = destPath;
          execPath = path.join(gamePath, game.selectedValue || "");

          console.log(`Moved ${game.title} to: ${destPath}`);
        } catch (moveErr) {
          console.error("Structured move failed:", moveErr);
          mainWindow.webContents.send("import-progress", {
            text: `Move failed for ${game.title}: ${moveErr.message}`,
            progress,
            total,
          });
        }
      }
      if (game.isArchive) {
        // ────────────────────────────────────────────────────────────────
        // 1. Get the ACTUAL archive file path
        // ────────────────────────────────────────────────────────────────
        if (
          !game.executables ||
          !Array.isArray(game.executables) ||
          game.executables.length === 0
        ) {
          throw new Error(
            "No executable/archive specified for this compressed game",
          );
        }

        const archiveFilename =
          game.executables[0].value || game.executables[0].key;
        if (!archiveFilename) {
          throw new Error("Archive filename could not be determined");
        }

        const zipPath = path.join(game.folder, archiveFilename);
        console.log(`Full archive path: ${zipPath}`);

        if (!fs.existsSync(zipPath)) {
          throw new Error(`Archive file not found: ${zipPath}`);
        }

        // ────────────────────────────────────────────────────────────────
        // 2. Build structured extraction path (ALWAYS in default library)
        // ────────────────────────────────────────────────────────────────
        if (!targetLibrary || !fs.existsSync(targetLibrary)) {
          throw new Error("Default library folder not set or does not exist");
        }

        const formatStr = format.trim();
        if (!formatStr) {
          throw new Error(
            "No folder structure format defined — cannot extract structured",
          );
        }

        const parts = formatStr
          .split("/")
          .map((p) => p.replace(/[{}]/g, "").trim());
        const segments = parts.map((part) => {
          let val = "Unknown";
          if (part.toLowerCase() === "creator") val = game.creator || "Unknown";
          if (part.toLowerCase() === "title") val = game.title || "Untitled";
          if (part.toLowerCase() === "version") val = game.version || "v1";
          if (part.toLowerCase() === "engine") val = game.engine || "Unknown";
          return (
            val
              .replace(/[\/\\:*?"<>|]/g, "_")
              .replace(/\s+/g, " ")
              .trim() || "Unknown"
          );
        });

        let extractPath = path.join(targetLibrary, ...segments);

        // Handle name conflict (add (1), (2), etc.)
        let counter = 1;
        const basePath = extractPath;
        while (fs.existsSync(extractPath)) {
          extractPath = `${basePath} (${counter++})`;
        }

        fs.mkdirSync(extractPath, { recursive: true });
        console.log(`Extraction target: ${extractPath}`);

        // Progress feedback
        mainWindow.webContents.send("import-progress", {
          text: `Extracting ${game.title} (${archiveFilename}) → library...`,
          progress,
          total,
        });

        // ────────────────────────────────────────────────────────────────
        // 3. Extract using the local function
        // ────────────────────────────────────────────────────────────────
        try {
          await unzipGame({ zipPath, extractPath });
          console.log("Extraction successful");

          // Optional: delete original archive if requested
          if (deleteAfter) {
            try {
              fs.unlinkSync(zipPath);
              console.log(`Deleted original archive: ${zipPath}`);
            } catch (delErr) {
              console.warn(
                `Failed to delete original archive: ${delErr.message}`,
              );
            }
          }

          gamePath = extractPath;
        } catch (extractErr) {
          console.error("Extraction failed:", extractErr);
          throw new Error(`Extraction failed: ${extractErr.message}`);
        }

        // ────────────────────────────────────────────────────────────────
        // 4. Find executables + promote single subfolder if needed
        // ────────────────────────────────────────────────────────────────
        let execs = findExecutables(extractPath, gameExt);

        if (execs.length === 0) {
          const items = fs.readdirSync(extractPath, { withFileTypes: true });
          const dirs = items.filter((i) => i.isDirectory());
          if (dirs.length === 1) {
            const subPath = path.join(extractPath, dirs[0].name);
            const subItems = fs.readdirSync(subPath);
            for (const item of subItems) {
              fs.renameSync(
                path.join(subPath, item),
                path.join(extractPath, item),
              );
            }
            try {
              fs.rmdirSync(subPath);
            } catch {}
            execs = findExecutables(extractPath, gameExt);
          }
        }

        // (rest of your logic: modal if multiple, select if one, error if zero)
        let selected = null;

        if (execs.length === 0) {
          throw new Error("No executable found after extraction and promotion");
        } else if (execs.length === 1) {
          selected = execs[0];
        } else {
          // Show modal (your existing promise + showExecutableChooser logic)
          selected = await new Promise((resolve) => {
            showExecutableChooser(game.title, game.version || "", execs);

            const onChosen = (event, data) => {
              ipcMain.removeAllListeners("executable-chosen");
              resolve(data.selectedExecutable || null);
            };

            ipcMain.once("executable-chosen", onChosen);

            // Safety: if window closed without choice
            executableChooserWindow.on("closed", () => {
              ipcMain.removeAllListeners("executable-chosen");
              resolve(null);
            });
          });

          if (!selected) {
            throw new Error("User cancelled executable selection");
          }
        }

        execPath = path.join(extractPath, selected);

        // Engine detection (unchanged)
        for (const [eng, patterns] of Object.entries(engineMap)) {
          if (patterns.some((p) => selected.toLowerCase().includes(p))) {
            game.engine = eng;
            break;
          }
        }

        // Update game object so it gets saved correctly
        game.executables = execs.map((e) => ({ key: e, value: e }));
        game.selectedValue = selected;

        mainWindow.webContents.send("import-progress", {
          text: `Extracted ${game.title} – ready for database`,
          progress,
          total,
        });
      }
      if (scanSize) {
        size = getFolderSize(gamePath);
      }

      const add = {
        title: game.title,
        creator: game.creator,
        engine: game.engine,
        description: game.description || "Imported game",
      };

      console.log("Adding Game");
      const recordId = await addGame(add);
      console.log("game added");
      console.log("adding version");
      await addVersion(
        { ...game, folder: gamePath, execPath, folderSize: size },
        recordId,
      );
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
      results.push({ success: true, recordId, atlasId: game.atlasId });
      // Update ui with game is added. Do not wait
      mainWindow.webContents.send("game-updated", recordId);
      mainWindow.webContents.send("import-complete");
      progress++;
      mainWindow.webContents.send("import-progress", {
        text: `Imported game '${game.title}' ${progress}/${total}`,
        progress,
        total,
      });
    } catch (err) {
      console.error("Error importing game:", err);
      results.push({ success: false, error: err.message });
      progress++;
      mainWindow.webContents.send("import-progress", {
        text: `Error importing game '${game.title}' ${progress}/${total}: ${err.message}`,
        progress,
        total,
      });
    }
  }

  mainWindow.webContents.send("import-progress", {
    text: `Game import complete: ${results.filter((r) => r.success).length} successful`,
    progress,
    total,
  });
  mainWindow.webContents.send("import-complete");

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
    });

    for (const game of gamesWithImages) {
      try {
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
        });

        await downloadImages(
          game.recordId,
          game.atlasId,
          (current, totalImages) => {
            mainWindow.webContents.send("import-progress", {
              text: `Downloading images for '${game.title}' ${progress + 1}/${imageTotal}, ${current}/${totalImages}`,
              progress,
              total: imageTotal,
            });
          },
          downloadBannerImages,
          downloadPreviewImages,
          previewLimit,
          downloadVideos,
        );

        mainWindow.webContents.send("game-updated", game.recordId);

        progress++;
        mainWindow.webContents.send("import-progress", {
          text: `Completed image download for '${game.title}' ${progress}/${imageTotal}, ${totalImages} images downloaded`,
          progress,
          total: imageTotal,
        });
      } catch (err) {
        console.error("Error downloading images for game:", err);
        progress++;
        mainWindow.webContents.send("import-progress", {
          text: `Error downloading images for '${game.title}' ${progress}/${imageTotal}: ${err.message}`,
          progress,
          total: imageTotal,
        });
      }
    }

    mainWindow.webContents.send("import-progress", {
      text: `Image download complete for ${progress} games`,
      progress,
      total: imageTotal,
    });
  }

  mainWindow.webContents.send("import-complete");
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
        if (extensions.includes(ext)) {
          execs.push(full.replace(dir + path.sep, ""));
        }
      }
    }
  }
  return execs;
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

async function unzipGame({ zipPath, extractPath }) {
  const AdmZip = require("adm-zip");
  const sevenZip = require("node-7z");
  const Unrar = require("unrar");

  try {
    let ext = path.extname(zipPath).toLowerCase();
    if (ext.startsWith(".")) ext = ext.slice(1);

    console.log(`Extracting: ${zipPath} (${ext}) → ${extractPath}`);

    if (ext === "zip") {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractPath, true);
    } 
    else if (ext === "rar") {
      const unrar = new Unrar(zipPath);
      await new Promise((resolve, reject) => {
        unrar.extract(extractPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } 
    else if (ext === "7z") {
      await sevenZip(zipPath, {
        o: extractPath,
        $bin: sevenZip.path7za,
      });
    } 
    else {
      throw new Error(`Unsupported format: .${ext}`);
    }

    // ── Critical: Check if extraction actually put files there ──
    const filesAfter = fs.readdirSync(extractPath, { recursive: true });
    console.log(`Files after extraction (${extractPath}):`, filesAfter.length);
    console.log("Sample files:", filesAfter.slice(0, 5));

    if (filesAfter.length === 0) {
      throw new Error(
        "Extraction reported success but target folder is empty. " +
        "Archive may be password-protected, corrupted, or empty."
      );
    }

    console.log("Extraction verified: files present");
    return { success: true };
  } catch (err) {
    console.error("Extraction failed:", err);
    throw new Error(`Extraction failed: ${err.message}`);
  }
}

async function launchGame({ execPath, extension, recordId }) {
  if (recordId) {
    const steamId = await getSteamIDbyRecord(recordId);
    if (steamId) {
      shell.openExternal(`steam://run/${steamId}`);
      return;
    }
  }
  if (!fs.existsSync(execPath)) {
    console.error(`Executable not found: ${execPath}`);
    return;
  }
  const emulator = await getEmulatorByExtension(extension);
  if (emulator) {
    const args = emulator.parameters ? emulator.parameters.split(" ") : [];
    args.push(execPath);
    const child = cp.spawn(emulator.program_path, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else {
    shell.openPath(execPath);
  }
}

function handleContextAction(data, sender) {
  if (!data || typeof data.action === "undefined") {
    console.error("handleContextAction: Invalid or missing data object", data);
    return;
  }

  switch (data.action) {
    case "launch":
      launchGame(data);
      break;
    case "openFolder":
      shell.openPath(data.gamePath);
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

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
