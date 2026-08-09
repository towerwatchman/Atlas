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
//   https://pixeldrain.com/d/{id}        the same file, download-oriented view
//   https://pixeldrain.com/api/file/{id} the file itself
//   https://pixeldrain.com/l/{id}        a LIST (folder) of files
//
// /d/ was missing, and the omission was invisible: matches() claims every
// pixeldrain.com URL, so a /d/ link was taken by this plugin and then refused by
// it as unrecognisable -- reported to the user as "This link is no longer
// available" for a file that was perfectly alive.
//
// Lists are detected and rejected rather than guessed at. A list is N files,
// and the queue models one item as one file; silently grabbing the first entry
// would give the user a partial download that looks complete.

const BASE = "https://pixeldrain.com";

// Ids are short and url-safe. The charset deliberately includes - and _ even
// though observed ids are alphanumeric: the previous [a-zA-Z0-9]+ did not FAIL on
// an id containing either, it TRUNCATED at the first one. "abc-123def" became
// "abc", which is a perfectly well formed request for a different file, and the
// 404 that came back was indistinguishable from the file having been deleted.
// Refusing to parse is recoverable; parsing into a confident wrong answer is not.
const ID = "([a-zA-Z0-9_-]+)";
const FILE_PATTERNS = [
  new RegExp(`pixeldrain\\.com/u/${ID}`, "i"),
  new RegExp(`pixeldrain\\.com/api/file/${ID}`, "i"),
];

// /d/ is the FILESYSTEM, a separate subsystem from /u/ with its own API base.
// It was briefly mapped onto the file id space here, which was wrong: the id in
// a /d/ link is a filesystem PATH, and /api/file/{it}/info answers
// "The entity you requested could not be found" for a file that plainly exists.
//
// Evidence, from a share page's details modal:
//   Path         /SnRizccJ
//   Mode         -rw-r--r--
//   Direct link  https://pixeldrain.com/api/filesystem/SnRizccJ
//
// The path may be nested (a shared directory addressing a file inside it), so
// everything after /d/ is kept, minus query and fragment. Splitting on the first
// segment would silently address the directory instead of the file -- the same
// class of mistake as truncating an id at a hyphen.
const FILESYSTEM_PATTERN = /pixeldrain\.com\/d\/([^?#]+)/i;
const LIST_PATTERN = new RegExp(`pixeldrain\\.com/l/${ID}`, "i");

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

/** The filesystem path a /d/ link addresses, or null. */
function filesystemPathFrom(url) {
  const match = String(url || "").match(FILESYSTEM_PATTERN);
  if (!match) return null;
  // Trailing slash removed so "/d/Bucket/" and "/d/Bucket" address one thing.
  const path = match[1].replace(/\/+$/, "").trim();
  return path || null;
}

/** Which URL shape this is, for diagnostics and for honest error wording. */
function shapeOf(url) {
  const text = String(url || "");
  if (/pixeldrain\.com\/api\/file\//i.test(text)) return "api";
  if (/pixeldrain\.com\/u\//i.test(text)) return "u";
  if (/pixeldrain\.com\/d\//i.test(text)) return "d";
  if (/pixeldrain\.com\/l\//i.test(text)) return "l";
  return "unknown";
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
  const value = String(body?.value || "").toLowerCase();
  if (isTransportError(err)) return "transient";
  const message = String(err?.message || body?.message || "").toLowerCase();
  const text = `${value} ${message}`;

  // Per the API docs these are two different 403s and must not be conflated.
  // virus_detected_captcha_required means the file is flagged as malware - no
  // amount of waiting or upgrading fixes that, so it is terminal.
  if (/virus_detected/.test(text)) return "blocked";
  // file_rate_limited_captcha_required (403) fires when a file has 3x more
  // downloads than views, or when hotlinking is detected. ip_rate_limit_reached
  // is 429. Both are "come back later", not an auth problem.
  if (/rate_?limit|captcha|transfer_?limit|bandwidth|hotlink/.test(text)) return "quota";
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

  const headers = { "user-agent": "Atlas", ...authHeaders(credentials) };

  // ── /d/ : the filesystem ───────────────────────────────────────────────────
  //
  // The download URL is known for certain -- a share page labels
  // https://pixeldrain.com/api/filesystem/{path} as both "Direct link" and
  // "Direct sharing link". What is NOT known is how to ask for metadata about it,
  // so this does not guess at an endpoint. It sends a HEAD to the download URL
  // itself and reads the standard headers, which is ordinary HTTP and cannot be
  // wrong about Pixeldrain's API shape because it makes no claim about it.
  //
  // Two unverified endpoint guesses already cost a round trip each on this one
  // link. This branch is built so a third is not needed.
  const fsPath = filesystemPathFrom(url);
  if (fsPath) {
    const directUrl = `${BASE}/api/filesystem/${fsPath}`;
    let head;
    try {
      head = await fetch(directUrl, { method: "HEAD", headers });
    } catch (err) {
      return {
        ok: false,
        kind: classifyError(err),
        error: err.message || String(err),
        diagnostic: { requested: directUrl, shape: "d", fsPath, transportError: true },
      };
    }

    const contentType = String(head.headers.get("content-type") || "");
    const disposition = String(head.headers.get("content-disposition") || "");
    const length = Number(head.headers.get("content-length")) || 0;
    const diagnostic = {
      requested: directUrl, shape: "d", fsPath,
      status: head.status, contentType, contentLength: length, disposition,
    };

    if (!head.ok) {
      return {
        ok: false,
        kind: classifyError(null, { status: head.status }),
        error: `Pixeldrain returned ${head.status} for this shared path.`,
        diagnostic,
      };
    }

    // A /d/ node can be a DIRECTORY as well as a file -- the share page shows a
    // unix mode, and a directory reads drwxr-xr-x. A directory is N files and the
    // queue models one item as one file, so it is refused for the same reason a
    // /l/ album is, rather than downloading a listing and calling it a game.
    if (/^(application\/json|text\/html)/i.test(contentType)) {
      return {
        ok: false,
        kind: "fatal",
        error:
          "This Pixeldrain link is a shared folder rather than a single file. "
          + "Atlas queues one file at a time, so open it in your browser and pick "
          + "the file you want.",
        diagnostic,
      };
    }

    // Content-Disposition first, then the last path segment. Both beat the id.
    const fromDisposition = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
    const fromPath = fsPath.split("/").pop();
    let fileName = fromDisposition || fromPath || `pixeldrain-${fsPath}`;
    try { fileName = decodeURIComponent(fileName); } catch { /* keep it raw */ }

    return {
      ok: true,
      diagnostic,
      directUrl,
      fileName,
      fileSize: length,
      headers: authHeaders(credentials),
      mimeType: contentType.split(";")[0] || "",
    };
  }

  const fileId = fileIdFrom(url);
  if (!fileId) {
    // Names Atlas as the limitation. This is a shape this plugin does not parse,
    // not a missing file, and the old wording ("Not a recognisable Pixeldrain
    // file link") read as though the user had pasted something wrong.
    return {
      ok: false,
      kind: "fatal",
      error:
        "Atlas does not recognise this Pixeldrain link format, so it cannot work "
        + "out which file to fetch. The file itself may be fine - opening the link "
        + "in a browser will show. Please report the link so the format can be added.",
    };
  }


  const shape = shapeOf(url);
  const infoUrl = `${BASE}/api/file/${fileId}/info`;

  let response;
  let info = null;
  try {
    response = await fetch(infoUrl, { headers });
    // A non-JSON body here means something upstream (a proxy, a captcha wall)
    // intercepted the request, so treat a parse failure as a real failure.
    info = await response.json().catch(() => null);
  } catch (err) {
    return {
      ok: false,
      kind: classifyError(err),
      error: err.message || String(err),
      diagnostic: { requested: infoUrl, shape, fileId, transportError: true },
    };
  }

  // A null `info` means the body would not parse. That has to fail: with a 200
  // and info === null, `info?.success === false` is undefined rather than true,
  // so an earlier version of this guard let a garbage response through as a
  // successful probe with an empty filename and zero size.
  if (!response.ok || !info || info.success === false) {
    const kind = classifyError(null, { status: response.status, body: info });
    const notFound = kind === "fatal";
    // A /d/ id that the FILE endpoint does not know is much more likely to be a
    // different kind of entity than a deleted file. Atlas maps /d/ onto the file
    // id space, and that mapping is an assumption -- it was never verified
    // against Pixeldrain's API. Saying "this link is gone" on the strength of an
    // unverified assumption is exactly the error this whole investigation began
    // with, so when the shape is /d/ and the entity is missing, the message says
    // which of the two it cannot distinguish.
    const unverifiedShape = notFound && shape === "d";
    return {
      ok: false,
      kind,
      error: unverifiedShape
        ? "Pixeldrain does not recognise this id as a file. Atlas treats a /d/ "
          + "link as a file link, which may be wrong for this one - it could be a "
          + "different kind of Pixeldrain share. Opening it in a browser will show "
          + "whether the file is still there; please report it either way."
        : (info?.message
          || (info ? `Pixeldrain returned ${response.status}` : "Unreadable response from Pixeldrain")),
      // Everything needed to identify the id space from one failed run.
      diagnostic: {
        requested: infoUrl,
        shape,
        fileId,
        status: response.status,
        success: info?.success ?? null,
        value: info?.value || "",
        message: info?.message || "",
        bodyKeys: info ? Object.keys(info).slice(0, 12) : null,
      },
    };
  }

  const fileName = String(info?.name || "").trim();
  const fileSize = Number(info?.size) || 0;

  return {
    ok: true,
    diagnostic: { requested: infoUrl, shape, fileId, status: response.status },
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
 * GET /user is the documented account endpoint and returns id, username,
 * email, subscription and the monthly transfer counters. Fields are still read
 * defensively so a shape change degrades to "the key works, we just cannot
 * describe it" rather than reporting a valid key as broken.
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
    // Field names confirmed against the API docs: GET /user returns
    // monthly_transfer_used and monthly_transfer_cap.
    const used = pick("monthly_transfer_used", "transfer_used");
    const rawCap = pick("monthly_transfer_cap", "transfer_cap");
    // The docs are explicit that a cap of 0 means NO custom cap is configured.
    // Treating it as a real limit would report "0 of 0 bytes remaining" to
    // every user who has not set one.
    const cap = rawCap && rawCap > 0 ? rawCap : null;

    return {
      ok: true,
      used,
      cap,
      unlimited: rawCap === 0,
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
  hostAliases: ["pixeldrain"],
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
  filesystemPathFrom,
  shapeOf,
  authHeaders,
};
