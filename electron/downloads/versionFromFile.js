"use strict";

// ── Version from a downloaded filename ───────────────────────────────────────
//
// Guesses the version of a downloaded archive so the install prompt can show
// something sensible instead of an empty box.
//
// This is a SUGGESTION, never an authority. Uploader filenames are freeform
// ("AFamilyVenture-0.09_V4-Fix_Supporter-pc.zip"), and the cost of a wrong
// guess is real: the version string becomes the folder name and decides
// whether an install replaces an existing build. So the prompt shows this
// pre-filled and editable, and a low-confidence guess is surfaced as such
// rather than quietly accepted.
//
// The catalog's version is the DEFAULT, agreeing or not. Two reasons: it is a
// curated value that already matches how every other version of this game is
// named in the library, whereas the filename guess is extracted from freeform
// uploader text ("AFamilyVenture-0.09_V4-Fix_Supporter-pc.zip"); and the string
// becomes a folder name and is what a later replace matches against, so a
// consistent shape matters more than fidelity to one uploader's spelling.
//
// A disagreement is still surfaced in full — both values, flagged as a mismatch —
// because the field is editable and the file version is sometimes the right
// answer (a link minted before the thread updated). What changed is only which
// one is pre-filled; nothing is decided silently either way.

// Noise that routinely sits next to a version and must not be swallowed into
// it. Order matters: longer phrases first.
const NOISE_TOKENS = [
  "fix", "hotfix", "patched", "patch", "repack", "compressed", "final",
  "supporter", "public", "pc", "win", "windows", "linux", "mac", "android",
  "full", "complete", "uncensored", "censored", "eng", "english", "multi",
  "part", "extra", "extras", "walkthrough", "wt", "mod",
];

// Real version shapes, most specific first.
//   v0.09, 0.09, 1.2.3, 2021.05.24, 0.9b, 1.0a, Ch5, Chapter 5, Ep2
// Ordering is load-bearing. "AFamilyVenture-0.09_V4-Fix" contains both 0.09
// and V4; the version is 0.09 and V4 is a fix revision. A v-prefix followed by
// a BARE INTEGER is therefore the weakest signal, not the strongest - it is far
// more often a revision counter than a build number. A v-prefix followed by a
// DOTTED number is the strongest.
const VERSION_PATTERNS = [
  // v0.9.2 - v-prefix AND a dot. Unambiguous.
  /\bv[\s._-]?(\d+\.\d+(?:\.\d+){0,2}[a-z]?)\b/i,
  // Date-like, before plain numerics so 2021.05.24 is not read as 2021.05.
  /\b(\d{4}\.\d{2}\.\d{2})\b/,
  // Bare dotted numeric: 0.09, 1.2.3. Beats a bare v-integer.
  /\b(\d+\.\d+(?:\.\d+){0,2}[a-z]?)\b/,
  // Chapter / episode numbering, common in episodic titles.
  /\b(?:chapter|chap|ch|episode|ep)[\s._-]?(\d+(?:\.\d+)?)\b/i,
  // v4 with no dot. Last resort - usually a revision marker, so low confidence.
  /\bv[\s._-]?(\d+[a-z]?)\b/i,
];

/** Strip the extension, including a trailing .tar in .tar.gz. */
function stripExtension(fileName) {
  return String(fileName || "")
    .replace(/\.(zip|7z|rar|tar|gz|bz2|xz|exe|apk)$/i, "")
    .replace(/\.tar$/i, "");
}

/** Separators to spaces, so token matching does not depend on punctuation. */
function tokenize(text) {
  return String(text || "").replace(/[_\-+()[\]]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Best-effort version from an archive filename.
 *
 * @returns {{version:string, confidence:'high'|'medium'|'low', source:string}}
 */
function versionFromFileName(fileName) {
  const base = tokenize(stripExtension(fileName));
  if (!base) return { version: "", confidence: "low", source: "none" };

  for (let index = 0; index < VERSION_PATTERNS.length; index += 1) {
    const match = base.match(VERSION_PATTERNS[index]);
    if (!match) continue;
    const raw = String(match[1] || "").trim();
    if (!raw) continue;
    // Indices track VERSION_PATTERNS above: 0 v-dotted, 1 date, 2 dotted,
    // 3 chapter, 4 bare v-integer.
    const confidence = index <= 2 ? "high" : index === 3 ? "medium" : "low";
    return {
      // Keep the v only where the filename actually had one.
      version: index === 0 || index === 4 ? `v${raw}` : raw,
      confidence,
      source: "filename",
    };
  }
  return { version: "", confidence: "low", source: "none" };
}

/**
 * Strip a version and the usual noise out of a filename to get a title.
 * Used only to show the user what the archive appears to contain.
 */
function titleFromFileName(fileName) {
  let base = tokenize(stripExtension(fileName));
  for (const pattern of VERSION_PATTERNS) base = base.replace(pattern, " ");
  const kept = base
    .split(" ")
    .filter((token) => token && !NOISE_TOKENS.includes(token.toLowerCase()))
    .filter((token) => !/^\d+$/.test(token));
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Reconcile the filename guess against what the catalog expects.
 *
 * Neither wins automatically. The catalog is usually right, but it can be
 * ahead of a link minted before the thread updated, so a disagreement is
 * reported for the user to settle rather than resolved silently.
 */
function suggestVersion(fileName, catalogVersion = "") {
  const guess = versionFromFileName(fileName);
  const catalog = String(catalogVersion || "").trim();

  if (!catalog) {
    // Nothing known for this game, so the filename is all there is.
    return {
      version: guess.version,
      confidence: guess.confidence,
      mismatch: false,
      catalogVersion: "",
      fileVersion: guess.version,
      source: guess.version ? "filename" : "none",
    };
  }
  if (!guess.version) {
    // Nothing parseable in the filename: the catalog's word, unverified.
    return {
      version: catalog,
      confidence: "medium",
      mismatch: false,
      catalogVersion: catalog,
      fileVersion: "",
      source: "catalog",
    };
  }

  // Compare loosely - "v0.09" and "0.09" are the same version written twice.
  const loose = (value) => value.toLowerCase().replace(/^v/, "").replace(/[\s._-]+/g, "");
  const agree = loose(guess.version) === loose(catalog);

  return {
    // The catalog version either way. On agreement it is simply the tidier
    // spelling of the same thing; on disagreement it is the default the user can
    // override from the mismatch panel, which shows both values.
    version: catalog,
    // A disagreement is still low confidence — the prompt asks for a look, it
    // just no longer pre-fills the uploader's guess.
    confidence: agree ? "high" : "low",
    mismatch: !agree,
    catalogVersion: catalog,
    fileVersion: guess.version,
    source: "catalog",
  };
}

module.exports = {
  versionFromFileName,
  titleFromFileName,
  suggestVersion,
  stripExtension,
  tokenize,
};
