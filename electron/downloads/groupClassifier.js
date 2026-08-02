"use strict";

// ── Download group classifier ────────────────────────────────────────────────
//
// Decides whether a link's `group` heading describes something we can safely
// queue as a full game download for this machine.
//
// Why this is not a lookup table: a scan of 164,381 stored links found 3,920
// distinct group values. The top of that distribution is orderly ("Win",
// "Mac", "Win/Linux", "Android", "Linux", "All") and the tail is whatever the
// poster typed - "Win x64", "Win, Linux", "Win/Lin", "-", "LOP Gold",
// "v2022-05-24", "Individual". Any design that enumerates values is wrong on
// arrival, so this tokenizes and reasons about two independent axes.
//
//   PLATFORM  which systems the download targets
//   KIND      whether it is a full game, or a patch/extra/fragment
//
// KIND OUTRANKS PLATFORM. "Win - Update Only" mentions Windows, but it is a
// patch. Queueing it as a full game with on_complete: 'replace' would delete a
// working install and put a fragment in its place. That asymmetry is the whole
// reason this module exists, and it is why unrecognised headings are accepted
// on platform (probably just oddly worded) but never skip the kind check.
//
// Multi-part archives are DETECTED but not decided here. ~3,900 links are
// labelled "Part 1".."Part 6"; a single part is useless on its own, and
// whether to queue the whole set or refuse is a policy call for the caller.

// Anything not on this list is not a platform we target. Mac and Android are
// recognised specifically so they can be rejected with a clear reason rather
// than falling through as "unknown".
const PLATFORM_TOKENS = {
  win: "win",
  win32: "win",
  win64: "win",
  windows: "win",
  x32: "win",
  x64: "win",
  pc: "win",
  lin: "linux",
  linux: "linux",
  mac: "mac",
  macos: "mac",
  osx: "mac",
  android: "android",
  apk: "android",
  ios: "ios",
  web: "web",
  html: "web",
  browser: "web",
  all: "all",
  any: "all",
};

const WANTED_PLATFORMS = new Set(["win", "linux", "all"]);

// A hit on any of these disqualifies the link regardless of platform.
// Ordered most-specific first so the reported reason is the useful one.
const KIND_MARKERS = [
  [/\bupdate\s*only\b/i, "update-only"],
  [/\bupdate\b/i, "update"],
  [/\bpatch(es)?\b/i, "patch"],
  [/\bhotfix\b/i, "hotfix"],
  [/\bincremental\b/i, "incremental"],
  [/\bwalkthrough\b/i, "walkthrough"],
  [/\bguide\b/i, "guide"],
  [/\bcheats?\b/i, "cheat"],
  [/\bmods?\b/i, "mod"],
  [/\bsaves?\b/i, "save"],
  [/\bsoundtrack|\bost\b/i, "soundtrack"],
  [/\bgallery\b/i, "gallery"],
  [/\bwallpapers?\b/i, "wallpaper"],
  [/\bart(work)?\b/i, "artwork"],
  [/\btranslations?\b/i, "translation"],
  [/\bextras?\b/i, "extras"],
];

// Media-only payloads. Present in the data as "MP4", "Swf" - not a game build.
const MEDIA_MARKERS = [/\bmp4\b/i, /\bswf\b/i, /\bmkv\b/i, /\bavi\b/i];

// "Compressed Win/Linux" (213) and "Compressed" (100) are full games with
// downscaled assets. Playable, so not rejected, but flagged so a caller can
// prefer the full build when both exist.
const COMPRESSED = /\bcompress(ed|ion)?\b|\blite\b/i;

const PART = /\bpart\s*[.:#-]?\s*(\d{1,2})\b/i;
// "1 of 3", "1/3" - a total, when the poster supplies one.
const PART_TOTAL = /\b(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})\b/i;

// Split on every separator seen in the data: slash, comma, dash, plus, pipe,
// ampersand, parens, whitespace. "Win x64" becomes ["win","x64"], and the
// bare value "-" becomes [] rather than a token.
const tokenize = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[\s/,\-+|&()[\]]+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

/**
 * Classify a group heading.
 *
 * @param {string} group   the raw heading, e.g. "Win/Linux" or "Win - Update Only"
 * @param {object} [link]  optional full link object; its `type` field is used
 *                         when present, since the scraper already tags
 *                         non-game payloads (save, mod, patch, soundtrack...)
 * @returns {{
 *   accepted: boolean, platforms: string[], kind: string, reason: string,
 *   compressed: boolean, part: {index:number,total:number|null}|null,
 *   requiresAllParts: boolean, raw: string
 * }}
 */
function classifyGroup(group, link = null) {
  const raw = String(group == null ? "" : group).trim();
  const tokens = tokenize(raw);

  const result = {
    raw,
    accepted: false,
    platforms: [],
    kind: "game",
    reason: "",
    compressed: false,
    part: null,
    requiresAllParts: false,
  };

  // The scraper already classifies payload type on a minority of links
  // (95 save, 91 wallpaper_art, 90 translation, 58 mod, 43 patch...). When it
  // has an opinion other than "game", trust it over the heading.
  const declaredType = String(link?.type || "").trim().toLowerCase();
  if (declaredType && declaredType !== "game") {
    result.kind = declaredType;
    result.reason = `link type is '${declaredType}', not a game build`;
    return result;
  }

  // ── Kind first. A patch that mentions Windows is still a patch. ──────────
  for (const [pattern, kind] of KIND_MARKERS) {
    if (pattern.test(raw)) {
      result.kind = kind;
      result.reason = `heading marks this as '${kind}', not a full game`;
      return result;
    }
  }
  for (const pattern of MEDIA_MARKERS) {
    if (pattern.test(raw)) {
      result.kind = "media";
      result.reason = "heading marks this as media, not a game build";
      return result;
    }
  }

  // ── Multi-part. Detected, flagged, not decided. ──────────────────────────
  const partMatch = raw.match(PART);
  const totalMatch = raw.match(PART_TOTAL);
  if (partMatch) {
    result.part = {
      index: Number.parseInt(partMatch[1], 10),
      total: totalMatch ? Number.parseInt(totalMatch[2], 10) : null,
    };
    result.requiresAllParts = true;
  }

  result.compressed = COMPRESSED.test(raw);

  // ── Platform. ────────────────────────────────────────────────────────────
  const found = new Set();
  for (const token of tokens) {
    const platform = PLATFORM_TOKENS[token];
    if (platform) found.add(platform);
  }
  result.platforms = Array.from(found);

  // An empty heading is not a signal of anything - 3,322 links have one and
  // they are ordinary downloads. Treat as unlabeled, which is acceptable.
  if (found.size === 0) {
    result.accepted = true;
    result.reason = raw
      ? "no platform recognised in heading; treated as unlabeled"
      : "no heading; treated as unlabeled";
    return result;
  }

  const wanted = result.platforms.filter((platform) => WANTED_PLATFORMS.has(platform));
  if (wanted.length > 0) {
    result.accepted = true;
    result.reason = `targets ${wanted.join(", ")}`;
    return result;
  }

  result.accepted = false;
  result.reason = `targets ${result.platforms.join(", ")} only`;
  return result;
}

/**
 * Filter a parsed link list down to what can be offered in the update modal.
 *
 * Multi-part sets are grouped: every part of a set is returned together under
 * one entry so the caller can queue the whole thing or refuse it, rather than
 * presenting individual fragments as if they were downloads.
 *
 * @param {Array} links       parsed thread links
 * @param {object} [options]
 * @param {Set<string>} [options.supportedHosts] only keep hosts with a plugin
 * @param {boolean} [options.allowCompressed]    default true
 */
function selectDownloadableLinks(links, options = {}) {
  const { supportedHosts = null, allowCompressed = true } = options;
  const accepted = [];
  const rejected = [];

  for (const link of Array.isArray(links) ? links : []) {
    const verdict = classifyGroup(link?.group, link);
    const entry = { link, verdict };

    if (!verdict.accepted) {
      rejected.push(entry);
      continue;
    }
    if (!allowCompressed && verdict.compressed) {
      rejected.push({ ...entry, verdict: { ...verdict, reason: "compressed build excluded" } });
      continue;
    }
    if (supportedHosts) {
      const host = String(link?.host || "").toLowerCase().split(".")[0];
      if (!supportedHosts.has(host)) {
        rejected.push({ ...entry, verdict: { ...verdict, reason: `no plugin for ${host}` } });
        continue;
      }
    }
    accepted.push(entry);
  }

  // Group multi-part entries by host + normalised heading so all parts of one
  // set travel together.
  const sets = new Map();
  const singles = [];
  for (const entry of accepted) {
    if (!entry.verdict.part) {
      singles.push(entry);
      continue;
    }
    const key = [
      String(entry.link?.host || "").toLowerCase(),
      entry.verdict.raw.replace(PART, "").replace(/\s+/g, " ").trim().toLowerCase(),
    ].join("|");
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(entry);
  }

  const multiPart = Array.from(sets.values()).map((parts) => ({
    parts: parts.sort((a, b) => a.verdict.part.index - b.verdict.part.index),
    host: parts[0].link?.host || "",
    declaredTotal: parts[0].verdict.part.total,
    // A gap means the thread is missing a part; extraction would fail.
    complete: isContiguous(parts.map((entry) => entry.verdict.part.index),
                           parts[0].verdict.part.total),
  }));

  // Split archives are NOT offered. Downloading them correctly means treating
  // N transfers as one all-or-nothing unit and extracting only once every part
  // has landed, which the queue cannot express yet. Offering them individually
  // would hand the user a fragment that fetches fine and then fails to open.
  //
  // `multiPart` is returned for diagnostics only - callers must offer
  // `singles`. `hiddenMultiPart` exists so the modal can explain the omission,
  // and only when there is actually something to explain: a game with no split
  // archives should never see the disclaimer.
  const hiddenMultiPart = {
    sets: multiPart.length,
    links: multiPart.reduce((total, set) => total + set.parts.length, 0),
    hosts: Array.from(new Set(multiPart.map((set) => set.host))).filter(Boolean),
  };

  return { singles, multiPart, hiddenMultiPart, rejected };
}

// Parts must run 1..n with no gaps, and match the declared total if given.
//
// A single part with no declared total counts as INCOMPLETE. If a poster
// labelled something "Part 1" there is implicitly a Part 2, so finding one in
// isolation means the rest are missing - not that the set is whole. Returning
// true here would let a lone fragment be queued as a finished download, which
// then fails to extract after the bytes have already been fetched.
function isContiguous(indexes, declaredTotal) {
  const sorted = Array.from(new Set(indexes)).sort((a, b) => a - b);
  if (sorted.length === 0 || sorted[0] !== 1) return false;
  for (let position = 1; position < sorted.length; position += 1) {
    if (sorted[position] !== sorted[position - 1] + 1) return false;
  }
  if (declaredTotal) return sorted.length === declaredTotal;
  // No total declared: only trust a set that actually has multiple parts.
  return sorted.length >= 2;
}

module.exports = {
  classifyGroup,
  selectDownloadableLinks,
  isContiguous,
  tokenize,
  WANTED_PLATFORMS,
};
