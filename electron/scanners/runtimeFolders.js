"use strict";

// ── Engine runtime folders are not games ─────────────────────────────────────
//
// An unstructured library scan walks every directory under the scan root and
// treats any directory holding a launchable as a candidate game. Game engines
// break that assumption: Ren'Py ships its interpreter in
// `renpy/windows-x86_64/`, and its per-architecture launchers in
// `lib/windows-i686/`, and both of those directories contain a .exe. Scanning a
// migrated library therefore produced a row per runtime folder --
//
//   Creator/Game/v1.0                      <- the real game
//   Creator/Game/v1.0/lib/windows-i686     <- titled "windows i686"
//   Creator/Game/v2.0/lib/windows-i686     <- titled "windows i686"
//   Creator/Game/Final/renpy/windows-x86_64 <- titled "windows x86", version 64
//
// -- which is both junk entries and duplicates of games already listed. On a
// real library that is roughly one false candidate per game, which is what
// CHANGELOG 1.0.66 describes as "thousands of false candidates".
//
// This module is the root-detection half of the fix. The executable-selection
// half already exists: executableScanner.findExecutables only descends into
// subdirectories when a directory has no launchable of its own, so once the
// root is identified correctly the nested launcher is picked up as a relative
// path under it rather than as a game in its own right.
//
// ── Why the list is deliberately short ───────────────────────────────────────
//
// The two failure directions are not symmetric. A false NEGATIVE leaves a junk
// row in the importer, which the user can see and deselect. A false POSITIVE
// silently folds a real game into its parent directory, and the game simply
// never appears -- there is nothing on screen to notice. So this errs toward
// under-matching.
//
// That is why `game`, `data`, `assets` and `resources` are absent despite being
// engine directory names. They are also perfectly ordinary folder names a
// person might use for a real title, and in practice they do not hold loose
// executables, so they never produce a false candidate to begin with. Adding
// them would buy nothing and risk the failure that cannot be seen.

// Exact directory names that only ever appear as engine containers.
const RUNTIME_DIR_NAMES = new Set([
  "lib",
  "libs",
  "renpy",
  "www",
  "runtime",
  "engine",
]);

// Per-architecture build folders: `windows-i686`, `windows-x86_64`,
// `py3-windows-x86_64`, `linux-x86_64`, `mac-universal`, `darwin-arm64`.
// Anchored at both ends so a game genuinely called "Windows" or
// "Linux Adventure" is not swept up.
const ARCH_DIR_PATTERN =
  /^(?:py[23][-_])?(?:windows|win|linux|mac|macos|osx|darwin|android)[-_](?:i686|i386|x86|x86[-_]?64|amd64|arm64|aarch64|armv7|universal|32|64)$/i;

function isRuntimeSegment(name) {
  const segment = String(name || "").trim().toLowerCase();
  if (!segment) return false;
  return RUNTIME_DIR_NAMES.has(segment) || ARCH_DIR_PATTERN.test(segment);
}

function segmentsOf(relativePath) {
  return String(relativePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
}

/**
 * True when any segment of `relativePath` is an engine runtime folder.
 *
 * Tests the whole path, not just the last segment: `lib/windows-i686` is
 * rejected on `lib` alone, so an engine layout this module has not seen before
 * is still grouped correctly as long as one of its levels is recognised.
 */
function isRuntimePath(relativePath) {
  return segmentsOf(relativePath).some(isRuntimeSegment);
}

/**
 * The directory a runtime folder's executables actually belong to: the nearest
 * ancestor with no runtime segment in it.
 *
 * Returns null when every segment is runtime, or when the answer would be the
 * scan root itself -- promoting to the scan root would collapse an entire
 * library into a single game, which is a far worse outcome than the junk row
 * this exists to prevent.
 */
function nearestGameRoot(relativePath) {
  const segments = segmentsOf(relativePath);
  let end = segments.length;
  while (end > 0 && isRuntimeSegment(segments[end - 1])) end -= 1;
  if (end === 0) return null;
  const kept = segments.slice(0, end);
  if (kept.some(isRuntimeSegment)) return null;
  return kept.join("/");
}

/**
 * Reduce a flat list of scanned directories to the ones that can be games.
 *
 * Returns `{ path, ownsRuntimeChild }` per surviving directory. Runtime
 * directories are dropped and their nearest real ancestor is marked instead,
 * which is what lets a version folder whose ONLY launcher sits in
 * `lib/windows-i686` still appear, with that nested launcher as its selection.
 *
 * ── Why the flag matters ─────────────────────────────────────────────────────
 *
 * The caller uses it to decide how hard to look for launchers. A directory that
 * owns a runtime child gets a recursive search, because its launcher is by
 * definition not at its own root. Every other directory gets a root-level
 * search only.
 *
 * Recursing everywhere instead is the obvious simplification and it is wrong:
 * `Creator/Game` has no launcher of its own, but a recursive search finds
 * `Creator/Game/v2.0/lib/windows-i686/GameA.exe` and promotes the CREATOR
 * folder to a game. That trades one class of phantom row for another.
 *
 * Paths are relative strings; the caller owns the join back to absolute.
 */
function resolveGameRoots(relativeDirs) {
  const roots = new Map();
  const mark = (key, ownsRuntimeChild) => {
    // OR the flag: a directory can be both an ordinary candidate and the owner
    // of a runtime child, and in that case it needs the recursive search.
    roots.set(key, (roots.get(key) || false) || ownsRuntimeChild);
  };

  const owners = [];
  for (const dir of relativeDirs || []) {
    const relative = String(dir || "").replace(/\\/g, "/");
    if (!relative) continue;
    if (!isRuntimePath(relative)) {
      mark(relative, false);
      continue;
    }
    const owner = nearestGameRoot(relative);
    if (owner) owners.push(owner);
  }

  // Applied after the natural roots so ordering stays stable.
  for (const owner of owners) mark(owner, true);

  return [...roots].map(([path, ownsRuntimeChild]) => ({
    path,
    ownsRuntimeChild,
  }));
}

module.exports = {
  isRuntimeSegment,
  isRuntimePath,
  nearestGameRoot,
  resolveGameRoots,
  RUNTIME_DIR_NAMES,
  ARCH_DIR_PATTERN,
};
