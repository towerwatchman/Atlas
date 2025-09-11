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
  getConfig: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  onWindowStateChanged: (callback) => {
    ipcRenderer.on('window-state-changed', (event, state) => callback(state));
  },
  onDbUpdateProgress: (callback) => {
    ipcRenderer.on('db-update-progress', (event, progress) => callback(progress));
  },
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('update-status');
  }
});