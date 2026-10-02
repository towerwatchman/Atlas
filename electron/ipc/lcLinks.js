"use strict";

// ── LewdCorner links ──────────────────────────────────────────────────────────
//
// Separate module beside updateLinks.js, so F95 behavior cannot regress.
// Per-session cache keyed `lc:{id}`; updateLinks.js uses `f95:{id}`.
// Tier gate mirrors Browse: links are offered only when the user is VIP or
// the thread tier is exactly 'Free'; an unknown thread tier stays hidden.

const { ipcMain } = require("electron");

const accountStore = require("../accounts/accountStore");
const { SITES } = require("../downloads/xenforoThreadParser");
const { parseLcThreadDownloads } = require("../downloads/lcThreadParser");
const { selectDownloadableLinks } = require("../downloads/groupClassifier");

const THREAD_URL = `${SITES.lewdcorner.base}/threads/{id}/`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const { supportedHostIds } = require("../downloads/hosts");

const SUPPORTED_HOSTS = new Set(supportedHostIds());

// lc:{id} -> { at, payload }
const cache = new Map();

const cacheKey = (lcId) => `lc:${String(lcId)}`;

function cacheHas(key) {
  return cache.has(key);
}

function clearLcLinkCache(lcId = null) {
  if (lcId == null) cache.clear();
  else cache.delete(cacheKey(lcId));
}

// Plain PK probe on lewdcorner_data, same cost as the Browse join. Exact
// match only: 'free', 'Free Tier' and '' do not count.
let tierLookup = null;

function setTierLookup(fn) {
  tierLookup = fn;
}

function getThreadTier(lcId) {
  if (tierLookup) return tierLookup(lcId);
  return new Promise((resolve) => {
    let db = null;
    try {
      db = require("../db/index").db;
    } catch {
      resolve(null);
      return;
    }
    if (!db) {
      resolve(null);
      return;
    }
    db.get(`SELECT tier FROM lewdcorner_data WHERE lc_id = ?`, [Number(lcId)], (err, row) => {
      if (err) resolve(null);
      else resolve(row?.tier ?? null);
    });
  });
}

async function fetchThreadHtml(lcId) {
  const url = THREAD_URL.replace("{id}", encodeURIComponent(String(lcId)));
  let fresh = false;
  try {
    fresh = await accountStore.ensureFreshCookies("lewdcorner");
  } catch (err) {
    console.warn("Could not refresh LewdCorner cookies:", err.message);
  }
  const cookieHeader = accountStore.getCookieHeaderForUrl(url) || "";
  if (!cookieHeader) {
    // Logged-out visitors can read the thread but the server withholds the
    // download links, so there is nothing to fetch without a session.
    const error = new Error(
      "You need to be signed in to LewdCorner to see download links. Add your account in Settings.",
    );
    error.code = "NO_SESSION";
    throw error;
  }
  if (!fresh) {
    console.warn("LewdCorner cookies did not verify as fresh; attempting the fetch anyway");
  }
  const response = await fetch(url, {
    headers: {
      cookie: cookieHeader,
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`LewdCorner returned ${response.status} for thread ${lcId}`);
  }
  return response.text();
}

/**
 * Download links for one LC thread, filtered to what this machine can use.
 * Tier-gated before the fetch result is offered: a local DB edit unhides the
 * row only, the server still serves a guest render to non-members.
 */
async function getLcLinks(lcId, { force = false } = {}) {
  const key = cacheKey(lcId);
  if (!force && cache.has(key)) {
    return { ...cache.get(key).payload, cached: true };
  }

  const html = await fetchThreadHtml(lcId);
  const parsed = parseLcThreadDownloads(html);

  if (!parsed.found) {
    throw new Error("Could not read the thread. It may have been removed or moved.");
  }
  if (parsed.loggedIn === false) {
    const error = new Error(
      "LewdCorner did not recognise your session. Re-add your account in Settings.",
    );
    error.code = "NOT_LOGGED_IN";
    throw error;
  }

  const userTier = accountStore.getLcUserTier();
  const threadTier = await getThreadTier(lcId);
  if (userTier !== "VIP" && threadTier !== "Free") {
    const error = new Error(
      "This thread needs LewdCorner Member+ — upgrade on lewdcorner.com to unlock it.",
    );
    error.code = "TIER_RESTRICTED";
    throw error;
  }

  const selection = selectDownloadableLinks(parsed.downloads, {
    supportedHosts: SUPPORTED_HOSTS.size > 0 ? SUPPORTED_HOSTS : null,
  });

  const payload = {
    ok: true,
    threadId: String(lcId),
    links: [
      ...selection.singles.map(({ link, verdict, index }) => ({
        order: index,
        url: link.url,
        host: link.host,
        label: link.label,
        group: link.group,
        platform: link.platform || '',
        masked: link.masked,
        compressed: verdict.compressed,
        platforms: verdict.platforms,
        files: [{ url: link.url, host: link.host, label: link.label, masked: link.masked }],
        partCount: 1,
      })),
      ...selection.offerableSets.map((set) => {
        const files = set.parts.map(({ link }) => ({
          url: link.url, host: link.host, label: link.label, masked: link.masked,
        }));
        const first = set.parts[0];
        return {
          url: files[0].url,
          host: set.host,
          label: `${first.link.label} (${files.length} parts)`,
          group: set.group,
          platform: set.platform || '',
          masked: files.some((file) => file.masked),
          compressed: first.verdict.compressed,
          platforms: first.verdict.platforms,
          files,
          partCount: files.length,
          order: set.index,
        };
      }),
      ...selection.unsupportedHost.map(({ link, verdict, index }) => ({
        order: index,
        url: link.url,
        host: link.host,
        label: link.label,
        group: link.group,
        platform: link.platform || '',
        masked: link.masked,
        compressed: verdict.compressed,
        platforms: verdict.platforms,
        files: [{ url: link.url, host: link.host, label: link.label, masked: link.masked }],
        partCount: 1,
        unsupported: true,
      })),
    ].sort((a, b) => a.order - b.order),
    hiddenMultiPart: selection.hiddenMultiPart,
    hiddenPlatform: selection.hiddenPlatform,
    rejectedCount: selection.rejected.length,
    fetchedAt: Date.now(),
  };

  cache.set(key, { at: Date.now(), payload });
  return { ...payload, cached: false };
}

async function ipcHandler({ lcId, force = false } = {}) {
  try {
    if (!lcId) return { ok: false, error: "No LewdCorner thread id for this game" };
    return await getLcLinks(lcId, { force });
  } catch (err) {
    console.warn(`lewdcorner-links-get failed for thread ${lcId ?? '?'}:`, err.message || err);
    return { ok: false, code: err.code || "", error: err.message || String(err) };
  }
}

function registerLcLinkHandlers() {
  // LC thread links under the user's own session. Tier-gated like Browse.
  ipcMain.handle("lewdcorner-links-get", async (event, params) => ipcHandler(params));

  // Drops the per-session lc: cache so a re-login takes effect at once.
  ipcMain.handle("lewdcorner-links-clear-cache", async (event, { lcId = null } = {}) => {
    clearLcLinkCache(lcId);
    return { ok: true };
  });
}

module.exports = registerLcLinkHandlers;
module.exports.getLcLinks = getLcLinks;
module.exports.clearLcLinkCache = clearLcLinkCache;
module.exports.cacheHas = cacheHas;
module.exports.SUPPORTED_HOSTS = SUPPORTED_HOSTS;
module.exports.__testables = { setTierLookup, ipcHandler, cacheKey };
