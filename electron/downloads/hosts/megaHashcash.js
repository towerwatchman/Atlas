"use strict";

// ── MEGA hashcash: main-process view ─────────────────────────────────────────
//
// The implementation now lives in workers/megaHashcashCore.js. It had to move:
// megaHashcashWorker.js requires it, and a worker thread in a packaged build can
// only load files that survive outside app.asar. `workers/**/*` is in
// build.asarUnpack and `electron/**/*` is not, so while the solver lived here the
// worker's require resolved under app.asar.unpacked/electron/ -- a directory that
// is never created. Every packaged sign-in MEGA challenged failed instantly, and
// because `new Worker()` reports a bad module asynchronously rather than throwing,
// the pool logged it as an exhausted budget. Users were told the proof of work ran
// out of time when it had never started.
//
// This file stays as the main-process entry point so callers and tests keep one
// import path, and so the solver the tests exercise is byte-for-byte the one the
// worker runs. Two copies of this maths would be worse than the bug it replaced:
// a drifted solver produces proofs MEGA rejects silently, which is
// indistinguishable from a wrong password.
//
// The path is rewritten explicitly rather than leaning on Electron's transparent
// asar redirect -- see electron/unpackedPath.js for why.

const path = require("path");
const { resolveUnpacked } = require("../../unpackedPath");

module.exports = require(
  resolveUnpacked(path.join(__dirname, "..", "..", "..", "workers", "megaHashcashCore.js")),
);
