"use strict";

// ── Resolving files that must exist outside app.asar ─────────────────────────
//
// electron-builder puts everything in build.files into app.asar, and everything
// ALSO matched by build.asarUnpack into a sibling app.asar.unpacked/ directory.
// Both paths exist; only the second is a real file on disk that a worker thread
// or a child process can open.
//
// Electron patches the public fs module to make in-asar paths readable, and it
// redirects reads of unpacked entries transparently, so it is tempting to rely
// on that and require the app.asar path directly. This module does the rewrite
// explicitly instead, for two reasons:
//
//   1. The transparent redirect is a property of Electron's fs patch, and the
//      patch does not cover every code path. check-extension-packaging.js
//      already records one case where it does not: fs.cpSync routes through
//      internal bindings rather than the patched public module, so it cannot
//      read across the boundary at all.
//   2. It fails loudly. An explicit path that is wrong produces a MODULE_NOT_FOUND
//      naming app.asar.unpacked, which points straight at the asarUnpack glob.
//      A silent fallback to the in-asar copy would work on a developer machine
//      and break only after shipping -- which is precisely how the MEGA hashcash
//      worker reached users broken.
//
// Guarded against `electron` being unresolvable: this module is loaded by tests
// running in plain Node, where there is no asar and the path is already correct.

const path = require("path");

const PACKED = `${path.sep}app.asar${path.sep}`;
const UNPACKED = `${path.sep}app.asar.unpacked${path.sep}`;

/**
 * Rewrite an absolute path inside app.asar to its unpacked twin.
 *
 * Returns the input unchanged when not packaged, when not inside an asar, or
 * when Electron is not present at all. Callers can therefore use this
 * unconditionally.
 */
function resolveUnpacked(modulePath) {
  const target = String(modulePath || "");
  try {
    const { app } = require("electron");
    if (app?.isPackaged && target.includes(PACKED)) {
      return target.replace(PACKED, UNPACKED);
    }
  } catch {
    // Not running under Electron. Nothing is packed, so nothing to rewrite.
  }
  return target;
}

/** True when `resolveUnpacked` would rewrite this path. Used by diagnostics. */
function isPacked(modulePath) {
  return String(modulePath || "").includes(PACKED);
}

module.exports = { resolveUnpacked, isPacked, PACKED, UNPACKED };
