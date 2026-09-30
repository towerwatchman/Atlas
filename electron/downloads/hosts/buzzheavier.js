"use strict";

// ── Buzzheavier host plugin ──────────────────────────────────────────────────
//
// Their published API covers upload, account info, storage locations and a file
// manager for your OWN content. It does not document how to turn a public share
// link into a downloadable URL, which is the one thing a download manager needs.
//
// What the site does do is run on htmx - the page markup carries hx-ext and
// hx-config - and an htmx download control answers with an HX-Redirect header
// rather than a 3xx. So resolving is: make the request the page's own download
// button makes, and read the location it hands back. No secret, no obfuscated
// constant, no reverse-engineered token; just the site's public interaction.
//
// That resolve path is INFERRED from the page's framework, not from their docs,
// so probe() reports what it actually saw when the shape is not what it
// expected. One real download either confirms it or says exactly what to
// change, which beats a silent wrong guess.

// Account endpoints live on the main domain.
const API_BASE = "https://buzzheavier.com";

// Downloads must be requested from the SAME origin the link was posted on.
// Shares appear as bzzhr.to; asking buzzheavier.com for a bzzhr.to id was the
// original bug - a cross-domain request that Cloudflare answered with a
// challenge, which then surfaced to the user as "transfer limit reached".
function originFor(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return API_BASE;
  }
}

// Share links appear on the main domain and their short domain. Ids are short
// alphanumerics; a trailing slug can be ignored.
// Confirmed against a real thread: shares are posted as bzzhr.to. An earlier
// guess of bzzhr.co matched nothing.
const LINK_PATTERNS = [
  /(?:^|\/\/|\.)(?:buzzheavier\.com|bzzhr\.(?:to|co))\/(?:f\/)?([a-zA-Z0-9]{4,})/i,
   // A /d/ URL (ts.bzzhr.to/d/<id>) is the DIRECT CDN link the browser resolve
   // hands back. It is matched separately, purely so the id can be read.
   // It must never drive a re-resolve: startTransfer treats
  // an already-resolved CDN link as final (see resolvedLink.js) and probe()
  // short-circuits /d/ URLs below, so this pattern cannot start the loop the
  // old comment warned about.
  /(?:^|\/\/|\.)(?:buzzheavier\.com|bzzhr\.(?:to|co))\/(?:d\/)([a-zA-Z0-9]{4,})/i,
];

// Their own site routes are pages, not shares.
const SITE_ROUTES = /^(api|pricing|blog|terms|privacy|contact|help|proxy|speedtest|developers|login|register)$/i;

const id = "buzzheavier";
const label = "Buzzheavier";
const supportsAnonymous = true;

function matches(url) {
  return /(^|\/\/|\.)(buzzheavier\.com|bzzhr\.to|bzzhr\.co)\//i.test(String(url || ""));
}

function fileIdFrom(url) {
  const text = String(url || "").split(/[?#]/)[0];
  for (const pattern of LINK_PATTERNS) {
    const match = text.match(pattern);
    if (match && !SITE_ROUTES.test(match[1])) return match[1];
  }
  // A null here is what surfaces as "Could not read a file id from this link".
  return null;
}

// Documented: Authorization: Bearer YOUR_ACCOUNT_ID. The token IS the account
// id, which is why Settings labels the field that way.
function authHeaders(credentials) {
  const token = String(credentials?.accountId || credentials?.apiKey || "").trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Classify a failure so the queue runner knows whether to retry.
 *
 * Cloudflare fronts this host - Turnstile loads on their pages - so a challenge
 * is treated as quota rather than fatal: it means "not right now", not "never".
 */
// A thrown fetch error describes the CONNECTION, never the file. Tested before
// any body vocabulary because the two overlap: "getaddrinfo ENOTFOUND host"
// contains "notfound", so a DNS failure matched the deleted-file rule and was
// classified fatal -- terminal, no retry, and the partial file discarded. A
// dropped wifi connection permanently failed the download.
const TRANSPORT_CODES = /\b(enotfound|econnrefused|econnreset|econnaborted|etimedout|epipe|ehostunreach|enetunreach|eai_again|eproto|und_err)\b/i;
const TRANSPORT_TEXT = /fetch failed|socket hang up|network error|aborted due to timeout|request timed?out|terminated/i;

/** True when this is a transport failure rather than anything the host said. */
function isTransportError(err) {
  if (!err) return false;
  const code = String(err.code || err.cause?.code || "");
  const message = String(err.message || "");
  return TRANSPORT_CODES.test(code) || TRANSPORT_CODES.test(message) || TRANSPORT_TEXT.test(message);
}

function classifyError(err, { status = 0, body = null } = {}) {
  const text = `${String(body?.message || "")} ${String(err?.message || "")}`.toLowerCase();
  if (isTransportError(err)) return "transient";

  // cf-mitigated: challenge is set explicitly by Cloudflare, so it is a
  // reliable signal - and it is NOT a quota. Reporting it as one told users to
  // wait or add an account, neither of which does anything.
  if (/cf-mitigated|turnstile|challenge|captcha|cf-chl|just a moment/.test(text)) {
    return "challenge";
  }
  if (status === 429) return "quota";
  if (/rate.?limit|too many/.test(text)) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (/unauthor|forbidden|invalid.*(token|account)/.test(text)) return "auth";
  if (status === 404 || status === 410) return "fatal";
  if (/not.?found|deleted|expired|removed/.test(text)) return "fatal";
  if (status >= 500 || status === 0) return "transient";
  if (/timeout|econnreset|enotfound|socket|network/.test(text)) return "transient";
  return "transient";
}

/**
 * Resolve a share link to a direct file URL.
 *
 * Redirects are deliberately NOT followed: the header is the answer, and
 * following it would begin the transfer inside the probe.
 */
async function probe(url, credentials = {}) {
  // A /d/ CDN link (ts.bzzhr.to/d/<id>) is the OUTPUT of a successful browser
  // resolve - it is already the file, not a share to resolve again. Returning
  // it as a passthrough stops any caller that reaches probe with one (and would
  // otherwise hit the /d/ file-id path) from re-resolving in a loop.
  if (/\/d\/[a-zA-Z0-9]/.test(String(url || ""))) {
    return {
      ok: true,
      directUrl: String(url).split(/[?#]/)[0],
      fileName: "",
      fileSize: 0,
      passthrough: true,
    };
  }

  const fileId = fileIdFrom(url);
  if (!fileId) {
    return { ok: false, kind: "fatal", error: "Not a recognisable Buzzheavier link" };
  }

  const base = originFor(url);
  const headers = {
    "user-agent": "Mozilla/5.0 Atlas/1.0",
    // Marks this as the page's own download interaction. Without them the
    // route answers with the HTML page instead of a redirect.
    "hx-request": "true",
    "hx-current-url": `${base}/${fileId}`,
    referer: `${base}/${fileId}`,
    ...authHeaders(credentials),
  };

  let response;
  try {
    response = await fetch(`${base}/${fileId}/download`, { headers, redirect: "manual" });
  } catch (err) {
    return { ok: false, kind: classifyError(err), error: err.message || String(err) };
  }

  const redirect =
    response.headers.get("hx-redirect")
    || response.headers.get("location");

  if (!redirect) {
    const snippet = await response.text().then((t) => t.slice(0, 300)).catch(() => "");
    const challenged = /turnstile|just a moment|cf-chl/i.test(snippet);
    return {
      ok: false,
      kind: challenged ? "quota" : classifyError(null, { status: response.status }),
      error: challenged
        ? "Buzzheavier returned a Cloudflare challenge. Try again shortly, or download from the browser."
        : `Buzzheavier gave no download location (HTTP ${response.status}).`,
      // Surfaced so a route change is diagnosable from one failed run.
      diagnostic: {
        requested: `${base}/${fileId}/download`,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        bodyStart: snippet,
      },
    };
  }

  const directUrl = redirect.startsWith("http") ? redirect : `${base}${redirect}`;

  // The filename is not returned by this route, so derive it from the resolved
  // URL; the transfer's Content-Disposition takes over if it has one.
  let fileName = "";
  try {
    const tail = new URL(directUrl).pathname.split("/").filter(Boolean).pop() || "";
    if (/\.[a-z0-9]{2,5}$/i.test(tail)) fileName = decodeURIComponent(tail);
  } catch {
    /* leave empty; the manager derives its own */
  }

  return {
    ok: true,
    directUrl,
    fileName,
    // Unknown up front. The manager reads Content-Length on the transfer and
    // shows an indeterminate bar until then, which is honest.
    fileSize: 0,
    headers: { referer: `${base}/${fileId}`, ...authHeaders(credentials) },
  };
}

/** Documented: GET /api/account, account id as a bearer token. */
async function validate(credentials = {}) {
  const token = String(credentials?.accountId || credentials?.apiKey || "").trim();
  if (!token) return { ok: true, anonymous: true };

  try {
    const response = await fetch(`${API_BASE}/api/account`, {
      headers: { "user-agent": "Atlas", ...authHeaders(credentials) },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "Buzzheavier rejected that account ID" };
    }
    if (!response.ok) return { ok: false, error: `Buzzheavier returned ${response.status}` };

    const info = await response.json().catch(() => null);
    return {
      ok: true,
      anonymous: false,
      // Field names are unpublished; read what is present rather than failing a
      // valid account because the shape differs from a guess.
      username: String(info?.username || info?.name || info?.email || "").trim(),
      plan: String(info?.plan || info?.tier || info?.subscription || "").trim(),
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Usage figures, if the account endpoint reports any. Their docs describe
 * /api/account only as "the current authenticated account's information" with
 * no schema, so this reads defensively and returns unknown rather than
 * inventing a number.
 */
async function getQuota(credentials = {}) {
  const token = String(credentials?.accountId || credentials?.apiKey || "").trim();
  if (!token) return { ok: false, error: "No account configured" };

  try {
    const response = await fetch(`${API_BASE}/api/account`, {
      headers: { "user-agent": "Atlas", ...authHeaders(credentials) },
    });
    if (!response.ok) return { ok: false, error: `Buzzheavier returned ${response.status}` };
    const info = await response.json().catch(() => null);
    if (!info) return { ok: false, error: "Could not read the account response" };

    const pick = (...keys) => {
      for (const key of keys) {
        const value = info?.[key] ?? info?.usage?.[key] ?? info?.quota?.[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
      }
      return null;
    };
    const used = pick("storageUsed", "usedStorage", "storage_used", "used");
    const rawCap = pick("storageLimit", "storageQuota", "storage_limit", "quota", "limit");
    // A zero cap means "no cap configured" on every host that reports one this
    // way; treating it as a literal limit reports "0 of 0" to everyone.
    const cap = rawCap && rawCap > 0 ? rawCap : null;

    return {
      ok: true,
      used,
      cap,
      unlimited: rawCap === 0,
      remaining: used != null && cap != null ? Math.max(0, cap - used) : null,
      plan: String(info?.plan || info?.tier || "").trim(),
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = {
  id,
  label,
  supportsAnonymous,
  // Host strings this plugin serves. groupClassifier gates mirrors on the first
  // label of the host ("bzzhr.to" -> "bzzhr"), which does not equal the plugin
  // id - without the alias every Buzzheavier mirror is filtered out as
  // unsupported even though the plugin handles it.
  hostAliases: ["buzzheavier", "bzzhr"],

  // Enabled: supportedHostIds() and listPlugins() include it, so Buzzheavier
  // mirrors appear in the update modal and the host shows in Settings >
  // Accounts. It shipped disabled while the Cloudflare gate could not be
  // cleared; the browser resolve below is what changed that.

  // Cloudflare challenges the download route: it answers a plain fetch with
  // 403 + cf-mitigated: challenge, and asks for User-Agent Client Hints that
  // only a real browser supplies. Rather than impersonate one, the manager
  // resolves this host in the Electron window that already exists - which
  // clears silently because it genuinely is Chromium.
  requiresBrowser: true,
  // The window treats these as "not yet arrived"; anything else is the file.
  gateHosts: ["bzzhr.to", "buzzheavier.com", "bzzhr.co"],
  // Path appended to the share URL to reach the download route.
  browserPath: (fileId) => `/${fileId}/download`,
  credentialFields: [
    {
      key: "accountId",
      label: "Account ID",
      type: "password",
      help:
        "From your Buzzheavier account page. Optional — public links download "
        + "without one. Sent as a bearer token, which is what their API expects.",
    },
  ],
  matches,
  probe,
  validate,
  getQuota,
  classifyError,
  // Exported for tests
  fileIdFrom,
  authHeaders,
};
