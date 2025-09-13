const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  addGame: (game) => ipcRenderer.invoke('add-game', game),
  getGames: () => ipcRenderer.invoke('get-games'),
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
  checkRecordExist: (params) => ipcRenderer.invoke('check-record-exist', params),
  importGames: (params) => ipcRenderer.invoke('import-games', params),
  onWindowStateChanged: (callback) => {
    ipcRenderer.on('window-state-changed', (event, state) => callback(state));
  },
  onDbUpdateProgress: (callback) => {
    ipcRenderer.on('db-update-progress', (event, progress) => callback(progress));
  },
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, progress) => callback(progress)),
  onScanComplete: (callback) => ipcRenderer.on('scan-complete', (event, games) => callback(games)),
  onImportProgress: (callback) => ipcRenderer.on('import-progress', (event, progress) => callback(progress)),
  onGameImported: (callback) => ipcRenderer.on('game-imported', callback),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('update-status');
  }
});