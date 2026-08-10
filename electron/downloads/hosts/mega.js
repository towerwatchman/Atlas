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
const {
  parseHashcashChallenge, formatHashcashHeader, verifyHashcash,
} = require("./megaHashcash");
const { solveWithWorkers, DEFAULT_BUDGET_MS } = require("./megaHashcashPool");
const appLog = require("../../appLog");

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

async function sendRequest(body, session, extraHeaders = {}, reuseSequence = null) {
  const suffix = session ? `&sid=${encodeURIComponent(session)}` : "";
  // A hashcash retry is the SAME request, resent with its proof attached -- which
  // is exactly the case the `id` comment above describes. Incrementing it made
  // every retry a brand new request to MEGA, so instead of accepting the proof it
  // minted a fresh challenge, and the loop solved challenge after challenge that
  // could never be accepted. Passing the original id keeps the retry attached to
  // the request the challenge was issued for.
  const sequence = reuseSequence === null ? (requestSequence += 1) : reuseSequence;
  const response = await fetch(`${API}?id=${sequence}${suffix}`, {
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
      sequence,
    };
  }
  const payload = await response.json();
  return { entry: Array.isArray(payload) ? payload[0] : payload, sequence };
}

// Distinct bodies for the three ways a proof of work can fail. They exist so
// describeHttpStatus can say something TRUE about each: the previous code
// returned one message ("did not finish in time") for all of them, including the
// case where the worker never started, which sent every packaged user chasing a
// performance problem they did not have.
const HASHCASH_BUDGET = "the proof of work did not finish in time";
const HASHCASH_LOAD_FAILED = "the proof-of-work worker could not start";
const HASHCASH_INVALID = "the proof of work failed local verification";
const HASHCASH_REJECTED = "MEGA refused a valid proof of work";

// Three challenges, not one retry. Each lap costs real CPU, so this is bounded;
// but a single attempt was too few, because the budget ending is the EXPECTED
// outcome roughly a third of the time even on a healthy machine -- the nonce
// search is memoryless, so the mean solve time is not a deadline.
const MAX_HASHCASH_ATTEMPTS = 3;

// A challenge carries a unix timestamp and MEGA's SDK budgets 300s against it,
// so a proof submitted after that has likely expired regardless of correctness.
// Kept as a named assumption rather than a fact: it is transcribed from the SDK,
// not observed, and challengeAgeMs is logged so the real value can be learned
// from a machine that actually gets challenged.
const ASSUMED_CHALLENGE_TTL_MS = DEFAULT_BUDGET_MS;
// Time for the retry to reach MEGA before the challenge lapses.
const SUBMIT_MARGIN_MS = 15000;

/** How long ago MEGA minted this challenge, or null if the timestamp is unusable. */
function challengeAgeMs(timestamp) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const age = Date.now() - seconds * 1000;
  // Reject nonsense rather than deriving a budget from it: a clock skewed by
  // days would otherwise produce a negative or absurd budget.
  if (age < -86400000 || age > 86400000) return null;
  return age;
}

/** Budget for this challenge: whatever is left of its TTL, floored at 30s. */
function budgetForChallenge(ageMs) {
  if (ageMs === null) return ASSUMED_CHALLENGE_TTL_MS;
  return Math.max(30000, ASSUMED_CHALLENGE_TTL_MS - ageMs - SUBMIT_MARGIN_MS);
}

/**
 * A MEGA API call, paying the proof of work if MEGA asks for it.
 *
 * MEGA gates its ACCOUNT commands behind hashcash: the request comes back 402
 * with an `X-Hashcash` challenge, and the retry has to carry a nonce that costs
 * real CPU to find. Public-link downloads are not gated, which is why anonymous
 * downloading worked long before any of this existed.
 *
 * Gating is a server-side anti-abuse decision, not a property of the request, so
 * plenty of clients are never challenged at all. That asymmetry is why this went
 * unnoticed: a developer whose sign-ins are never gated cannot reach this branch
 * by signing in, and the branch was broken in packaged builds the whole time.
 *
 * Each lap requests a FRESH challenge rather than resubmitting against the old
 * one. Re-solving an expired challenge burns minutes to earn a proof the server
 * will refuse regardless.
 */
async function apiCall(body, session, { onProgress = null, telemetry = null } = {}) {
  let response = await sendRequest(body, session);
  if (response.httpStatus !== 402) return response;
  if (telemetry) telemetry.challenged = true;

  let solvedButRejected = false;
  for (let attempt = 1; attempt <= MAX_HASHCASH_ATTEMPTS; attempt += 1) {
    const challenge = parseHashcashChallenge(response.hashcash);
    if (!challenge) {
      appLog.write("mega-hashcash", {
        event: "unusable-challenge",
        header: response.hashcash || "(none)",
        body: response.httpBody || "",
      });
      return response;
    }

    const ageMs = challengeAgeMs(challenge.timestamp);
    const budgetMs = budgetForChallenge(ageMs);
    appLog.write("mega-hashcash", {
      event: "challenge", attempt, easiness: challenge.easiness, ageMs, budgetMs,
    });

    const solve = await solveWithWorkers({
      token: challenge.token,
      easiness: challenge.easiness,
      budgetMs,
      onProgress,
    }).catch((err) => ({ outcome: "worker-error", prefix: null, error: err.message }));

    // A worker that cannot load will not load on the next lap either. Retrying
    // would spend three budgets rediscovering a packaging fault.
    if (solve.outcome === "load-error" || solve.outcome === "worker-error") {
      appLog.write("mega-hashcash", { event: "abandoned", reason: solve.outcome, error: solve.error });
      return {
        httpStatus: 402,
        httpBody: HASHCASH_LOAD_FAILED,
        hashcash: response.hashcash,
        hashcashError: solve.error || null,
      };
    }

    if (solve.prefix) {
      // Verified locally before it is sent. One hash, against the same verifier
      // the tests use, and it separates "our proof is wrong" from "MEGA rejected
      // a correct proof" -- which are otherwise the same 402 with an empty body.
      if (!verifyHashcash(challenge.token, challenge.easiness, solve.prefix)) {
        appLog.write("mega-hashcash", { event: "self-verify-failed", easiness: challenge.easiness });
        return { httpStatus: 402, httpBody: HASHCASH_INVALID, hashcash: response.hashcash };
      }
      const retried = await sendRequest(body, session, {
        "x-hashcash": formatHashcashHeader(challenge.token, solve.prefix),
      }, response.sequence);
      if (retried.httpStatus !== 402) {
        appLog.write("mega-hashcash", { event: "accepted", attempt, elapsedMs: solve.elapsedMs });
        return retried;
      }
      // A fresh 402 after a locally valid proof: the challenge rotated, or the
      // answer arrived too late. Both are worth another lap with a new one.
      // MEGA's own body is the only account of WHY a locally valid proof was
      // refused, and it was being discarded here -- the same mistake sendRequest
      // already has a comment about not making. Without it the next person sees
      // "rejected" with no evidence, which is where this investigation started.
      solvedButRejected = true;
      appLog.write("mega-hashcash", {
        event: "rejected-after-solve",
        attempt,
        ageMs,
        sequence: response.sequence,
        body: retried.httpBody || "",
        freshChallenge: retried.hashcash || "",
        sameChallenge: retried.hashcash === response.hashcash,
      });
      response = retried;
      continue;
    }

    // Budget exhausted. Ask for a new challenge rather than re-solving this one,
    // whose remaining TTL is now smaller than the budget that just failed.
    appLog.write("mega-hashcash", { event: "budget-exhausted", attempt, elapsedMs: solve.elapsedMs });
    if (attempt < MAX_HASHCASH_ATTEMPTS) {
      response = await sendRequest(body, session);
      if (response.httpStatus !== 402) return response;
    }
  }

  // Solved every time and refused every time is NOT a timeout, and saying so sent
  // the last investigation looking at CPU speed for a problem that had none.
  if (solvedButRejected) {
    return {
      httpStatus: 402,
      httpBody: HASHCASH_REJECTED,
      hashcash: response.hashcash,
    };
  }
  return {
    httpStatus: 402,
    httpBody: HASHCASH_BUDGET,
    hashcash: response.hashcash,
    hashcashTimedOut: true,
  };
}

/** HTTP-level rejections MEGA uses instead of its own negative codes. */
function describeHttpStatus(status, body) {
  const detail = String(body || "").trim();
  const suffix = detail ? ` MEGA said: ${detail}` : "";
  // A defect, not slowness. Retrying cannot help and telling the user to close
  // other programs would be actively misleading -- this build cannot start the
  // worker at all. Points at the log, because that is where the resolved path is.
  if (status === 402 && detail === HASHCASH_LOAD_FAILED) {
    return "Atlas could not start the background task that signs in to MEGA. This "
      + "is a fault in the app rather than a problem with the account or the "
      + "connection, and trying again will not help. Settings \u2192 Accounts has a "
      + "\u201cTest proof-of-work\u201d button that records the details in the log.";
  }
  // Solved, then failed our own verifier. Either the challenge was malformed or
  // the solver is wrong; either way sending it would earn a bare 402 with no
  // explanation, so it is named here instead.
  if (status === 402 && detail === HASHCASH_INVALID) {
    return "Atlas computed a proof of work for MEGA that failed its own check, so "
      + "it was not sent. Please report this \u2014 Settings \u2192 Accounts has a "
      + "\u201cTest proof-of-work\u201d button that records what is needed.";
  }
  // Solved correctly, verified locally, and refused anyway. Nothing the user can
  // do affects this, so it must not offer them CPU advice.
  if (status === 402 && detail === HASHCASH_REJECTED) {
    return "MEGA rejected Atlas's proof of work even though it computed correctly, "
      + `after ${MAX_HASHCASH_ATTEMPTS} attempts. This is a fault in Atlas rather `
      + "than a problem with the account, the password or this computer. Please "
      + "report it \u2014 the log records what MEGA sent back.";
  }
  if (status === 402 && /proof of work/i.test(String(body || ""))) {
    // Says how many attempts were already made, because the honest advice used to
    // be "try again" and this now tries three times before giving up. Trying
    // again is still worth it -- MEGA sets the difficulty per challenge, so a
    // later attempt can draw an easier one -- but not for the reason it implied.
    return `Signing in to MEGA needs a proof-of-work calculation, and it did not `
      + `finish in time after ${MAX_HASHCASH_ATTEMPTS} attempts. It is CPU-bound, `
      + "so closing other heavy work helps, and trying again later may draw an "
      + "easier challenge. Settings \u2192 Accounts has a \u201cTest "
      + "proof-of-work\u201d button that measures how long this machine needs.";
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
      appLog.write("mega-login", {
        step: "us0", status: saltResult.httpStatus, body: saltResult.httpBody || "",
      });
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
    // Whether MEGA demanded a proof of work AT ALL is the single most useful fact
    // about a sign-in, and nothing recorded it. Hashcash is applied by server-side
    // policy, so some clients are challenged and some never are -- and until this
    // line existed, "no proof of work happened" and "the proof of work code did
    // not log anything" looked identical, on a machine nobody could inspect.
    const telemetry = { challenged: false };
    const loginResult = await apiCall([request], null, {
      telemetry,
      onProgress: (info) => {
        // MEGA charges CPU for a sign-in. Logged so minutes of silence have an
        // explanation somewhere rather than looking like a hang.
        appLog.write("mega-login", { event: "solving-proof-of-work", ...info });
      },
    });
    appLog.write("mega-login", {
      event: "login-attempted",
      challenged: telemetry.challenged,
      accountVersion: version,
      sentMfa: Boolean(mfa),
    });
    if (loginResult.httpStatus) {
      appLog.write("mega-login", {
        step: "us", status: loginResult.httpStatus, body: loginResult.httpBody || "",
        accountVersion: version, sentMfa: Boolean(mfa),
      });
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
