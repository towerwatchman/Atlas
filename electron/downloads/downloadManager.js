"use strict";

// ── Download manager ─────────────────────────────────────────────────────────
//
// Runs the persisted queue from db/downloads.js. Three responsibilities:
//
//   1. Fetch bytes for items that have a direct URL, resumably.
//   2. Watch a folder and adopt files the user downloaded themselves, matching
//      them to queued items.
//   3. Hand a finished file to the version-attach step.
//
// What it deliberately does NOT do: resolve F95Zone masked links. Those sit
// behind a CAPTCHA, so there is no honest programmatic path through them — an
// item for a masked link is created in the `awaiting_file` state, the user opens
// the link in a browser themselves, and the watch folder picks the result up.
// That keeps the queue, extraction and version-attach useful for every host
// without Atlas pretending it can bypass the gate.
//
// Progress is throttled before it reaches the renderer. A fast transfer produces
// thousands of data events per second and forwarding each one would spend more
// time on IPC than on the download.

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const https = require("https");
const http = require("http");
const { pipeline } = require("stream/promises");

const downloadsDb = require("./../db/downloads");

// Concurrent transfers. Higher is not faster for a single host and gets you
// rate-limited, so this stays small and is not user-configurable for now.
const MAX_CONCURRENT = 2;
// How often a running transfer is allowed to report upward, in ms.
const PROGRESS_INTERVAL_MS = 400;
// Redirect budget. Hosts in this space chain several before the real file.
const MAX_REDIRECTS = 10;
// A file must stop growing for this long before the watch folder treats it as
// complete — browsers write partials in place, so size stability is the signal.
const WATCH_SETTLE_MS = 2500;

// Live transfers, keyed by download id, so pause/cancel can reach into them.
const active = new Map();
let runnerScheduled = false;
let emitter = null;
let watcher = null;
let watchTimer = null;
let attachHandler = null;
let getDownloadsDir = () => "";

// ── Events ───────────────────────────────────────────────────────────────────

const configure = ({ onEvent, resolveDownloadsDir, onFileReady }) => {
  emitter = typeof onEvent === "function" ? onEvent : null;
  if (typeof resolveDownloadsDir === "function") getDownloadsDir = resolveDownloadsDir;
  // Called with a completed file so the caller can extract it and attach the
  // version. Kept as an injected callback rather than a direct require so this
  // module has no dependency on the importer's internals.
  attachHandler = typeof onFileReady === "function" ? onFileReady : null;
};

const emit = (type, payload) => {
  if (emitter) {
    try {
      emitter(type, payload);
    } catch (err) {
      console.warn("Download event listener threw:", err.message);
    }
  }
};

const publish = async (id) => {
  const item = await downloadsDb.getDownload(id).catch(() => null);
  if (item) emit("download-updated", item);
  return item;
};

const setState = async (id, state, patch = {}) => {
  await downloadsDb.updateDownload(id, { state, ...patch });
  return publish(id);
};

// ── Filenames ────────────────────────────────────────────────────────────────

const sanitizeFileName = (value) => {
  const base = String(value || "").trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
  // Long names blow past path limits once joined to a nested library folder.
  return base.slice(0, 180) || "download";
};

// Prefer the server's filename, then the URL's last segment, then the title.
const deriveFileName = (item, response, requestUrl) => {
  const disposition = response?.headers?.["content-disposition"] || "";
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return sanitizeFileName(decodeURIComponent(utf8[1]));
    } catch {
      // Malformed encoding — fall through to the other strategies.
    }
  }
  const quoted = disposition.match(/filename="?([^";]+)"?/i);
  if (quoted) return sanitizeFileName(quoted[1]);
  try {
    const parsed = new URL(requestUrl);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return sanitizeFileName(last);
  } catch {
    // Not a parseable URL — fall through.
  }
  const version = item.version ? `-${item.version}` : "";
  return sanitizeFileName(`${item.title}${version}`);
};

const uniquePath = async (target) => {
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  let candidate = target;
  let counter = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await fsp.stat(candidate).then(() => true).catch(() => false);
    if (!exists) return candidate;
    candidate = path.join(dir, `${base} (${counter})${ext}`);
    counter += 1;
  }
};

// ── HTTP transfer ────────────────────────────────────────────────────────────

const requestWithRedirects = (url, { headers = {}, redirectsLeft = MAX_REDIRECTS } = {}) =>
  new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Not a valid URL: ${url}`));
      return;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      reject(new Error(`Unsupported protocol: ${parsed.protocol}`));
      return;
    }
    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.get(parsed, { headers }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("Too many redirects"));
          return;
        }
        // Relative redirects are legal and common.
        const next = new URL(location, parsed).toString();
        requestWithRedirects(next, { headers, redirectsLeft: redirectsLeft - 1 })
          .then(resolve)
          .catch(reject);
        return;
      }
      resolve({ response, finalUrl: parsed.toString() });
    });
    request.on("error", reject);
    // A dead host should not hold a queue slot forever.
    request.setTimeout(45000, () => {
      request.destroy(new Error("Connection timed out"));
    });
  });

const startTransfer = async (item) => {
  const downloadsDir = getDownloadsDir();
  if (!downloadsDir) {
    await setState(item.id, "failed", { error: "No downloads folder is configured" });
    return;
  }
  await fsp.mkdir(downloadsDir, { recursive: true });

  const controller = { canceled: false, paused: false, stream: null, response: null };
  active.set(item.id, controller);

  try {
    // Resume when we already have bytes on disk and the file is still there.
    let existingBytes = 0;
    if (item.filePath) {
      existingBytes = await fsp
        .stat(item.filePath)
        .then((stat) => stat.size)
        .catch(() => 0);
    }
    const headers = { "user-agent": "Atlas" };
    if (existingBytes > 0) headers.range = `bytes=${existingBytes}-`;

    await setState(item.id, "downloading", { error: "" });

    const { response, finalUrl } = await requestWithRedirects(item.url, { headers });
    controller.response = response;
    const status = response.statusCode || 0;

    if (status === 416) {
      // Range not satisfiable: we already have the whole file.
      response.resume();
      await finishFile(item.id, item.filePath, existingBytes);
      return;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new Error(`Server responded ${status}`);
    }

    // A server that ignores Range replies 200 and restarts the body, so the
    // partial file has to be thrown away rather than appended to.
    const isResume = status === 206 && existingBytes > 0;
    if (existingBytes > 0 && !isResume) existingBytes = 0;

    const declaredLength = Number(response.headers["content-length"]) || 0;
    const totalBytes = isResume ? existingBytes + declaredLength : declaredLength;

    let filePath = item.filePath;
    if (!filePath || !isResume) {
      const fileName = item.fileName || deriveFileName(item, response, finalUrl);
      filePath = await uniquePath(path.join(downloadsDir, fileName));
      await downloadsDb.updateDownload(item.id, {
        filePath,
        fileName: path.basename(filePath),
      });
    }

    await downloadsDb.updateDownload(item.id, {
      totalBytes,
      receivedBytes: existingBytes,
    });
    await publish(item.id);

    const fileStream = fs.createWriteStream(filePath, {
      flags: isResume ? "a" : "w",
    });
    controller.stream = fileStream;

    let received = existingBytes;
    let lastReport = 0;
    response.on("data", (chunk) => {
      received += chunk.length;
      const stamp = Date.now();
      if (stamp - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = stamp;
        // Fire and forget: a dropped progress tick is harmless, and awaiting it
        // inside the data handler would stall the stream.
        downloadsDb
          .updateDownload(item.id, { receivedBytes: received })
          .then(() => publish(item.id))
          .catch(() => {});
      }
    });

    await pipeline(response, fileStream);

    if (controller.canceled) {
      await fsp.rm(filePath, { force: true }).catch(() => {});
      await setState(item.id, "canceled", { receivedBytes: 0 });
      return;
    }
    if (controller.paused) {
      await setState(item.id, "paused", { receivedBytes: received });
      return;
    }

    await downloadsDb.updateDownload(item.id, { receivedBytes: received });
    await finishFile(item.id, filePath, received);
  } catch (err) {
    const controllerState = active.get(item.id);
    if (controllerState?.canceled) {
      await setState(item.id, "canceled");
    } else if (controllerState?.paused) {
      await setState(item.id, "paused");
    } else {
      await setState(item.id, "failed", { error: err.message || String(err) });
    }
  } finally {
    active.delete(item.id);
    scheduleRunner();
  }
};

// ── Completion ───────────────────────────────────────────────────────────────

// A finished file: sanity-check it, then hand it to the attach step. Verifying is
// intentionally cheap — we have no checksum from these hosts, so all we can
// assert is that the file exists and matches the length the server promised.
const finishFile = async (id, filePath, receivedBytes) => {
  await setState(id, "verifying");
  const item = await downloadsDb.getDownload(id);
  if (!item) return;

  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || stat.size === 0) {
    await setState(id, "failed", { error: "Downloaded file is missing or empty" });
    return;
  }
  if (item.totalBytes > 0 && stat.size !== item.totalBytes) {
    await setState(id, "failed", {
      error: `Incomplete: got ${stat.size} of ${item.totalBytes} bytes`,
      receivedBytes: stat.size,
    });
    return;
  }

  await downloadsDb.updateDownload(id, {
    receivedBytes: receivedBytes ?? stat.size,
    totalBytes: item.totalBytes || stat.size,
    filePath,
    fileName: path.basename(filePath),
  });

  if (!attachHandler) {
    // Nothing wired to extract and attach: the bytes are on disk and the user
    // can import manually, which is a better outcome than reporting failure.
    await setState(id, "done", { completedAt: Math.floor(Date.now() / 1000) });
    return;
  }

  try {
    await setState(id, "extracting");
    const result = await attachHandler({
      item: await downloadsDb.getDownload(id),
      filePath,
      setState: (state, patch) => setState(id, state, patch),
    });
    if (result?.success) {
      await setState(id, "done", {
        completedAt: Math.floor(Date.now() / 1000),
        version: result.version || item.version || "",
        recordId: result.recordId ?? item.recordId ?? null,
        error: "",
      });
      emit("download-complete", await downloadsDb.getDownload(id));
    } else {
      await setState(id, "failed", {
        error: result?.error || "Could not add the downloaded version",
      });
    }
  } catch (err) {
    await setState(id, "failed", { error: err.message || String(err) });
  }
};

// ── Queue runner ─────────────────────────────────────────────────────────────

const scheduleRunner = () => {
  if (runnerScheduled) return;
  runnerScheduled = true;
  setImmediate(async () => {
    runnerScheduled = false;
    try {
      while (active.size < MAX_CONCURRENT) {
        const next = await downloadsDb.claimNextQueued();
        if (!next) break;
        // Mark it taken before awaiting anything else, or two runner passes can
        // claim the same row.
        await downloadsDb.updateDownload(next.id, { state: "downloading" });
        startTransfer({ ...next, state: "downloading" });
      }
    } catch (err) {
      console.error("Download runner failed:", err.message);
    }
  });
};

// ── Public actions ───────────────────────────────────────────────────────────

const enqueue = async (payload) => {
  const result = await downloadsDb.enqueueDownload(payload);
  if (result.success) {
    emit("download-added", result.item);
    scheduleRunner();
  }
  return result;
};

const pause = async (id) => {
  const controller = active.get(id);
  if (controller) {
    controller.paused = true;
    controller.stream?.close?.();
    controller.response?.destroy?.();
    return { success: true };
  }
  // Not running yet — just take it out of the runnable set.
  const item = await downloadsDb.getDownload(id);
  if (!item) return { success: false, error: "Download not found" };
  if (item.state === "queued") {
    await setState(id, "paused");
    return { success: true };
  }
  return { success: false, error: `Cannot pause a ${item.state} download` };
};

const resume = async (id) => {
  const item = await downloadsDb.getDownload(id);
  if (!item) return { success: false, error: "Download not found" };
  if (!item.url) {
    // No URL to resume from: back to waiting for the user's own file.
    await setState(id, "awaiting_file", { error: "" });
    return { success: true };
  }
  await setState(id, "queued", { error: "" });
  scheduleRunner();
  return { success: true };
};

const cancel = async (id) => {
  const controller = active.get(id);
  if (controller) {
    controller.canceled = true;
    controller.stream?.close?.();
    controller.response?.destroy?.();
    return { success: true };
  }
  const item = await downloadsDb.getDownload(id);
  if (!item) return { success: false, error: "Download not found" };
  if (item.filePath) await fsp.rm(item.filePath, { force: true }).catch(() => {});
  await setState(id, "canceled", { receivedBytes: 0 });
  return { success: true };
};

const retry = async (id) => {
  const item = await downloadsDb.getDownload(id);
  if (!item) return { success: false, error: "Download not found" };
  // A failed partial may be corrupt, so a retry starts clean rather than trying
  // to resume onto a file we no longer trust.
  if (item.filePath) await fsp.rm(item.filePath, { force: true }).catch(() => {});
  await downloadsDb.updateDownload(id, { receivedBytes: 0, filePath: "", error: "" });
  return resume(id);
};

const remove = async (id, { deleteFile = false } = {}) => {
  await cancel(id).catch(() => {});
  const item = await downloadsDb.getDownload(id);
  if (deleteFile && item?.filePath) {
    await fsp.rm(item.filePath, { force: true }).catch(() => {});
  }
  await downloadsDb.removeDownload(id);
  emit("download-removed", { id });
  return { success: true };
};

const reorder = async (ids) => {
  await downloadsDb.reorderDownloads(ids);
  emit("downloads-reordered", { ids });
  scheduleRunner();
  return { success: true };
};

// ── Watch folder ─────────────────────────────────────────────────────────────

// Score how well a filename matches a queued item. Used to adopt files the user
// downloaded themselves through a browser.
//
// Deliberately conservative: a wrong match would attach the wrong build to a
// game, which is worse than asking. Only a title-token match plus (if the item
// knows a version) that version string in the name is accepted.
const scoreFileAgainstItem = (fileName, item) => {
  const haystack = fileName.toLowerCase().replace(/[\W_]+/g, " ");
  const titleTokens = String(item.title || "")
    .toLowerCase()
    .replace(/[\W_]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 2);
  if (titleTokens.length === 0) return 0;
  const hits = titleTokens.filter((token) => haystack.includes(token)).length;
  const titleRatio = hits / titleTokens.length;
  if (titleRatio < 0.6) return 0;

  let score = titleRatio;
  const version = String(item.version || "").toLowerCase().replace(/^v/, "");
  if (version) {
    const normalized = version.replace(/[\W_]+/g, " ").trim();
    // A version match is a strong signal; its absence is not disqualifying,
    // because plenty of uploads omit it from the filename.
    if (normalized && haystack.includes(normalized)) score += 1;
  }
  return score;
};

const adoptFile = async (filePath) => {
  const candidates = await downloadsDb.listAwaitingFile();
  if (candidates.length === 0) return null;
  const fileName = path.basename(filePath);

  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreFileAgainstItem(fileName, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Require a title match at minimum. Below this, leave the file alone.
  if (!best || bestScore < 0.6) return null;

  await downloadsDb.updateDownload(best.id, {
    filePath,
    fileName,
    source: best.source || "watch-folder",
  });
  const stat = await fsp.stat(filePath).catch(() => null);
  await finishFile(best.id, filePath, stat?.size || 0);
  return best.id;
};

// Files still being written must be left alone until their size stops changing.
const pendingFiles = new Map();

const considerFile = (filePath) => {
  // Browser partial-download suffixes. Nothing to do until they are renamed.
  if (/\.(crdownload|part|partial|tmp|download)$/i.test(filePath)) return;
  pendingFiles.set(filePath, { size: -1, stableSince: 0 });
};

const sweepPendingFiles = async () => {
  for (const [filePath, tracked] of Array.from(pendingFiles.entries())) {
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      pendingFiles.delete(filePath);
      continue;
    }
    if (stat.size !== tracked.size) {
      pendingFiles.set(filePath, { size: stat.size, stableSince: Date.now() });
      continue;
    }
    if (stat.size > 0 && Date.now() - tracked.stableSince >= WATCH_SETTLE_MS) {
      pendingFiles.delete(filePath);
      await adoptFile(filePath).catch((err) =>
        console.warn(`Watch folder could not adopt ${filePath}:`, err.message),
      );
    }
  }
};

const startWatching = () => {
  stopWatching();
  const dir = getDownloadsDir();
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (eventType, fileName) => {
      if (!fileName) return;
      considerFile(path.join(dir, fileName));
    });
    watcher.on("error", (err) => console.warn("Download watcher error:", err.message));
    watchTimer = setInterval(() => {
      sweepPendingFiles().catch(() => {});
    }, 1000);
    console.log(`Watching downloads folder: ${dir}`);
  } catch (err) {
    console.warn("Could not watch the downloads folder:", err.message);
  }
};

const stopWatching = () => {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  pendingFiles.clear();
};

const start = async () => {
  await downloadsDb.initializeDownloads();
  startWatching();
  scheduleRunner();
};

module.exports = {
  configure,
  start,
  stopWatching,
  startWatching,
  enqueue,
  pause,
  resume,
  cancel,
  retry,
  remove,
  reorder,
  adoptFile,
  scoreFileAgainstItem,
  MAX_CONCURRENT,
};
