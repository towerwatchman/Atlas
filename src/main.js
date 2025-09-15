const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { startScan } = require('./components/scanners/f95scanner');
const { autoUpdater } = require('electron-updater');
const ini = require('ini');
const { checkRecordExist, checkPathExist ,initializeDatabase, addGame, addVersion, addAtlasMapping, getGames, removeGame, checkDbUpdates, updateFolderSize, getBannerUrl, getScreensUrlList } = require('./database');

let mainWindow;
let settingsWindow;
let importerWindow;
let appConfig;

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
      nodeIntegration: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (process.argv.includes('--dev') || appConfig?.Interface?.showDebugConsole) {
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
    roundedCorners: true,
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

  if (process.argv.includes('--dev') || appConfig?.Interface?.showDebugConsole) {
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

  if (process.argv.includes('--dev') || appConfig?.Interface?.showDebugConsole) {
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

const templatesDir = path.join(dataDir, 'templates/banner');
if (!fs.existsSync(templatesDir)) {
  fs.mkdirSync(templatesDir, { recursive: true });
}

// Setup electron-updater events
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'towerwatchman',
  repo: 'Atlas'
});
autoUpdater.allowDowngrade = true;
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
    } else if (ext === '.7z') {
      await Seven.extractFull(zipPath, extractPath);
    } else if (ext === '.rar') {
      const extractor = new Unrar(zipPath);
      extractor.extract(extractPath);
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
  try {
    const { searchAtlas } = require('./database');
    const data = await searchAtlas(title, creator);
    return data;
  } catch (err) {
    console.error('Error in search-atlas:', err);
    return [];
  }
});

ipcMain.handle('find-f95-id', async (event, atlasId) => {
  try {
    const { findF95Id } = require('./database');
    return await findF95Id(atlasId);
  } catch (err) {
    console.error('Error in find-f95-id:', err);
    return '';
  }
});

ipcMain.handle('get-atlas-data', async (event, atlasId) => {
  try {
    const { getAtlasData } = require('./database');
    return await getAtlasData(atlasId);
  } catch (err) {
    console.error('Error in get-atlas-data:', err);
    return {};
  }
});

ipcMain.handle('check-record-exist', async (event, { title, creator, engine, version, path }) => {
  try {
    const existsByDetails = await checkRecordExist(title, creator, engine, version);
    if (existsByDetails) return true;
    return checkPathExist(path, title);
  } catch (err) {
    console.error('Error in check-record-exist:', err);
    return false;
  }
});

ipcMain.handle('log', async (event, message) => {
  console.log(`Renderer: ${message}`);
});

ipcMain.handle('update-progress', async (event, progress) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.webContents.send('update-progress', progress);
  }
});

ipcMain.handle('get-available-banner-templates', async () => {
  const templatesDir = path.join(__dirname, 'data', 'templates', 'banner');
  try {
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
      console.log(`Created templates directory: ${templatesDir}`);
    }
    const files = fs.readdirSync(templatesDir).filter(file => file.endsWith('.js'));
    return files.map(file => path.basename(file, '.js'));
  } catch (err) {
    console.error('Error reading templates directory:', err);
    return [];
  }
});

ipcMain.handle('get-selected-banner-template', async () => {
  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    const match = configData.match(/bannerTemplate=(.*)/);
    return match ? match[1] : 'Default';
  } catch (err) {
    console.error('Error reading selected banner template:', err);
    return 'Default';
  }
});

ipcMain.handle('set-selected-banner-template', async (event, template) => {
  try {
    let configData = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';
    configData = configData.replace(/bannerTemplate=.*/g, '') + `\nbannerTemplate=${template}`;
    fs.writeFileSync(configPath, configData.trim());
  } catch (err) {
    console.error('Error saving selected banner template:', err);
    throw err;
  }
});

ipcMain.handle('open-external-url', async (event, url) => {
  try {
    await require('electron').shell.openExternal(url);
  } catch (err) {
    console.error('Error opening external URL:', err);
  }
});

ipcMain.handle('import-games', async (event, params) => {
  const { games, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos, deleteAfter, scanSize, isCompressed } = params;
  const total = games.length;
  let progress = 0;
  const results = [];
  const successfulImports = [];

  // First, import all game data without downloading images
  for (const game of games) {
    try {
      const exists = await checkRecordExist(game.title, game.creator, game.version);
      if (exists) {
        results.push({ success: false, error: 'Record already exists' });
      } else {
        const record_id = await addGame({
          title: game.title,
          creator: game.creator,
          engine: game.engine || 'Unknown'
        });
        await addVersion(game, record_id);
        if (game.atlasId) {
          await addAtlasMapping(record_id, game.atlasId);
        }
        if (scanSize) {
          const size = getFolderSize(game.folder);
          await updateFolderSize(record_id, game.version, size);
        }
        successfulImports.push({
          recordId: record_id,
          atlasId: game.atlasId,
          title: game.title
        });
        results.push({ success: true });
        mainWindow.webContents.send('game-imported'); // Send to main window after game import
      }
    } catch (err) {
      console.error('Error importing game:', err);
      results.push({ success: false, error: err.message });
    } finally {
      progress++;
      mainWindow.webContents.send('import-progress', { 
        text: `Importing game data '${game.title}' ${progress}/${total}`, 
        progress, 
        total 
      });
    }

    if (deleteAfter && isCompressed && game.folder) {
      try {
        if (fs.existsSync(game.folder)) {
          fs.unlinkSync(game.folder);
          console.log(`Deleted archive: ${game.folder}`);
        }
      } catch (err) {
        console.error(`Error deleting archive for ${game.title}:`, err);
      }
    }
  }

  // Now, download images for all successfully imported games that require it
  const imageDownloads = successfulImports.filter(imp => imp.atlasId && (downloadBannerImages || downloadPreviewImages));
  const imageTotal = imageDownloads.length;
  let imageProgress = 0;

  for (const imp of imageDownloads) {
    try {
      const onImageProgress = (current, totalImages) => {
        mainWindow.webContents.send('import-progress', { 
          text: `Downloading image ${current} of ${totalImages} for '${imp.title}'`, 
          progress: imageProgress, 
          total: imageTotal 
        });
      };
      await downloadImagesFunc(imp.recordId, imp.atlasId, onImageProgress, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos);
      mainWindow.webContents.send('game-imported'); // Send to main window after images downloaded
    } catch (err) {
      console.error(`Error downloading images for ${imp.title}:`, err);
    } finally {
      imageProgress++;
      mainWindow.webContents.send('import-progress', { 
        text: `Completed images for '${imp.title}' (${imageProgress}/${imageTotal})`, 
        progress: imageProgress, 
        total: imageTotal 
      });
    }
  }

  mainWindow.webContents.send('import-progress', { 
    text: `Import complete: ${results.filter(r => r.success).length} successful`, 
    progress: imageTotal, 
    total: imageTotal 
  });

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

async function downloadImagesFunc(recordId, atlasId, onImageProgress, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos) {
  const sharp = require('sharp');
  const axios = require('axios');
  const { getBannerUrl, getScreensUrlList, updateBanners, updatePreviews } = require('./database');

  const imgDir = path.join(dataDir, 'images', recordId.toString());
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  let imageProgress = 0;
  const bannerUrl = downloadBannerImages ? await getBannerUrl(atlasId) : null;
  const screenUrls = downloadPreviewImages ? await getScreensUrlList(atlasId) : [];
  const previewCount = downloadPreviewImages ? (previewLimit === 'Unlimited' ? screenUrls.length : Math.min(parseInt(previewLimit), screenUrls.length)) : 0;
  const totalImages = (bannerUrl ? 3 : 0) + previewCount;

  // Delay function to enforce 2 requests per second (500ms per request)
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  if (bannerUrl) {
    console.log(`Downloading banner from URL: ${bannerUrl}`);
    try {
      const ext = path.extname(new URL(bannerUrl).pathname).toLowerCase();
      const baseName = path.basename(bannerUrl, ext);
      const imagePath = path.join(imgDir, baseName);
      const relativePath = path.join('data', 'images', recordId.toString(), baseName);

      let imageBytes;
      if (['.gif', '.mp4', '.webm'].includes(ext) && downloadVideos) {
        const animatedPath = `${imagePath}${ext}`;
        if (!fs.existsSync(animatedPath)) {
          const response = await axios.get(bannerUrl, { responseType: 'arraybuffer' });
          imageBytes = Buffer.from(response.data);
          fs.writeFileSync(animatedPath, imageBytes);
          await updateBanners(recordId, `${relativePath}${ext}`, 'banner');
          await delay(500); // Enforce 2 requests per second
        }
        imageProgress++;
        onImageProgress(imageProgress, totalImages);
      }

      const highResPath = `${imagePath}_mc.webp`;
      const lowResPath = `${imagePath}_sc.webp`;
      if (!fs.existsSync(highResPath)) {
        if (!imageBytes) {
          const response = await axios.get(bannerUrl, { responseType: 'arraybuffer' });
          imageBytes = Buffer.from(response.data);
          await delay(500); // Enforce 2 requests per second
        }
        await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 1260, withoutEnlargement: true }).toFile(highResPath);
        await updateBanners(recordId, `${relativePath}_mc.webp`, 'banner');
      }
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      if (!fs.existsSync(lowResPath)) {
        if (!imageBytes) {
          const response = await axios.get(bannerUrl, { responseType: 'arraybuffer' });
          imageBytes = Buffer.from(response.data);
          await delay(500); // Enforce 2 requests per second
        }
        await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 600, withoutEnlargement: true }).toFile(lowResPath);
        await updateBanners(recordId, `${relativePath}_sc.webp`, 'banner');
      }
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      console.log('Banner images updated');
    } catch (err) {
      console.error('Error downloading or converting banner:', err);
    }
  }

  for (let i = 0; i < previewCount; i++) {
    const url = screenUrls[i].trim();
    if (url) {
      console.log(`Downloading screen ${i + 1} from URL: ${url}`);
      try {
        const ext = path.extname(new URL(url).pathname).toLowerCase();
        const baseName = `preview${i}`;
        const imagePath = path.join(imgDir, baseName);
        const relativePath = path.join('data', 'images', recordId.toString(), baseName);

        const targetPath = (['.gif', '.mp4', '.webm'].includes(ext) && downloadVideos) ? `${imagePath}${ext}` : `${imagePath}_pr.webp`;
        if (!fs.existsSync(targetPath)) {
          const response = await axios.get(url, { responseType: 'arraybuffer' });
          const imageBytes = Buffer.from(response.data);
          await delay(500); // Enforce 2 requests per second

          if (['.gif', '.mp4', '.webm'].includes(ext) && downloadVideos) {
            fs.writeFileSync(targetPath, imageBytes);
            await updatePreviews(recordId, `${relativePath}${ext}`);
          } else if (!['.gif', '.mp4', '.webm'].includes(ext)) {
            await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 1260, withoutEnlargement: true }).toFile(targetPath);
            await updatePreviews(recordId, `${relativePath}_pr.webp`);
          }
        }
        imageProgress++;
        onImageProgress(imageProgress, totalImages);
        console.log(`Screen ${i + 1} updated`);
      } catch (err) {
        console.error(`Error downloading or converting screen ${i + 1}:`, err);
      }
    }
  }
}

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});