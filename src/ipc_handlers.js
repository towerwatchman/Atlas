// src/ipc_handlers.js
const { BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const axios = require('axios');
const { initializeDatabase, addGame, addVersion, addAtlasMapping, getGame, getGames, removeGame, checkDbUpdates, updateFolderSize, getBannerUrl, getScreensUrlList, getEmulatorConfig, removeEmulatorConfig, saveEmulatorConfig } = require('./database');
const { startScan } = require('./components/scanners/f95scanner');
const { getFolderSize, findExecutables, downloadImages, launchGame, processTemplate, handleContextAction } = require('./utils');
const AdmZip = require('adm-zip');
const Seven = require('node-7z');
const Unrar = require('unrar');

let mainWindow;
let settingsWindow;
let importerWindow;
const contextMenuData = new Map();
let contextMenuId = 0;

function registerIpcHandlers(app, mainWindowInstance) {
  mainWindow = mainWindowInstance;

  ipcMain.handle('add-game', async (event, game) => {
    await initializeDatabase(path.join(app.getAppPath(), 'data'));
    return addGame(game);
  });

  ipcMain.handle('get-game', async (event, recordId) => {
    await initializeDatabase(path.join(app.getAppPath(), 'data'));
    return await getGame(recordId, app.getAppPath(), process.argv.includes('--dev'));
  });

  ipcMain.handle('get-games', async (event, { offset, limit }) => {
    await initializeDatabase(path.join(app.getAppPath(), 'data'));
    return await getGames(app.getAppPath(), process.argv.includes('--dev'), offset, limit);
  });

  ipcMain.handle('remove-game', async (event, record_id) => {
    await initializeDatabase(path.join(app.getAppPath(), 'data'));
    return removeGame(record_id);
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

  ipcMain.handle('check-db-updates', async () => {
    await initializeDatabase(path.join(app.getAppPath(), 'data'));
    return checkDbUpdates(path.join(app.getAppPath(), 'data', 'updates'), mainWindow);
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
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    } catch (err) {
      console.error('Error selecting file:', err);
      return null;
    }
  });

  ipcMain.handle('select-directory', async () => {
    try {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (result.canceled) return null;
      return result.filePaths[0];
    } catch (err) {
      console.error('Error selecting directory:', err);
      return null;
    }
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
      await fs.writeFile(path.join(app.getAppPath(), 'data', 'config.ini'), ini.stringify(settings));
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
      return await searchAtlas(title, creator);
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
    await initializeDatabase(path.join(app.getAppPath(), 'data'));
    const { checkRecordExist } = require('./database');
    const existsByDetails = await checkRecordExist(title, creator, engine, version);
    if (existsByDetails) return true;
    return false;
  });

  ipcMain.handle('import-games', async (event, params) => {
    await initializeDatabase(path.join(app.getAppPath(), 'data'));
    const { games, deleteAfter, scanSize, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos, gameExt } = params;
    const gamesDir = path.join(app.getAppPath(), 'data', 'games');
    if (!(await fs.access(gamesDir).then(() => true).catch(() => false))) await fs.mkdir(gamesDir, { recursive: true });

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
          if (!(await fs.access(extractPath).then(() => true).catch(() => false))) await fs.mkdir(extractPath, { recursive: true });
          await ipcMain.handle('unzip-game')({}, { zipPath: game.folder, extractPath });
          if (deleteAfter) await fs.unlink(game.folder);
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
        mainWindow.webContents.send('game-imported', recordId);
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
          await downloadImages(game.recordId, game.atlasId, (current, totalImages) => {
            mainWindow.webContents.send('import-progress', { 
              text: `Downloading images for '${game.title}' ${progress + 1}/${imageTotal}, ${current}/${totalImages}`, 
              progress, 
              total: imageTotal 
            });
          }, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos);

          mainWindow.webContents.send('game-updated', game.recordId);

          progress++;
          mainWindow.webContents.send('import-progress', { 
            text: `Completed image download for '${game.title}' ${progress}/${imageTotal}`, 
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

    mainWindow.webContents.send('import-complete');
    return results;
  });

  ipcMain.handle('save-emulator-config', async (event, emulator) => {
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      await saveEmulatorConfig(emulator);
      return { success: true };
    } catch (err) {
      console.error('Error saving emulator config:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-emulator-config', async () => {
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      return await getEmulatorConfig();
    } catch (err) {
      console.error('Error fetching emulator config:', err);
      return [];
    }
  });

  ipcMain.handle('remove-emulator-config', async (event, extension) => {
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      await removeEmulatorConfig(extension);
      return { success: true };
    } catch (err) {
      console.error('Error removing emulator config:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('show-context-menu', (event, template) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      console.error('No sender window found for context menu');
      return;
    }

    const processedTemplate = processTemplate(template, event.sender);
    console.log('Processed context menu template:', JSON.stringify(processedTemplate, null, 2));
    const menu = Menu.buildFromTemplate(processedTemplate);
    menu.popup({ window: senderWindow });
  });

  ipcMain.handle('get-screens-url-list', async (event, recordId) => {
    console.log('Handling get-screens-url-list for recordId:', recordId);
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      const previews = await getPreviewsFromDatabase(recordId); // Placeholder
      return previews || [];
    } catch (err) {
      console.error('Error fetching preview URLs:', err);
      return [];
    }
  });

  ipcMain.handle('update-banners', async (event, recordId) => {
    console.log('Handling update-banners for recordId:', recordId);
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      const bannerUrl = await downloadBanner(recordId); // Placeholder
      mainWindow.webContents.send('game-updated', recordId); // Notify App.jsx
      return bannerUrl;
    } catch (err) {
      console.error('Error downloading banner:', err);
      throw err;
    }
  });

  ipcMain.handle('update-previews', async (event, recordId) => {
    console.log('Handling update-previews for recordId:', recordId);
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      const previewUrls = await downloadPreviews(recordId); // Placeholder
      mainWindow.webContents.send('game-updated', recordId); // Notify App.jsx
      return previewUrls;
    } catch (err) {
      console.error('Error downloading previews:', err);
      throw err;
    }
  });

  ipcMain.handle('convert-and-save-banner', async (event, { recordId, filePath }) => {
    console.log('Handling convert-and-save-banner for recordId:', recordId, 'filePath:', filePath);
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      const outputPath = path.join(app.getAppPath(), 'data', 'images', `${recordId}`, 'banner_sc.webp');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await sharp(filePath)
        .webp({ quality: 80 })
        .toFile(outputPath);
      console.log('Banner converted and saved:', outputPath);
      mainWindow.webContents.send('game-updated', recordId); // Notify App.jsx
      return `file://${outputPath}`;
    } catch (err) {
      console.error('Error converting and saving banner:', err);
      throw err;
    }
  });

  ipcMain.handle('update-game', async (event, game) => {
    console.log('Handling update-game:', game);
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      await updateGameInDatabase(game); // Placeholder
      mainWindow.webContents.send('game-updated', game.record_id); // Notify App.jsx
      console.log('Game updated in database');
    } catch (err) {
      console.error('Error updating game:', err);
      throw err;
    }
  });

  ipcMain.handle('update-version', async (event, version) => {
    console.log('Handling update-version:', version);
    try {
      await initializeDatabase(path.join(app.getAppPath(), 'data'));
      await updateVersionInDatabase(version); // Placeholder
      mainWindow.webContents.send('game-updated', version.recordId); // Notify App.jsx
      console.log('Version updated in database');
    } catch (err) {
      console.error('Error updating version:', err);
      throw err;
    }
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

// GAME DETAILS WINDOW
function createGameDetailsWindow(recordId) {
  const gameDetailsWindow = new BrowserWindow({
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

  gameDetailsWindow.loadFile(path.join(__dirname, 'gamedetails.html'));

  gameDetailsWindow.webContents.on('did-finish-load', () => {
    console.log('Fetching game data for recordId:', recordId);
    getGame(recordId, app.getAppPath(), process.argv.includes('--dev')).then(game => {
      console.log('Sending game data:', game);
      setTimeout(() => {
        gameDetailsWindow.webContents.send('send-game-data', game);
      }, 200);
    }).catch(err => {
      console.error('Failed to fetch game data:', err);
      gameDetailsWindow.webContents.send('send-game-data', null);
    });
  });

  if (process.argv.includes('--dev') || appConfig?.Interface?.showDebugConsole) {
    gameDetailsWindow.webContents.openDevTools();
  }

  gameDetailsWindow.on('maximize', () => {
    gameDetailsWindow.webContents.send('window-state-changed', 'maximized');
  });
  gameDetailsWindow.on('unmaximize', () => {
    gameDetailsWindow.webContents.send('window-state-changed', 'restored');
  });

  gameDetailsWindow.on('closed', () => {
    // gameDetailsWindow = null; // Keep commented to match original
  });
}

module.exports = {
  registerIpcHandlers,
  createSettingsWindow,
  createImporterWindow,
  createGameDetailsWindow
};