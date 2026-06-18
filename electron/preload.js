// src/renderer.js
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isWindows: () => process.platform === "win32",
  isLinux: () => process.platform === "linux",
  // optional
  getDefault7zPaths: () => {
    if (process.platform === "win32") {
      return [
        "C:\\Program Files\\7-Zip\\7z.exe",
        "C:\\Program Files (x86)\\7-Zip\\7z.exe",
      ];
    } else if (process.platform === "linux") {
      return ["/usr/bin/7z", "/usr/bin/7zz", "/usr/local/bin/7z"];
    }
    return [];
  },
  addGame: (game) => ipcRenderer.invoke("add-game", game),
  getGame: (id) => {
    console.log("Invoking getGame for recordId:", id);
    return ipcRenderer.invoke("get-game", id);
  },
  getGames: (offset, limit, options) => {
    if (offset && typeof offset === "object") {
      return ipcRenderer.invoke("get-games", offset);
    }
    return ipcRenderer.invoke("get-games", { offset, limit, options });
  },
  getCatalogGames: () => ipcRenderer.invoke("get-catalog-games"),
  addWishlistEntry: (entry) => ipcRenderer.invoke("wishlist-add", entry),
  removeWishlistEntry: (identity) =>
    ipcRenderer.invoke("wishlist-remove", identity),
  toggleWishlistEntry: (entry) => ipcRenderer.invoke("wishlist-toggle", entry),
  getWishlistEntries: () => ipcRenderer.invoke("wishlist-list"),
  getWishlistEntryIdentities: () => ipcRenderer.invoke("wishlist-identities"),
  validateLibraryPaths: () => ipcRenderer.invoke("validate-library-paths"),
  removeGame: (id) => ipcRenderer.invoke("remove-game", id),
  checkUpdates: () => ipcRenderer.invoke("check-updates"),
  checkAppUpdate: () => ipcRenderer.invoke("check-app-update"),
  getAppUpdateState: () => ipcRenderer.invoke("get-app-update-state"),
  downloadAppUpdate: () => ipcRenderer.invoke("download-app-update"),
  downloadAndInstallAppUpdate: () =>
    ipcRenderer.invoke("download-and-install-app-update"),
  installAppUpdate: () => ipcRenderer.invoke("install-app-update"),
  checkDbUpdates: () => ipcRenderer.invoke("check-db-updates"),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  maximizeWindow: () => ipcRenderer.invoke("maximize-window"),
  closeWindow: () => {
    console.log("Invoking closeWindow");
    return ipcRenderer.invoke("close-window");
  },
  selectFile: () => {
    console.log("Invoking selectFile");
    return ipcRenderer.invoke("select-file");
  },
  selectDirectory: () => {
    console.log("Invoking selectDirectory");
    return ipcRenderer.invoke("select-directory");
  },
  getVersion: () => ipcRenderer.invoke("get-version"),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  openImporter: (source) => {
    console.log(`Invoking openImporter with source: ${source}`);
    return ipcRenderer.invoke("open-importer", source);
  },
  onImportSource: (callback) => {
    console.log("Registering onImportSource listener");
    ipcRenderer.on("import-source", (event, source) => callback(source));
  },
  getConfig: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  getSavedFilters: () => ipcRenderer.invoke("get-saved-filters"),
  saveSavedFilter: (filter) => ipcRenderer.invoke("save-saved-filter", filter),
  deleteSavedFilter: (id) => ipcRenderer.invoke("delete-saved-filter", id),
  startScan: (params) => ipcRenderer.invoke("start-scan", params),
  cancelScan: () => ipcRenderer.invoke("cancel-scan"),
  searchAtlasByF95Id: (f95Id) =>
    ipcRenderer.invoke("search-atlas-by-f95-id", f95Id),
  searchAtlas: (title, creator) =>
    ipcRenderer.invoke("search-atlas", { title, creator }),
  addAtlasMapping: (recordId, atlasId) =>
    ipcRenderer.invoke("add-atlas-mapping", { recordId, atlasId }),
  findF95Id: (atlasId) => ipcRenderer.invoke("find-f95-id", atlasId),
  getAtlasData: (atlasId) => ipcRenderer.invoke("get-atlas-data", atlasId),
  checkRecordExist: (params) =>
    ipcRenderer.invoke("check-record-exist", params),
  getImportRecordStatus: (game) =>
    ipcRenderer.invoke("get-import-record-status", game),
  getReplaceVersionOptions: (params) =>
    ipcRenderer.invoke("get-replace-version-options", params),
  resolveImportMatches: (games) =>
    ipcRenderer.invoke("resolve-import-matches", games),
  importGames: (params) => ipcRenderer.invoke("import-games", params),
  scanRenpySaves: (params) => ipcRenderer.invoke("scan-renpy-saves", params),
  selectRenpySaveDirectory: () =>
    ipcRenderer.invoke("select-renpy-save-directory"),
  importRenpySaveGames: (games) =>
    ipcRenderer.invoke("import-renpy-save-games", games),
  selectCatalogImportSource: () =>
    ipcRenderer.invoke("select-catalog-import-source"),
  importCatalogEntry: (params) => ipcRenderer.invoke("import-catalog-entry", params),
  importLocalGameVersion: (params) =>
    ipcRenderer.invoke("import-local-game-version", params),
  getDroppedFilePath: (file) => {
    const webUtilsPath = webUtils?.getPathForFile?.(file) || "";
    const fallbackPath = file?.path || "";
    const resolvedPath = webUtilsPath || fallbackPath || "";
    console.log("Dropped file path diagnostics", {
      name: file?.name || "",
      type: file?.type || "",
      extension: file?.name?.includes(".") ? file.name.split(".").pop() : "",
      webUtilsReturnedPath: Boolean(webUtilsPath),
      fallbackPathExisted: Boolean(fallbackPath),
      resolvedPath: Boolean(resolvedPath),
    });
    return resolvedPath;
  },
  cancelImport: () => ipcRenderer.invoke("cancel-import"),
  log: (message) => ipcRenderer.invoke("log", message),
  sendUpdateProgress: (progress) =>
    ipcRenderer.invoke("update-progress", progress),
  getAvailableBannerTemplates: () =>
    ipcRenderer.invoke("get-available-banner-templates"),
  getAvailableThemes: () => ipcRenderer.invoke("get-available-themes"),
  saveTheme: (theme, options) => ipcRenderer.invoke("save-theme", theme, options),

  // ─── FIXED: Added missing banner template getter ────────────────────────
  getSelectedBannerTemplate: () =>
    ipcRenderer.invoke("get-selected-banner-template"),

  setSelectedBannerTemplate: (template) =>
    ipcRenderer.invoke("set-selected-banner-template", template),

  // ─── FIXED: Added missing external URL opener for Update Available button ──
  openExternalUrl: (url) => ipcRenderer.invoke("open-external-url", url),
  launchGame: (data) => ipcRenderer.invoke("launch-game", data),
  openGameFolder: (data) => ipcRenderer.invoke("open-game-folder", data),
  openGameImageFolder: (recordId) =>
    ipcRenderer.invoke("open-game-image-folder", recordId),
  openGameProperties: (recordId) =>
    ipcRenderer.invoke("open-game-properties", recordId),

  saveEmulatorConfig: (config) =>
    ipcRenderer.invoke("save-emulator-config", config),
  getEmulatorConfig: () => ipcRenderer.invoke("get-emulator-config"),
  removeEmulatorConfig: (extension) =>
    ipcRenderer.invoke("remove-emulator-config", extension),
  getPreviews: (recordId) => {
    console.log("Invoking getPreviews for recordId:", recordId);
    return ipcRenderer.invoke("get-previews", recordId);
  },
  getBrowsePreviewUrls: (record) =>
    ipcRenderer.invoke("get-browse-preview-urls", record),
  updateBanners: (recordId) => {
    console.log("Invoking updateBanners for recordId:", recordId);
    return ipcRenderer.invoke("update-banners", recordId);
  },
  updatePreviews: (recordId) => {
    console.log("Invoking updatePreviews for recordId:", recordId);
    return ipcRenderer.invoke("update-previews", recordId);
  },
  refreshGameMedia: (recordId) => {
    console.log("Invoking refreshGameMedia for recordId:", recordId);
    return ipcRenderer.invoke("refresh-game-media", recordId);
  },
  convertAndSaveBanner: (recordId, filePath) => {
    console.log(
      "Invoking convertAndSaveBanner for recordId:",
      recordId,
      "filePath:",
      filePath,
    );
    return ipcRenderer.invoke("convert-and-save-banner", {
      recordId,
      filePath,
    });
  },
  updateGame: (game) => {
    console.log("Invoking updateGame with game data:", game);
    return ipcRenderer.invoke("update-game", game);
  },
  updateVersion: (version, record_id) => {
    console.log("Invoking updateVersion with version data:", version);
    return ipcRenderer.invoke("update-version", version, record_id);
  },
  recalculateVersionSize: (params) =>
    ipcRenderer.invoke("recalculate-version-size", params),
  onWindowStateChanged: (callback) => {
    ipcRenderer.on("window-state-changed", (event, state) => callback(state));
  },
  onAppearanceChanged: (callback) => {
    ipcRenderer.on("appearance-changed", (event, appearance) => callback(appearance));
    return () => ipcRenderer.removeAllListeners("appearance-changed");
  },
  // Theme Builder live preview — see electron/ipc/themes.js. Sent only
  // while a Theme Builder window is open, to every OTHER window, as the
  // person edits the draft theme; 'ended' fires once when that window
  // closes (however it closes), telling receivers to drop the draft and
  // go back to whatever theme is actually persisted (e.g. by re-applying
  // their own current theme/layout state, already held in ThemeProvider).
  onThemePreviewChanged: (callback) => {
    ipcRenderer.on("theme-preview-changed", (event, draftTheme) => callback(draftTheme));
    return () => ipcRenderer.removeAllListeners("theme-preview-changed");
  },
  onThemePreviewEnded: (callback) => {
    ipcRenderer.on("theme-preview-ended", () => callback());
    return () => ipcRenderer.removeAllListeners("theme-preview-ended");
  },
  openThemeBuilder: () => ipcRenderer.invoke("open-theme-builder"),
  broadcastThemePreview: (draftTheme) => ipcRenderer.invoke("broadcast-theme-preview", draftTheme),
  onMetadataChanged: (callback) => {
    ipcRenderer.on("metadata-changed", (event, metadata) => callback(metadata));
    return () => ipcRenderer.removeAllListeners("metadata-changed");
  },
  onDbUpdateProgress: (callback) => {
    ipcRenderer.on("db-update-progress", (event, progress) =>
      callback(progress),
    );
  },
  deleteBanner: (recordId) => {
    console.log("Invoking deleteBanner for recordId:", recordId);
    return ipcRenderer.invoke("delete-banner", recordId);
  },
  deletePreviews: (recordId) => {
    console.log("Invoking deletePreviews for recordId:", recordId);
    return ipcRenderer.invoke("delete-previews", recordId);
  },
  onScanProgress: (callback) =>
    ipcRenderer.on("scan-progress", (event, progress) => callback(progress)),
  onScanComplete: (callback) =>
    ipcRenderer.on("scan-complete", (event, game) => callback(game)),
  onScanCompleteFinal: (callback) =>
    ipcRenderer.on("scan-complete-final", (event, games) => callback(games)),
  onUpdateProgress: (callback) =>
    ipcRenderer.on("update-progress", (event, progress) => callback(progress)),
  onImportProgress: (callback) =>
    ipcRenderer.on("import-progress", (event, progress) => callback(progress)),
  onGameImported: (callback) => ipcRenderer.on("game-imported", callback),
  onGameUpdated: (callback) => ipcRenderer.on("game-updated", callback),
  onImportComplete: (callback) => ipcRenderer.on("import-complete", callback),
  onLibraryValidationProgress: (callback) =>
    ipcRenderer.on("library-validation-progress", (event, progress) =>
      callback(progress),
    ),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (event, status) => callback(status));
    return () => ipcRenderer.removeAllListeners("update-status");
  },
  removeUpdateStatusListener: () =>
    ipcRenderer.removeAllListeners("update-status"),
  removeAllListeners: (channel) => {
    const allowedChannels = new Set([
      "window-state-changed",
      "db-update-progress",
      "scan-progress",
      "scan-complete",
      "scan-complete-final",
      "update-progress",
      "import-progress",
      "game-imported",
      "game-updated",
      "import-complete",
      "update-status",
      "appearance-changed",
      "metadata-changed",
      "context-menu-command",
      "game-deleted",
      "library-validation-progress",
    ]);

    if (allowedChannels.has(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  showContextMenu: (template) =>
    ipcRenderer.invoke("show-context-menu", template),
  onContextMenuCommand: (callback) =>
    ipcRenderer.on("context-menu-command", callback),
  onGameData: (callback) => {
    console.log("Registering onGameData listener");
    ipcRenderer.on("send-game-data", (event, game) => {
      console.log("Received send-game-data event in renderer:", game);
      callback(event, game);
    });
  },
  requestGameData: () => ipcRenderer.invoke("request-game-data"),
  openDirectory: (path) => {
    console.log("Invoking openDirectory for path:", path);
    return ipcRenderer.invoke("open-directory", path);
  },
  onGameDetailsImportProgress: (callback) => {
    console.log("Registering game-details-import-progress listener");
    ipcRenderer.on("game-details-import-progress", (event, progress) =>
      callback(progress),
    );
  },
  removeGameDetailsImportProgressListener: (callback) => {
    console.log("Removing game-details-import-progress listener");
    ipcRenderer.removeListener("game-details-import-progress", callback);
  },
  startSteamScan: (params) => ipcRenderer.invoke("start-steam-scan", params),
  selectSteamDirectory: () => {
    console.log("Invoking selectSteamDirectory");
    return ipcRenderer.invoke("select-steam-directory");
  },
  onPromptSteamDirectory: (callback) => {
    console.log("Registering onPromptSteamDirectory listener");
    ipcRenderer.on("prompt-steam-directory", (event) => callback());
  },
  openSteamImportWindow: () => {
    console.log("Invoking openSteamImportWindow");
    return ipcRenderer.invoke("open-steam-import-window");
  },
  getSteamGameData: (steamId) =>
    ipcRenderer.invoke("get-steam-game-data", steamId),

  // ────────────────────────────────────────────────────────────────
  //     METHODS FOR MOVE-TO-LIBRARY FEATURE (already added)
  // ────────────────────────────────────────────────────────────────
  getDefaultGameFolder: () => ipcRenderer.invoke("get-default-game-folder"),
  setDefaultGameFolder: (newPath) =>
    ipcRenderer.invoke("set-default-game-folder", newPath),
  moveFolderToLibrary: (args) =>
    ipcRenderer.invoke("move-folder-to-library", args),

  // Optional: better feedback during long imports/moves
  onImportWarning: (callback) =>
    ipcRenderer.on("import-warning", (event, data) => callback(data)),

  // ────────────────────────────────────────────────────────────────
  //     METHODS TO REMOVE
  // ────────────────────────────────────────────────────────────────
  countVersions: (recordId) => ipcRenderer.invoke("count-versions", recordId),
  deleteVersion: (params) => ipcRenderer.invoke("delete-version", params),
  deleteGameCompletely: (recordId) =>
    ipcRenderer.invoke("delete-game-completely", recordId),
  deleteTitle: (params) => ipcRenderer.invoke("delete-title", params),
  deleteFolderRecursive: (params) =>
    ipcRenderer.invoke("delete-folder-recursive", params),
  onGameDeleted: (callback) => {
    ipcRenderer.on("game-deleted", (event, recordId) => callback(recordId));
  },
  getUniqueFilterOptions: () => ipcRenderer.invoke("get-unique-filter-options"),
});

contextBridge.exposeInMainWorld("electronIPC", {
  on: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  },
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  // If needed: invoke, etc.
});
