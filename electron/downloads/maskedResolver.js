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

// How long the hidden attempt gets before the window is revealed as a safety
// net. Non-browser hosts (F95 -> Pixeldrain/Mega) usually resolve headlessly
// within this, so the user rarely sees a window.
const DEFAULT_HEADLESS_MS = 9000;

function isCloudflareCookie(name) {
  return /^_?_?cf_/.test(name) || name === "__cfruid";
}

// Cloudflare challenge markers. Used by the poll to reveal the window ONLY when
// a challenge is actually present - so a clean (VPN-off) download stays hidden
// while a VPN-flagged one pops the window for the user to tick. Mirrored inline
// in the injected poll script, which cannot call this function directly.
const CLOUDFLARE_MARKERS = /cloudflare|just a moment|checking your browser|verify you are human|attention required|cf-chl|turnstile/i;
function isCloudflareChallenge(text) {
  return CLOUDFLARE_MARKERS.test(text || "");
}

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
 *                    diagnostics:object, headers?:object}>}
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

    // Persistent partition: the resolve is a one-shot, but we keep the
    // session so Cloudflare cf_clearance cookies (and any other challenge
    // cookies) survive window close and app restarts. F95 cookies are
    // applied explicitly via applyCookies(), so they do not depend on the
    // partition. The shared persistent store means a challenge solved once
    // is remembered for subsequent resolves until the cookie expires.
    const partition = "persist:masked-resolver";
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

    const contents = win.webContents;
    const ses = contents.session;

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
    let pollInterval = null;
    let revealed = false;
    // Browser session cookies / headers captured on page load so we can hand
    // them back to Atlas when the download is intercepted. Without these,
    // Cloudflare-challenged CDNs reject the anonymous Node.js request.
    let cachedBrowserHeaders = null;
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

    const finish = async (result) => {
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
      // The partition is now persistent so Cloudflare cf_clearance cookies
      // survive window/app restarts. To keep the original throwaway
      // semantics for everything else, strip non-CF cookies after each
      // resolve. F95 session cookies are applied fresh from the encrypted
      // account store on every call via applyCookies(), so they never
      // depend on what we leave behind here.
      try {
        const all = await ses.cookies.get({});
        await Promise.all(
          all
            .filter((c) => !isCloudflareCookie(c.name))
            .map((c) => {
              const proto = c.secure ? "https" : "http";
              const domain = c.domain.startsWith(".") ? c.domain.substring(1) : c.domain;
              const url = `${proto}://${domain}${c.path || "/"}`;
              return ses.cookies.remove(url, c.name);
            })
        );
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

    const finishDirect = (url, source) => {
      if (!isNavigableHttp(url)) return false;
      note(source, url);
      const result = {
        ok: true,
        url,
        host: hostOf(url),
        hasFragment: hasFragment(url),
        source,
      };
      if (cachedBrowserHeaders) {
        result.headers = cachedBrowserHeaders;
      }
      // Surface the things that have actually bitten this host before: the
      // resolved host landing OUTSIDE gateHosts (ts.bzzhr.to instead of
      // bzzhr.to), and a /d/ CDN path the file-id parser refuses to match.
      const resolvedHost = hostOf(url);
      const isGateHost = Array.isArray(gateHosts) ? gateHosts.includes(resolvedHost) : false;
      const hasCdNPath = /\/d\/[a-zA-Z0-9]/.test(url);
      finish(result);
      return true;
    };

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

    async function cacheBrowserHeaders() {
      try {
        const current = contents.getURL();
        const cookies = await ses.cookies.get({ url: current });
        const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        cachedBrowserHeaders = {
          cookie: cookieString,
          referer: current,
          "user-agent": contents.userAgent || "",
        };
      } catch {
        cachedBrowserHeaders = null;
      }
    }

    ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
      // Top-level document requests only; subresources are page furniture.
      if (details.resourceType === "mainFrame") note("web-request", details.url);
      callback({ cancel: false });
    });

    // Capture HX-Redirect headers from Buzzheavier and similar htmx-based hosts.
    // The download route returns the file URL in this header rather than a 3xx.
    //
    // responseHeaders is a plain Object, not an Array, so we iterate keys
    // rather than calling .find().
    ses.webRequest.onHeadersReceived({ urls: ["*://*/*"] }, (details, callback) => {
      const headers = details.responseHeaders || {};
      let redirectValue = null;
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === "hx-redirect") {
          redirectValue = headers[key];
          break;
        }
      }
      if (redirectValue) {
        const hxRedirect = Array.isArray(redirectValue) ? redirectValue[0] : redirectValue;
        const absolute = hxRedirect.startsWith("http")
          ? hxRedirect
          : `${new URL(details.url).origin}${hxRedirect}`;
        finishDirect(absolute, "hx-redirect");
      }
      callback({ cancel: false, responseHeaders: details.responseHeaders });
    });

    // Buzzheavier may answer the download request with a standard file
    // attachment (Content-Disposition: attachment) instead of an HX-Redirect.
    // In that case Electron triggers the OS Save As dialog via will-download.
    // Intercept it here: grab the URL, cancel the browser download, and hand
    // the direct link back through the normal resolve path.
    ses.on("will-download", (event, item) => {
      event.preventDefault();
      const url = item.getURL();
      if (!isNavigableHttp(url)) return;
      finishDirect(url, "will-download");
    });

    // Click the continue link once the page has loaded. Harmless when the
    // element never appears - the reveal timer covers that case.
    contents.on("did-finish-load", async () => {
      if (settled) return;
      const current = contents.getURL();
      // Only on the gate page; never inject into the destination host.
      if (!onGate(current)) return;
      contents.executeJavaScript(CLICK_HOST_LINK, true).catch(() => {
        // A failed injection is not fatal; the window will be revealed.
      });
      // Buzzheavier gates present download buttons via htmx rather than the
      // F95 continue link. Poll and click natively so the browser's own
      // download manager fires will-download, which we intercept below. The
      // same poll also watches for a Cloudflare challenge: if one appears we
      // reveal the window so the user can tick it - a clean (VPN-off) download
      // stays hidden and resolves on its own.
      pollInterval = setInterval(async () => {
        if (settled) {
          clearInterval(pollInterval);
          return;
        }
        try {
          const result = await contents.executeJavaScript(`(() => {
            const btn = document.querySelector('.download-btn[hx-get]');
            const body = (document.body && document.body.innerText) || '';
            const cfChallenge =
              /cloudflare|just a moment|checking your browser|verify you are human|attention required|cf-chl|turnstile/i.test(body) ||
              !!document.querySelector('#cf-chl, iframe[src*="challenges.cloudflare.com"], .cf-turnstile, #challenge-running');
            if (btn) { btn.click(); return { clicked: true, cf: cfChallenge }; }
            return { clicked: false, cf: cfChallenge };
          })()`, true);
          if (result.cf) {
            reveal("cloudflare");
          }
          if (result.clicked) {
            clearInterval(pollInterval);
          }
        } catch (err) {
          // poll errors are non-fatal; the reveal timer still fires
        }
      }, 1000);
      // Cache the browser session cookies / headers so they can be handed back
      // to Atlas when the download is intercepted below.
      await cacheBrowserHeaders();
    });

    // ── User closed the window ──────────────────────────────────────────────
    win.on("closed", () => {
      if (settled) return;
      if (pollInterval) clearInterval(pollInterval);
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
  // Pure Cloudflare-challenge detector, exported for the same reason.
  isCloudflareChallenge,
  // Keeps Cloudflare challenge cookies (cf_clearance, __cf_bm, __cfruid,
  // cf_chl_opt) and removes everything else after each resolve. Exported so
  // the filter can be unit-tested without a window.
  isCloudflareCookie,
  // Re-exported from maskedResolverUrls so callers have one import. The pure
  // logic lives there precisely so it can be tested without Electron.
  isGateUrl,
  isNavigableHttp,
  hasFragment,
  pickBestCandidate,
  F95_HOST,
};
