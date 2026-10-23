"use strict";

// ── Forum fetches through a real window (threads and arbitrary pages) ──
//
// The headless requests (Node fetch, axios, even ses.fetch with a stored
// cf_clearance) all eat cf-mitigated=challenge: the clearance harvested by
// the ephemeral login window dies with it, and the resolver partition only
// holds a grant after a challenge is actually solved inside it. So the page
// itself loads in a window on the persistent resolver partition: hidden
// while it passes unchallenged, revealed for the user to tick the checkbox
// when it does not. A solved grant then persists for later fetches.
//
// Only used when a full Electron runtime is present; the test stubs provide
// no BrowserWindow and keep the plain-fetch path.

const { RESOLVER_PARTITION, applyCookies, F95_HOST, isCloudflareChallenge } = require("./maskedResolver");
const appLog = require("../appLog");

const CHALLENGE_MARKERS = /just a moment|verify you are human|attention required|cf-chl|turnstile|checking your browser/i;

// Watchdog per executeJavaScript read, so one hung read cannot stall the poll
// loop; the failed read is retried on the next tick.
const POLL_READ_TIMEOUT_MS = 10000;

function isAvailable() {
  try {
    const { BrowserWindow } = require("electron");
    return typeof BrowserWindow === "function";
  } catch {
    return false;
  }
}

// One window fetch for both callers. They differ only in what "content has
// arrived" means (a thread waits for its post markup; an arbitrary page for
// any title) and in how their errors name the thing that failed.
function fetchHtmlViaWindow(url, cookieHeader, {
  host = F95_HOST,
  timeoutMs = 180000,
  windowTitle = "Loading page",
  // Nouns the timeout and closed errors, so "the thread timed out" stays
  // readable. failLabel defaults to it when the caller wants fuller wording.
  noun = "page",
  failLabel = noun,
  isReady = (state) => state.loggedIn !== null || state.title,
} = {}) {
  const { BrowserWindow } = require("electron");

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let poll = null;
    let revealed = false;
    let calmPolls = 0;
    // Kept so the timeout error can name the phase that stalled.
    let lastPollError = null;
    // Stage timings for the single [forum-window] summary at capture; the
    // per-stage lines were folded in once the shape of a good run was known.
    let navSettles = 0;
    let loadSettledAt = 0;
    let postVisibleAt = 0;
    let cookiesSeeded = 0;
    // Wall-clock from window open, so a slow fetch points at the phase that ate the time.
    const openedAt = Date.now();

    const win = new BrowserWindow({
      width: 1000,
      height: 800,
      title: windowTitle,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        partition: RESOLVER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const contents = win.webContents;
    // Electron queues executeJavaScript calls behind the current load, so
    // polling during a long load piles up pending calls and trips
    // MaxListenersExceededWarning. Only poll after the first did-stop-loading,
    // the same signal core waits for.
    let loadStopped = false;
    contents.on("did-stop-loading", () => {
      loadStopped = true;
      navSettles += 1;
      if (!loadSettledAt) loadSettledAt = Date.now();
    });

    const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} made no progress for ${ms}ms`)), ms);
      promise.then(
        (value) => { clearTimeout(t); resolve(value); },
        (err) => { clearTimeout(t); reject(err); },
      );
    });

    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch {
        // Already gone.
      }
      fn(value);
    };

    const reveal = () => {
      if (revealed || settled) return;
      revealed = true;
      appLog.write("forum-window", {
        event: "challenge-visible",
        host,
        elapsedMs: Date.now() - openedAt,
      });
      try {
        if (!win.isDestroyed()) {
          win.show();
          win.moveTop();
          win.focus();
        }
      } catch {
        // Window gone.
      }
    };

    win.on("closed", () => {
      const error = new Error(`The ${noun} window was closed before the load finished.`);
      error.code = "CANCELED";
      done(reject, error);
    });

    timer = setTimeout(() => {
      const hint = !loadStopped
        ? " (first load never stopped)"
        : lastPollError ? ` (last poll read: ${lastPollError})` : "";
      const error = new Error(`Timed out waiting for the ${noun} to load${hint}.`);
      error.code = "TIMEOUT";
      done(reject, error);
    }, timeoutMs);

    poll = setInterval(async () => {
      if (settled || contents.isDestroyed()) return;
      if (!loadStopped) return;
      let state = null;
      try {
        state = await withTimeout(
          contents.executeJavaScript(
          `(() => ({
            title: document.title || "",
            body: (document.body && document.body.innerText || "").slice(0, 2000),
            ready: document.readyState,
            loggedIn: document.documentElement && document.documentElement.getAttribute("data-logged-in"),
            // Threads gate their capture on this; other callers ignore it.
            hasPost: !!document.querySelector(".bbWrapper"),
          }))()`,
            true,
          ),
          POLL_READ_TIMEOUT_MS,
          "poll read",
        );
      } catch (err) {
        // executeJavaScript rejects legitimately while the page navigates;
        // only reported if the fetch ends up timing out.
        lastPollError = err && err.message || err;
        return;
      }
      if (!state) return;
      lastPollError = null;
      if (CHALLENGE_MARKERS.test(`${state.title} ${state.body}`)) {
        calmPolls = 0;
        reveal();
        return;
      }
      // Past the challenge and ready: two calm polls so late-injected markup
      // settles. "complete" is too strict here - the DOM the caller wanted is
      // usually ready while ad frames and fonts keep streaming, and waiting
      // for it paid that tail on every fetch.
      if (state.ready !== "loading" && isReady(state)) {
        calmPolls += 1;
        if (!postVisibleAt) postVisibleAt = Date.now();
        if (calmPolls >= 2) {
          try {
            // A re-navigation can queue this behind did-stop-loading
            // indefinitely; bounded so the next tick can retry.
            const captureStartedAt = Date.now();
            const html = await withTimeout(
              contents.executeJavaScript(
                "document.documentElement.outerHTML",
                true,
              ),
              POLL_READ_TIMEOUT_MS,
              "html capture",
            );
            if (html) {
              appLog.write("forum-window", {
                host,
                cookiesSeeded,
                pageLoadMs: loadSettledAt ? loadSettledAt - openedAt : null,
                contentWaitMs: postVisibleAt && loadSettledAt ? postVisibleAt - loadSettledAt : null,
                twoPollWaitMs: postVisibleAt ? Date.now() - postVisibleAt : null,
                htmlReadMs: Date.now() - captureStartedAt,
                navigations: navSettles,
                totalMs: Date.now() - openedAt,
              });
              done(resolve, String(html));
            }
          } catch {
            // Read failed; next poll retries.
          }
        }
      } else {
        calmPolls = 0;
      }
    }, 1000);

    (async () => {
      try {
        cookiesSeeded = await applyCookies(contents.session, cookieHeader, `https://${host}/`);
        await contents.loadURL(url);
      } catch (err) {
        const error = new Error(`Could not load the ${failLabel} (${err.message || err}).`);
        error.code = "FETCH_FAILED";
        done(reject, error);
      }
    })();
  });
}

// Thread fetch: builds the URL from the thread id and only captures once the
// post markup is on the page, so a guest view can't be mistaken for content.
function fetchThreadHtmlViaWindow(threadId, cookieHeader, { timeoutMs = 180000, host = F95_HOST } = {}) {
  return fetchHtmlViaWindow(`https://${host}/threads/${encodeURIComponent(String(threadId))}/`, cookieHeader, {
    host,
    timeoutMs,
    windowTitle: "Loading thread",
    noun: "thread",
    failLabel: `${host} thread`,
    isReady: (state) => state.hasPost || state.loggedIn !== null,
  });
}

// Arbitrary URL (the tier scraper's shop page, for instance) in the same
// hidden window. Readiness is loose here: any settled page with a title
// counts, and the caller is always logged in.
function fetchUrlViaWindow(url, cookieHeader, { host = "lewdcorner.com", timeoutMs = 180000 } = {}) {
  return fetchHtmlViaWindow(url, cookieHeader, { host, timeoutMs });
}

/**
 * Shared tail of the link fetchers (updateLinks.js, lcLinks.js): the headless
 * response's 403 and a challenge signed HTTP 200 both steer into the real
 * window; anything else is either the html itself or the site error named by
 * siteLabel, exactly as each caller produced before this tail was shared.
 */
async function withWindowFallback(threadId, cookieHeader, {
  host = F95_HOST,
  siteLabel,
  response,
  stages,
  onSteer = null,
  timeoutMs,
}) {
  // One window run per fetch; onSteer keeps the status that forced it.
  const viaWindow = async () => {
    const windowStartedAt = Date.now();
    if (onSteer) onSteer(response.status);
    const html = await fetchThreadHtmlViaWindow(threadId, cookieHeader, { host, timeoutMs });
    stages.windowMs = Date.now() - windowStartedAt;
    return { html, stages };
  };
  if (!response.ok) {
    if (response.status === 403 && isAvailable()) return viaWindow();
    throw new Error(`${siteLabel} returned ${response.status} for thread ${threadId}`);
  }
  const body = await response.text();
  // An interstitial can arrive signed HTTP 200; parsing it yields a guest
  // render and a misleading re-add-your-account error.
  if (isCloudflareChallenge(body) && isAvailable()) return viaWindow();
  return { html: body, stages };
}

module.exports = {
  isAvailable,
  fetchThreadHtmlViaWindow,
  fetchUrlViaWindow,
  withWindowFallback,
};
