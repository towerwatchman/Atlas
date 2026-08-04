"use strict";

// ── Recently deleted game paths ──────────────────────────────────────────────
//
// Paths that belonged to a game's versions moments before the record was
// deleted, kept for five minutes.
//
// It exists because deletion is two steps that can arrive in either order: the
// database rows go, and then the folders go. Once the rows are gone, nothing can
// prove a folder ever belonged to that game -- and `isAllowedDeletionPath()`
// refuses to delete a folder it cannot tie to the record. So the paths are
// remembered across that window, and expire because a stale entry is a standing
// permission to delete a directory.
//
// ── WHY IT IS A MODULE ──────────────────────────────────────────────────────
//
// It used to be `const recentlyDeletedGamePaths = new Map()` in main.js, passed
// to ipc/importer.js and ipc/games.js through their ctx object. That works for
// handler code, which runs inside registerXHandlers(ctx) and can see the
// destructured binding -- but importer.js also has MODULE-LEVEL functions that
// need it, and those cannot. `isAllowedDeletionPath()` at module scope referenced
// a name that only existed inside the register function, so every call threw
//
//   ReferenceError: recentlyDeletedGamePaths is not defined
//
// and because the only module-level caller was replaceInstalledVersionAfterImport
// -- while every in-handler caller resolved the ctx copy and worked fine -- the
// symptom was that version replace had never once succeeded, with everything
// around it healthy. eslint had it flagged as no-undef the whole time; the rule
// was downgraded to a warning for that file as tracked debt and the finding sat
// in a pile of 77.
//
// A module solves it at the level the problem lives at: `require` resolves from
// module scope, so every consumer gets the same Map whether it is inside a
// handler or not. Node caches the module, so this is still exactly one Map -- the
// same guarantee passing one instance through ctx gave.
//
// The TTL lives here too. It was written out twice, in main.js and importer.js,
// as a bare setTimeout on a magic number.

/** How long a deleted path stays deletable. */
const RETENTION_MS = 5 * 60 * 1000;

const paths = new Map();
const timers = new Map();

/**
 * Remember the paths a record's versions occupied, so a folder delete arriving
 * after the rows are gone can still be authorised.
 */
function remember(recordId, versionPaths = []) {
  const id = Number(recordId);
  if (!Number.isInteger(id) || id <= 0) return;
  const list = (Array.isArray(versionPaths) ? versionPaths : [])
    .filter((entry) => typeof entry === "string" && entry.trim());
  paths.set(id, list);
  // Re-remembering restarts the window rather than leaving the first timer to
  // expire the newer list early.
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    paths.delete(id);
    timers.delete(id);
  }, RETENTION_MS);
  // Never hold the process open on this alone.
  if (typeof timer.unref === "function") timer.unref();
  timers.set(id, timer);
}

/** Paths remembered for a record. Always an array. */
function pathsFor(recordId) {
  return paths.get(Number(recordId)) || [];
}

/** Drop a record's entry early, e.g. once the folders are confirmed gone. */
function forget(recordId) {
  const id = Number(recordId);
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  paths.delete(id);
}

/** Test seam. Not for production use. */
function _reset() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  paths.clear();
}

module.exports = { RETENTION_MS, remember, pathsFor, forget, _reset };
