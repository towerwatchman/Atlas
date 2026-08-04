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
const account = require("./megaAccount");
const { parseHashcashChallenge, formatHashcashHeader } = require("./megaHashcash");
const { solveWithWorkers } = require("./megaHashcashPool");

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
  "-26": { kind: "auth", message: "This MEGA account needs a two-factor code." },
  "-27": { kind: "auth", message: "That two-factor code was not accepted." },
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

function sessionFrom(credentials) {
  const session = String(credentials?.session || "").trim();
  return session || null;
}

// A sequence number MEGA expects to increase across calls from one client. It is
// not authentication; it is how MEGA collapses a retried request rather than
// running it twice.
let requestSequence = Math.floor(Date.now() / 1000);

async function sendRequest(body, session, extraHeaders = {}) {
  const suffix = session ? `&sid=${encodeURIComponent(session)}` : "";
  requestSequence += 1;
  const response = await fetch(`${API}?id=${requestSequence}${suffix}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Sent because MEGA's own clients identify themselves and the anonymous
      // path is the only one confirmed to work without it. Following the
      // convention pixeldrain.js already uses rather than imitating a browser.
      "user-agent": "Atlas",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // The body is KEPT. A bare status is a conclusion with no evidence: the
    // first real login attempt returned 402 and there was nothing to explain it,
    // because this line used to discard exactly the thing that would have.
    const text = await response.text().catch(() => "");
    return {
      httpStatus: response.status,
      httpBody: text.slice(0, 500),
      hashcash: response.headers.get("x-hashcash") || "",
    };
  }
  const payload = await response.json();
  return { entry: Array.isArray(payload) ? payload[0] : payload };
}

/**
 * A MEGA API call, paying the proof of work if MEGA asks for it.
 *
 * MEGA gates its ACCOUNT commands behind hashcash: the request comes back 402
 * with an `X-Hashcash` challenge, and the retry has to carry a nonce that costs
 * real CPU to find. Public-link downloads are not gated, which is why anonymous
 * downloading worked long before any of this existed.
 *
 * Retried exactly ONCE. A fresh challenge on the second attempt means something
 * other than difficulty is wrong -- an expired timestamp, a changed policy -- and
 * looping would spend minutes of CPU per lap discovering that.
 */
async function apiCall(body, session, { onProgress = null } = {}) {
  const first = await sendRequest(body, session);
  if (first.httpStatus !== 402) return first;

  const challenge = parseHashcashChallenge(first.hashcash);
  if (!challenge) {
    console.log("[mega-hashcash] 402 with no usable challenge", JSON.stringify({
      header: first.hashcash || "(none)", body: first.httpBody || "",
    }));
    return first;
  }

  const prefix = await solveWithWorkers({
    token: challenge.token,
    easiness: challenge.easiness,
    onProgress,
  }).catch((err) => {
    console.log("[mega-hashcash] solver failed", JSON.stringify({ message: err.message }));
    return null;
  });
  if (!prefix) {
    return {
      httpStatus: 402,
      httpBody: "the proof of work did not finish in time",
      hashcash: first.hashcash,
      hashcashTimedOut: true,
    };
  }

  return sendRequest(body, session, {
    "x-hashcash": formatHashcashHeader(challenge.token, prefix),
  });
}

/** HTTP-level rejections MEGA uses instead of its own negative codes. */
function describeHttpStatus(status, body) {
  const detail = String(body || "").trim();
  const suffix = detail ? ` MEGA said: ${detail}` : "";
  if (status === 402 && /proof of work/i.test(String(body || ""))) {
    return "Signing in to MEGA needs a proof-of-work calculation, and it did not "
      + "finish in time. Trying again usually works; it is CPU-bound, so closing "
      + "other heavy work helps.";
  }
  if (status === 402) {
    // Recorded rather than diagnosed. What is known: an anonymous `a:"g"` call
    // succeeds with an identical request shape, so this is specific to the
    // account commands rather than to the transport. What is not known is why,
    // and guessing in the message would send someone looking in the wrong place.
    return "MEGA refused the sign-in request (HTTP 402) and did not send a "
      + "proof-of-work challenge Atlas could read. Anonymous downloads are "
      + `unaffected.${suffix}`;
  }
  if (status === 403) return `MEGA denied the request (HTTP 403).${suffix}`;
  if (status === 429) return `MEGA is rate limiting this connection (HTTP 429).${suffix}`;
  if (status >= 500) return `MEGA's API is having trouble (HTTP ${status}). Worth retrying.${suffix}`;
  return `MEGA's API returned ${status}.${suffix}`;
}

async function probe(url, credentials = {}) {
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

  // The session, when there is one, is what buys the account's transfer quota
  // instead of the anonymous allowance. It changes nothing else about the
  // download: the key still comes from the link, not from the account.
  const session = sessionFrom(credentials);
  let result;
  try {
    // ONLY the id. The key after the # is never sent: including it returns
    // [-2], which is how this was first got wrong.
    result = await apiCall([{ a: "g", g: 1, p: link.id }], session);
    if (result.httpStatus) {
      return {
        ok: false,
        kind: result.httpStatus >= 500 ? "transient" : "fatal",
        error: describeHttpStatus(result.httpStatus, result.httpBody),
        diagnostic: {
          status: result.httpStatus, body: result.httpBody || "",
          fileId: link.id, authenticated: Boolean(session),
        },
      };
    }
  } catch (err) {
    return {
      ok: false,
      kind: "transient",
      error: `Could not reach MEGA: ${err.message}`,
      diagnostic: { fileId: link.id },
    };
  }

  // Either `-2` or `[-2]`; a success is `[{ … }]`.
  const entry = result.entry;
  if (typeof entry === "number") {
    const mapped = errorFor(entry);
    return {
      ok: false, kind: mapped.kind, error: mapped.message,
      diagnostic: { megaError: entry, fileId: link.id, authenticated: Boolean(session) },
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

/**
 * Sign in and return a SESSION, never the password.
 *
 * The password is used once, here, and discarded: `secrets` in the result
 * replaces what gets written to the credential store, so a copied config cannot
 * be replayed as a login. The cost is that an expired session needs signing in
 * again rather than being refreshed silently -- the same trade the F95
 * browser-added accounts already make.
 */
async function validate(credentials = {}) {
  const email = String(credentials.email || "").trim().toLowerCase();
  const password = String(credentials.password || "");
  const mfa = String(credentials.mfa || "").replace(/\s+/g, "");
  if (!email || !password) {
    return { ok: false, error: "An email address and password are both required." };
  }

  try {
    // Which account generation, and the salt for v2. v1 accounts predate the
    // salt and derive their hash from the email instead.
    const saltResult = await apiCall([{ a: "us0", user: email }], null);
    if (saltResult.httpStatus) {
      // Logged with the step, so the next 402 says which of the two calls it was.
      console.log("[mega-login]", JSON.stringify({
        step: "us0", status: saltResult.httpStatus, body: saltResult.httpBody || "",
      }));
      return { ok: false, error: describeHttpStatus(saltResult.httpStatus, saltResult.httpBody) };
    }
    const saltEntry = saltResult.entry;
    if (typeof saltEntry === "number") {
      return { ok: false, error: errorFor(saltEntry).message };
    }

    const version = Number(saltEntry?.v) || 1;
    let derivedKey;
    let passwordHash;
    if (version >= 2) {
      const derived = account.deriveKeyV2(password, saltEntry.s);
      if (!derived) return { ok: false, error: "MEGA sent an unreadable password salt." };
      derivedKey = derived.derivedKey;
      passwordHash = derived.passwordHash;
    } else {
      derivedKey = account.prepareKeyV1(password);
      passwordHash = account.stringHashV1(email, derivedKey);
    }

    const request = { a: "us", user: email, uh: account.toBase64Url(passwordHash) };
    if (mfa) request.mfa = mfa;
    const loginResult = await apiCall([request], null, {
      onProgress: (info) => {
        // MEGA charges CPU for a sign-in. Logged so a minute of silence has an
        // explanation somewhere rather than looking like a hang.
        console.log("[mega-login] solving proof of work", JSON.stringify(info));
      },
    });
    if (loginResult.httpStatus) {
      console.log("[mega-login]", JSON.stringify({
        step: "us", status: loginResult.httpStatus, body: loginResult.httpBody || "",
        accountVersion: version, sentMfa: Boolean(mfa),
      }));
      return { ok: false, error: describeHttpStatus(loginResult.httpStatus, loginResult.httpBody) };
    }
    const login = loginResult.entry;
    if (typeof login === "number") {
      const mapped = errorFor(login);
      // -9 on the login step is a wrong password far more often than a missing
      // account, since us0 above already confirmed the account exists.
      if (login === -9) {
        return { ok: false, error: "MEGA rejected that password." };
      }
      return { ok: false, error: mapped.message };
    }

    // A session key login returns tsid directly; a password login returns csid
    // and needs the RSA step.
    let sessionId = null;
    if (login.tsid) {
      sessionId = String(login.tsid);
    } else {
      const masterKey = account.decryptMasterKey(login.k, derivedKey);
      if (!masterKey) return { ok: false, error: "MEGA sent an unreadable master key." };
      const privateKey = account.decryptPrivateKey(login.privk, masterKey);
      if (!privateKey) {
        // The master key is what decrypts privk, so unreadable components here
        // almost always mean the password was wrong in a way the server accepted
        // the hash for -- worth saying rather than reporting a crypto failure.
        return { ok: false, error: "Could not read this account's keys. Check the password." };
      }
      sessionId = account.decryptSessionId(login.csid, privateKey);
      if (!sessionId) return { ok: false, error: "Could not complete MEGA's session challenge." };
    }

    // Display detail only. A failure here does not invalidate the session.
    let label = "";
    const quota = await getQuota({ session: sessionId }).catch(() => null);
    if (quota?.ok) {
      label = quota.pro ? "Pro" : "Free";
    }

    return {
      ok: true,
      username: email,
      plan: label,
      // Replaces what is stored: the session, and nothing that can be replayed.
      secrets: { session: sessionId },
    };
  } catch (err) {
    return { ok: false, error: `Could not reach MEGA: ${err.message}` };
  }
}

/** Storage and transfer allowance, for the Settings readout. */
async function getQuota(credentials = {}) {
  const session = sessionFrom(credentials);
  if (!session) return { ok: false, error: "Sign in to MEGA to see your quota." };
  try {
    const result = await apiCall([{ a: "uq", xfer: 1, strg: 1, pro: 1 }], session);
    if (result.httpStatus) {
      return { ok: false, error: describeHttpStatus(result.httpStatus, result.httpBody) };
    }
    const entry = result.entry;
    if (typeof entry === "number") {
      return { ok: false, error: errorFor(entry).message };
    }
    // `used` and `cap` are the keys the Settings readout reads, matching
    // pixeldrain. Reporting transfer rather than storage because that is the
    // limit an account raises and therefore the number that matters here.
    const used = Number(entry?.caxfer ?? entry?.csxfer) || 0;
    const rawCap = Number(entry?.mxfer) || 0;
    return {
      ok: true,
      used,
      // A free account reports no transfer allowance of its own, so a zero cap
      // is "not stated" rather than "nothing left" -- the same distinction
      // pixeldrain draws for an unset custom cap.
      cap: rawCap > 0 ? rawCap : null,
      storageUsed: Number(entry?.cstrg) || 0,
      storageCap: Number(entry?.mstrg) || 0,
      pro: Number(entry?.utype) > 0,
    };
  } catch (err) {
    return { ok: false, error: `Could not reach MEGA: ${err.message}` };
  }
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
  credentialFields: [
    { key: "email", label: "Email", type: "text",
      help: "The email address on your MEGA account." },
    { key: "password", label: "Password", type: "password",
      help: "Used once to sign in. Atlas stores the resulting session, never the password." },
    { key: "mfa", label: "Two-factor code", type: "text",
      help: "Only if two-factor authentication is enabled. Leave blank otherwise." },
  ],
  matches,
  probe,
  validate,
  getQuota,
  classifyError,
  // Exported for tests
  describeHttpStatus,
  // Exported for tests
  fileIdFrom,
  ERROR_CODES,
};
