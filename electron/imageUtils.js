'use strict'

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const axios = require('axios')
const sharp = require('sharp')

const accountStore = require('./accounts/accountStore')

// Merge the auth Cookie for F95zone/LewdCorner into a request's headers when an
// account is configured, so login-gated artwork downloads succeed. No-op for
// any other host (Steam CDNs, etc.).
function withAuthCookie(url, headers) {
  try {
    const cookie = accountStore.getCookieHeaderForUrl(url)
    if (cookie) return { ...headers, Cookie: cookie }
  } catch (err) {
    /* no account / store not ready — send unauthenticated */
  }
  return headers
}


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

function buildMediaAssetBaseName(asset) {
  const preferred = String(asset?.preferredFilename || asset?.assetType || "media_asset")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const source = normalizeImageSource(asset?.source, "remote");
  return preferred.startsWith(`${source}_`) ? preferred : `${source}_${preferred || "media_asset"}`;
}


function getMediaAssetMaxWidth(assetType) {
  const type = String(assetType || "").toLowerCase();
  if (/(hero|wallpaper|header|banner_wide)/.test(type)) return 1920;
  if (/(cover|poster|capsule)/.test(type)) return 900;
  if (/logo/.test(type)) return 1200;
  return 1260;
}


const isPotentialAnimatedImage = (ext) =>
  ANIMATED_IMAGE_EXTENSIONS.has(String(ext || "").toLowerCase());


async function getImageMetadata(imageBytes, options = {}) {
  return await sharp(imageBytes, options).metadata();
}


function sendImageDownloadProgress(payload) {
  if (!process.versions?.electron) return;
  try {
    const electron = require("electron");
    const webContents = electron?.webContents;
    if (!webContents || typeof webContents.getAllWebContents !== "function") return;
    webContents.getAllWebContents().forEach((wc) => {
      wc.send("game-details-import-progress", payload);
    });
  } catch {
    // Running under a plain Node smoke test has no Electron runtime to notify.
  }
}


function hasMultiplePages(metadata) {
  return Number(metadata?.pages || 1) > 1;
}


// Formats that are already efficiently compressed. When a source is one of
// these AND already within our target width, we copy the bytes straight to disk
// instead of decoding + re-encoding through sharp (which wastes CPU and, for
// webp->webp, drops a second generation of lossy quality).
const ALREADY_COMPRESSED_FORMATS = new Set(["webp", "avif"]);

// Sentinel returned by conditionalFetchImage when the origin says 304 Not
// Modified, so callers can skip all work for that asset.
const NOT_MODIFIED = Symbol("not-modified");

// Fetch an image with HTTP validators. If we hold a cached etag/last-modified
// for this (record,url), send them as If-None-Match / If-Modified-Since; a 304
// short-circuits to NOT_MODIFIED. Otherwise we return the bytes plus the
// validators + a sha256 the caller can persist. When the origin sends no
// validators, the caller can still compare content_length / content_hash.
async function conditionalFetchImage(url, { cache, extraHeaders } = {}) {
  const headers = {
    "User-Agent": "Atlas/1.0 (+https://github.com/towerwatchman/Atlas)",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    ...(extraHeaders || {}),
  };
  if (cache?.etag) headers["If-None-Match"] = cache.etag;
  if (cache?.last_modified) headers["If-Modified-Since"] = cache.last_modified;

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    maxRedirects: 5,
    // Treat 304 as a normal, non-throwing response.
    validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    headers,
  });

  if (response.status === 304) return { status: 304, notModified: NOT_MODIFIED };

  const bytes = Buffer.from(response.data);
  const etag = response.headers?.etag || response.headers?.ETag || null;
  const lastModified = response.headers?.["last-modified"] || null;
  const contentLength = Number(response.headers?.["content-length"]) || bytes.length || null;
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");

  // Fallback identity check for origins that send no validators: if the byte
  // length AND hash match what we stored, it's the same image we already have.
  const unchangedByHash = Boolean(
    cache &&
      !cache.etag &&
      !cache.last_modified &&
      cache.content_hash &&
      cache.content_hash === contentHash,
  );

  return {
    status: response.status,
    bytes,
    validators: { etag, lastModified, contentLength, contentHash },
    unchangedByHash,
  };
}

// Decide how to get the source bytes onto disk as `destPath`. If the source is
// already webp/avif and no wider than targetWidth, we write the original bytes
// unchanged (no re-encode). Otherwise we resize (and, for already-webp sources,
// re-encode near-losslessly to avoid a visible second-generation quality hit).
async function encodeToWebp(imageBytes, destPath, targetWidth) {
  let format = null;
  let width = null;
  try {
    const meta = await getImageMetadata(imageBytes);
    format = String(meta?.format || "").toLowerCase();
    width = Number(meta?.width) || null;
  } catch {
    /* fall through to a normal encode if metadata can't be read */
  }

  const alreadyCompressed = ALREADY_COMPRESSED_FORMATS.has(format);
  const withinTarget = width != null && width <= targetWidth;

  // Best case: already an efficiently-compressed format at an acceptable size,
  // so persist the bytes verbatim. Note the on-disk name still ends in .webp
  // for avif sources, but the bytes are the original avif; sharp/renderer read
  // by content, not extension, so this is safe and avoids a needless transcode.
  if (alreadyCompressed && withinTarget) {
    await fs.promises.writeFile(destPath, imageBytes);
    return { reencoded: false };
  }

  const pipeline = sharp(imageBytes).resize({ width: targetWidth, withoutEnlargement: true });
  if (format === "webp") {
    // webp -> webp: near-lossless keeps the recompression from stacking loss.
    await pipeline.webp({ nearLossless: true, quality: 90 }).toFile(destPath);
  } else {
    await pipeline.webp({ quality: 90 }).toFile(destPath);
  }
  return { reencoded: true };
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
  const defaultPreviewSource = options.previewSource || options.source || "remote";
  const additionalAssets = Array.isArray(options.additionalAssets)
    ? options.additionalAssets
        .map((asset) => ({
          ...asset,
          url: String(asset?.url || "").trim(),
        }))
        .filter((asset) => asset.url)
    : [];
  const upsertMediaAsset = typeof options.upsertMediaAsset === "function"
    ? options.upsertMediaAsset
    : null;
  const requestDelayMs = Math.max(0, Number.parseInt(options.requestDelayMs, 10) || 0);
  // Optional persistence for HTTP validators so refreshes can skip unchanged
  // remote images. When absent (older callers), we simply fall back to the old
  // "exists on disk?" behavior with no conditional requests.
  const getMediaSourceCache = typeof options.getMediaSourceCache === "function"
    ? options.getMediaSourceCache
    : null;
  const upsertMediaSourceCache = typeof options.upsertMediaSourceCache === "function"
    ? options.upsertMediaSourceCache
    : null;
  const result = {
    success: true,
    recordId,
    atlasId,
    imageDir: imgDir,
    attempted: 0,
    downloaded: 0,
    bannerUrlCount: 0,
    previewUrlCount: 0,
    mediaAssetUrlCount: additionalAssets.length,
    filesWritten: 0,
    filesExisting: 0,
    bannerRowsWritten: 0,
    previewRowsWritten: 0,
    mediaAssetRowsWritten: 0,
    localBannerPath: "",
    localPreviewPaths: [],
    localMediaAssetPaths: [],
    skipped: false,
    skipReasons: [],
    errors: [],
  };

  let imageProgress = 0;
  let requiredErrorCount = 0;
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
  const totalImages = (bannerUrl ? 2 : 0) + previewCount + additionalAssets.length;

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
    requiredErrorCount++;
    result.errors.push(message);
  };
  const addOptionalError = (label, err) => {
    const message = `${label}: ${err?.message || err}`;
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

      // If both derivatives already exist we can ask the origin (via validators)
      // whether the source changed; a 304 lets us skip the whole asset. If a
      // derivative is missing we must fetch bytes regardless, so we don't send
      // validators in that case (they could yield a bodyless 304).
      const bannerDerivativesPresent =
        fs.existsSync(`${imagePath}_mc.webp`) && fs.existsSync(`${imagePath}_sc.webp`);
      let imageBytes;
      let downloaded = false;
      let bannerNotModified = false;
      const loadImageBytes = async () => {
        if (!imageBytes && !bannerNotModified) {
          const cache = (getMediaSourceCache && bannerDerivativesPresent)
            ? await getMediaSourceCache(recordId, bannerUrl)
            : null;
          const res = await conditionalFetchImage(bannerUrl, {
            cache,
            extraHeaders: withAuthCookie(bannerUrl, {}),
          });
          if (res.notModified || res.unchangedByHash) {
            bannerNotModified = true;
            return null;
          }
          imageBytes = res.bytes;
          downloaded = true;
          if (upsertMediaSourceCache) {
            await upsertMediaSourceCache({
              recordId,
              originalUrl: bannerUrl,
              etag: res.validators.etag,
              lastModified: res.validators.lastModified,
              contentLength: res.validators.contentLength,
              contentHash: res.validators.contentHash,
            });
          }
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
                  // Matches every other webp() call in this file (90) —
                  // this one was previously 80, which is noticeably
                  // lossier on the kind of flat-color, sharp-edged, often
                  // text-heavy content typical of screen-capture GIFs
                  // than the same setting would be on a photo.
                  quality: 90,
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
        await encodeToWebp(imageBytes, highResPath, 1260);
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
        await encodeToWebp(imageBytes, lowResPath, 600);
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
        sendImageDownloadProgress({
          text: `Completed banner download ${imageProgress}/${totalImages}`,
          progress: imageProgress,
          total: totalImages,
        });
        if (requestDelayMs > 0) await delay(requestDelayMs);
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

      // Only send validators when the plain preview derivative already exists;
      // a missing derivative must fetch bytes unconditionally.
      const previewDerivativePresent = fs.existsSync(`${imagePath}_pr.webp`);
      let imageBytes;
      let downloaded = false;
      let previewNotModified = false;
      const loadImageBytes = async () => {
        if (!imageBytes && !previewNotModified) {
          const cache = (getMediaSourceCache && previewDerivativePresent)
            ? await getMediaSourceCache(recordId, url)
            : null;
          const res = await conditionalFetchImage(url, {
            cache,
            extraHeaders: withAuthCookie(url, {}),
          });
          if (res.notModified || res.unchangedByHash) {
            previewNotModified = true;
            return null;
          }
          imageBytes = res.bytes;
          downloaded = true;
          if (upsertMediaSourceCache) {
            await upsertMediaSourceCache({
              recordId,
              originalUrl: url,
              etag: res.validators.etag,
              lastModified: res.validators.lastModified,
              contentLength: res.validators.contentLength,
              contentHash: res.validators.contentHash,
            });
          }
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
                  // See the matching comment on the animated banner
                  // conversion above — was 80, noticeably lossier on
                  // GIF-typical content than that setting reads on a
                  // photo. Now matches every other webp() call here.
                  quality: 90,
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
        await encodeToWebp(imageBytes, targetPath, 1260);
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
        sendImageDownloadProgress({
          text: `Completed preview download ${imageProgress}/${totalImages}`,
          progress: imageProgress,
          total: totalImages,
        });
        if (requestDelayMs > 0) await delay(requestDelayMs);
      }
    } catch (err) {
      console.error(`Error downloading or converting screen ${i + 1}:`, err);
      addError(`Preview ${i + 1}`, err);
    }
  }

  for (let i = 0; i < additionalAssets.length; i++) {
    const asset = additionalAssets[i];
    const url = asset.url;
    console.log(`Downloading media asset ${asset.assetType || i + 1} from URL: ${url}`);
    try {
      result.attempted++;
      const parsedUrl = new URL(url);
      const ext = path.extname(parsedUrl.pathname).toLowerCase();
      const baseName = buildMediaAssetBaseName(asset);
      const imagePath = path.join(imgDir, baseName);
      const relativePath = path.join("data", "images", recordId.toString(), baseName);
      const isVideo = [".mp4", ".webm", ".m4v"].includes(ext);

      let localPath;
      let relativeAssetPath;
      let width = null;
      let height = null;

      const response = async () => axios.get(url, {
        responseType: "arraybuffer",
        maxRedirects: 5,
        headers: withAuthCookie(url, {
          "User-Agent": "Atlas/1.0 (+https://github.com/towerwatchman/Atlas)",
          Accept: isVideo
            ? "video/webm,video/mp4,video/*,*/*;q=0.8"
            : "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        }),
      });

      if (isVideo && downloadVideos) {
        localPath = `${imagePath}${ext}`;
        relativeAssetPath = `${relativePath}${ext}`;
        const existedBefore = fs.existsSync(localPath);
        if (!existedBefore) {
          const videoResponse = await response();
          fs.writeFileSync(localPath, Buffer.from(videoResponse.data));
        }
        await verifyTrackedFile(localPath, existedBefore);
      } else if (!isVideo) {
        localPath = `${imagePath}.webp`;
        relativeAssetPath = `${relativePath}.webp`;
        const existedBefore = fs.existsSync(localPath);
        if (!existedBefore) {
          // Derivative is absent, so fetch unconditionally (no validators) and
          // record fresh validators for next time.
          const res = await conditionalFetchImage(url, {
            extraHeaders: withAuthCookie(url, {}),
          });
          await encodeToWebp(Buffer.from(res.bytes), localPath, getMediaAssetMaxWidth(asset.assetType));
          if (upsertMediaSourceCache && res.validators) {
            await upsertMediaSourceCache({
              recordId,
              originalUrl: url,
              etag: res.validators.etag,
              lastModified: res.validators.lastModified,
              contentLength: res.validators.contentLength,
              contentHash: res.validators.contentHash,
            });
          }
        }
        await verifyTrackedFile(localPath, existedBefore);
        try {
          const metadata = await sharp(localPath).metadata();
          width = Number.isFinite(metadata.width) ? metadata.width : null;
          height = Number.isFinite(metadata.height) ? metadata.height : null;
        } catch (metadataErr) {
          console.warn(`Unable to read metadata for media asset ${localPath}:`, metadataErr);
        }
      } else {
        result.skipReasons.push(`skipped video media asset ${asset.assetType || url}`);
        imageProgress++;
        reportProgress();
        continue;
      }

      if (upsertMediaAsset) {
        await upsertMediaAsset({
          recordId,
          source: asset.source || "remote",
          assetType: asset.assetType || "media_asset",
          path: relativeAssetPath,
          originalUrl: url,
          width,
          height,
        });
        result.mediaAssetRowsWritten++;
      }
      result.localMediaAssetPaths.push(relativeAssetPath);
      result.downloaded++;
      imageProgress++;
      reportProgress();

      sendImageDownloadProgress({
        text: `Completed media asset download ${imageProgress}/${totalImages}`,
        progress: imageProgress,
        total: totalImages,
      });
      if (requestDelayMs > 0) await delay(requestDelayMs);
    } catch (err) {
      const host = (() => {
        try { return new URL(url).host; } catch { return "unknown host"; }
      })();
      console.error(`Error downloading media asset ${asset.assetType || i + 1} from ${host}:`, err);
      addOptionalError(`Media asset ${asset.assetType || i + 1} (${host})`, err);
      imageProgress++;
      reportProgress();
    }
  }

  if (result.attempted > 0 && result.filesWritten === 0 && requiredErrorCount > 0) {
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
  buildMediaAssetBaseName,
  isPotentialAnimatedImage,
  getImageMetadata,
  hasMultiplePages,
  sendImageDownloadProgress,
  ANIMATED_IMAGE_EXTENSIONS,
  normalizeImageSource,
  getMediaAssetMaxWidth,
}
