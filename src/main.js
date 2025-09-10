const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const AdmZip = require('adm-zip');
const Seven = require('node-7z');
const Unrar = require('unrar');
const axios = require('axios');
const { autoUpdater } = require('electron-updater');
const ini = require('ini');

let mainWindow;
let settingsWindow;
let appConfig; // Global config variable

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

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 850,
    height: 600,
    minWidth: 850,
    minHeight: 600,
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

const dbPath = path.join(dataDir, 'data.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database error:', err);
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS games
      (
        record_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        creator TEXT NOT NULL,
        engine TEXT,
        last_played_r DATE DEFAULT 0,
        total_playtime INTEGER DEFAULT 0,
        description TEXT,
        UNIQUE (title, creator, engine)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS versions
      (
        record_id INTEGER REFERENCES games (record_id),
        version TEXT,
        game_path TEXT,
        exec_path TEXT,
        in_place BOOLEAN,
        last_played DATE,
        version_playtime INTEGER,
        folder_size INTEGER,
        date_added INTEGER,
        UNIQUE (record_id, version)
      );
    `);
    db.run(`
      CREATE VIEW IF NOT EXISTS last_import_times (record_id, last_import) AS
      SELECT DISTINCT record_id, versions.date_added
      FROM games
      NATURAL JOIN versions
      ORDER BY versions.date_added DESC;
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_data
      (
        atlas_id INTEGER PRIMARY KEY,
        id_name STRING UNIQUE,
        short_name STRING,
        title STRING,
        original_name STRING,
        category STRING,
        engine STRING,
        status STRING,
        version STRING,
        developer STRING,
        creator STRING,
        overview STRING,
        censored STRING,
        language STRING,
        translations STRING,
        genre STRING,
        tags STRING,
        voice STRING,
        os STRING,
        release_date DATE,
        length STRING,
        banner STRING,
        banner_wide STRING,
        cover STRING,
        logo STRING,
        wallpaper STRING,
        previews STRING,
        last_db_update STRING
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_previews
      (
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        preview_url STRING NOT NULL,
        UNIQUE (atlas_id, preview_url)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS atlas_mappings
      (
        record_id INTEGER REFERENCES games (record_id),
        atlas_id INTEGER REFERENCES atlas_data (atlas_id),
        UNIQUE (record_id, atlas_id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_data
      (
        f95_id INTEGER UNIQUE PRIMARY KEY,
        atlas_id INTEGER REFERENCES atlas_data (atlas_id) UNIQUE,
        banner_url STRING,
        site_url STRING,
        last_thread_comment STRING,
        thread_publish_date STRING,
        last_record_update STRING,
        views STRING,
        likes STRING,
        tags STRING,
        rating STRING,
        screens STRING,
        replies STRING
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_zone_screens
      (
        f95_id INTEGER REFERENCES f95_zone_data (f95_id),
        screen_url TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS updates
      (
        update_time INTEGER PRIMARY KEY,
        record_id INTEGER REFERENCES games (record_id),
        path STRING UNIQUE
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS f95_latest
      (
        record_id INTEGER REFERENCES games(record_id),
        f95_id INTEGER REFERENCES f95_zone_data(f95_id)
      );
    `);
    db.all('SELECT record_id, path FROM banners', [], (err, rows) => {
      if (err) console.error('Error fetching banners:', err);
    });
  });
});

ipcMain.handle('add-game', async (event, game) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO games (title, creator, engine, description, total_playtime, last_played_r) VALUES (?, ?, ?, ?, 0, 0)',
      [game.title, game.creator || 'Unknown', game.engine || null, game.description || ''],
      function (err) {
        if (err) {
          reject(err);
          return;
        }
        const record_id = this.lastID;
        db.run(
          'INSERT INTO versions (record_id, version, game_path, exec_path, in_place, last_played, version_playtime, folder_size, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [record_id, game.version || '1.0', game.game_path || game.path, game.exec_path || game.path, game.in_place || 0, game.last_played || null, game.version_playtime || 0, game.folder_size || 0, Date.now()],
          (err) => {
            if (err) reject(err);
            else resolve({ success: true, record_id });
          }
        );
      }
    );
  });
});

ipcMain.handle('get-games', async () => {
  return new Promise((resolve, reject) => {
    const isDev = process.defaultApp;
    const appPath = app.getAppPath();
    const baseImagePath = isDev
      ? path.join(appPath, "src")
      : path.resolve(appPath, '../../');
    db.all(`
      WITH LatestVersion AS (
        SELECT record_id, MAX(date_added) as latest_date
        FROM versions
        GROUP BY record_id
      )
      SELECT 
        g.record_id,
        g.title,
        g.creator,
        g.engine,
        g.description,
        g.total_playtime,
        g.last_played_r,
        v.version,
        v.game_path,
        v.exec_path,
        v.in_place,
        v.last_played,
        v.version_playtime,
        v.folder_size,
        v.date_added,
        CASE 
          WHEN b.path IS NOT NULL THEN REPLACE('${baseImagePath}/' || b.path, '\\', '/')
          ELSE NULL
        END AS banner_url,
        GROUP_CONCAT(t.tag) AS tags
      FROM games g
      INNER JOIN LatestVersion lv ON g.record_id = lv.record_id
      INNER JOIN versions v ON g.record_id = v.record_id AND v.date_added = lv.latest_date
      LEFT JOIN banners b ON g.record_id = b.record_id
      LEFT JOIN tag_mappings tm ON g.record_id = tm.record_id
      LEFT JOIN tags t ON tm.tag_id = t.tag_id
      GROUP BY g.record_id
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
});

ipcMain.handle('remove-game', async (event, record_id) => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM games WHERE record_id = ?', [record_id], (err) => {
      if (err) reject(err);
      else resolve({ success: true });
    });
  });
});

ipcMain.handle('unzip-game', async (event, { zipPath, extractPath }) => {
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
  try {
    const response = await axios.get('https://api.github.com/repos/towerwatchman/Atlas-Electron/releases/latest');
    const latestVersion = response.data.tag_name;
    return { latestVersion, currentVersion: app.getVersion() };
  } catch (err) {
    return { success: false, error: err.message };
  }
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

app.whenReady().then(() => {
  loadConfig(); // Load config at startup
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});