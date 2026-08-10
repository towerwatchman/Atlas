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
const { resolveDirectUrl, pluginFor } = require("./hosts");
// Contract extension for hosts that serve ciphertext. See hosts/megaDecrypt.js:
// MEGA has no URL that yields plaintext, so rather than give it a private
// downloader -- a second copy of the resume, progress and cancellation logic
// below -- a plugin may return a `decrypt` descriptor and the response is piped
// through the transform it names.
const { createMegaDecryptStream } = require("./hosts/megaDecrypt");
const appLog = require("../appLog");

const DECRYPT_FACTORIES = {
  mega: (spec, startOffset) => createMegaDecryptStream({ ...spec, startOffset }),
};

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

// ── Retry policy ─────────────────────────────────────────────────────────────
// A transient failure gets one automatic retry after a pause; a second failure
// stops and waits for the user. Quota is terminal immediately - waiting sixty
// seconds does not restore a daily transfer allowance, and retrying into a wall
// just burns through the queue. Auth is terminal for the same reason:
// credentials do not fix themselves.
const RETRY_DELAY_MS = 60_000;
const MAX_AUTO_RETRIES = 1;
const TERMINAL_KINDS = new Set(["quota", "auth", "fatal", "blocked", "challenge"]);

// Reasons a user can act on, rather than a raw error they cannot.
//
// These are a FALLBACK, used when a plugin had nothing more specific to say. They
// used to take precedence, which meant a plugin's real explanation was thrown
// away in favour of a generic sentence -- and the generic sentence was sometimes
// flatly untrue. A Pixeldrain /d/ link that Atlas could not parse, and a
// Pixeldrain album that has to be downloaded from a browser, were both reported
// as "This link is no longer available" for files that existed. The plugin knows
// which of the several fatal causes it hit; this map cannot.
const KIND_MESSAGES = {
  quota: "Transfer limit reached on this host. Try again later, or add an account in Settings.",
  auth: "The host rejected your account details. Check them in Settings.",
  fatal: "This link is no longer available.",
  blocked: "The host has flagged this file as malware and blocked automatic downloads.",
  challenge: "This host asked for a browser check that could not be completed. Open the link in your browser and Atlas will pick up the file.",
};

// Per-session attempt counts and pending retry timers, keyed by download id.
// Not persisted: a restart is a reasonable moment to try again.
const attempts = new Map();
const retryTimers = new Map();

const cancelRetry = (id) => {
  const timer = retryTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(id);
  }
};

// Live transfers, keyed by download id, so pause/cancel can reach into them.
const active = new Map();
let runnerScheduled = false;
let emitter = null;
let watcher = null;
let watchTimer = null;
let getDownloadsDir = () => "";
// Per-host credentials, keyed by plugin id. Injected rather than required
// so the manager never touches the credential store directly.
let getHostCredentials = () => ({});
// Opens a URL in a real browser window and reports where it landed. Injected
// rather than required so the manager keeps no dependency on Electron.
let resolveInBrowser = null;

// ── Events ───────────────────────────────────────────────────────────────────

const configure = ({ onEvent, resolveDownloadsDir, resolveHostCredentials, browserResolver }) => {
  emitter = typeof onEvent === "function" ? onEvent : null;
  if (typeof resolveDownloadsDir === "function") getDownloadsDir = resolveDownloadsDir;
  if (typeof resolveHostCredentials === "function") getHostCredentials = resolveHostCredentials;
  if (typeof browserResolver === "function") resolveInBrowser = browserResolver;
  // Called with a completed file so the caller can extract it and attach the
  // version. Kept as an injected callback rather than a direct require so this
  // module has no dependency on the importer's internals.
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

    // A resolved link is usually a share PAGE, not a file. Ask the host plugin
    // to translate it before a single byte moves - without this, fetching
    // https://pixeldrain.com/u/UPND8Ncr writes 4KB of HTML and calls it a game.
    //
    // Probing first also means a dead or rate-limited link fails immediately
    // with a real reason, instead of after a partial transfer.
    let transferUrl = item.url;
    let resolvedInBrowser = false;

    // Hosts fronted by a challenge cannot be resolved from Node: Cloudflare
    // asks for User-Agent Client Hints that only a real browser answers. The
    // Electron window already clears those honestly, so it is used here rather
    // than trying to imitate a browser from a fetch.
    const plugin = pluginFor(item.url);
    if (plugin?.requiresBrowser && resolveInBrowser) {
      const fileId = plugin.fileIdFrom ? plugin.fileIdFrom(item.url) : null;
      if (!fileId) {
        await handleFailure(item.id, "fatal", "Could not read a file id from this link");
        return;
      }
      let origin;
      try {
        origin = new URL(item.url).origin;
      } catch {
        await handleFailure(item.id, "fatal", "Malformed link");
        return;
      }
      const target = plugin.browserPath
        ? `${origin}${plugin.browserPath(fileId)}`
        : item.url;

      await setState(item.id, "downloading", { error: "" });
      const resolved = await resolveInBrowser(target, {
        gateHosts: plugin.gateHosts,
        title: item.title,
      }).catch((err) => ({ ok: false, error: err.message }));

      if (!resolved?.ok || !resolved.url) {
        await handleFailure(
          item.id,
          resolved?.canceled ? "challenge" : "transient",
          resolved?.error || "The browser did not reach a download link",
        );
        return;
      }
      transferUrl = resolved.url;
      resolvedInBrowser = true;
      await downloadsDb.updateDownload(item.id, { host: item.host || plugin.id });
    }

    // Skipped when the window already produced the file URL: re-probing would
    // walk straight back into the challenge it just cleared.
    // Set by a plugin whose bytes arrive encrypted. Null for every other host.
    let decryptSpec = null;
    const probe = resolvedInBrowser
      ? { ok: true, passthrough: true }
      : await resolveDirectUrl(item.url, getHostCredentials());
    if (!probe.ok) {
      // A plugin may attach a diagnostic describing what it actually saw.
      // Logging it is the difference between "transfer limit reached" and
      // knowing which URL was requested and what came back - the classified
      // kind alone is a conclusion, not evidence.
      //
      // Logged for EVERY failed probe, not only when a plugin attached a
      // diagnostic. The link Atlas actually requested is the single most useful
      // fact about a failure and it is not always the link the user pasted -- a
      // masked link is resolved first, so the two can differ. A Pixeldrain report
      // stalled precisely here: the error named the wrong cause and there was no
      // record of which URL produced it.
      //
      // Through appLog rather than console.log: main-process console output goes
      // to a stream that does not exist in a packaged build, which is where every
      // one of these failures happens.
      appLog.write("download-probe", {
        host: item.host,
        url: item.url,
        kind: probe.kind,
        error: probe.error,
        ...(probe.diagnostic || {}),
      });
      await handleFailure(item.id, probe.kind || "transient",
        probe.error || "Could not prepare this download");
      return;
    }
    if (!probe.passthrough) {
      transferUrl = probe.directUrl || item.url;
      decryptSpec = probe.decrypt || null;
      Object.assign(headers, probe.headers || {});
      // The host knows the real filename and size; both are better than
      // anything guessable from the URL, and the size gives an honest
      // progress bar instead of an indeterminate one.
      await downloadsDb.updateDownload(item.id, {
        ...(probe.fileName && !item.fileName ? { fileName: probe.fileName } : {}),
        ...(probe.fileSize ? { totalBytes: probe.fileSize } : {}),
        // Keep the real hostname. Overwriting it with the plugin id
        // ("pixeldrain" rather than "pixeldrain.com") broke the favicon lookup
        // and made the row read less clearly.
        host: item.host || probe.plugin,
      });
    }

    if (existingBytes > 0) headers.range = `bytes=${existingBytes}-`;

    await setState(item.id, "downloading", { error: "" });

    const { response, finalUrl } = await requestWithRedirects(transferUrl, { headers });
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
      // Plugin-reported name wins: it is the uploader's actual filename,
      // where deriveFileName can only guess from headers or the url path.
      const fileName = probe.fileName || item.fileName
        || deriveFileName(item, response, finalUrl);
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

    // Insert the plugin's transform when there is one. The manager still owns the
    // transfer: progress is counted on the response above, so a percentage still
    // reflects bytes received rather than bytes decrypted, and cancellation still
    // destroys the same stream.
    let decryptStream = null;
    if (decryptSpec) {
      const factory = DECRYPT_FACTORIES[decryptSpec.kind];
      if (!factory) {
        await handleFailure(item.id, "fatal",
          `This download needs a decryption method Atlas does not have: ${decryptSpec.kind}`);
        return;
      }
      try {
        decryptStream = factory(decryptSpec, existingBytes);
      } catch (err) {
        // A resume that cannot be aligned to the cipher's block boundary. Failing
        // is right: the alternative is a file of noise that passes every length
        // check the completion step makes.
        await handleFailure(item.id, "fatal",
          `Could not resume this encrypted download: ${err.message}`);
        return;
      }
    }

    await (decryptStream
      ? pipeline(response, decryptStream, fileStream)
      : pipeline(response, fileStream));

    if (controller.canceled) {
      await fsp.rm(filePath, { force: true }).catch(() => {});
      await setState(item.id, "canceled", { receivedBytes: 0 });
      return;
    }
    if (controller.paused) {
      await setState(item.id, "paused", { receivedBytes: received });
      return;
    }

    // Integrity, where the host gives us something to check against. Only
    // possible once the last byte has arrived, so a large file can transfer
    // completely and still be rejected here -- the message has to say that the
    // bytes are wrong rather than something generic, because the file looks
    // perfectly complete by every other measure.
    if (decryptStream) {
      const verified = decryptStream.verify();
      if (verified === false) {
        await fsp.rm(filePath, { force: true }).catch(() => {});
        await handleFailure(item.id, "transient",
          "The file downloaded but failed MEGA's integrity check, so it is corrupt. "
          + "The partial file was removed; retrying downloads it again.");
        return;
      }
      // null means "not computed", which a resumed transfer cannot do: the MAC is
      // sequential over the whole file and this stream only saw part of it.
      // Distinguished from a failure rather than collapsed into one boolean.
      if (verified === null) {
        appLog.write("download-verify", {
          id: item.id, host: item.host, reason: "mac-not-computed",
          resumed: existingBytes > 0,
        });
      }
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
      // Socket-level failures never reach a plugin's classifier, so they are
      // treated as transient and get the one retry.
      await handleFailure(item.id, "transient", err.message || String(err));
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

  // Stop here. The bytes are on disk and verified, but installing means
  // choosing a version string that becomes a folder name and may REPLACE an
  // existing build - so it waits for the user to confirm rather than acting on
  // a filename guess. The renderer drives the rest via downloads-install.
  attempts.delete(id);
  await setState(id, "ready");
  emit("download-complete", await downloadsDb.getDownload(id));
};

// State transitions for callers outside this module - specifically the
// installer in ipc/importer.js, which owns extraction because that is where
// the 7-Zip resolution and config context live. Routing through here keeps the
// event broadcast in one place instead of two.
const setItemState = (id, state, patch = {}) => setState(id, state, patch);

// ── Queue runner ─────────────────────────────────────────────────────────────

/**
 * Record a failure and decide what happens next.
 *
 * Terminal kinds stop immediately with an explanation. A transient failure gets
 * one automatic retry; the second stops and waits, because something silently
 * retrying forever is worse than something that says it failed.
 */
const handleFailure = async (id, kind, message) => {
  const used = attempts.get(id) || 0;

  if (TERMINAL_KINDS.has(kind)) {
    attempts.delete(id);
    await setState(id, "failed", {
      // Plugin first. Every message a plugin returns on a terminal path is
      // written for the user; the generic is what is left when it had nothing.
      error: message || KIND_MESSAGES[kind],
      // Quota and auth leave the partial file alone: those bytes are still
      // good and a later resume should not start from zero.
      ...(kind === "fatal" ? { receivedBytes: 0 } : {}),
    });
    return;
  }

  if (used >= MAX_AUTO_RETRIES) {
    attempts.delete(id);
    await setState(id, "failed", { error: `${message} (retried once)` });
    return;
  }

  attempts.set(id, used + 1);
  await setState(id, "paused", {
    error: `${message} — retrying in ${Math.round(RETRY_DELAY_MS / 1000)}s`,
  });
  cancelRetry(id);
  retryTimers.set(id, setTimeout(async () => {
    retryTimers.delete(id);
    const current = await downloadsDb.getDownload(id).catch(() => null);
    // Only resume if the user has not cancelled or removed it meanwhile.
    if (!current || current.state !== "paused") return;
    await downloadsDb.updateDownload(id, { state: "queued", error: "" });
    await publish(id);
    scheduleRunner();
  }, RETRY_DELAY_MS));
};

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
  // An explicit pause overrides a pending automatic retry.
  cancelRetry(id);
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
  cancelRetry(id);
  attempts.delete(id);
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
  // A manual retry resets the automatic counter: the user has intervened.
  cancelRetry(id);
  attempts.delete(id);
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
  setItemState,
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
