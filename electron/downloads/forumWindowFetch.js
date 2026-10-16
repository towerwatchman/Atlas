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
      try {
        if (!win.isDestroyed()) {
          win.show();
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
      const error = new Error("Timed out waiting for the F95 thread to load.");
      error.code = "TIMEOUT";
      done(reject, error);
    }, timeoutMs);

    poll = setInterval(async () => {
      if (settled || contents.isDestroyed()) return;
      let state = null;
      try {
        state = await contents.executeJavaScript(
          `(() => ({
            title: document.title || "",
            body: (document.body && document.body.innerText || "").slice(0, 2000),
            ready: document.readyState,
            loggedIn: document.documentElement && document.documentElement.getAttribute("data-logged-in"),
            hasPost: !!document.querySelector(".bbWrapper"),
          }))()`,
          true,
        );
      } catch {
        return;
      }
      if (!state) return;
      if (CHALLENGE_MARKERS.test(`${state.title} ${state.body}`)) {
        calmPolls = 0;
        reveal();
        return;
      }
      // Past the challenge (or never challenged) with the post present: two
      // calm polls so late-injected markup settles before reading.
      if (state.ready === "complete" && (state.hasPost || state.loggedIn !== null)) {
        calmPolls += 1;
        if (calmPolls >= 2) {
          try {
            const html = await contents.executeJavaScript(
              "document.documentElement.outerHTML",
              true,
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
