'use strict'

const path = require('path')
const fs = require('fs')
const axios = require('axios')
const sharp = require('sharp')


const ANIMATED_IMAGE_EXTENSIONS = new Set([".gif", ".webp"]);


function normalizeImageSource(value, fallback = "custom") {
  return (
    String(value || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}


function buildBannerBaseName(source) {
  return `banner_${normalizeImageSource(source)}`;
}


function buildPreviewBaseName(source, index) {
  const numericIndex = Number(index);
  const safeIndex = String((Number.isFinite(numericIndex) ? numericIndex : 0) + 1)
    .padStart(3, "0");
  return `preview_${normalizeImageSource(source, "f95")}_${safeIndex}`;
}


const isPotentialAnimatedImage = (ext) =>
  ANIMATED_IMAGE_EXTENSIONS.has(String(ext || "").toLowerCase());


async function getImageMetadata(imageBytes, options = {}) {
  return await sharp(imageBytes, options).metadata();
}


function hasMultiplePages(metadata) {
  return Number(metadata?.pages || 1) > 1;
}


async function downloadImages(
  recordId,
  atlasId,
  onImageProgress,
  downloadBannerImages,
  downloadPreviewImages,
  previewLimit,
  downloadVideos,
  dataDir,
  getBannerUrl,
  getScreensUrlList,
  updateBanners,
  updatePreviews,
  options = {},
) {
  const imgDir = path.join(dataDir, "images", recordId.toString());
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  const defaultPreviewSource = options.previewSource || options.source || "f95";
  const result = {
    success: true,
    recordId,
    atlasId,
    imageDir: imgDir,
    attempted: 0,
    downloaded: 0,
    bannerUrlCount: 0,
    previewUrlCount: 0,
    filesWritten: 0,
    filesExisting: 0,
    bannerRowsWritten: 0,
    previewRowsWritten: 0,
    localBannerPath: "",
    localPreviewPaths: [],
    skipped: false,
    skipReasons: [],
    errors: [],
  };

  let imageProgress = 0;
  const bannerUrl = downloadBannerImages ? await getBannerUrl(atlasId) : null;
  const screenUrls = downloadPreviewImages
    ? await getScreensUrlList(atlasId)
    : [];
  result.bannerUrlCount = bannerUrl ? 1 : 0;
  result.previewUrlCount = screenUrls.length;
  const previewCount = downloadPreviewImages
    ? previewLimit === "Unlimited"
      ? screenUrls.length
      : Math.min(parseInt(previewLimit), screenUrls.length)
    : 0;
  const totalImages = (bannerUrl ? 2 : 0) + previewCount;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const verifyLocalFile = async (filePath) => {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`Downloaded image file is empty: ${filePath}`);
    }
    return stat;
  };
  const verifyTrackedFile = async (filePath, existedBefore) => {
    await verifyLocalFile(filePath);
    if (existedBefore) result.filesExisting++;
    else result.filesWritten++;
  };
  const addError = (label, err) => {
    const message = `${label}: ${err?.message || err}`;
    result.success = false;
    result.errors.push(message);
  };
  const reportProgress = () => {
    if (typeof onImageProgress === "function") {
      onImageProgress(imageProgress, totalImages);
    }
  };

  if (downloadBannerImages && !bannerUrl) {
    result.skipped = true;
    result.skipReasons.push("no banner URL found");
    console.warn(`Skipped banner download for record ${recordId}: no banner URL found`);
  }

  if (downloadPreviewImages && previewCount === 0) {
    result.skipped = true;
    result.skipReasons.push("no preview URLs found");
    console.warn(`Skipped preview download for record ${recordId}: no preview URLs found`);
  }

  if (bannerUrl) {
    console.log(`Downloading banner from URL: ${bannerUrl}`);
    try {
      result.attempted++;
      const ext = path.extname(new URL(bannerUrl).pathname).toLowerCase();
      const bannerSource = options.bannerSource || options.source || "f95";
      const baseName = buildBannerBaseName(bannerSource);
      const imagePath = path.join(imgDir, baseName);
      const relativePath = path.join(
        "data",
        "images",
        recordId.toString(),
        baseName,
      );

      let imageBytes;
      let downloaded = false;
      const loadImageBytes = async () => {
        if (!imageBytes) {
          const response = await axios.get(bannerUrl, {
            responseType: "arraybuffer",
            maxRedirects: 5,
            headers: {
              "User-Agent": "Atlas/1.0 (+https://github.com/towerwatchman/Atlas)",
              Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        return imageBytes;
      };

      if ([".mp4", ".webm"].includes(ext) && downloadVideos) {
        const animatedPath = `${imagePath}${ext}`;
        const existedBefore = fs.existsSync(animatedPath);
        if (!existedBefore) {
          await loadImageBytes();
          fs.writeFileSync(animatedPath, imageBytes);
        }
        await verifyTrackedFile(animatedPath, existedBefore);
        await updateBanners(recordId, `${relativePath}${ext}`, "animated");
        result.bannerRowsWritten++;
        result.downloaded++;
        imageProgress++;
        reportProgress();
      }

      if (isPotentialAnimatedImage(ext)) {
        try {
          await loadImageBytes();
          const animatedMetadata = await getImageMetadata(imageBytes, {
            animated: true,
          });

          if (hasMultiplePages(animatedMetadata)) {
            const animatedWebpPath = `${imagePath}_animated.webp`;
            const existedBefore = fs.existsSync(animatedWebpPath);
            if (!existedBefore) {
              await sharp(imageBytes, { animated: true })
                .resize({ width: 1260, withoutEnlargement: true })
                .webp({
                  quality: 80,
                  effort: 6,
                  loop: 0,
                })
                .toFile(animatedWebpPath);
            }
            await verifyTrackedFile(animatedWebpPath, existedBefore);
            await updateBanners(
              recordId,
              `${relativePath}_animated.webp`,
              "animated",
            );
            result.bannerRowsWritten++;
            result.downloaded++;
            imageProgress++;
            reportProgress();
          }
        } catch (animatedErr) {
          console.warn(
            `Failed to create animated WebP banner for ${recordId}:`,
            animatedErr,
          );
          result.errors.push(`Animated banner: ${animatedErr.message || animatedErr}`);
        }
      }

      const highResPath = `${imagePath}_mc.webp`;
      const highResExisted = fs.existsSync(highResPath);
      if (!highResExisted) {
        await loadImageBytes();
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 1260, withoutEnlargement: true })
          .toFile(highResPath);
      }
      await verifyTrackedFile(highResPath, highResExisted);
      await updateBanners(recordId, `${relativePath}_mc.webp`, "small");
      result.bannerRowsWritten++;
      result.localBannerPath = `${relativePath}_mc.webp`;
      result.downloaded++;
      imageProgress++;
      reportProgress();

      const lowResPath = `${imagePath}_sc.webp`;
      const lowResExisted = fs.existsSync(lowResPath);
      if (!lowResExisted) {
        await loadImageBytes();
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 600, withoutEnlargement: true })
          .toFile(lowResPath);
      }
      await verifyTrackedFile(lowResPath, lowResExisted);
      await updateBanners(recordId, `${relativePath}_sc.webp`, "large");
      result.bannerRowsWritten++;
      if (!result.localBannerPath) result.localBannerPath = `${relativePath}_sc.webp`;
      result.downloaded++;
      imageProgress++;
      reportProgress();

      console.log("Banner images updated");
      if (downloaded) {
        require("electron")
          .webContents.getAllWebContents()
          .forEach((wc) => {
            wc.send("game-details-import-progress", {
              text: `Completed banner download ${imageProgress}/${totalImages}`,
              progress: imageProgress,
              total: totalImages,
            });
          });
        await delay(500);
      }
    } catch (err) {
      console.error("Error downloading or converting banner:", err);
      addError("Banner", err);
    }
  }

  for (let i = 0; i < previewCount; i++) {
    const previewEntry = screenUrls[i];
    const url = typeof previewEntry === "string"
      ? previewEntry.trim()
      : String(previewEntry?.url || "").trim();
    if (!url) continue;

    console.log(`Downloading screen ${i + 1} from URL: ${url}`);
    try {
      result.attempted++;
      const ext = path.extname(new URL(url).pathname).toLowerCase();
      const previewSource = typeof previewEntry === "object"
        ? previewEntry.source
        : defaultPreviewSource;
      const baseName = buildPreviewBaseName(previewSource, i);
      const imagePath = path.join(imgDir, baseName);
      const relativePath = path.join(
        "data",
        "images",
        recordId.toString(),
        baseName,
      );

      let imageBytes;
      let downloaded = false;
      const loadImageBytes = async () => {
        if (!imageBytes) {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
            maxRedirects: 5,
            headers: {
              "User-Agent": "Atlas/1.0 (+https://github.com/towerwatchman/Atlas)",
              Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        return imageBytes;
      };

      if ([".mp4", ".webm"].includes(ext) && downloadVideos) {
        const videoPath = `${imagePath}${ext}`;
        const existedBefore = fs.existsSync(videoPath);
        if (!existedBefore) {
          await loadImageBytes();
          fs.writeFileSync(videoPath, imageBytes);
        }
        await verifyTrackedFile(videoPath, existedBefore);
        await updatePreviews(recordId, `${relativePath}${ext}`);
        result.previewRowsWritten++;
        result.localPreviewPaths.push(`${relativePath}${ext}`);
        result.downloaded++;
      }

      let animatedPreviewSaved = false;

      if (isPotentialAnimatedImage(ext)) {
        try {
          await loadImageBytes();
          const animatedMetadata = await getImageMetadata(imageBytes, {
            animated: true,
          });

          if (hasMultiplePages(animatedMetadata)) {
            const animatedPreviewPath = `${imagePath}_animated.webp`;
            const existedBefore = fs.existsSync(animatedPreviewPath);
            if (!existedBefore) {
              await sharp(imageBytes, { animated: true })
                .resize({ width: 1260, withoutEnlargement: true })
                .webp({
                  quality: 80,
                  effort: 6,
                  loop: 0,
                })
                .toFile(animatedPreviewPath);
            }
            await verifyTrackedFile(animatedPreviewPath, existedBefore);

            await updatePreviews(recordId, `${relativePath}_animated.webp`);
            result.previewRowsWritten++;
            result.localPreviewPaths.push(`${relativePath}_animated.webp`);
            animatedPreviewSaved = true;
            result.downloaded++;
          }
        } catch (animatedErr) {
          console.warn(
            `Failed to create animated WebP preview for ${recordId} from ${url}:`,
            animatedErr,
          );
          result.errors.push(`Animated preview ${i + 1}: ${animatedErr.message || animatedErr}`);
        }
      }

      const targetPath = `${imagePath}_pr.webp`;
      const targetExisted = fs.existsSync(targetPath);
      if (!targetExisted) {
        await loadImageBytes();
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 1260, withoutEnlargement: true })
          .toFile(targetPath);
      }
      await verifyTrackedFile(targetPath, targetExisted);
      if (!animatedPreviewSaved) {
        await updatePreviews(recordId, `${relativePath}_pr.webp`);
        result.previewRowsWritten++;
        result.localPreviewPaths.push(`${relativePath}_pr.webp`);
        result.downloaded++;
      }
      imageProgress++;
      reportProgress();

      console.log(`Screen ${i + 1} updated`);
      if (downloaded) {
        require("electron")
          .webContents.getAllWebContents()
          .forEach((wc) => {
            wc.send("game-details-import-progress", {
              text: `Completed preview download ${imageProgress}/${totalImages}`,
              progress: imageProgress,
              total: totalImages,
            });
          });
        await delay(500);
      }
    } catch (err) {
      console.error(`Error downloading or converting screen ${i + 1}:`, err);
      addError(`Preview ${i + 1}`, err);
    }
  }

  if (result.attempted > 0 && result.filesWritten === 0 && result.errors.length > 0) {
    result.success = false;
  }
  if (result.attempted === 0 && result.skipReasons.length > 0) {
    result.skipped = true;
  }

  return result;
}

module.exports = {
  downloadImages,
  buildBannerBaseName,
  buildPreviewBaseName,
  isPotentialAnimatedImage,
  getImageMetadata,
  hasMultiplePages,
  ANIMATED_IMAGE_EXTENSIONS,
  normalizeImageSource,
}
