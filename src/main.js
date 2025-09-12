const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { startScan } = require('./components/scanners/f95scanner');
const { autoUpdater } = require('electron-updater');
const ini = require('ini');
const { initializeDatabase, addGame, getGames, removeGame, checkDbUpdates } = require('./database');

let mainWindow;
let settingsWindow;
let importerWindow;
let appConfig; // Global config variable

app.commandLine.appendSwitch('force-color-profile', 'srgb');

// MAIN WINDOW
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 720,
    minWidth: 1400,
    minHeight: 720,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'renderer.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state-changed', 'maximized');
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state-changed', 'restored');
  });
}

// SETTINGS WINDOW
function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 850,
    height: 600,
    minWidth: 850,
    minHeight: 600,
    roundedCorners:  true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    center: false,
    webPreferences: {
      preload: path.join(__dirname, 'renderer.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  if (process.argv.includes('--dev')) {
    settingsWindow.webContents.openDevTools();
  }

  settingsWindow.on('maximize', () => {
    settingsWindow.webContents.send('window-state-changed', 'maximized');
  });
  settingsWindow.on('unmaximize', () => {
    settingsWindow.webContents.send('window-state-changed', 'restored');
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// IMPORTER WINDOW
function createImporterWindow() {
  importerWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'renderer.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
  });

  importerWindow.loadFile(path.join(__dirname, 'importer.html'));

  if (process.argv.includes('--dev')) {
    importerWindow.webContents.openDevTools();
  }

  importerWindow.on('maximize', () => {
    importerWindow.webContents.send('window-state-changed', 'maximized');
  });
  importerWindow.on('unmaximize', () => {
    importerWindow.webContents.send('window-state-changed', 'restored');
  });

  importerWindow.on('closed', () => {
    importerWindow = null;
  });
}

// Create data folders
var dataDir = "";
if (process.defaultApp) {
  console.log('Running in development');
  dataDir = path.join(__dirname, 'data');
} else {
  const resourcesPath = path.resolve(app.getAppPath(), '../../');
  dataDir = path.join(resourcesPath, 'data');
  console.log(`Running in release`);
}

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const updatesDir = path.join(dataDir, 'updates');
if (!fs.existsSync(updatesDir)) {
  fs.mkdirSync(updatesDir, { recursive: true });
}
const imagesDir = path.join(dataDir, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Setup electron-updater events
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'towerwatchman',
  repo: 'Atlas'
});
autoUpdater.allowDowngrade = true; // Prevent clearing app directory during updates
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
  mainWindow.webContents.send('update-status', { status: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  console.log(`Update available: ${info.version}`);
  mainWindow.webContents.send('update-status', { status: 'available', version: info.version });
});

autoUpdater.on('update-not-available', (info) => {
  console.log('No updates available.');
  mainWindow.webContents.send('update-status', { status: 'not-available' });
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`Download progress: ${progress.percent}%`);
  mainWindow.webContents.send('update-status', { status: 'downloading', percent: progress.percent });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log(`Update downloaded: ${info.version}`);
  mainWindow.webContents.send('update-status', { status: 'downloaded', version: info.version });
  autoUpdater.quitAndInstall();
});

autoUpdater.on('error', (err) => {
  console.error('Updater error:', err);
  mainWindow.webContents.send('update-status', { status: 'error', error: err.message });
});

// Initialize database
initializeDatabase(dataDir);

// Initialize config.ini
const configPath = path.join(dataDir, 'config.ini');
const defaultConfig = {
  Interface: {
    language: 'English',
    atlasStartup: 'Do Nothing',
    gameStartup: 'Do Nothing',
    showDebugConsole: false,
    minimizeToTray: false
  },
  Library: {
    rootPath: dataDir,
    gameFolder: ''
  },
  Metadata: {
    downloadPreviews: false
  }
};

// Load config.ini at startup
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      appConfig = ini.parse(configData);
    } else {
      appConfig = defaultConfig;
      fs.writeFileSync(configPath, ini.stringify(appConfig));
    }
  } catch (err) {
    console.error('Error loading config.ini:', err);
    appConfig = defaultConfig;
  }
}

ipcMain.handle('add-game', async (event, game) => {
  return addGame(game);
});

ipcMain.handle('get-games', async () => {
  return getGames(app.getAppPath(), process.defaultApp);
});

ipcMain.handle('remove-game', async (event, record_id) => {
  return removeGame(record_id);
});

ipcMain.handle('unzip-game', async (event, { zipPath, extractPath }) => {
  const AdmZip = require('adm-zip');
  const Seven = require('node-7z');
  const Unrar = require('unrar');
  try {
    const ext = path.extname(zipPath).toLowerCase();
    if (ext === '.zip') {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractPath, true);
    } else if (ext === '.rar') {
      const unrar = new Unrar(zipPath);
      unrar.extract(extractPath);
    } else if (ext === '.7z') {
      await Seven.extractFull(zipPath, extractPath);
    } else {
      throw new Error('Unsupported file format');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-updates', async () => {
  const axios = require('axios');
  try {
    const response = await axios.get('https://api.github.com/repos/towerwatchman/Atlas-Electron/releases/latest');
    const latestVersion = response.data.tag_name;
    return { latestVersion, currentVersion: app.getVersion() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-db-updates', async () => {
  return checkDbUpdates(updatesDir, mainWindow);
});

ipcMain.handle('minimize-window', () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) focusedWindow.minimize();
});

ipcMain.handle('maximize-window', () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    if (focusedWindow.isMaximized()) {
      focusedWindow.unmaximize();
    } else {
      focusedWindow.maximize();
    }
  }
});

ipcMain.handle('close-window', () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) focusedWindow.close();
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Archives', extensions: ['zip', 'rar', '7z'] }] });
  return result.filePaths[0] || null;
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.filePaths[0] || null;
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('open-settings', () => {
  if (!settingsWindow) {
    createSettingsWindow();
  } else {
    settingsWindow.focus();
  }
});

ipcMain.handle('get-settings', async () => {
  return appConfig || defaultConfig;
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    appConfig = settings;
    fs.writeFileSync(configPath, ini.stringify(settings));
    return { success: true };
  } catch (err) {
    console.error('Error writing to config.ini:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-importer', () => {
  if (!importerWindow) {
    createImporterWindow();
  } else {
    importerWindow.focus();
  }
});

ipcMain.handle('start-scan', async (event, params) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  try {
    await startScan(params, window);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('search-atlas', async (event, { title, creator }) => {
  return searchAtlas(title, creator);
});

ipcMain.handle('find-f95-id', async (event, atlasId) => {
  return findF95Id(atlasId);
});

ipcMain.handle('check-record-exist', async (event, { title, creator, engine, version, path }) => {
  const existsByDetails = await checkRecordExist(title, creator, engine, version);
  if (existsByDetails) return true;
  return checkPathExist(path, title);
});

ipcMain.handle('import-games', async (event, params) => {
  const { games, deleteAfter, scanSize, downloadImages, gameExt } = params;
  const gamesDir = path.join(dataDir, 'games');
  if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });

  const results = [];
  for (const game of games) {
    try {
      let gamePath = game.folder;
      let execPath = game.selectedValue ? path.join(gamePath, game.selectedValue) : '';
      let size = 0;

      if (game.isArchive) {
        const extractPath = path.join(gamesDir, `${game.title}-${game.version}`);
        if (!fs.existsSync(extractPath)) fs.mkdirSync(extractPath, { recursive: true });
        await unzipGame({ zipPath: game.folder, extractPath });
        if (deleteAfter) fs.unlinkSync(game.folder);
        gamePath = extractPath;

        const execs = findExecutables(extractPath, gameExt);
        if (execs.length > 0) {
          const selected = execs[0];
          execPath = path.join(extractPath, selected);
          for (const [eng, patterns] of Object.entries(engineMap)) {
            if (patterns.some(p => selected.toLowerCase().includes(p))) {
              game.engine = eng;
              break;
            }
          }
        }
      }

      if (scanSize) {
        size = getFolderSize(gamePath);
      }

      const add = {
        title: game.title,
        creator: game.creator,
        engine: game.engine,
        description: game.description || 'Imported game',
        game_path: gamePath,
        exec_path: execPath,
        version: game.version,
        folderSize: size
      };

      const recordId = await addGame(add);
      if (game.atlasId) await addAtlasMapping(recordId, game.atlasId);
      if (downloadImages && game.atlasId) await downloadImagesFunc(game.atlasId); // Rename if conflicting with var name
      results.push({ success: true, recordId });
    } catch (err) {
      results.push({ success: false, error: err.message });
    }
  }
  return results;
});

const engineMap = {
  rpgm: ['rpgmv.exe', 'rpgmk.exe', 'rpgvx.exe', 'rpgvxace.exe', 'rpgmktranspatch.exe'],
  renpy: ['renpy.exe', 'renpy.sh'],
  unity: ['unityplayer.dll', 'unitycrashhandler64.exe'],
  html: ['index.html'],
  flash: ['.swf']
};

function getFolderSize(dir) {
  let size = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      fs.readdirSync(current).forEach(f => stack.push(path.join(current, f)));
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
          execs.push(full.replace(dir + path.sep, ''));
        }
      }
    }
  }
  return execs;
}

async function downloadImagesFunc(atlasId) {
  const row = await new Promise((resolve, reject) => {
    db.get(`SELECT banner, cover, logo, wallpaper, previews FROM atlas_data WHERE atlas_id = ?`, [atlasId], (err, row) => {
      if (err) reject(err);
      resolve(row);
    });
  });
  if (!row) return;
  const imgDir = path.join(imagesDir, atlasId.toString());
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  const urls = {
    banner: row.banner,
    cover: row.cover,
    logo: row.logo,
    wallpaper: row.wallpaper
  };
  for (const [name, url] of Object.entries(urls)) {
    if (url) {
      try {
        const resp = await axios.get(url, { responseType: 'arraybuffer' });
        fs.writeFileSync(path.join(imgDir, `${name}${path.extname(new URL(url).pathname) || '.jpg'}`), resp.data);
      } catch {}
    }
  }
  if (row.previews) {
    const prevs = row.previews.split(',');
    for (let i = 0; i < prevs.length; i++) {
      const url = prevs[i].trim();
      if (url) {
        try {
          const resp = await axios.get(url, { responseType: 'arraybuffer' });
          fs.writeFileSync(path.join(imgDir, `preview${i}${path.extname(new URL(url).pathname) || '.jpg'}`), resp.data);
        } catch {}
      }
    }
  }
}

app.whenReady().then(() => {
  loadConfig(); // Load config at startup
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});