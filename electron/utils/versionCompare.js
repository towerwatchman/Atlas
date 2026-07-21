"use strict";

/**
 * Scheme-aware version comparison for the messy real-world version strings that
 * appear on F95/LewdCorner/GOG/Steam titles.
 *
 * The problem this solves: version strings in the wild are not semver. A single
 * `versions` field can contain any of:
 *   - plain semver            v0.9.11, v1.10.3, 0.06c
 *   - letter revisions        v0.3.6c, v0.02c, Ep.5.02p, va1.4.0
 *   - chapter/act progression Ch.1, Chapter 2, Act II, Ch.10 v0.10.0
 *   - episode progression     Ep.2, Episode 1, Ep.3.5.2, S1 Ep.6.1
 *   - season nesting          S2 Ep.4, S01 Ep 02
 *   - part sub-steps          Ep.2 P1, Part 1.5, Ch.1 P2 v1.0.2
 *   - terminal markers        Final, Finale, Epilogue, Complete
 *   - dates                   2026-06-03, March 2026, Dec 2025
 *   - pure noise / editions   + DLC, Patreon, Steam Patched, SE, (Teaser)
 *
 * No single numeric axis orders all of these, so a naive "strip to digits and
 * compare" is wrong for large slices of the catalog (that was the old bug).
 *
 * Key facts that make this tractable:
 *   1. We only ever compare two strings *from the same game* (the installed
 *      version vs. that game's known-latest). Within one game a developer is
 *      almost always internally consistent, so we don't need a universal
 *      ordering of every string — only "is B newer than A" for a matched pair.
 *   2. When two strings use genuinely different / unparseable schemes we would
 *      rather stay silent than guess. Incomparable => suppress the badge.
 *
 * Ordering hierarchy (compared left-to-right, missing component counts as 0):
 *
 *      terminal > season > chapter > episode > part > semver > letter > qualifier
 *
 * Terminal (Final/Finale/Epilogue/Complete) beats any in-progress version.
 * Qualifier rank: pre-release (demo/alpha/beta/proto/early access) < normal
 * < post-release (public/full/fix/patch).
 */

// Distribution / edition / marketing tags that carry no progression meaning.
// Stripped before parsing so "v1.0" and "v1.0 + DLC" compare equal.
const NOISE_PATTERNS = [
  /\+\s*dlc\d*/gi,
  /\+\s*hf\s*[\d.]*/gi,
  /\ball\s+dlcs?\b/gi,
  /\bdlcs?\b/gi,
  /\bpatreon\b/gi,
  /\bsteam(\s*patched)?\b/gi,
  /\bitch\b/gi,
  /\bvoiceless\b/gi,
  /\bvoiced\b/gi,
  /\bse\b/gi, // Special Edition
  /\buv\b/gi,
  /\bpa\b/gi,
  /\bre\b/gi, // Remaster/Redux tag seen as trailing "RE"
  /\bext\b/gi,
  /\brp\b/gi,
  /\bcompact\s+edition\b/gi,
  /\bdeluxe(\s+techbuild)?\b/gi,
  /\bsummer\s+sales?\b/gi,
  /\bhalloween(\s+special)?\b/gi,
  /\bcorruption\b/gi,
  /\breworked\b/gi,
  /\bfree\b/gi,
  /\bteaser\b/gi,
  /\bfixed\s+version\b/gi,
  /\(\s*fixed\s*version\s*\)/gi,
  /\bhot\s*fix(\s*patch)?\d*/gi,
  /\bhotfix\d*/gi,
  /\bbug\s*fix\d*/gi,
  /\bupdate\s*\d*/gi,
  /\bday\s*\d+/gi,
  /\bissue\s*\d+/gi,
  /\bsec\.?\s*\d+/gi,
  /\balldlcs?\b/gi,
];

const TERMINAL_RE = /\b(final|finale|epilogue|complete)\b/i;
const PRE_RE = /\b(demo|alpha|beta|proto(?:type)?|early\s*access|prologue|pilot|proof\s+of\s+concept)\b/i;
const POST_RE = /\b(public|full|fix|patch)\b/i;

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function stripNoise(raw) {
  let s = " " + String(raw || "").toLowerCase() + " ";
  for (const re of NOISE_PATTERNS) s = s.replace(re, " ");
  return s.replace(/\s+/g, " ").trim();
}

function isTerminal(raw) {
  const s = String(raw || "");
  return TERMINAL_RE.test(s) && !PRE_RE.test(s);
}

// ---- date parsing -----------------------------------------------------------
// Returns [year, month, day] (month/day default 1) or null.
function parseDate(raw) {
  const s = String(raw || "").trim();
  // ISO: 2026-06-03  (optionally v-prefixed)
  let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return [+m[1], +m[2], +m[3]];
  // Dotted 2-digit build date that is clearly a date: 26.07.01 (yy.mm.dd) with
  // a leading v and no other semantic. Kept conservative to avoid catching
  // semver like 1.2.08.
  m = s.match(/\bv(\d{2})\.(\d{2})\.(\d{2})\b/);
  if (m) {
    const yy = +m[1], mm = +m[2], dd = +m[3];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yy >= 20) {
      return [2000 + yy, mm, dd];
    }
  }
  // Month name + year: "March 2026", "Dec 2025"
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(20\d{2})\b/i);
  if (m) return [+m[2], MONTHS[m[1].slice(0, 3).toLowerCase()], 1];
  return null;
}

// ---- numbered-label extraction ---------------------------------------------
// Extract a dotted numeric array for a label family, e.g. episode "3.5.2" from
// "Ep.3.5.2". Ranges ("Ch.1-6", "Ep.1&2") take the top end. Roman numerals for
// Act/Ep are supported.
function extractLabel(cleaned, keys) {
  const alt = keys.join("|");
  let best = null;

  // dotted numeric form: Ep.3.5.2  /  Ch.1  /  S2
  const numRe = new RegExp(
    `\\b(?:${alt})\\.?\\s*(\\d+(?:\\.\\d+)*)(?:\\s*[-&]\\s*(\\d+))?`,
    "gi",
  );
  let m;
  while ((m = numRe.exec(cleaned))) {
    let parts = m[1].split(".").map((n) => parseInt(n, 10) || 0);
    if (m[2]) parts = [parseInt(m[2], 10) || 0]; // range → top end
    if (best === null || cmpArray(parts, best) > 0) best = parts;
  }

  // roman form: Act II / Ep. III
  const romRe = new RegExp(`\\b(?:${alt})\\.?\\s*(x|ix|viii|vii|vi|v|iv|iii|ii|i)\\b`, "gi");
  while ((m = romRe.exec(cleaned))) {
    const n = ROMAN[m[1].toLowerCase()];
    if (n && (best === null || cmpArray([n], best) > 0)) best = [n];
  }

  return best; // null when the label is absent
}

// Semver core: the dotted numeric run, ignoring any that belongs to a label we
// already consumed. We remove label tokens first, then grab the first dotted
// numeric group (optionally v-prefixed, optionally with a letter-in-version
// like va1.4.0).
function extractSemver(cleaned, consumedLabels) {
  let s = cleaned;
  // Remove label tokens so their numbers don't leak into the semver.
  for (const key of consumedLabels) {
    s = s.replace(
      new RegExp(`\\b${key}\\.?\\s*\\d+(?:\\.\\d+)*(?:\\s*[-&]\\s*\\d+)?`, "gi"),
      " ",
    );
    s = s.replace(new RegExp(`\\b${key}\\.?\\s*(?:x|ix|viii|vii|vi|v|iv|iii|ii|i)\\b`, "gi"), " ");
  }
  // v-prefixed or bare dotted numeric; allow a stray letter right after v (va1.4.0)
  const m = s.match(/v?[a-z]?(\d+(?:\.\d+)+)/i) || s.match(/(?:^|\s)v?[a-z]?(\d+)(?=\D|$)/i);
  if (!m) return null;
  return m[1].split(".").map((n) => parseInt(n, 10) || 0);
}

// Trailing letter revision on the last numeric group: 0.3.6c → 3, va… → n,
// Ep.5.02p → 16. Returns 0 when absent.
function extractLetterRev(cleaned) {
  const m = cleaned.match(/\d([a-z])\b/i);
  return m ? m[1].toLowerCase().charCodeAt(0) - 96 : 0;
}

function extractPart(cleaned) {
  let best = null;
  const re = /\b(?:p|pt|part)\.?\s*(\d+(?:\.\d+)*)/gi;
  let m;
  while ((m = re.exec(cleaned))) {
    const parts = m[1].split(".").map((n) => parseInt(n, 10) || 0);
    if (best === null || cmpArray(parts, best) > 0) best = parts;
  }
  return best;
}

function qualifierRank(raw) {
  if (isTerminal(raw)) return 3;
  if (POST_RE.test(raw)) return 2;
  if (PRE_RE.test(raw)) return 0; // pre-release ranks below "normal"
  return 1; // normal
}

function cmpArray(a, b) {
  a = a || [];
  b = b || [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Parse a raw version string into a structured, comparable descriptor.
 */
function parseVersion(raw) {
  const original = String(raw || "").trim();
  const terminal = isTerminal(original);
  const date = parseDate(original);
  const cleaned = stripNoise(original);

  const season = extractLabel(cleaned, ["s", "season"]);
  const chapter = extractLabel(cleaned, ["ch", "chapter", "act"]);
  const episode = extractLabel(cleaned, ["ep", "episode"]);

  const consumed = [];
  if (season) consumed.push("s", "season");
  if (chapter) consumed.push("ch", "chapter", "act");
  if (episode) consumed.push("ep", "episode");

  const part = extractPart(cleaned);
  const semver = extractSemver(cleaned, consumed);
  const letter = extractLetterRev(cleaned);
  const qualifier = qualifierRank(original);

  const hasStructure =
    terminal || !!date || !!season || !!chapter || !!episode || !!part || !!semver;

  return {
    original,
    normalized: cleaned,
    terminal,
    date, // [y,m,d] | null
    season, // number[] | null
    chapter,
    episode,
    part,
    semver,
    letter,
    qualifier,
    hasStructure,
  };
}

/**
 * Compare two parsed descriptors.
 * @returns {number|null} 1 if a>b, -1 if a<b, 0 if equal, null if incomparable.
 */
function compareParsed(a, b) {
  // Terminal dominates everything in-progress.
  if (a.terminal || b.terminal) {
    if (a.terminal && !b.terminal) return 1;
    if (!a.terminal && b.terminal) return -1;
    // both terminal → fall through to finer keys (e.g. Final v1.1 > Final v1.0)
  }

  // Dates only compare against dates.
  if (a.date || b.date) {
    if (a.date && b.date) return cmpArray(a.date, b.date);
    return null; // date vs non-date is incomparable
  }

  // If neither side has any parseable structure, only exact-equality is safe.
  if (!a.hasStructure && !b.hasStructure) {
    return a.normalized === b.normalized ? 0 : null;
  }
  // One structured, one not → incomparable.
  if (a.hasStructure !== b.hasStructure) return null;

  // Hierarchy: season → chapter → episode → part → semver → letter → qualifier.
  const keys = ["season", "chapter", "episode", "part", "semver"];
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) continue;
    // If one side uses a level the other doesn't, they may still be comparable
    // when a shared lower level exists — but a mismatch at a *present* level is
    // authoritative. Treat missing as 0-array so "Ch.2" > "Ch.1 Ep.9".
    const c = cmpArray(av, bv);
    if (c !== 0) return c;
  }

  if (a.letter !== b.letter) return a.letter > b.letter ? 1 : -1;
  if (a.qualifier !== b.qualifier) return a.qualifier > b.qualifier ? 1 : -1;
  return 0;
}

/**
 * Compare two raw version strings.
 * @returns {number|null} 1 if latest>installed, -1 if <, 0 if equal, null if
 *   incomparable.
 */
function compareVersionStrings(a, b) {
  return compareParsed(parseVersion(a), parseVersion(b));
}

/**
 * Determine whether an update is available.
 *
 * @param {string} latestVersion  the known-latest version for the game
 * @param {Array<{version:string}>} versions  the user's installed/known versions
 * @returns {boolean}
 *
 * Semantics (per product decisions):
 *   - Version-string authoritative. Thread/metadata timestamps are NOT used;
 *     "thread activity" is not "new version" and was the main false-positive
 *     source.
 *   - An update exists only when the newest installed version is strictly older
 *     than latest.
 *   - Terminal (Final/Finale/Epilogue/Complete) latest beats any in-progress
 *     install.
 *   - Incomparable schemes suppress the badge (no false alarms).
 */
function getIsUpdateAvailable(latestVersion, versions) {
  if (!latestVersion || !Array.isArray(versions) || versions.length === 0) {
    return false;
  }

  const latest = parseVersion(latestVersion);

  // If the user already has a version whose string matches latest (after noise
  // stripping), there is definitively no update.
  if (versions.some((v) => parseVersion(v.version).normalized === latest.normalized)) {
    return false;
  }
  // If the user has a terminal version, they are at the end — never nag.
  if (versions.some((v) => isTerminal(v.version))) return false;

  // Find the newest installed version *that is comparable to latest*. An update
  // exists only if even that newest comparable install is older than latest.
  let newestComparable = null;
  let sawComparable = false;

  for (const v of versions) {
    const parsed = parseVersion(v.version);
    const c = compareParsed(latest, parsed);
    if (c === null) continue; // incomparable to latest — ignore for the decision
    sawComparable = true;
    if (newestComparable === null || compareParsed(parsed, newestComparable) > 0) {
      newestComparable = parsed;
    }
  }

  // Nothing the user has is comparable to latest → suppress (avoid false
  // alarms), UNLESS latest is terminal, which always represents progress.
  if (!sawComparable) return latest.terminal === true;

  return compareParsed(latest, newestComparable) === 1;
}

module.exports = {
  parseVersion,
  compareParsed,
  compareVersionStrings,
  getIsUpdateAvailable,
  isTerminal,
  // exposed for tests
  _internals: { stripNoise, parseDate, extractLabel, extractSemver },
};
