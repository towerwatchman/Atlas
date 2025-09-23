// src/utils.js
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const { getBannerUrl, getScreensUrlList, updateBanners, updatePreviews, getEmulatorByExtension } = require('./database');
const { shell } = require('electron');

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
    const stat = require('fs').statSync(current);
    if (stat.isDirectory()) {
      require('fs').readdirSync(current).forEach(f => stack.push(path.join(current, f)));
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
    const items = require('fs').readdirSync(current, { withFileTypes: true });
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

async function downloadImages(recordId, atlasId, onImageProgress, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos) {
  const dataDir = path.join(require('electron').app.getAppPath(), 'data');
  const imgDir = path.join(dataDir, 'images', recordId.toString());
  if (!(await fs.access(imgDir).then(() => true).catch(() => false))) await fs.mkdir(imgDir, { recursive: true });

  let imageProgress = 0;
  const bannerUrl = downloadBannerImages ? await getBannerUrl(atlasId) : null;
  const screenUrls = downloadPreviewImages ? await getScreensUrlList(atlasId) : [];
  const previewCount = downloadPreviewImages ? (previewLimit === 'Unlimited' ? screenUrls.length : Math.min(parseInt(previewLimit), screenUrls.length)) : 0;
  const totalImages = (bannerUrl ? 3 : 0) + previewCount;

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
        if (!(await fs.access(animatedPath).then(() => true).catch(() => false))) {
          const response = await axios.get(bannerUrl, { responseType: 'arraybuffer' });
          imageBytes = Buffer.from(response.data);
          await fs.writeFile(animatedPath, imageBytes);
          await updateBanners(recordId, `${relativePath}${ext}`, 'banner');
          downloaded = true;
        }
        imageProgress++;
        onImageProgress(imageProgress, totalImages);
      }

      const highResPath = `${imagePath}_mc.webp`;
      const lowResPath = `${imagePath}_sc.webp`;
      if (!(await fs.access(highResPath).then(() => true).catch(() => false))) {
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

      if (!(await fs.access(lowResPath).then(() => true).catch(() => false))) {
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
        require('electron').BrowserWindow.getAllWindows()[0].webContents.send('game-updated', recordId);
        await delay(500);
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
        if (!(await fs.access(targetPath).then(() => true).catch(() => false))) {
          const response = await axios.get(url, { responseType: 'arraybuffer' });
          const imageBytes = Buffer.from(response.data);

          if (['.gif', '.mp4', '.webm'].includes(ext) && downloadVideos) {
            await fs.writeFile(targetPath, imageBytes);
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
          await delay(500);
        }
      } catch (err) {
        console.error(`Error downloading or converting screen ${i + 1}:`, err);
      }
    }
  }
}

async function launchGame({ execPath, extension }) {
  if (!(await fs.access(execPath).then(() => true).catch(() => false))) {
    console.error(`Executable not found: ${execPath}`);
    return;
  }

  const emulator = await getEmulatorByExtension(extension);
  if (emulator) {
    const args = emulator.parameters ? emulator.parameters.split(' ') : [];
    args.push(execPath);
    const child = require('child_process').spawn(emulator.program_path, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    shell.openPath(execPath);
  }
}

function processTemplate(items, sender) {
  return items.map(item => {
    const newItem = { ...item };
    if (newItem.submenu) {
      newItem.submenu = processTemplate(newItem.submenu, sender);
    }
    if (newItem.data) {
      const id = contextMenuId++;
      contextMenuData.set(id, newItem.data);
      newItem.click = () => {
        const data = contextMenuData.get(id);
        console.log('Menu item clicked:', data);
        handleContextAction(data, sender);
        contextMenuData.delete(id);
      };
      delete newItem.data;
    }
    return newItem;
  });
}

function handleContextAction(data, sender) {
  if (!data || typeof data.action === 'undefined') {
    console.error('handleContextAction: Invalid or missing data object', data);
    return;
  }

  switch (data.action) {
    case 'launch':
      launchGame(data);
      break;
    case 'openFolder':
      shell.openPath(data.gamePath);
      break;
    case 'openUrl':
      shell.openExternal(data.url);
      break;
    case 'properties':
      console.log('Creating GameDetailsWindow for recordId:', data.recordId);
      createGameDetailsWindow(data.recordId);
      break;
    default:
      console.error(`Unknown action: ${data.action}`);
  }
}

module.exports = {
  getFolderSize,
  findExecutables,
  downloadImages,
  launchGame,
  processTemplate,
  handleContextAction
};