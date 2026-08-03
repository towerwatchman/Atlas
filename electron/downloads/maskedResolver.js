"use strict";

// ── Masked link resolver ─────────────────────────────────────────────────────
//
// Opens an F95 /masked/ link in a real, visible browser window carrying the
// user's own session, waits for THEM to click through, and captures where the
// browser ended up.
//
// Why a window at all: masked links are AES-encrypted server-side with an
// HMAC over the requesting account's user id, so they cannot be decoded
// offline, and the landing page loads reCAPTCHA. A real browser is the only
// honest way through.
//
// Two-stage resolve. The window is created HIDDEN and the continue link is
// clicked programmatically; if that produces a destination within a few
// seconds, the user never sees anything. If it does not - because reCAPTCHA
// decided to challenge, or the markup changed - the window is revealed and the
// user finishes it themselves.
//
// Clicking programmatically is done on the basis that F95zone confirmed it is
// acceptable. It is also long-established in this ecosystem: F95Checker's
// css_redirect does the same, as does the public userscript.
//
// What is still NOT done here: no user-agent spoofing, no stealth flags, no
// solving service, and no attempt to make automated traffic look human. The
// click is a click. If the site decides a human is needed, the fallback shows
// the page and lets one answer - the automation is a convenience on the happy
// path, never a way around a challenge that actually fires.
//
// ── The fragment problem ─────────────────────────────────────────────────────
//
// Mega puts the decryption key in the URL fragment (#...), and a Mega link
// without it is inert - you can fetch the ciphertext and never read it. But
// fragments are never transmitted to servers, so webRequest-based capture
// CANNOT see them; only renderer-level navigation events carry the fragment.
//
// Electron's exact behaviour here is not something we could verify offline, so
// rather than guess, every candidate source is recorded along with whether it
// preserved a fragment, and the best one wins. The diagnostics come back with
// the result so the first real resolve tells us which source to trust, instead
// of shipping an assumption and discovering it broken on a 4GB download.

const { BrowserWindow, session: electronSession } = require("electron");
const {
  F95_HOST,
  isGateUrl,
  isNavigableHttp,
  hasFragment,
  pickBestCandidate,
  hostOf,
} = require("./maskedResolverUrls");

// Long enough for a slow challenge, short enough that a forgotten window does
// not pin a queue slot indefinitely.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// How long the hidden attempt gets before the window is revealed. Generous
// enough for a cold page load plus reCAPTCHA initialising on a slow
// connection, short enough that a user staring at a stalled download does not
// wait long for something to appear.
const DEFAULT_HEADLESS_MS = 9000;

// Injected after load. Waits for the continue link to exist before clicking,
// because it is added by /assets/js/masked.js after reCAPTCHA initialises -
// clicking earlier hits nothing. A MutationObserver rather than a poll for the
// same reason the userscript uses one: the element arrives late and there is
// no load event marking it.
//
// The 400ms settle is NOT about looking human. reCAPTCHA attaches its own
// handler to this element, and clicking in the same tick it appears can fire
// before that handler is bound, which silently does nothing.
const CLICK_HOST_LINK = `
  (function () {
    var clicked = false;
    function attempt() {
      if (clicked) return;
      var el = document.querySelector('.host_link');
      if (!el) return;
      clicked = true;
      setTimeout(function () { el.click(); }, 400);
    }
    var observer = new MutationObserver(attempt);
    observer.observe(document.body, { childList: true, subtree: true });
    attempt();
  })();
`;

// Cookie header -> individual cookies on the window's session, so F95 sees the
// user's real login. Stored cookies come back as a single header string, which
// is what the headless fetch path uses.
async function applyCookies(ses, cookieHeader, baseUrl) {
  if (!cookieHeader) return 0;
  let applied = 0;
  for (const pair of String(cookieHeader).split(";")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    try {
      await ses.cookies.set({
        url: baseUrl,
        name,
        value,
        domain: `.${F95_HOST}`,
        path: "/",
        secure: true,
        httpOnly: false,
      });
      applied += 1;
    } catch (err) {
      console.warn(`Could not set cookie ${name}:`, err.message);
    }
  }
  return applied;
}

/**
 * Resolve one masked link.
 *
 * @param {string} maskedUrl
 * @param {object} [options]
 * @param {BrowserWindow} [options.parentWindow]
 * @param {string} [options.cookieHeader] the user's F95 cookies
 * @param {string} [options.title] window title, e.g. the game name
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ok:boolean, url?:string, host?:string, hasFragment?:boolean,
 *                    canceled?:boolean, timedOut?:boolean, error?:string,
 *                    diagnostics:object}>}
 */
function resolveMaskedLink(maskedUrl, options = {}) {
  const {
    parentWindow = null,
    cookieHeader = "",
    title = "",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    // Set false to go straight to a visible window - useful if the automated
    // path ever starts misbehaving in the field.
    headless = true,
    headlessTimeoutMs = DEFAULT_HEADLESS_MS,
    // Hosts that count as "still on the gate". Defaults to F95; a host plugin
    // passes its own so the window knows when it has reached the real file.
    gateHosts = undefined,
  } = options;
  const onGate = (target) => isGateUrl(target, gateHosts);

  return new Promise((resolve) => {
    if (!isNavigableHttp(maskedUrl)) {
      resolve({ ok: false, error: "Not a resolvable URL", diagnostics: {} });
      return;
    }

    // Ephemeral partition, mirroring browserLogin.js: the resolve is a
    // one-shot, and nothing it picks up should leak into later sessions.
    const partition = `masked-resolve-${Date.now()}`;
    const win = new BrowserWindow({
      width: 900,
      height: 800,
      title: title ? `Continue download — ${title}` : "Continue download",
      autoHideMenuBar: true,
      parent: parentWindow || undefined,
      show: false,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Every URL we observe, with where it came from and whether it kept a
    // fragment. This is what tells us which source to trust.
    const candidates = [];
    const seen = new Set();
    const note = (source, url) => {
      if (!isNavigableHttp(url)) return;
      const key = `${source}|${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ source, url, fragment: hasFragment(url), at: Date.now() });
    };

    let settled = false;
    let timer = null;
    let revealTimer = null;
    let revealed = false;
    // Which path produced the answer. Reported in the result so the first real
    // runs show whether the hidden attempt is actually working, rather than
    // this being assumed.
    let resolvedVia = headless ? "headless" : "visible";

    // Show the window and stop pretending this will resolve itself.
    const reveal = (reason) => {
      if (revealed || settled) return;
      revealed = true;
      resolvedVia = `visible:${reason}`;
      try {
        if (!win.isDestroyed()) {
          win.show();
          win.focus();
        }
      } catch { /* window gone */ }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (revealTimer) clearTimeout(revealTimer);
      const diagnostics = {
        // Which sources produced an off-site URL, and did each keep the
        // fragment. Log this on the first real resolve.
        candidates: candidates.map(({ source, url, fragment }) => ({
          source,
          fragment,
          host: hostOf(url) || "?",
        })),
        fragmentSources: candidates.filter((entry) => entry.fragment).map((entry) => entry.source),
        resolvedVia,
        revealed,
      };
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch {
        /* already gone */
      }
      // Clean up the throwaway partition.
      try {
        electronSession.fromPartition(partition).clearStorageData();
      } catch {
        /* best effort */
      }
      resolve({ ...result, diagnostics });
    };

    const settleFromCandidates = () => {
      const best = pickBestCandidate(candidates, gateHosts);
      if (!best) return false;
      finish({
        ok: true,
        url: best.url,
        host: hostOf(best.url),
        hasFragment: best.fragment,
        source: best.source,
      });
      return true;
    };

    const contents = win.webContents;

    // ── Capture points ──────────────────────────────────────────────────────
    // will-navigate and will-redirect are renderer-level and DO carry the
    // fragment. onBeforeRequest is network-level and never will - it is here
    // only as a backstop for the case where the navigation events do not fire.

    contents.on("will-navigate", (event, url) => {
      note("will-navigate", url);
      if (!onGate(url)) {
        // Stop before the destination actually loads. There is no reason to
        // render Mega's web app; we only wanted the address.
        event.preventDefault();
        settleFromCandidates();
      }
    });

    contents.on("will-redirect", (event, url) => {
      note("will-redirect", url);
      if (!onGate(url)) {
        event.preventDefault();
        settleFromCandidates();
      }
    });

    contents.on("did-navigate", (event, url) => {
      note("did-navigate", url);
      if (!onGate(url)) settleFromCandidates();
    });

    // New-window / target=_blank: F95's continue link may open this way.
    contents.setWindowOpenHandler(({ url }) => {
      note("window-open", url);
      if (!onGate(url)) {
        settleFromCandidates();
        return { action: "deny" };
      }
      return { action: "deny" };
    });

    const ses = contents.session;
    ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
      // Top-level document requests only; subresources are page furniture.
      if (details.resourceType === "mainFrame") note("web-request", details.url);
      callback({ cancel: false });
    });

    // Click the continue link once the page has loaded. Harmless when the
    // element never appears - the reveal timer covers that case.
    contents.on("did-finish-load", () => {
      if (settled) return;
      const current = contents.getURL();
      // Only on the gate page; never inject into the destination host.
      if (!onGate(current)) return;
      contents.executeJavaScript(CLICK_HOST_LINK, true).catch(() => {
        // A failed injection is not fatal; the window will be revealed.
      });
    });

    // ── User closed the window ──────────────────────────────────────────────
    win.on("closed", () => {
      if (settled) return;
      // They may have clicked through and the window closed itself after we
      // already saw the destination.
      if (!settleFromCandidates()) {
        finish({ ok: false, canceled: true, error: "Resolve window was closed" });
      }
    });

    contents.on("render-process-gone", () => {
      finish({ ok: false, error: "Resolve window crashed" });
    });

    // Hidden attempt gets a short window before the user is brought in.
    if (headless) {
      revealTimer = setTimeout(() => reveal("timeout"), headlessTimeoutMs);
    }

    timer = setTimeout(() => {
      if (!settleFromCandidates()) {
        finish({ ok: false, timedOut: true, error: "Timed out waiting for the download link" });
      }
    }, timeoutMs);

    // ── Go ──────────────────────────────────────────────────────────────────
    (async () => {
      try {
        await applyCookies(ses, cookieHeader, `https://${F95_HOST}/`);
        await contents.loadURL(maskedUrl);
        // Stay hidden while the automated attempt runs. reveal() brings it up
        // if that does not pan out.
        if (!headless) reveal("requested");
      } catch (err) {
        // ERR_ABORTED is expected when we preventDefault a navigation we were
        // already happy with, so only report it if nothing was captured.
        if (!settleFromCandidates()) {
          // A load failure is exactly when a human should get a look.
          reveal("load-error");
          finish({ ok: false, error: err.message || String(err) });
        }
      }
    })();
  });
}

module.exports = {
  resolveMaskedLink,
  // Re-exported from maskedResolverUrls so callers have one import. The pure
  // logic lives there precisely so it can be tested without Electron.
  isGateUrl,
  isNavigableHttp,
  hasFragment,
  pickBestCandidate,
  F95_HOST,
};
