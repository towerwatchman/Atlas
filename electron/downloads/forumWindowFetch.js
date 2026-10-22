"use strict";

// ── Forum thread fetch via a real window (F95) ──────────────────────────────
//
// The headless requests (Node fetch, axios, even ses.fetch with a stored
// cf_clearance) all eat cf-mitigated=challenge: the clearance harvested by
// the ephemeral login window dies with it, and the resolver partition only
// holds a grant after a challenge is actually solved inside it. So the
// thread itself loads in a window on the persistent resolver partition:
// hidden while it passes unchallenged, revealed for the user to tick the
// checkbox when it does not. A solved grant then persists for later fetches.
//
// Only used when a full Electron runtime is present; the test stubs provide
// no BrowserWindow and keep the plain-fetch path.

const { RESOLVER_PARTITION, applyCookies, F95_HOST } = require("./maskedResolver");

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

function fetchThreadHtmlViaWindow(threadId, cookieHeader, { timeoutMs = 180000 } = {}) {
  const { BrowserWindow } = require("electron");
  const url = `https://${F95_HOST}/threads/${encodeURIComponent(String(threadId))}/`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let poll = null;
    let revealed = false;
    let calmPolls = 0;
    // Kept so the timeout error can name the phase that stalled.
    let lastPollError = null;
    // Wall-clock from window open, so a slow fetch points at the phase that ate the time.
    const openedAt = Date.now();
    const stamp = () => `[forum-window +${((Date.now() - openedAt) / 1000).toFixed(1)}s]`;

    const win = new BrowserWindow({
      width: 1000,
      height: 800,
      title: "Loading thread",
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
      console.warn(`${stamp()} challenge visible, showing the window`);
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
      const error = new Error("Thread window was closed before links loaded.");
      error.code = "CANCELED";
      done(reject, error);
    });

    timer = setTimeout(() => {
      const hint = !loadStopped
        ? " (first load never stopped)"
        : lastPollError ? ` (last poll read: ${lastPollError})` : "";
      const error = new Error(`Timed out waiting for the F95 thread to load${hint}.`);
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
      // Past the challenge with the post present: two calm polls so
      // late-injected markup settles. "complete" is too strict here - the post
      // DOM is server-rendered and ready while ad frames and fonts keep
      // streaming, and waiting for it paid that tail on every fetch.
      if (state.ready !== "loading" && (state.hasPost || state.loggedIn !== null)) {
        calmPolls += 1;
        if (calmPolls >= 2) {
          try {
            // A re-navigation can queue this behind did-stop-loading
            // indefinitely; bounded so the next tick can retry.
            const html = await withTimeout(
              contents.executeJavaScript(
                "document.documentElement.outerHTML",
                true,
              ),
              POLL_READ_TIMEOUT_MS,
              "html capture",
            );
            if (html) done(resolve, String(html));
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
        await applyCookies(contents.session, cookieHeader, `https://${F95_HOST}/`);
        await contents.loadURL(url);
      } catch (err) {
        const error = new Error(`Could not load the F95 thread (${err.message || err}).`);
        error.code = "FETCH_FAILED";
        done(reject, error);
      }
    })();
  });
}

module.exports = {
  isAvailable,
  fetchThreadHtmlViaWindow,
};
