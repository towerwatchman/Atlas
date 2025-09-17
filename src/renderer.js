const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  addGame: (game) => ipcRenderer.invoke('add-game', game),
  getGame: (id) => ipcRenderer.invoke('get-game', id),
  getGames: (offset, limit) => ipcRenderer.invoke('get-games', { offset, limit }),
  removeGame: (id) => ipcRenderer.invoke('remove-game', id),
  unzipGame: (zipPath, extractPath) => ipcRenderer.invoke('unzip-game', { zipPath, extractPath }),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  checkDbUpdates: () => ipcRenderer.invoke('check-db-updates'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  openImporter: () => ipcRenderer.invoke('open-importer'),
  getConfig: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  startScan: (params) => ipcRenderer.invoke('start-scan', params),
  searchAtlas: (title, creator) => ipcRenderer.invoke('search-atlas', { title, creator }),
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
  onWindowStateChanged: (callback) => {
    ipcRenderer.on('window-state-changed', (event, state) => callback(state));
  },
  onDbUpdateProgress: (callback) => {
    ipcRenderer.on('db-update-progress', (event, progress) => callback(progress));
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
  }
});