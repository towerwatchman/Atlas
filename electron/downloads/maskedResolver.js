"use strict";

// ── Masked link resolver ─────────────────────────────────────────────────────
//
// Opens a forum /masked/ link (F95 or LewdCorner) in a real, visible browser
// window carrying the user's own session, waits for THEM to click through,
// and captures where the browser ended up.
//
// Why a window at all: F95 masked links are AES-encrypted server-side with an
// HMAC over the requesting account's user id, so they cannot be decoded
// offline, and the landing page loads reCAPTCHA. A real browser is the only
// honest way through. (LC masked links normally decode offline in the parser;
// only undecodable fallbacks reach this window, under LC cookies.)
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
const appLog = require("../appLog");
const {
  F95_HOST,
  isGateUrl,
  isNavigableHttp,
  hasFragment,
  pickBestCandidate,
  hostOf,
} = require("./maskedResolverUrls");
// Drives F95's own /dl/ interstitial: the poll clicks its Continue / Generate
// controls and reports the countdown, which the reveal watchdog counts as
// progress while it runs.
const { DL_POLL_SCRIPT, shouldReveal, IDLE_REVEAL_MS, LOAD_GRACE_MS } = require("./dlGate");
// Shared with forum thread fetching (forumWindowFetch.js, updateLinks.js):
// the persistent session whose jar holds solved Cloudflare grants, and the
// cookie copier that seeds a window with the user's forum session.
const RESOLVER_PARTITION = "persist:masked-resolver";
// Long enough for a slow challenge, short enough that a forgotten window does
// not pin a queue slot indefinitely.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// ── Which cookies survive a resolve ──────────────────────────────────────────
//
// The partition is persistent so a solved Cloudflare challenge is not re-run on
// every download; everything else is stripped after each resolve to keep the
// old throwaway semantics. So this decides what persists, and being loose here
// means leaking a site's own tracking cookies across resolves.
//
// The earlier version tested /^_?_?cf_/, which is both too broad and too narrow:
// it kept ANY cookie starting `cf_` (a site's own `cf_language`, say) while
// missing `cf_clearance`'s siblings that do not use the prefix. These are the
// actual names Cloudflare sets, matched exactly.
const CLOUDFLARE_COOKIES = new Set([
  "cf_clearance",   // the challenge grant -- the one that makes this worth doing
  "__cf_bm",        // bot management
  "__cfruid",       // rate limiting
  "__cfwaitingroom",
  "cf_chl_opt",     // challenge state, mid-solve
  "cf_chl_prog",
  "cf_chl_rc_m",
  "cf_chl_rc_ni",
  "cf_ob_info",     // origin-error context
  "cf_use_ob",
]);

function isCloudflareCookie(name) {
  const text = String(name || "");
  if (!text) return false;
  if (CLOUDFLARE_COOKIES.has(text)) return true;
  // Cloudflare versions some challenge cookies with a numeric suffix
  // (cf_chl_2, cf_chl_prog_1). Anchored to the challenge families only, so an
  // unrelated cookie that merely starts with cf_ is not kept.
  return /^cf_chl[a-z_]*_?\d*$/i.test(text) || /^__cf_bm_/i.test(text);
}

// Cloudflare challenge markers. The poll uses them to log challenge and
// challenge-passed cycles, which is how a report is classified; the reveal
// itself is decided by idleness, so a challenge that clears on its own never
// shows a window. Mirrored inline in the injected poll script, which cannot
// call this function directly.
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

// Copies the user's forum cookies into the resolve window, so the site sees
// a logged-in user instead of a guest. The domain comes from baseUrl because
// cookies are per-host: an LC cookie stored under F95 would never be sent to LC
async function applyCookies(ses, cookieHeader, baseUrl = `https://${F95_HOST}/`) {
  if (!cookieHeader) return 0;
  let domain = F95_HOST;
  try {
    domain = new URL(baseUrl).hostname || F95_HOST;
  } catch {
    // A malformed base keeps the F95 default instead of failing the resolve.
  }
  let applied = 0;
  // Which Cloudflare cookies materialised where. One line per header that
  // carries any: `seeded` means the jar lacked that grant before us (each
  // fetch then starts from a fresh challenge), `jarHad` means the jar already
  // held it and we stayed out of the way. The pairing is what distinguishes a
  // report of "challenged every time" between no grant persisted and
  // Cloudflare challenging despite a live grant.
  const seeded = [];
  const jarHad = [];
  for (const pair of String(cookieHeader).split(";")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // Cloudflare grants only reach the jar when it has none: one solved here is
    // always fresher than a harvested one in the store, and overwriting the
    // jar's own grant re-runs the challenge for nothing. URL-based lookup so a
    // host-only grant the browser itself solved also counts as present.
    if (isCloudflareCookie(name)) {
      try {
        const present = await ses.cookies.get({ url: baseUrl, name });
        if (present.length > 0) {
          jarHad.push(name);
          continue;
        }
        seeded.push(name);
      } catch {
        // Jar unreadable — still seed rather than lose the session grant.
        seeded.push(name);
      }
    }
    try {
      await ses.cookies.set({
        url: baseUrl,
        name,
        value,
        domain: `.${domain}`,
        path: "/",
        secure: true,
        httpOnly: false,
      });
      applied += 1;
    } catch (err) {
      console.warn(`Could not set cookie ${name}:`, err.message);
    }
  }
  // Only headers that actually carry CF cookies produce a line, so the ordinary
  // forum-cookie seeding stays silent. Values never go out, only names.
  if (seeded.length > 0 || jarHad.length > 0) {
    require("../appLog").write("cf-jar", { host: domain, seeded, jarHad }, { devtools: true });
  }
  return applied;
}

/**
 * Resolve one masked link.
 *
 * @param {string} maskedUrl
 * @param {object} [options]
 * @param {BrowserWindow} [options.parentWindow]
 * @param {string} [options.cookieHeader] the user's site cookies for the link's site
 * @param {string} [options.baseUrl] forum origin the cookies belong to (F95 default)
 * @param {string} [options.title] window title, e.g. the game name
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ok:boolean, url?:string, host?:string, hasFragment?:boolean,
 *                    canceled?:boolean, timedOut?:boolean, error?:string,
 *                    diagnostics:object, headers?:object}>}
 */
function resolveMaskedLinkImpl(maskedUrl, options = {}) {
  const {
    parentWindow = null,
    cookieHeader = "",
    baseUrl = `https://${F95_HOST}/`,
    title = "",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    // Set false to go straight to a visible window - useful if the automated
    // path ever starts misbehaving in the field.
    headless = true,
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
    const partition = RESOLVER_PARTITION;
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
        // A hidden window is a background page, and Chromium throttles its
        // timers - which F95's masked.js and reCAPTCHA run on. Left on, the
        // automated attempt sat frozen until the user was shown the window.
        backgroundThrottling: false,
      },
    });

    const contents = win.webContents;
    const ses = contents.session;

    // Every URL we observe, with where it came from and whether it kept a
    // fragment. This is what tells us which source to trust.
    const candidates = [];
    const seen = new Set();
    // Bumped by everything that moves the resolve forward: navigation, a load
    // event, the continue link, a countdown tick, a download. The window stays
    // hidden while this moves and is revealed once it has not, for
    // IDLE_REVEAL_MS - a page waiting on a human.
    let lastProgressAt = Date.now();
    const markProgress = () => { lastProgressAt = Date.now(); };
    // False until the current navigation has a parsed document. A slow
    // response is not a stall, so the watchdog waits longer in this state.
    let domReady = false;
    const note = (source, url) => {
      if (!isNavigableHttp(url)) return;
      markProgress();
      const key = `${source}|${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ source, url, fragment: hasFragment(url), at: Date.now() });
    };

    // A page that is still loading is working, not waiting on a human. Until
    // dom-ready the watchdog uses LOAD_GRACE_MS, so a slow response is not
    // mistaken for a stall; once the document exists, the idle window applies.
    contents.on("did-start-loading", () => { domReady = false; markProgress(); });
    contents.on("dom-ready", () => { domReady = true; markProgress(); });
    contents.on("did-stop-loading", markProgress);

    let settled = false;
    let timer = null;
    let idleTimer = null;
    let pollInterval = null;
    let revealed = false;
    // Browser session cookies / headers captured on page load so we can hand
    // them back to Atlas when the download is intercepted. Without these,
    // Cloudflare-challenged CDNs reject the anonymous Node.js request.
    let cachedBrowserHeaders = null;
    // Last tick's report from the /dl/ poll: whether the countdown is live,
    // seconds left, and the host the page says the link will land on. The
    // settle warning reads it, and a changed snapshot counts as progress.
    let dlPoll = null;
    // The last values seen from the polls, so "changed" can be told from "ran".
    let lastHostLink = null;
    let lastDlKey = null;
    // The same queueing hazard forumWindowFetch guards against: an
    // executeJavaScript made while any load is running sits pending until the
    // load stops, so unbounded poll calls stack up during redirects.
    const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} made no progress for ${ms}ms`)), ms);
      promise.then(
        (value) => { clearTimeout(t); resolve(value); },
        (err) => { clearTimeout(t); reject(err); },
      );
    });
    // Declared here so finish() can detach it; assigned once the session is in
    // hand. A const at the registration site would sit in its TDZ for any early
    // finish path.
    let onWillDownload = null;
    // CF challenge tracking for the poll: how many separate challenge pages
    // this resolve met, and whether the current page is one. Not every tick --
    // a challenge that loops produces one line per loop.
    let challengeActive = false;
    let challengeSeen = 0;
    // When the current cycle's challenge page first appeared; challenge-passed
    // reports how long it held.
    let challengeStartedAt = null;
    // This tick's gate-poll CF verdict, hoisted out of the first poll try so
    // the transition logger below can read it.
    let gatePollCf = false;
    // Which path produced the answer. Reported in the result so the first real
    // runs show whether the hidden attempt is actually working, rather than
    // this being assumed.
    let resolvedVia = headless ? "headless" : "visible";

    // Show the window and stop pretending this will resolve itself.
    const reveal = (reason) => {
      if (revealed || settled) return;
      revealed = true;
      resolvedVia = `visible:${reason}`;
      // What the user is actually being shown, so a report of "a window
      // appeared" names the page instead of leaving it to guesswork.
      let url = "";
      let pageTitle = "";
      try {
        url = contents.getURL();
        pageTitle = contents.getTitle();
      } catch {
        /* already gone */
      }
      // A resolve that needed a human is the prime suspect whenever a host
      // blocks us: the reason and the cf-jar line above pair into one story.
      appLog.write("masked-resolve", { event: "reveal", reason, url, title: pageTitle }, { devtools: true });
      try {
        if (!win.isDestroyed()) {
          win.show();
          // Windows denies activation from a background process, so focus()
          // alone would leave the window under the user's app: raise without it.
          win.moveTop();
          win.focus();
        }
      } catch { /* window gone */ }
    };

    // Callers invoke this fire-and-forget (`void finish(...)`): the promise the
    // resolve returns is settled by the resolve() at the end of this function,
    // not by awaiting the call. So nothing in here may throw -- every step is
    // already wrapped, and this outer guard is the backstop.
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (idleTimer) clearInterval(idleTimer);
      // The page the attempt ended on, and the last interstitial state. Without
      // these a failed resolve says only that it failed.
      let pageUrl = "";
      let pageTitle = "";
      try {
        pageUrl = contents.getURL();
        pageTitle = contents.getTitle();
      } catch {
        /* already gone */
      }
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
        challengeSeen,
        url: pageUrl,
        title: pageTitle,
        dl: dlPoll
          ? { dlActive: !!dlPoll.dlActive, seconds: dlPoll.seconds, declaredHost: dlPoll.declaredHost }
          : null,
      };
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch {
        /* already gone */
      }
      // Detach everything hung off the SHARED persistent session. The old
      // ephemeral partition was thrown away wholesale, so nothing needed
      // removing; a persistent one keeps every listener alive for the life of
      // the app. will-download is an EventEmitter and would accumulate one
      // handler per resolve (and fire on a later resolve's download); the
      // webRequest hooks take a single listener each, so clearing them with
      // null leaves the session clean for the next resolve rather than holding
      // a filter that points at a destroyed window.
      if (pollInterval) clearInterval(pollInterval);
      try {
        if (onWillDownload) ses.removeListener("will-download", onWillDownload);
      } catch {
        /* best effort */
      }
      try {
        ses.webRequest.onBeforeRequest(null);
        ses.webRequest.onHeadersReceived(null);
      } catch {
        /* best effort */
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
      const declaredHost = dlPoll && dlPoll.declaredHost ? String(dlPoll.declaredHost).trim().toLowerCase() : null;
      if (result.ok && declaredHost && result.host
        && String(result.host).toLowerCase() !== declaredHost) {
        console.warn(`[masked-resolve] destination host ${result.host} does not match the gate-declared ${declaredHost}`);
      }
      resolve({
        ...result,
        // What the interstitial claimed the link would land on, if it said.
        ...(declaredHost ? { declaredHost } : {}),
        diagnostics,
      });
    };

    const settleFromCandidates = () => {
      const best = pickBestCandidate(candidates, gateHosts);
      if (!best) return false;
      void finish({
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
      // The two things that have actually bitten this host: the resolved host
      // landing OUTSIDE gateHosts (ts.bzzhr.to rather than bzzhr.to), and a /d/
      // CDN path fileIdFrom refuses to match. These were previously computed
      // and dropped on the floor; they are recorded on the result so the
      // diagnostics log shows them.
      const resolvedHost = hostOf(url);
      result.directHost = resolvedHost;
      result.leftGateHost = Array.isArray(gateHosts)
        ? !gateHosts.includes(resolvedHost)
        : null;
      result.cdnPath = /\/d\/[a-zA-Z0-9]/.test(url);
      void finish(result);
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
    onWillDownload = (event, item) => {
      // Guard: the session is shared and persistent, so only act while THIS
      // resolve is live. Without it a late event could settle a resolve with
      // another one's URL.
      if (settled) return;
      event.preventDefault();
      const url = item.getURL();
      if (!isNavigableHttp(url)) return;
      finishDirect(url, "will-download");
    };
    ses.on("will-download", onWillDownload);

    // Click the continue link once the page has loaded. Harmless when the
    // element never appears - the idle watchdog reveals the window then.
    contents.on("did-finish-load", async () => {
      if (settled) return;
      markProgress();
      const current = contents.getURL();
      // Only on the gate page; never inject into the destination host.
      if (!onGate(current)) return;
      contents.executeJavaScript(CLICK_HOST_LINK, true).catch(() => {
        // A failed injection is not fatal; the window will be revealed.
      });
      // Buzzheavier gates present download buttons via htmx rather than the
      // F95 continue link. Poll and click natively so the browser's own
      // download manager fires will-download, which we intercept below. The
      // same poll also reports a Cloudflare challenge; a challenge that passes
      // on its own navigates and counts as progress, while one that persists is
      // revealed by the idle watchdog like any other page waiting on a human.
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(async () => {
        if (settled) {
          clearInterval(pollInterval);
          return;
        }
        try {
          const result = await withTimeout(
            contents.executeJavaScript(`(() => {
            const btn = document.querySelector('.download-btn[hx-get]');
            const hostLink = !!document.querySelector('.host_link');
            const body = (document.body && document.body.innerText) || '';
            const cfChallenge =
              /cloudflare|just a moment|checking your browser|verify you are human|attention required|cf-chl|turnstile/i.test(body) ||
              !!document.querySelector('#cf-chl, iframe[src*="challenges.cloudflare.com"], .cf-turnstile, #challenge-running');
            if (btn) { btn.click(); return { clicked: true, cf: cfChallenge, hostLink }; }
            return { clicked: false, cf: cfChallenge, hostLink };
          })()`, true),
            10000,
            "gate poll",
          );
          gatePollCf = result.cf;
          // Only the appearance of the link is a step; losing it is not.
          if (result.hostLink && !lastHostLink) markProgress();
          lastHostLink = result.hostLink;
          if (result.clicked) {
            markProgress();
            clearInterval(pollInterval);
          }
        } catch (err) {
          // poll errors are non-fatal; the idle watchdog still fires
        }
        // The /dl/ flow is page-internal and staged: Continue first, then
        // Generate after the countdown, so the interval stays open and only
        // the settle clears it. A POST is never synthesized - _xfToken is
        // session-bound.
        try {
          const dlResult = await withTimeout(
            contents.executeJavaScript(DL_POLL_SCRIPT, true),
            10000,
            "dl poll",
          );
          if (dlResult) {
            dlPoll = dlResult;
            // Only a change counts: a frozen countdown keeps reporting the same
            // seconds and must not look alive forever. The first reading is the
            // baseline, not a step.
            const key = [dlResult.dlActive, dlResult.seconds, dlResult.declaredHost, dlResult.clicked].join("|");
            if (lastDlKey === null) lastDlKey = key;
            else if (key !== lastDlKey) {
              lastDlKey = key;
              markProgress();
            }
          }
        } catch {
          // dl poll errors are non-fatal; the capture points still settle
        }
        // CF challenge state transitions, not every tick: one line when a
        // challenge page appears and one when it passes. A page that keeps
        // challenging produces challenge/challenge-passed pairs per cycle —
        // the same footprints a "verified then challenged again" report
        // shows, with how long the challenge held.
        if (gatePollCf && !challengeActive) {
          challengeActive = true;
          challengeSeen += 1;
          challengeStartedAt = Date.now();
          appLog.write("masked-resolve", {
            event: "challenge",
            host: hostOf(maskedUrl),
            cycle: challengeSeen,
          }, { devtools: true });
        } else if (!gatePollCf && challengeActive) {
          challengeActive = false;
          appLog.write("masked-resolve", {
            event: "challenge-passed",
            host: hostOf(maskedUrl),
            cycle: challengeSeen,
            heldMs: Date.now() - challengeStartedAt,
          }, { devtools: true });
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
        void finish({ ok: false, canceled: true, error: "Resolve window was closed" });
      }
    });

    contents.on("render-process-gone", () => {
      void finish({ ok: false, error: "Resolve window crashed" });
    });

    // The window stays hidden while the page is moving and is shown once it has
    // stopped, because that is the point a human is needed. This replaces the
    // old fixed reveal timer: a healthy resolve is never interrupted, however
    // long it takes, and a stalled page is handed over in seconds.
    if (headless) {
      idleTimer = setInterval(() => {
        // While the main document is still coming, a slow response looks exactly
        // like a stall. Allow it the load grace; once dom-ready has fired, the
        // normal idle window is the right measure.
        const idleMs = domReady ? IDLE_REVEAL_MS : LOAD_GRACE_MS;
        if (shouldReveal({ settled, revealed, lastProgressAt }, Date.now(), idleMs)) {
          reveal("idle");
        }
      }, 1000);
    }

    timer = setTimeout(() => {
      if (!settleFromCandidates()) {
        void finish({ ok: false, timedOut: true, error: "Timed out waiting for the download link" });
      }
    }, timeoutMs);

    // ── Go ──────────────────────────────────────────────────────────────────
    (async () => {
      try {
        // Jar grant state BEFORE seeding: pairs with the challenge/reveal
        // lines so a resolve challenged despite a live grant reads as
        // Cloudflare refusing our fingerprint, not a missing grant.
        try {
          const grant = await ses.cookies.get({ url: baseUrl, name: "cf_clearance" });
          appLog.write("cf-jar", {
            event: "resolve",
            host: hostOf(maskedUrl),
            grant: grant.length > 0,
          }, { devtools: true });
        } catch {
          // Jar unreadable — applyCookies below still seeds.
        }
        await applyCookies(ses, cookieHeader, baseUrl);
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
          void finish({ ok: false, error: err.message || String(err) });
        }
      }
    })();
  });
}

// ── One resolve at a time ────────────────────────────────────────────────────
//
// The partition is persistent (so a solved Cloudflare challenge survives), which
// means every resolve now shares ONE Session object rather than getting its own
// throwaway one. Concurrency against a shared session breaks three ways:
//
//   * session.webRequest.onBeforeRequest / onHeadersReceived accept a SINGLE
//     listener each. A second resolve registering silently replaces the first
//     one's capture, so the first stops seeing candidates and hangs to timeout.
//   * the cookie strip in finish() runs against the shared store, deleting the
//     F95 cookies applyCookies() just installed for a resolve still in flight.
//   * a stray will-download from one resolve could settle another with the
//     wrong URL -- i.e. the queue item downloads someone else's file.
//
// downloadManager runs MAX_CONCURRENT = 2 transfers, so this is reachable, not
// theoretical. Serializing is the honest fix: a browser resolve is a visible,
// interactive, one-at-a-time event, and two windows fighting over one session
// was never going to be right. Queued resolves wait rather than fail.
let resolveChain = Promise.resolve();

function resolveMaskedLink(maskedUrl, options = {}) {
  const run = resolveChain.then(
    () => resolveMaskedLinkImpl(maskedUrl, options),
    () => resolveMaskedLinkImpl(maskedUrl, options),
  );
  // The chain must not inherit a rejection, or every later resolve short-circuits.
  resolveChain = run.then(() => undefined, () => undefined);
  return run;
}

module.exports = {
  resolveMaskedLink,
  // Persistent partition + cookie seeding, shared with forum thread fetching
  // so both use the one session that holds solved Cloudflare grants.
  RESOLVER_PARTITION,
  applyCookies,
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
