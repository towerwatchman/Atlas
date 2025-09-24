// src/renderer.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  addGame: (game) => ipcRenderer.invoke('add-game', game),
  getGame: (id) => {
    console.log('Invoking getGame for recordId:', id);
    return ipcRenderer.invoke('get-game', id);
  },
  getGames: (offset, limit) => ipcRenderer.invoke('get-games', { offset, limit }),
  removeGame: (id) => ipcRenderer.invoke('remove-game', id),
  unzipGame: (zipPath, extractPath) => ipcRenderer.invoke('unzip-game', { zipPath, extractPath }),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  checkDbUpdates: () => ipcRenderer.invoke('check-db-updates'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  selectFile: () => {
    console.log('Invoking selectFile');
    return ipcRenderer.invoke('select-file');
  },
  selectDirectory: () => {
    console.log('Invoking selectDirectory');
    return ipcRenderer.invoke('select-directory');
  },
  getVersion: () => ipcRenderer.invoke('get-version'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  openImporter: () => ipcRenderer.invoke('open-importer'),
  getConfig: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  startScan: (params) => ipcRenderer.invoke('start-scan', params),
  searchAtlas: (title, creator) => ipcRenderer.invoke('search-atlas', { title, creator }),
  addAtlasMapping: (recordId, atlasId) => ipcRenderer.invoke('add-atlas-mapping', { recordId, atlasId }),
  findF95Id: (atlasId) => ipcRenderer.invoke('find-f95-id', atlasId),
  getAtlasData: (atlasId) => ipcRenderer.invoke('get-atlas-data', atlasId),
  checkRecordExist: (params) => ipcRenderer.invoke('check-record-exist', params),
  importGames: (params) => ipcRenderer.invoke('import-games', params),
  log: (message) => ipcRenderer.invoke('log', message),
  sendUpdateProgress: (progress) => ipcRenderer.invoke('update-progress', progress),
  getAvailableBannerTemplates: () => ipcRenderer.invoke('get-available-banner-templates'),
  getSelectedBannerTemplate: () => ipcRenderer.invoke('get-selected-banner-template'),
  setSelectedBannerTemplate: (template) => ipcRenderer.invoke('set-selected-banner-template', template),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  saveEmulatorConfig: (config) => ipcRenderer.invoke('save-emulator-config', config),
  getEmulatorConfig: () => ipcRenderer.invoke('get-emulator-config'),
  removeEmulatorConfig: (extension) => ipcRenderer.invoke('remove-emulator-config', extension),
  getPreviews: (recordId) => {
    console.log('Invoking getPreviews for recordId:', recordId);
    return ipcRenderer.invoke('get-previews', recordId);
  },
  updateBanners: (recordId) => {
    console.log('Invoking updateBanners for recordId:', recordId);
    return ipcRenderer.invoke('update-banners', recordId);
  },
  updatePreviews: (recordId) => {
    console.log('Invoking updatePreviews for recordId:', recordId);
    return ipcRenderer.invoke('update-previews', recordId);
  },
  convertAndSaveBanner: (recordId, filePath) => {
    console.log('Invoking convertAndSaveBanner for recordId:', recordId, 'filePath:', filePath);
    return ipcRenderer.invoke('convert-and-save-banner', { recordId, filePath });
  },
  updateGame: (game) => {
    console.log('Invoking updateGame with game data:', game);
    return ipcRenderer.invoke('update-game', game);
  },
  updateVersion: (version) => {
    console.log('Invoking updateVersion with version data:', version);
    return ipcRenderer.invoke('update-version', version);
  },
  onWindowStateChanged: (callback) => {
    ipcRenderer.on('window-state-changed', (event, state) => callback(state));
  },
  onDbUpdateProgress: (callback) => {
    ipcRenderer.on('db-update-progress', (event, progress) => callback(progress));
  },
  deleteBanner: (recordId) => {
    console.log('Invoking deleteBanner for recordId:', recordId);
    return ipcRenderer.invoke('delete-banner', recordId);
  },
  deletePreviews: (recordId) => {
  console.log('Invoking deletePreviews for recordId:', recordId);
  return ipcRenderer.invoke('delete-previews', recordId);
},
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, progress) => callback(progress)),
  onScanComplete: (callback) => ipcRenderer.on('scan-complete', (event, game) => callback(game)),
  onScanCompleteFinal: (callback) => ipcRenderer.on('scan-complete-final', (event, games) => callback(games)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, progress) => callback(progress)),
  onImportProgress: (callback) => ipcRenderer.on('import-progress', (event, progress) => callback(progress)),
  onGameImported: (callback) => ipcRenderer.on('game-imported', callback),
  onGameUpdated: (callback) => ipcRenderer.on('game-updated', callback),
  onImportComplete: (callback) => ipcRenderer.on('import-complete', callback),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('update-status');
  },
  showContextMenu: (template) => ipcRenderer.invoke('show-context-menu', template),
  onContextMenuCommand: (callback) => ipcRenderer.on('context-menu-command', callback),
  onGameData: (callback) => {
    console.log('Registering onGameData listener');
    ipcRenderer.on('send-game-data', (event, game) => {
      console.log('Received send-game-data event in renderer:', game);
      callback(event, game);
    });
  },
  openDirectory: (path) => {
  console.log('Invoking openDirectory for path:', path);
  return ipcRenderer.invoke('open-directory', path);
},
});