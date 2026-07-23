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
    // Treat 304 (not modified) and 429/503 (rate limited) as non-throwing so we
    // can detect and report them rather than swallowing a generic axios error.
    validateStatus: (status) =>
      (status >= 200 && status < 300) || status === 304 || status === 429 || status === 503,
    headers,
  });

  if (response.status === 304) return { status: 304, notModified: NOT_MODIFIED };

  // Rate limited (or service unavailable with a Retry-After). Surface it so the
  // caller can stop hitting THIS source for the rest of the run and notify.
  if (response.status === 429 || response.status === 503) {
    const retryAfterRaw = response.headers?.["retry-after"] || null;
    let retryAfterMs = null;
    if (retryAfterRaw != null) {
      const asSeconds = Number(retryAfterRaw);
      if (Number.isFinite(asSeconds)) retryAfterMs = asSeconds * 1000;
      else {
        const asDate = Date.parse(retryAfterRaw);
        if (!Number.isNaN(asDate)) retryAfterMs = Math.max(0, asDate - Date.now());
      }
    }
    return { status: response.status, rateLimited: true, retryAfterMs };
  }

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

// Encode the SAME source into multiple sizes while decoding it only once.
// `targets` is an array of { destPath, targetWidth, skip }. Sharp lets us reuse
// one decoded instance for many .resize().toFile() calls (via .clone()), so a
// banner's _mc (1260) and _sc (600) no longer pay for two full decodes.
// `skip:true` targets are left untouched (already-on-disk case). Falls back to
// per-size encodeToWebp when the shared decode can't read the image.
async function encodeToWebpSizes(imageBytes, targets, sharedMeta = null) {
  const pending = targets.filter((t) => t && !t.skip);
  if (pending.length === 0) return;

  let format = null;
  let width = null;
  try {
    const meta = sharedMeta || (await getImageMetadata(imageBytes));
    format = String(meta?.format || "").toLowerCase();
    width = Number(meta?.width) || null;
  } catch {
    /* fall through */
  }
  const alreadyCompressed = ALREADY_COMPRESSED_FORMATS.has(format);

  // One decoded pipeline, cloned per output size.
  let base;
  try {
    base = sharp(imageBytes);
  } catch (err) {
    // Decode failed up front — fall back to independent encodes so each target
    // gets its own error handling.
    for (const t of pending) await encodeToWebp(imageBytes, t.destPath, t.targetWidth);
    return;
  }

  for (const t of pending) {
    // Verbatim fast path per-size: already-compressed source within this
    // target's width doesn't need a re-encode.
    if (alreadyCompressed && width != null && width <= t.targetWidth) {
      await fs.promises.writeFile(t.destPath, imageBytes);
      continue;
    }
    const clone = base.clone().resize({ width: t.targetWidth, withoutEnlargement: true });
    if (format === "webp") {
      await clone.webp({ nearLossless: true, quality: 90 }).toFile(t.destPath);
    } else {
      await clone.webp({ quality: 90 }).toFile(t.destPath);
    }
  }
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
  // Shared across a whole import/refresh run: once a source (f95/steam/gog/lc)
  // returns 429/503, it's added here and all remaining downloads from that
  // source are skipped for the rest of the run while other sources continue.
  const blockedSources = options.blockedSources instanceof Set ? options.blockedSources : null;
  const onRateLimited = typeof options.onRateLimited === "function" ? options.onRateLimited : null;
  const isSourceBlocked = (src) => Boolean(blockedSources && src && blockedSources.has(String(src)));
  const markSourceRateLimited = (src, retryAfterMs) => {
    if (!src) return;
    const key = String(src);
    const firstTime = blockedSources && !blockedSources.has(key);
    if (blockedSources) blockedSources.add(key);
    if (firstTime && onRateLimited) {
      try { onRateLimited(key, retryAfterMs ?? null); } catch { /* ignore */ }
    }
  };
  // Raised inside a fetch when a rate-limit is detected, so the surrounding
  // try/catch can record the source and skip cleanly.
  class RateLimitError extends Error {
    constructor(source, retryAfterMs) {
      super(`Rate limited by source: ${source}`);
      this.name = "RateLimitError";
      this.source = source;
      this.retryAfterMs = retryAfterMs ?? null;
    }
  }
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

  const bannerSource = options.bannerSource || options.source || "f95";
  if (bannerUrl && isSourceBlocked(bannerSource)) {
    result.skipped = true;
    result.skipReasons.push(`banner skipped: ${bannerSource} rate-limited`);
  } else if (bannerUrl) {
    console.log(`Downloading banner from URL: ${bannerUrl}`);
    try {
      result.attempted++;
      const ext = path.extname(new URL(bannerUrl).pathname).toLowerCase();
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
          if (res.rateLimited) {
            markSourceRateLimited(bannerSource, res.retryAfterMs);
            throw new RateLimitError(bannerSource, res.retryAfterMs);
          }
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
          const animatedWebpPath = `${imagePath}_animated.webp`;
          const existedBefore = fs.existsSync(animatedWebpPath);
          if (existedBefore) {
            // Already have the animated derivative — don't decode every frame
            // just to re-confirm it's animated. Register the existing file.
            await verifyTrackedFile(animatedWebpPath, true);
            await updateBanners(recordId, `${relativePath}_animated.webp`, "animated");
            result.bannerRowsWritten++;
            result.downloaded++;
            imageProgress++;
            reportProgress();
          } else {
            await loadImageBytes();
            // Single animated decode here decides frame count AND is reused by
            // the encode below (sharp re-reads from bytes, but we avoid the
            // earlier separate metadata pass on already-existing files).
            const animatedMetadata = await getImageMetadata(imageBytes, {
              animated: true,
            });
            if (hasMultiplePages(animatedMetadata)) {
              await sharp(imageBytes, { animated: true })
                .resize({ width: 1260, withoutEnlargement: true })
                .webp({
                  quality: 90,
                  // effort 4 (was 6): 6 is sharp's slowest webp setting and is
                  // the dominant cost for animated GIFs with many frames. 4 is
                  // substantially faster with negligible size/quality change.
                  effort: 4,
                  loop: 0,
                })
                .toFile(animatedWebpPath);
              await verifyTrackedFile(animatedWebpPath, false);
              await updateBanners(recordId, `${relativePath}_animated.webp`, "animated");
              result.bannerRowsWritten++;
              result.downloaded++;
              imageProgress++;
              reportProgress();
            }
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
      const lowResPath = `${imagePath}_sc.webp`;
      const lowResExisted = fs.existsSync(lowResPath);
      if (!highResExisted || !lowResExisted) {
        await loadImageBytes();
        // Decode the source once, emit both banner sizes from it.
        await encodeToWebpSizes(imageBytes, [
          { destPath: highResPath, targetWidth: 1260, skip: highResExisted },
          { destPath: lowResPath, targetWidth: 600, skip: lowResExisted },
        ]);
      }
      await verifyTrackedFile(highResPath, highResExisted);
      await updateBanners(recordId, `${relativePath}_mc.webp`, "small");
      result.bannerRowsWritten++;
      result.localBannerPath = `${relativePath}_mc.webp`;
      result.downloaded++;
      imageProgress++;
      reportProgress();

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
      if (err instanceof RateLimitError) {
        result.skipped = true;
        result.skipReasons.push(`banner skipped: ${err.source} rate-limited`);
      } else {
        console.error("Error downloading or converting banner:", err);
        addError("Banner", err);
      }
    }
  }

  for (let i = 0; i < previewCount; i++) {
    const previewEntry = screenUrls[i];
    const url = typeof previewEntry === "string"
      ? previewEntry.trim()
      : String(previewEntry?.url || "").trim();
    if (!url) continue;

    const previewSource = typeof previewEntry === "object"
      ? previewEntry.source
      : defaultPreviewSource;
    if (isSourceBlocked(previewSource)) {
      result.skipped = true;
      result.skipReasons.push(`preview ${i + 1} skipped: ${previewSource} rate-limited`);
      continue;
    }

    console.log(`Downloading screen ${i + 1} from URL: ${url}`);
    try {
      result.attempted++;
      const ext = path.extname(new URL(url).pathname).toLowerCase();
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
          if (res.rateLimited) {
            markSourceRateLimited(previewSource, res.retryAfterMs);
            throw new RateLimitError(previewSource, res.retryAfterMs);
          }
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
          const animatedPreviewPath = `${imagePath}_animated.webp`;
          const existedBefore = fs.existsSync(animatedPreviewPath);
          if (existedBefore) {
            // Already have it — skip the full animated frame decode.
            await verifyTrackedFile(animatedPreviewPath, true);
            await updatePreviews(recordId, `${relativePath}_animated.webp`);
            result.previewRowsWritten++;
            result.localPreviewPaths.push(`${relativePath}_animated.webp`);
            animatedPreviewSaved = true;
            result.downloaded++;
          } else {
            await loadImageBytes();
            const animatedMetadata = await getImageMetadata(imageBytes, {
              animated: true,
            });
            if (hasMultiplePages(animatedMetadata)) {
              await sharp(imageBytes, { animated: true })
                .resize({ width: 1260, withoutEnlargement: true })
                .webp({
                  quality: 90,
                  // effort 4 (was 6) — see the animated banner note above.
                  effort: 4,
                  loop: 0,
                })
                .toFile(animatedPreviewPath);
              await verifyTrackedFile(animatedPreviewPath, false);
              await updatePreviews(recordId, `${relativePath}_animated.webp`);
              result.previewRowsWritten++;
              result.localPreviewPaths.push(`${relativePath}_animated.webp`);
              animatedPreviewSaved = true;
              result.downloaded++;
            }
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
      if (err instanceof RateLimitError) {
        result.skipped = true;
        result.skipReasons.push(`preview ${i + 1} skipped: ${err.source} rate-limited`);
      } else {
        console.error(`Error downloading or converting screen ${i + 1}:`, err);
        addError(`Preview ${i + 1}`, err);
      }
    }
  }

  for (let i = 0; i < additionalAssets.length; i++) {
    const asset = additionalAssets[i];
    const url = asset.url;
    const assetSource = asset.source || "remote";
    if (isSourceBlocked(assetSource)) {
      result.skipped = true;
      result.skipReasons.push(`asset ${asset.assetType || i + 1} skipped: ${assetSource} rate-limited`);
      continue;
    }
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
          if (res.rateLimited) {
            markSourceRateLimited(assetSource, res.retryAfterMs);
            throw new RateLimitError(assetSource, res.retryAfterMs);
          }
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
      if (err instanceof RateLimitError) {
        result.skipped = true;
        result.skipReasons.push(`asset ${asset.assetType || i + 1} skipped: ${err.source} rate-limited`);
        imageProgress++;
        reportProgress();
        continue;
      }
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
