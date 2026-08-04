"use strict";

// ── MEGA ─────────────────────────────────────────────────────────────────────
//
// Anonymous public-link downloads. No account required: Mega's public-link API
// takes no authentication at all, because the link itself is the credential --
// the decryption key travels in the URL fragment and never reaches the server.
// An account only raises the transfer quota, so signing in is additive and this
// plugin is useful before it exists.
//
// Unlike every other plugin here, `probe()` also returns a `decrypt` descriptor.
// Mega serves ciphertext, so there is no URL that yields the real file; the
// manager pipes the response through the transform this describes. See
// megaDecrypt.js for why that is a contract extension rather than a private
// downloader.

const {
  parseMegaLink,
  deriveFileKey,
  decryptAttributes,
  fileNameFromAttributes,
} = require("./megaLink");

const API = "https://g.api.mega.co.nz/cs";

// Mega reports failure as a BARE NEGATIVE NUMBER, either as the whole body or as
// the single element of an array -- not as an object with a message. Discovered
// by sending a malformed request and getting back exactly `[-2]`.
const ERROR_CODES = {
  "-1": { kind: "transient", message: "MEGA had an internal error. It is worth retrying." },
  "-2": { kind: "fatal", message: "MEGA rejected the request as malformed." },
  "-3": { kind: "transient", message: "MEGA asked us to try again shortly." },
  "-4": { kind: "transient", message: "MEGA is rate limiting this connection." },
  "-6": { kind: "transient", message: "Too many concurrent requests to MEGA." },
  "-9": { kind: "fatal", message: "This MEGA file no longer exists." },
  "-11": { kind: "fatal", message: "Access to this MEGA file was denied." },
  "-15": { kind: "auth", message: "The MEGA session has expired." },
  "-16": { kind: "fatal", message: "This MEGA account has been blocked." },
  "-17": { kind: "quota", message: "MEGA's transfer quota is exhausted. It resets periodically." },
  "-18": { kind: "transient", message: "This MEGA file is temporarily unavailable." },
};

function errorFor(code) {
  return ERROR_CODES[String(code)]
    || { kind: "transient", message: `MEGA returned error ${code}.` };
}

function matches(url) {
  return parseMegaLink(url) !== null;
}

/** The public id, for the manager's browser-resolution path (unused here). */
function fileIdFrom(url) {
  return parseMegaLink(url)?.id || null;
}

async function probe(url) {
  const link = parseMegaLink(url);
  if (!link) return { ok: false, kind: "fatal", error: "That is not a MEGA link." };

  if (link.kind === "folder") {
    // Recognised deliberately so this reads as a missing feature rather than a
    // broken link: a folder needs its tree fetched and decrypted before there is
    // any file to fetch, which is its own piece of work.
    return {
      ok: false,
      kind: "fatal",
      error: "This is a MEGA folder link. Atlas can only download direct file "
        + "links from MEGA so far — open the folder and copy the link for the file itself.",
    };
  }

  const material = deriveFileKey(link.keyBase64);
  if (!material) {
    return {
      ok: false,
      kind: "fatal",
      error: "The key in this MEGA link is not a file key. It may have been "
        + "truncated when it was copied — everything after the # matters.",
    };
  }

  let payload;
  try {
    const response = await fetch(`${API}?id=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // ONLY the id. The key after the # is never sent: including it returns
      // [-2], which is how this was first got wrong.
      body: JSON.stringify([{ a: "g", g: 1, p: link.id }]),
    });
    if (!response.ok) {
      return {
        ok: false,
        kind: response.status >= 500 ? "transient" : "fatal",
        error: `MEGA's API returned ${response.status}.`,
        diagnostic: { status: response.status, fileId: link.id },
      };
    }
    payload = await response.json();
  } catch (err) {
    return {
      ok: false,
      kind: "transient",
      error: `Could not reach MEGA: ${err.message}`,
      diagnostic: { fileId: link.id },
    };
  }

  // Either `-2` or `[-2]`; a success is `[{ … }]`.
  const entry = Array.isArray(payload) ? payload[0] : payload;
  if (typeof entry === "number") {
    const mapped = errorFor(entry);
    return {
      ok: false, kind: mapped.kind, error: mapped.message,
      diagnostic: { megaError: entry, fileId: link.id },
    };
  }
  if (!entry || typeof entry !== "object" || !entry.g) {
    return {
      ok: false, kind: "transient",
      error: "MEGA's response did not include a download URL.",
      diagnostic: { fileId: link.id, keys: entry ? Object.keys(entry) : [] },
    };
  }

  const attributes = decryptAttributes(entry.at, material.key);
  if (!attributes) {
    // The MEGA prefix inside `at` only appears when the key is right, so this is
    // specifically a key mismatch and not a corrupt response.
    return {
      ok: false,
      kind: "fatal",
      error: "The key in this MEGA link does not match the file. The link may be "
        + "for a different file, or part of it was lost when it was copied.",
      diagnostic: { fileId: link.id, hadAttributes: Boolean(entry.at) },
    };
  }

  return {
    ok: true,
    // Served over plain http by MEGA's storage nodes, which the manager already
    // accepts. The payload is encrypted regardless of the transport.
    directUrl: String(entry.g),
    fileName: fileNameFromAttributes(attributes),
    fileSize: Number(entry.s) || 0,
    headers: {},
    // The contract extension: the manager pipes the response through this.
    decrypt: {
      kind: "mega",
      key: material.key,
      nonce: material.nonce,
      metaMac: material.metaMac,
    },
  };
}

async function validate() {
  // No account support yet, and saying so is better than accepting details that
  // would do nothing. Anonymous downloads are unaffected.
  return {
    ok: false,
    error: "Atlas does not sign in to MEGA yet. Public links download without an "
      + "account; an account would only raise the transfer quota.",
  };
}

function classifyError(err, { status, body } = {}) {
  const numeric = Number(String(body ?? "").trim());
  if (Number.isInteger(numeric) && numeric < 0) return errorFor(numeric).kind;
  if (status === 429) return "quota";
  if (status && status >= 500) return "transient";
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(String(err?.message || ""))) {
    return "transient";
  }
  return "transient";
}

module.exports = {
  id: "mega",
  label: "MEGA",
  supportsAnonymous: true,
  // The mirror gate matches the FIRST LABEL of the host, so mega.nz and
  // mega.co.nz both present as "mega".
  hostAliases: ["mega"],
  credentialFields: [],
  matches,
  probe,
  validate,
  classifyError,
  // Exported for tests
  fileIdFrom,
  ERROR_CODES,
};
