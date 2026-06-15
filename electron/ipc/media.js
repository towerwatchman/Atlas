'use strict'

const { ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

module.exports = function registerMediaHandlers(ctx) {
  const {
    getAssetBasePath, getMediaStorageMode, templatesDir,
    getPreviews, getBanner, deleteBanner, deletePreviews,
    updateBanners, updatePreviews, getBannerUrl, getScreensUrlList,
    appConfig, configPath,
  } = ctx

  ipcMain.handle('get-available-banner-templates', async () => {
    try {
      const builtIn = ['Default']
      if (!fs.existsSync(templatesDir)) return builtIn
      const files = fs.readdirSync(templatesDir)
        .filter(f => f.endsWith('.js'))
        .map(f => path.basename(f, '.js'))
      return [...builtIn, ...files]
    } catch (err) {
      console.error('get-available-banner-templates error:', err)
      return ['Default']
    }
  })

  ipcMain.handle('get-selected-banner-template', async () => {
    try {
      return appConfig?.Appearance?.bannerTemplate || 'Default'
    } catch (err) {
      return 'Default'
    }
  })

  ipcMain.handle('set-selected-banner-template', async (event, template) => {
    try {
      const ini = require('ini')
      const newConfig = {
        ...appConfig,
        Appearance: { ...appConfig.Appearance, bannerTemplate: template },
      }
      fs.writeFileSync(configPath, ini.stringify(newConfig))
      ctx.appConfig = newConfig
      return { success: true }
    } catch (err) {
      console.error('set-selected-banner-template error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-previews', async (event, recordId) => {
    return await getPreviews(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode())
  })

  ipcMain.handle('update-banners', async (event, recordId) => {
    return await updateBanners(recordId, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('update-previews', async (event, recordId) => {
    return await updatePreviews(recordId, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('refresh-game-media', async (event, recordId) => {
    try {
      await updateBanners(recordId, getAssetBasePath(), process.defaultApp)
      await updatePreviews(recordId, getAssetBasePath(), process.defaultApp)
      return { success: true }
    } catch (err) {
      console.error('refresh-game-media error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('delete-banner', async (event, recordId) => {
    return await deleteBanner(recordId, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('delete-previews', async (event, recordId) => {
    return await deletePreviews(recordId, getAssetBasePath(), process.defaultApp)
  })


ipcMain.handle(
  "convert-and-save-banner",
  async (event, { recordId, filePath }) => {
    console.log(
      "Handling convert-and-save-banner for recordId:",
      recordId,
      "filePath:",
      filePath,
    );
    try {
      if (!recordId) {
        throw new Error("Missing recordId");
      }

      if (!filePath || typeof filePath !== "string") {
        throw new Error("No banner file selected");
      }

      const sourcePath = path.resolve(filePath);
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Selected banner does not exist: ${sourcePath}`);
      }

      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile()) {
        throw new Error("Selected banner path is not a file");
      }

      const imageDir = path.join(dataDir, "images", String(recordId));
      await fs.promises.mkdir(imageDir, { recursive: true });

      const customBaseName = buildBannerBaseName("custom");
      const relativeBasePath = path.join(
        "data",
        "images",
        String(recordId),
        customBaseName,
      );
      const mediumPath = path.join(imageDir, `${customBaseName}_mc.webp`);
      const smallPath = path.join(imageDir, `${customBaseName}_sc.webp`);

      const normalizedSource = path.resolve(sourcePath).toLowerCase();
      const normalizedMedium = path.resolve(mediumPath).toLowerCase();
      const normalizedSmall = path.resolve(smallPath).toLowerCase();
      if (
        normalizedSource === normalizedMedium ||
        normalizedSource === normalizedSmall
      ) {
        throw new Error(
          "Selected banner is already the saved Atlas banner. Choose a different source file.",
        );
      }

      const imageBytes = await fs.promises.readFile(sourcePath);
      await sharp(imageBytes)
        .webp({ quality: 90 })
        .resize({ width: 1260, withoutEnlargement: true })
        .toFile(mediumPath);

      await sharp(imageBytes)
        .webp({ quality: 90 })
        .resize({ width: 600, withoutEnlargement: true })
        .toFile(smallPath);

      await updateBanners(recordId, `${relativeBasePath}_mc.webp`, "small");
      await updateBanners(recordId, `${relativeBasePath}_sc.webp`, "large");

      const bannerPath = await getBanner(
        recordId,
        getAssetBasePath(),
        process.defaultApp,
        "large",
        "download",
      );

      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("game-updated", recordId);
        }
      });

      event.sender.send("game-details-import-progress", {
        text: "Custom banner saved",
        progress: 1,
        total: 1,
      });

      return firstMediaPath(bannerPath);
    } catch (err) {
      console.error("Error converting and saving banner:", err);
      event.sender.send("game-details-import-progress", {
        text: `Failed to save custom banner: ${err.message}`,
        progress: 0,
        total: 1,
      });
      throw err;
    }
  },
);

}
