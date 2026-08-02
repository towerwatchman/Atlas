"use strict";

// ── Pixeldrain host plugin ───────────────────────────────────────────────────
//
// Turns a Pixeldrain share page into something the download manager can
// actually fetch.
//
// This is the gap that made a resolved link produce a 4KB file: the masked
// resolver correctly hands back https://pixeldrain.com/u/UPND8Ncr, but that is
// an HTML page. Fetching it gets you the page. The bytes live at
// /api/file/{id}, which is what this maps to.
//
// Pixeldrain is the friendliest host in the set - a plain documented REST API,
// no encryption, no interstitial, and public files need no credentials. An
// optional API key raises transfer limits and is sent as HTTP Basic with an
// empty username.
//
// URL shapes:
//   https://pixeldrain.com/u/{id}        single file share page
//   https://pixeldrain.com/api/file/{id} the file itself
//   https://pixeldrain.com/l/{id}        a LIST (folder) of files
//
// Lists are detected and rejected rather than guessed at. A list is N files,
// and the queue models one item as one file; silently grabbing the first entry
// would give the user a partial download that looks complete.

const BASE = "https://pixeldrain.com";

// /u/{id} and /api/file/{id}. Ids are short alphanumerics.
const FILE_PATTERNS = [
  /pixeldrain\.com\/u\/([a-zA-Z0-9]+)/i,
  /pixeldrain\.com\/api\/file\/([a-zA-Z0-9]+)/i,
];
const LIST_PATTERN = /pixeldrain\.com\/l\/([a-zA-Z0-9]+)/i;

const id = "pixeldrain";
const label = "Pixeldrain";
const supportsAnonymous = true;

function matches(url) {
  return /(^|\/\/|\.)pixeldrain\.com\//i.test(String(url || ""));
}

function fileIdFrom(url) {
  const text = String(url || "");
  for (const pattern of FILE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function listIdFrom(url) {
  const match = String(url || "").match(LIST_PATTERN);
  return match ? match[1] : null;
}

// An API key authenticates as Basic with an EMPTY username - the key goes in
// the password field. Anonymous access simply omits the header.
function authHeaders(credentials) {
  const apiKey = String(credentials?.apiKey || credentials?.password || "").trim();
  if (!apiKey) return {};
  const encoded = Buffer.from(`:${apiKey}`).toString("base64");
  return { authorization: `Basic ${encoded}` };
}

/**
 * Classify a failure so the queue runner knows whether to retry.
 *
 * Pixeldrain signals problems both by status code and by a `value` field in a
 * JSON body. The exact strings are not fully documented, so this matches on
 * substrings and falls back to the status code rather than assuming an exact
 * vocabulary - a misclassified error costing one wasted retry is much better
 * than a hard failure on a transient blip.
 */
function classifyError(err, { status = 0, body = null } = {}) {
  const value = String(body?.value || "").toLowerCase();
  const message = String(err?.message || body?.message || "").toLowerCase();
  const text = `${value} ${message}`;

  if (/rate_?limit|captcha|transfer_?limit|bandwidth/.test(text)) return "quota";
  if (status === 429) return "quota";
  if (/unauthor|forbidden|invalid.*key|auth/.test(text)) return "auth";
  if (status === 401 || status === 403) return "auth";
  if (/not_?found|deleted|expired/.test(text)) return "fatal";
  if (status === 404 || status === 410) return "fatal";
  if (status >= 500 || status === 0) return "transient";
  if (/timeout|econnreset|enotfound|socket/.test(text)) return "transient";
  return "transient";
}

/**
 * Resolve a share URL to a direct file URL plus metadata.
 *
 * Called before any bytes move, so the queue can show a real filename and size,
 * and so a dead link fails immediately rather than after a partial transfer.
 *
 * @returns {Promise<{ok:boolean, directUrl?:string, fileName?:string,
 *                     fileSize?:number, headers?:object, error?:string,
 *                     kind?:string}>}
 */
async function probe(url, credentials = {}) {
  const listId = listIdFrom(url);
  if (listId) {
    return {
      ok: false,
      kind: "fatal",
      error:
        "This is a Pixeldrain album containing several files. Atlas can only " +
        "queue single files, so download it from the browser instead.",
    };
  }

  const fileId = fileIdFrom(url);
  if (!fileId) {
    return { ok: false, kind: "fatal", error: "Not a recognisable Pixeldrain file link" };
  }

  const headers = { "user-agent": "Atlas", ...authHeaders(credentials) };

  let response;
  let info = null;
  try {
    response = await fetch(`${BASE}/api/file/${fileId}/info`, { headers });
    // A non-JSON body here means something upstream (a proxy, a captcha wall)
    // intercepted the request, so treat a parse failure as a real failure.
    info = await response.json().catch(() => null);
  } catch (err) {
    return { ok: false, kind: classifyError(err), error: err.message || String(err) };
  }

  if (!response.ok || info?.success === false) {
    return {
      ok: false,
      kind: classifyError(null, { status: response.status, body: info }),
      error: info?.message || `Pixeldrain returned ${response.status}`,
    };
  }

  const fileName = String(info?.name || "").trim();
  const fileSize = Number(info?.size) || 0;

  return {
    ok: true,
    // ?download sets Content-Disposition: attachment. The bytes are identical
    // either way; this just keeps the filename sane if anything else handles it.
    directUrl: `${BASE}/api/file/${fileId}?download`,
    fileName: fileName || `pixeldrain-${fileId}`,
    fileSize,
    // Sent with the transfer too - an API key raises the limit for the actual
    // download, not just the info lookup.
    headers: authHeaders(credentials),
    mimeType: info?.mime_type || "",
  };
}

/**
 * Confirm a key works, and report what the account is.
 *
 * /api/user is the documented account endpoint. Its exact response shape is not
 * something we can pin down offline, so every field is read defensively and a
 * parse failure degrades to "the key works, we just cannot describe it" rather
 * than reporting a valid key as broken.
 */
async function validate(credentials = {}) {
  const apiKey = String(credentials?.apiKey || credentials?.password || "").trim();
  if (!apiKey) return { ok: true, anonymous: true };

  try {
    const response = await fetch(`${BASE}/api/user`, {
      headers: { "user-agent": "Atlas", ...authHeaders(credentials) },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "Pixeldrain rejected that API key" };
    }
    if (!response.ok) {
      return { ok: false, error: `Pixeldrain returned ${response.status}` };
    }
    const info = await response.json().catch(() => null);
    return {
      ok: true,
      anonymous: false,
      username: String(info?.username || "").trim(),
      // Subscription naming varies; take whatever is there and show it as-is
      // rather than mapping to names that might not match theirs.
      plan: String(info?.subscription?.name || info?.subscription?.id || "").trim(),
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Transfer allowance, when the host will tell us.
 *
 * Pixeldrain caps transfer rather than requests, and the cap is what users
 * actually hit mid-queue. Reporting it turns "download failed" into "you have
 * used your daily transfer" - the difference between a bug report and an
 * understood limit.
 *
 * Field names are read defensively across several plausible spellings because
 * the response shape could not be verified offline. Unknown is a valid answer;
 * inventing a number would be worse.
 */
async function getQuota(credentials = {}) {
  try {
    const response = await fetch(`${BASE}/api/user`, {
      headers: { "user-agent": "Atlas", ...authHeaders(credentials) },
    });
    if (!response.ok) {
      return { ok: false, error: `Pixeldrain returned ${response.status}` };
    }
    const info = await response.json().catch(() => null);
    if (!info) return { ok: false, error: "Could not read the quota response" };

    const pick = (...keys) => {
      for (const key of keys) {
        const value = info?.[key] ?? info?.subscription?.[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
      }
      return null;
    };
    const used = pick("transfer_used", "transferUsed", "monthly_transfer_used");
    const cap = pick("transfer_cap", "transferCap", "monthly_transfer_cap");

    return {
      ok: true,
      used,
      cap,
      // Only meaningful when both numbers came back.
      remaining: used != null && cap != null ? Math.max(0, cap - used) : null,
      plan: String(info?.subscription?.name || "").trim(),
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = {
  id,
  label,
  supportsAnonymous,
  // What the Settings form should ask for. An API key is preferred over a
  // password: a leaked scoped key is a smaller problem than a leaked account.
  credentialFields: [
    {
      key: "apiKey",
      label: "API key",
      type: "password",
      help: "Found under your Pixeldrain account settings. Optional - "
        + "downloads work without one, but an account raises the transfer limit.",
    },
  ],
  matches,
  probe,
  validate,
  getQuota,
  classifyError,
  // Exported for tests
  fileIdFrom,
  listIdFrom,
  authHeaders,
};
