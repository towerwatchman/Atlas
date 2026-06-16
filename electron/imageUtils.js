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
    attempted: 0,
    downloaded: 0,
    skipped: 0,
    errors: [],
  };

  let imageProgress = 0;
  const bannerUrl = downloadBannerImages ? await getBannerUrl(atlasId) : null;
  const screenUrls = downloadPreviewImages
    ? await getScreensUrlList(atlasId)
    : [];
  const previewCount = downloadPreviewImages
    ? previewLimit === "Unlimited"
      ? screenUrls.length
      : Math.min(parseInt(previewLimit), screenUrls.length)
    : 0;
  const totalImages = (bannerUrl ? 2 : 0) + previewCount;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const reportProgress = () => {
    if (typeof onImageProgress === "function") {
      onImageProgress(imageProgress, totalImages);
    }
  };

  if (downloadBannerImages && !bannerUrl) {
    result.skipped++;
    console.warn(`Skipped banner download for record ${recordId}: no banner URL found`);
  }

  if (downloadPreviewImages && previewCount === 0) {
    result.skipped++;
    console.warn(`Skipped preview download for record ${recordId}: no preview URLs found`);
  }

  if (bannerUrl) {
    console.log(`Downloading banner from URL: ${bannerUrl}`);
    try {
      result.attempted++;
      const ext = path.extname(new URL(bannerUrl).pathname).toLowerCase();
      const bannerSource = "f95";
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
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        return imageBytes;
      };

      if ([".mp4", ".webm"].includes(ext) && downloadVideos) {
        const animatedPath = `${imagePath}${ext}`;
        if (!fs.existsSync(animatedPath)) {
          await loadImageBytes();
          fs.writeFileSync(animatedPath, imageBytes);
        }
        await updateBanners(recordId, `${relativePath}${ext}`, "animated");
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
            if (!fs.existsSync(animatedWebpPath)) {
              await sharp(imageBytes, { animated: true })
                .resize({ width: 1260, withoutEnlargement: true })
                .webp({
                  quality: 80,
                  effort: 6,
                  loop: 0,
                })
                .toFile(animatedWebpPath);
            }
            await updateBanners(
              recordId,
              `${relativePath}_animated.webp`,
              "animated",
            );
            result.downloaded++;
            imageProgress++;
            reportProgress();
          }
        } catch (animatedErr) {
          console.warn(
            `Failed to create animated WebP banner for ${recordId}:`,
            animatedErr,
          );
        }
      }

      const highResPath = `${imagePath}_mc.webp`;
      if (!fs.existsSync(highResPath)) {
        await loadImageBytes();
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 1260, withoutEnlargement: true })
          .toFile(highResPath);
      }
      await updateBanners(recordId, `${relativePath}_mc.webp`, "small");
      result.downloaded++;
      imageProgress++;
      reportProgress();

      const lowResPath = `${imagePath}_sc.webp`;
      if (!fs.existsSync(lowResPath)) {
        await loadImageBytes();
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 600, withoutEnlargement: true })
          .toFile(lowResPath);
      }
      await updateBanners(recordId, `${relativePath}_sc.webp`, "large");
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
      result.success = false;
      result.errors.push(`Banner: ${err.message || err}`);
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
          });
          imageBytes = Buffer.from(response.data);
          downloaded = true;
        }
        return imageBytes;
      };

      if ([".mp4", ".webm"].includes(ext) && downloadVideos) {
        const videoPath = `${imagePath}${ext}`;
        if (!fs.existsSync(videoPath)) {
          await loadImageBytes();
          fs.writeFileSync(videoPath, imageBytes);
        }
        await updatePreviews(recordId, `${relativePath}${ext}`);
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
            if (!fs.existsSync(animatedPreviewPath)) {
              await sharp(imageBytes, { animated: true })
                .resize({ width: 1260, withoutEnlargement: true })
                .webp({
                  quality: 80,
                  effort: 6,
                  loop: 0,
                })
                .toFile(animatedPreviewPath);
            }

            await updatePreviews(recordId, `${relativePath}_animated.webp`);
            animatedPreviewSaved = true;
            result.downloaded++;
          }
        } catch (animatedErr) {
          console.warn(
            `Failed to create animated WebP preview for ${recordId} from ${url}:`,
            animatedErr,
          );
        }
      }

      const targetPath = `${imagePath}_pr.webp`;
      if (!fs.existsSync(targetPath)) {
        await loadImageBytes();
        await sharp(imageBytes)
          .webp({ quality: 90 })
          .resize({ width: 1260, withoutEnlargement: true })
          .toFile(targetPath);
      }
      if (!animatedPreviewSaved) {
        await updatePreviews(recordId, `${relativePath}_pr.webp`);
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
      result.success = false;
      result.errors.push(`Preview ${i + 1}: ${err.message || err}`);
    }
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
