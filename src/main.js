const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { startScan } = require('./components/scanners/f95scanner');
const { autoUpdater } = require('electron-updater');
const ini = require('ini');
const { initializeDatabase, addGame, addVersion, addAtlasMapping, getGame, getGames, removeGame, checkDbUpdates, updateFolderSize, getBannerUrl, getScreensUrlList, getEmulatorConfig, removeEmulatorConfig, saveEmulatorConfig } = require('./database');

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

  // Force DevTools open for debugging
  importerWindow.webContents.openDevTools();

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
var launcherDir = "";
if (process.defaultApp) {
  console.log('Running in development');
  dataDir = path.join(__dirname, 'data');
  launcherDir = path.join(__dirname, 'launchers');
} else {
  const resourcesPath = path.resolve(app.getAppPath(), '../../');
  dataDir = path.join(resourcesPath, 'data');
  launcherDir = path.join(resourcesPath, 'launchers');
  console.log(`Running in release`);
}

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(launcherDir)) {
  fs.mkdirSync(launcherDir, { recursive: true });
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
  },
  Performance: {
    maxHeapSize: 4096
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

ipcMain.handle('get-game', async (event, recordId) => {
  return await getGame(recordId, app.getAppPath(), process.defaultApp);
});

ipcMain.handle('get-games', async (event, { offset, limit }) => {
  return await getGames(app.getAppPath(), process.defaultApp, offset, limit);
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
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [], // Allow all file types
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  } catch (err) {
    console.error('Error selecting file:', err);
    return null;
  }
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
  const { checkRecordExist } = require('./database');
  const existsByDetails = await checkRecordExist(title, creator, engine, version);
  if (existsByDetails) return true;
  return checkPathExist(path, title);
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
  const configPath = path.join(__dirname, 'data', 'config.ini');
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
  const configPath = path.join(__dirname, 'data', 'config.ini');
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
  const { games, deleteAfter, scanSize, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos, gameExt } = params;
  const gamesDir = path.join(dataDir, 'games');
  if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });

  const total = games.length;
  let progress = 0;
  mainWindow.webContents.send('import-progress', { text: `Starting import of ${total} games...`, progress, total });

  const results = [];
  // Phase 1: Import all games
  for (const game of games) {
    try {
      mainWindow.webContents.send('import-progress', { 
        text: `Importing game '${game.title}' ${progress + 1}/${total}`, 
        progress, 
        total 
      });

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
          game.executables = execs.map(e => ({ key: e, value: e }));
          game.selectedValue = selected;
        }
      }

      if (scanSize) {
        size = getFolderSize(gamePath);
      }

      const add = {
        title: game.title,
        creator: game.creator,
        engine: game.engine,
        description: game.description || 'Imported game'
      };

      console.log('Adding Game');
      const recordId = await addGame(add);
      console.log('game added');
      console.log('adding version');
      await addVersion({ ...game, folder: gamePath, execPath, folderSize: size }, recordId);
      console.log('added version');
      console.log('adding mapping');
      console.log('recordId:', recordId, 'atlasId:', game.atlasId);
      if (game.atlasId) {
        try {
          await addAtlasMapping(recordId, game.atlasId);
          console.log('mapping added');
        } catch (err) {
          console.error('Failed to add atlas mapping:', err);
          throw err;
        }
      }

      if (size > 0) await updateFolderSize(recordId, game.version, size);
      results.push({ success: true, recordId, atlasId: game.atlasId });

      progress++;
      mainWindow.webContents.send('import-progress', { 
        text: `Imported game '${game.title}' ${progress}/${total}`, 
        progress, 
        total 
      });
      //mainWindow.webContents.send('game-imported', recordId);
    } catch (err) {
      console.error('Error importing game:', err);
      results.push({ success: false, error: err.message });
      progress++;
      mainWindow.webContents.send('import-progress', { 
        text: `Error importing game '${game.title}' ${progress}/${total}: ${err.message}`, 
        progress, 
        total 
      });
    }
  }

  mainWindow.webContents.send('import-progress', { 
    text: `Game import complete: ${results.filter(r => r.success).length} successful`, 
    progress, 
    total 
  });
  mainWindow.webContents.send('import-complete');

  // Phase 2: Download images for successful imports
  if (downloadBannerImages || downloadPreviewImages) {
    progress = 0;
    const gamesWithImages = results
      .filter(r => r.success && r.atlasId)
      .map(r => ({
        title: games.find(g => g.atlasId === r.atlasId)?.title || 'Unknown Game',
        atlasId: r.atlasId,
        recordId: r.recordId
      }));
    const imageTotal = gamesWithImages.length;

    mainWindow.webContents.send('import-progress', { 
      text: `Starting image download for ${imageTotal} games...`, 
      progress, 
      total: imageTotal 
    });

    for (const game of gamesWithImages) {
      try {
        const bannerUrl = await getBannerUrl(game.atlasId);
        const screenUrls = await getScreensUrlList(game.atlasId);
        const previewCount = downloadPreviewImages ? (previewLimit === 'Unlimited' ? screenUrls.length : Math.min(parseInt(previewLimit), screenUrls.length)) : 0;
        const totalImages = (downloadBannerImages && bannerUrl ? 3 : 0) + previewCount;

        mainWindow.webContents.send('import-progress', { 
          text: `Downloading images for '${game.title}' ${progress + 1}/${imageTotal}, 0/${totalImages}`, 
          progress, 
          total: imageTotal 
        });

        await downloadImagesFunc(game.recordId, game.atlasId, (current, totalImages) => {
          mainWindow.webContents.send('import-progress', { 
            text: `Downloading images for '${game.title}' ${progress + 1}/${imageTotal}, ${current}/${totalImages}`, 
            progress, 
            total: imageTotal 
          });
        }, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos);

        mainWindow.webContents.send('game-updated', game.recordId);

        progress++;
        mainWindow.webContents.send('import-progress', { 
          text: `Completed image download for '${game.title}' ${progress}/${imageTotal}, ${totalImages} images downloaded`, 
          progress, 
          total: imageTotal 
        });
      } catch (err) {
        console.error('Error downloading images for game:', err);
        progress++;
        mainWindow.webContents.send('import-progress', { 
          text: `Error downloading images for '${game.title}' ${progress}/${imageTotal}: ${err.message}`, 
          progress, 
          total: imageTotal 
        });
      }
    }

    mainWindow.webContents.send('import-progress', { 
      text: `Image download complete for ${progress} games`, 
      progress, 
      total: imageTotal 
    });
  }

  // Reload the UI to show all games
  mainWindow.webContents.send('import-complete');
  return results;
});

ipcMain.handle('save-emulator-config', async (event, emulator) => {
  try {
    await initializeDatabase(dataDir); // Ensure DB is initialized
    await saveEmulatorConfig(emulator);
    return { success: true };
  } catch (err) {
    console.error('Error saving emulator config:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-emulator-config', async () => {
  try {
    await initializeDatabase(dataDir); // Ensure DB is initialized
    return await getEmulatorConfig();
  } catch (err) {
    console.error('Error fetching emulator config:', err);
    return [];
  }
});

ipcMain.handle('remove-emulator-config', async (event, extension) => {
  try {
    await initializeDatabase(dataDir); // Ensure DB is initialized
    await removeEmulatorConfig(extension);
    return { success: true };
  } catch (err) {
    console.error('Error removing emulator config:', err);
    return { success: false, error: err.message };
  }
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
      const baseName = path.basename('banner', ext);
      const imagePath = path.join(imgDir, baseName);
      const relativePath = path.join('data', 'images', recordId.toString(), baseName);

      let imageBytes;
      let downloaded = false;
      if (['.gif', '.mp4', '.webm'].includes(ext) && downloadVideos) {
        const animatedPath = `${imagePath}${ext}`;
        if (!fs.existsSync(animatedPath)) {
          const response = await axios.get(bannerUrl, { responseType: 'arraybuffer' });
          imageBytes = Buffer.from(response.data);
          fs.writeFileSync(animatedPath, imageBytes);
          await updateBanners(recordId, `${relativePath}${ext}`, 'banner');
          downloaded = true;
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
          downloaded = true;
        }
        await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 1260, withoutEnlargement: true }).toFile(highResPath);
        await updateBanners(recordId, `${relativePath}_mc.webp`, 'banner');
        downloaded = true;
      }
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      if (!fs.existsSync(lowResPath)) {
        if (!imageBytes) {
          const response = await axios.get(bannerUrl, { responseType: 'arraybuffer' });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 600, withoutEnlargement: true }).toFile(lowResPath);
        await updateBanners(recordId, `${relativePath}_sc.webp`, 'banner');
        downloaded = true;
      }
      imageProgress++;
      onImageProgress(imageProgress, totalImages);

      console.log('Banner images updated');
      if (downloaded) {
        mainWindow.webContents.send('game-updated', recordId);
        await delay(500); // Enforce 2 requests per second
      }
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
        const baseName = path.basename(url, ext);
        const imagePath = path.join(imgDir, baseName);
        const relativePath = path.join('data', 'images', recordId.toString(), baseName);

        const targetPath = (['.gif', '.mp4', '.webm'].includes(ext) && downloadVideos) ? `${imagePath}${ext}` : `${imagePath}_pr.webp`;
        let downloaded = false;
        if (!fs.existsSync(targetPath)) {
          const response = await axios.get(url, { responseType: 'arraybuffer' });
          const imageBytes = Buffer.from(response.data);

          if (['.gif', '.mp4', '.webm'].includes(ext) && downloadVideos) {
            fs.writeFileSync(targetPath, imageBytes);
            await updatePreviews(recordId, `${relativePath}${ext}`);
          } else if (!['.gif', '.mp4', '.webm'].includes(ext)) {
            await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 1260, withoutEnlargement: true }).toFile(targetPath);
            await updatePreviews(recordId, `${relativePath}_pr.webp`);
          }
          downloaded = true;
        }
        imageProgress++;
        onImageProgress(imageProgress, totalImages);
        console.log(`Screen ${i + 1} updated`);
        if (downloaded) {
          // We do not need to update the record. Only update for banner images
          await delay(500); // Enforce 2 requests per second
        }
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