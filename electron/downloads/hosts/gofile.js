"use strict";

// Gofile host plugin, free route. Premium API for direct links will be
// another approach when needed.

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Free allowance in decimal bytes, matching gofile.io display.
// This is not mentioned in documents, but it's the current limit for Guest account
const GUEST_TRAFFIC_CAP = 1000000000000;
const TRAFFIC_WINDOW_DAYS = 30;

const API_BASE = "https://api.gofile.io";

// Part of the website-token hash: the sent UA must be the hashed UA.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WT_LANG = "en-US";
// No default WL_SALT. A hardcoded salt rots and every install fails at
// once. The persisted value (userData/gofile-salt.json) is the source of
// truth; with no stored value the first probe fetches WL_URLS live, takes
// the top candidate, stores it, and proceeds with it below.
const WL_URLS = [
  "https://gofile.io/js/wt.obf.js",
  "https://gofile.io/dist/js/wt.obf.js",
];
const WT_WINDOW_SECONDS = 14400;
const id = "gofile";
const label = "Gofile";
const supportsAnonymous = true;

// Store hosts serve picked files rather than share pages.
function isStoreHost(host) {
  const name = String(host || "");
  return name.endsWith(".gofile.io") && name !== "api.gofile.io"
    && name !== "gofile.io" && name !== "www.gofile.io";
}

function matches(url) {
  let host = "";
  try {
    host = new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "gofile.io" || host === "www.gofile.io") return true;
  // Store hosts serve picked files and need a cookie, so claim them to re-probe.
  return isStoreHost(host);
}

function fileIdFrom(url) {
  const text = String(url || "");
  const path = text.match(/gofile\.io\/d\/([A-Za-z0-9]+)/i);
  if (path) return path[1];
  const param = text.match(/[?&]c=([A-Za-z0-9]+)/i);
  return param ? param[1] : null;
}

function websiteToken(token, nowMs = Date.now(), salt = "") {
  const window = Math.floor(nowMs / 1000 / WT_WINDOW_SECONDS);
  return createHash("sha256")
    .update(`${UA}::${WT_LANG}::${token}::${window}::${salt}`)
    .digest("hex");
}

function userDataDir() {
  // Test override; production resolves through Electron below.
  if (process.env.ATLAS_USER_DATA) return process.env.ATLAS_USER_DATA;
  try {
    // Unavailable under plain node: callers then run memory-less, which only
    // costs a refetch on rotation.
    return require("electron").app.getPath("userData");
  } catch {
    return null;
  }
}

function isValidSalt(value) {
  return typeof value === "string" && /^[A-Za-z0-9]{8,64}$/.test(value);
}

// Last persisted salt, or null when there is none (fresh install, corrupt
// file, or no userData dir). Never throws. Plain JSON, no encryption: the
// salt is public (shipped in Gofile's own script) and anonymous downloads
// must not depend on an OS keychain.
function loadSalt() {
  try {
    const dir = userDataDir();
    if (!dir) return null;
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "gofile-salt.json"), "utf8"));
    const salt = parsed && parsed.salt;
    return isValidSalt(salt) ? salt : null;
  } catch {
    return null;
  }
}

// Persist a server-validated salt. Best-effort: a failed write only means the
// next probe refetches instead of reusing.
function saveSalt(salt) {
  if (!isValidSalt(salt)) return false;
  try {
    const dir = userDataDir();
    if (!dir) return false;
    const target = path.join(dir, "gofile-salt.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ salt }), { mode: 0o600 });
    return true;
  } catch (err) {
    console.warn("[gofile-salt]", `persist failed for ${salt}:`, err?.message || err);
    return false;
  }
}

// Candidates scraped from the live script. The salt ships as one contiguous
// \x run while obfuscator blobs are plain base64, so that pass isolates it;
// hex-shaped then generic scans are fallback for a future non-hex shape.
function extractSalts(script) {
  const raw = String(script || "");
  const found = [];
  const push = (s) => { if (s && !found.includes(s)) found.push(s); };
  const decode = (s) => s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const text = decode(raw);
  for (const m of raw.matchAll(/((?:\\x[0-9a-fA-F]{2}){12,16})/g)) {
    const s = decode(m[1]);
    if (/^[0-9a-fA-F]+$/.test(s) && /[A-Za-z]/.test(s) && /[0-9]/.test(s)) push(s);
    if (found.length >= 8) break;
  }
  if (found.length < 8) {
    for (const m of text.matchAll(/[0-9a-fA-F]{12,16}/g)) {
      const s = m[0];
      if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) continue;
      push(s);
      if (found.length >= 8) break;
    }
  }
  if (found.length < 8) {
    for (const m of text.matchAll(/[A-Za-z0-9]{12,24}/g)) {
      const s = m[0];
      if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) continue;
      push(s);
      if (found.length >= 8) break;
    }
  }
  return found.slice(0, 8);
}

// One shared fetch per rotation incident: concurrent probes reuse it instead
// of each downloading the script. Browser headers: the script host WAFs bare
// fetches. Empty when unreachable, degrading to the transient error below.
let inflightSalts = null;

async function refreshSalts(exclude = new Set()) {
  if (!inflightSalts) {
    inflightSalts = (async () => {
      for (const scriptUrl of WL_URLS) {
        try {
          const res = await fetch(scriptUrl, {
            cache: "no-store",
            headers: {
              "user-agent": UA,
              referer: "https://gofile.io/",
              origin: "https://gofile.io",
            },
          });
          if (!res.ok) continue;
          return extractSalts(await res.text());
        } catch {
          continue;
        }
      }
      return [];
    })().finally(() => { inflightSalts = null; });
  }
  return (await inflightSalts).filter((s) => !exclude.has(s));
}

function classifyError(err, { status = 0, body = null } = {}) {  // Exact Gofile statuses only (see gofile.io/api status table). Anything
  // unknown stays retryable and gets reported, never faked fatal/quota.
  // Order matters: error-notPremium arrives as HTTP 401, so it must precede
  // the 401 -> auth rule.
  const s = String(body?.status || err?.gofileStatus || "");
  if (/password/i.test(s)) return "fatal";
  if (s === "error-notFound") return "fatal";
  if (status === 404 || status === 410) return "fatal";
  if (status === 429 || s === "error-rateLimit" || s === "error-limits") return "quota";
  if (s === "error-notPremium") return "transient";
  // Guest-only: no account-id or ownership calls exist here, so only token
  // failures are reachable. Owner/accountId statuses are deliberately unmapped.
  if (status === 401 || status === 403 || s === "error-token" || s === "error-wrongToken") return "auth";
  return "transient";
}

// Advice only for API codes we know; unknown codes pass through untouched.
const API_ADVICE = {
  "error-rateLimit": "Rate limited. Wait 1-2 mins and try again.",
  "error-limits": "Rate limited. Wait 1-2 mins and try again.",
  "error-notFound": "The folder may have expired — check it in your browser.",
  "error-wrongToken": "Session rejected. Try again — a fresh guest session is minted automatically.",
  "error-token": "Session rejected. Try again — a fresh guest session is minted automatically.",
};

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Network failures need a next step, not just the raw error. Guests get
// ~20 API calls/min, and retry-mashing a throttle extends it.
function netError(what, err) {
  return `Could not reach Gofile ${what} (${err?.message || err}). Check your connection, wait a bit, then try again.`;
}

async function createGuestAccount() {
  const response = await fetch(`${API_BASE}/accounts`, {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/json" },
    body: "{}",
  });
  const body = await readJson(response);
  const token = body?.data?.token;
  if (!response.ok || body?.status !== "ok" || !token) {
    const err = new Error(body?.status && body.status !== "ok"
      ? `Gofile returned ${body.status}`
      : `Gofile returned ${response.status} creating a guest account`);
    err.gofileStatus = body?.status || "";
    throw err;
  }
  return { token, id: body?.data?.id || null };
}

// One guest token per session: each mint spends guest-budget calls (20/min).
// A rejected token drops the cache and mints once (see token retry in probe).
let cachedGuest = null;
async function getGuestAccount() {
  if (cachedGuest) return cachedGuest.account;
  const account = await createGuestAccount();
  cachedGuest = { account };
  return account;
}
function dropGuestAccount() {
  cachedGuest = null;
}

// Single listing attempt at one time window. Callers handle windows: giving
// every candidate its own previous-window retry would double junk candidates
// into a rate-limit incident.
async function fetchListing(code, token, salt, nowMs) {
  const params = new URLSearchParams({
    contentFilter: "",
    page: "1",
    pageSize: "1000",
    sortField: "createTime",
    sortDirection: "-1",
  });
  const target = `${API_BASE}/contents/${code}?${params}`;
  const response = await fetch(target, {
    headers: {
      "user-agent": UA,
      authorization: `Bearer ${token}`,
      "x-website-token": websiteToken(token, nowMs, salt),
      "x-bl": WT_LANG,
      origin: "https://gofile.io",
      referer: "https://gofile.io/",
    },
  });
  return { response, body: await readJson(response), requested: target };
}

// One file -> directUrl. Several files -> `choices` for the modal picker; a
// folder reaching the queue is refused there, never silently first-filed.
async function probe(url) {
  const code = fileIdFrom(url);
  let host = "";
  try {
    host = new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (!code) {
    if (isStoreHost(host)) {
      try {
        const { token } = await getGuestAccount();
        return {
          ok: true,
          diagnostic: { requested: String(url).split(/[?#]/)[0] },
          directUrl: String(url).split(/[?#]/)[0],
          fileName: "",
          fileSize: 0,
          headers: { cookie: `accountToken=${token}` },
        };
      } catch (err) {
        return {
          ok: false,
          kind: classifyError(err, { body: { status: err.gofileStatus || "" } }),
          error: netError("for a guest session", err),
          diagnostic: { requested: `${API_BASE}/accounts` },
        };
      }
    }
    return {
      ok: false,
      kind: "fatal",
      error: "Atlas does not recognise this Gofile link format. Opening it in a "
        + "browser will show whether the files are still there; please report it either way.",
    };
  }

  let token;
  try {
    ({ token } = await getGuestAccount());
  } catch (err) {
    return {
      ok: false,
      kind: classifyError(err, { body: { status: err.gofileStatus || "" } }),
      error: netError("for a guest session", err),
      diagnostic: { requested: `${API_BASE}/accounts`, stage: "guest-account" },
    };
  }

  let listing;
  // Stored salt first; with none, fetch the live top seed and proceed with
  // it — the listing below validates it, rotation heals a miss. Never saved
  // here: only a server-validated salt may persist (see below).
  const fromStore = loadSalt();
  let stored = fromStore;
  if (!stored) {
    const fresh = await refreshSalts();
    stored = fresh[0] || null;
    if (!stored) {
      return {
        ok: false,
        kind: "transient",
        error: "Gofile isn't letting Atlas read this folder right now. They may have "
          + "changed something on their end -- please report it so it can be fixed.",
        diagnostic: { requested: `${API_BASE}/contents/${code}`, code, stage: "seed" },
      };
    }
  }
  console.log("[gofile-salt]", `probe ${code}: salt ${stored} (${fromStore ? "stored" : "live"})`);
  const now = Date.now();
  try {
    listing = await fetchListing(code, token, stored, now);
  } catch (err) {
    return {
      ok: false,
      kind: classifyError(err),
      error: netError("for this folder", err),
      diagnostic: { requested: `${API_BASE}/contents/${code}`, code, stage: "listing" },
    };
  }
  // Same hash, previous window: a boundary-crossing clock reads as a rotated
  // salt, so rule skew out before paying for a script fetch.
  if (/token/i.test(String(listing?.body?.status || ""))) {
    // Cached token rejected (IP change, expiry): mint fresh once and retry.
    // Anything else still failing is reported, never looped.
    dropGuestAccount();
    try {
      ({ token } = await getGuestAccount());
      listing = await fetchListing(code, token, stored, Date.now());
    } catch (err) {
      return {
        ok: false,
        kind: classifyError(err),
        error: netError("for this folder", err),
        diagnostic: { requested: `${API_BASE}/contents/${code}`, code, stage: "listing-retry" },
      };
    }
  }
  if (listing?.body?.status === "error-notPremium") {
    try {
      const prev = await fetchListing(code, token, stored, now - WT_WINDOW_SECONDS * 1000);
      if (prev?.body?.status !== "error-notPremium") listing = prev;
    } catch {
      // Keep the original listing; the live retry below still runs.
    }
  }
  // Stored salt rejected on both windows: refetch live and retry alternates,
  // persisting the first server-validated one. A bad hash can also surface
  // as rateLimit, or a bare HTTP 429 with no JSON body; both signal
  // rotation, never a verdict.
  const rejected = String(listing?.body?.status || "");
  let rotated = false;
  if (rejected === "error-notPremium" || rejected === "error-rateLimit" || rejected === "error-limits"
    || listing?.response?.status === 429) {
    console.log("[gofile-salt]", `probe ${code}: salt ${stored} rejected (${listing?.response?.status} ${rejected}), refetching live`);
    const pending = await refreshSalts(new Set([stored]));
    // One pause before trying: setup already spent guest-budget calls, and a
    // throttled burst answers 429 to even the correct hash.
    // ATLAS_GOFILE_PAUSE_MS overrides the wait (tests use 0).
    if (pending.length) await new Promise((r) => setTimeout(r, Number(process.env.ATLAS_GOFILE_PAUSE_MS || 4000)));
    const settle = async (when) => {
      for (const salt of pending) {
        let retry;
        try {
          retry = await fetchListing(code, token, salt, when);
        } catch {
          continue;
        }
        const verdict = String(retry?.body?.status || "");
        // First throttled answer ends rotation: the budget is gone and every
        // further try extends the wall. Null keeps the original listing.
        if (!verdict || /token|ratelimit|limits/i.test(verdict) || retry?.response?.status === 429) {
          return null;
        }
        if (verdict !== "error-notPremium") {
          // Only a post-auth verdict proves the hash validated.
          if (verdict === "ok" || /notfound|password/i.test(verdict)) {
            saveSalt(salt);
            console.log("[gofile-salt]", `probe ${code}: stored new salt ${salt}`);
          }
          return retry;
        }
      }
      return null;
    };
    const settled = await settle(now);
    if (settled) listing = settled;
    rotated = true;
  }
  const { response, body, requested } = listing;
  const diagnostic = { requested, code, status: response.status, gofileStatus: body?.status || "" };
  // Happy path proves the salt too: persist it so the next probe starts from
  // a known-good stored value. Skipped after a rotation, which already
  // persisted its validated salt.
  if (!rotated && body?.status === "ok" && loadSalt() !== stored) saveSalt(stored);

  if (!response.ok || !body || body.status !== "ok") {
    const status = String(body?.status || "");
    if (/password/i.test(status)) {
      return {
        ok: false,
        kind: "fatal",
        error: "This Gofile folder is password-protected. Atlas cannot open those, "
          + "so grab the file from your browser instead.",
        diagnostic,
      };
    }
    if (/notpremium/i.test(status)) {
      return {
        ok: false,
        kind: "transient",
        error: "Gofile isn't letting Atlas read this folder right now. They may have "
          + "changed something on their end -- please report it so it can be fixed.",
        diagnostic,
      };
    }
    const kind = classifyError(null, { status: response.status, body });
    const code = String(body?.status || response.status || "");
    const advice = API_ADVICE[code] || (response.status === 429 ? API_ADVICE["error-rateLimit"] : "");
    return {
      ok: false,
      kind,
      error: `Gofile returned ${code || "an unreadable response"}` + (advice ? `. ${advice}` : ""),
      diagnostic,
    };
  }

  const children = Object.values(body?.data?.children || {});
  const files = children.filter((child) => child?.type !== "folder" && child?.link);
  if (files.length === 0) {
    return {
      ok: false,
      kind: "fatal",
      error: children.length > 0
        ? "This Gofile folder holds only subfolders. Atlas reads one level, so open "
          + "it in your browser and pick the file you want."
        : "This Gofile folder is empty or expired.",
      diagnostic,
    };
  }
  if (files.length > 1) {
    return {
      ok: true,
      diagnostic,
      choices: files.map((file) => ({
        name: String(file.name || "unnamed"),
        size: Number(file.size) || 0,
        directUrl: String(file.link),
      })),
    };
  }

  const file = files[0];
  return {
    ok: true,
    diagnostic,
    directUrl: String(file.link),
    fileName: String(file.name || `gofile-${code}`),
    fileSize: Number(file.size) || 0,
    // Store checks the cookie, not the auth header. Without it: 401.
    headers: { cookie: `accountToken=${token}` },
  };
}

async function validate() {
  return { ok: true, anonymous: true };
}

// Sum the last 30 days of the usage buckets in account details. Day values
// are normally byte counts, but deeper (hourly) leaves are summed too so a
// shape change undercounts nothing; undated leaves are skipped.
function trafficUsed(history) {
  if (!history || typeof history !== "object") return null;
  const cutoff = Date.now() - TRAFFIC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sumLeaves = (node, time) => {
    const amount = typeof node === "number" ? node : (typeof node === "string" && node.trim() !== "" ? Number(node) : NaN);
    if (Number.isFinite(amount)) return time >= cutoff ? amount : 0;
    if (!node || typeof node !== "object") return 0;
    let sub = 0;
    for (const value of Object.values(node)) sub += sumLeaves(value, time);
    return sub;
  };
  let used = 0;
  for (const [year, months] of Object.entries(history)) {
    if (!months || typeof months !== "object") continue;
    for (const [month, days] of Object.entries(months)) {
      if (!days || typeof days !== "object") continue;
      for (const [day, bytes] of Object.entries(days)) {
        used += sumLeaves(bytes, Date.UTC(Number(year), Number(month) - 1, Number(day)));
      }
    }
  }
  return used;
}

async function getQuota() {
  try {
    // Cached token: same IP attribution, one less budget call per check.
    const { token, id } = await getGuestAccount();
    if (!id) return { ok: false, error: "Could not read the quota response" };
    const response = await fetch(`${API_BASE}/accounts/${id}`, {
      headers: { "user-agent": UA, authorization: `Bearer ${token}` },
    });
    const body = await readJson(response);
    const data = body?.data;
    if (!response.ok || body?.status !== "ok" || !data) {
      return { ok: false, error: "Could not read the quota response" };
    }
    const used = trafficUsed(data.ipTraffic);
    if (used == null) return { ok: false, error: "Could not read the quota response" };
    const cap = data.tier === "guest" ? GUEST_TRAFFIC_CAP : null;
    return { ok: true, used, cap };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = {
  id,
  label,
  supportsAnonymous,
  quotaWithoutAccount: true,
  quotaTemplate: `Transfer used: {used} of {cap} per ${TRAFFIC_WINDOW_DAYS} days`,
  hostAliases: ["gofile"],
  credentialFields: [],
  matches,
  probe,
  validate,
  getQuota,
  classifyError,
  fileIdFrom,
  websiteToken,
  saltStore: { load: loadSalt, save: saveSalt, refresh: refreshSalts, extractSalts, resetGuest: dropGuestAccount },
};
