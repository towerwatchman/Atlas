"use strict";

// ── Update links ─────────────────────────────────────────────────────────────
//
// Fetches a game's F95 thread under the USER's own session and returns the
// download links they can actually use.
//
// The catalog's stored links are deliberately not used. Masked URLs embed the
// requesting account's user id inside an HMAC-signed payload, so a link scraped
// under one account cannot be opened by another. Every user has to mint their
// own, which means fetching the thread client-side.
//
// Results are cached for the session. Opening the update modal, closing it and
// reopening should not cost a second request - F95 sees one desktop client per
// user and there is no reason to make that busier than a browser would be. The
// cache is dropped on restart, which is the same lifetime the rest of the
// client's catalog state has.

const { ipcMain } = require("electron");

const accountStore = require("../accounts/accountStore");
const { parseThreadDownloads } = require("../downloads/f95ThreadParser");
const { selectDownloadableLinks } = require("../downloads/groupClassifier");

const THREAD_URL = "https://f95zone.to/threads/{id}/";
// A plausible desktop UA, matching what xenforoAuth already sends. The cookie
// is what authenticates; this just keeps the forum from gating us as a bot.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Hosts with a working download plugin, read from the registry rather than
// hand-maintained - a list that has to be updated alongside every new plugin
// is a list that will drift. Offering a mirror with no plugin behind it hands
// the user a link that downloads the host's html page instead of the game.
const { supportedHostIds } = require("../downloads/hosts");

const SUPPORTED_HOSTS = new Set(supportedHostIds());

// threadId -> { at, payload }
const cache = new Map();

const cacheKey = (threadId) => String(threadId);

function clearUpdateLinkCache(threadId = null) {
  if (threadId == null) cache.clear();
  else cache.delete(cacheKey(threadId));
}

async function fetchThreadHtml(threadId) {
  const url = THREAD_URL.replace("{id}", encodeURIComponent(String(threadId)));
  // ensureFreshCookies is async and returns a boolean; getCookieHeaderForUrl is
  // SYNCHRONOUS and returns a string. Getting that wrong is what produced
  // ".catch is not a function" - neither is a thenable to be chained onto.
  //
  // A false return is meaningful rather than incidental: browser-added accounts
  // store no password, so an expired session cannot be refreshed headlessly and
  // the user has to sign in again. Saying so beats a generic failure.
  let fresh = false;
  try {
    fresh = await accountStore.ensureFreshCookies("f95");
  } catch (err) {
    console.warn("Could not refresh F95 cookies:", err.message);
  }
  const cookieHeader = accountStore.getCookieHeaderForUrl(url) || "";
  if (!cookieHeader) {
    const error = new Error(
      "You need to be signed in to F95zone to see download links. Add your account in Settings.",
    );
    error.code = "NO_SESSION";
    throw error;
  }
  if (!fresh) {
    // Cookies exist but did not verify. Try them anyway - checkCookiesLive can
    // fail on a transient network blip - and let the logged-in check below
    // catch a genuinely dead session.
    console.warn("F95 cookies did not verify as fresh; attempting the fetch anyway");
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
    throw new Error(`F95zone returned ${response.status} for thread ${threadId}`);
  }
  return response.text();
}

/**
 * Download links for one thread, filtered to what this machine can use.
 *
 * Returns `singles` (offerable) and `hiddenMultiPart` so the modal can explain
 * split archives it deliberately left out - see groupClassifier for why those
 * are not offered.
 */
async function getUpdateLinks(threadId, { force = false } = {}) {
  const key = cacheKey(threadId);
  if (!force && cache.has(key)) {
    return { ...cache.get(key).payload, cached: true };
  }

  const html = await fetchThreadHtml(threadId);
  const parsed = parseThreadDownloads(html);

  if (!parsed.found) {
    throw new Error("Could not read the thread. It may have been removed or moved.");
  }
  // A guest render has no masked links at all, which is the clearest signal
  // that the session did not apply.
  if (parsed.loggedIn === false) {
    const error = new Error(
      "F95zone did not recognise your session. Re-add your account in Settings.",
    );
    error.code = "NOT_LOGGED_IN";
    throw error;
  }

  const selection = selectDownloadableLinks(parsed.downloads, {
    supportedHosts: SUPPORTED_HOSTS.size > 0 ? SUPPORTED_HOSTS : null,
  });

  const payload = {
    ok: true,
    threadId: String(threadId),
    // Re-interleaved into POST ORDER. The selection splits one ordered list into
    // singles, sets and unsupported; concatenating those buckets would render
    // every unsupported build after every working one, which puts Being a DIK's
    // CURRENT build underneath three older ones. The poster listed it first for a
    // reason.
    links: [
      ...selection.singles.map(({ link, verdict, index }) => ({
        order: index,
        url: link.url,
        host: link.host,
        label: link.label,
        // The build label alone. Platform travels beside it rather than inside it,
        // so two DLCs that were both posted for Win/Linux/Mac stay two options.
        group: link.group,
        platform: link.platform || '',
        masked: link.masked,
        compressed: verdict.compressed,
        platforms: verdict.platforms,
        // One file. `files` is present on every option so a consumer never has
        // to branch on which kind it is holding.
        files: [{ url: link.url, host: link.host, label: link.label, masked: link.masked }],
        partCount: 1,
      })),
      // A complete split archive: ONE option that fetches every part. `url` is
      // the first part so that a consumer which only reads `url` still gets a
      // valid link rather than undefined - but such a consumer would fetch a
      // fragment, which is why partCount is there to be checked.
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
      // Mirrors with no plugin behind them. Carried so the modal can SHOW the
      // build and say why it cannot fetch it, rather than omitting a build the
      // thread visibly offers. `unsupported` is what stops them being treated as
      // choosable; buildDownloadOptions drops them from any build that also has
      // a working mirror, so they only ever surface when they are all there is.
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
    // Only non-zero when split archives were actually found, so the modal can
    // stay silent for the games that have none.
    hiddenMultiPart: selection.hiddenMultiPart,
    // Same contract for builds refused on platform. Platform is its own axis now,
    // so these vanish from the list unless something says so.
    hiddenPlatform: selection.hiddenPlatform,
    // Counted rather than listed: useful as "12 links were for other
    // platforms" without cluttering the modal.
    rejectedCount: selection.rejected.length,
    fetchedAt: Date.now(),
  };

  cache.set(key, { at: Date.now(), payload });
  return { ...payload, cached: false };
}

function registerUpdateLinkHandlers() {
  ipcMain.handle("update-links-get", async (event, { threadId, force = false } = {}) => {
    try {
      if (!threadId) return { ok: false, error: "No F95 thread id for this game" };
      return await getUpdateLinks(threadId, { force });
    } catch (err) {
      return { ok: false, code: err.code || "", error: err.message || String(err) };
    }
  });

  ipcMain.handle("update-links-clear-cache", async (event, { threadId = null } = {}) => {
    clearUpdateLinkCache(threadId);
    return { ok: true };
  });
}

module.exports = registerUpdateLinkHandlers;
module.exports.getUpdateLinks = getUpdateLinks;
module.exports.clearUpdateLinkCache = clearUpdateLinkCache;
module.exports.SUPPORTED_HOSTS = SUPPORTED_HOSTS;
