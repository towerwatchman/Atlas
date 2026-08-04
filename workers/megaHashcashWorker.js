"use strict";

// ── MEGA hashcash worker ─────────────────────────────────────────────────────
//
// One slice of the nonce space. Lives in workers/ beside extractWorker.js and is
// resolved the same way, so packaging picks it up (`workers/**/*` is already in
// the build's file list).
//
// This runs off the main thread because a MEGA sign-in is genuinely expensive:
// each nonce rehashes 12MB in full, and at MEGA's real difficulty that is
// hundreds of gigabytes of SHA-256. On the main thread it would freeze the app
// for the entire time.

const { parentPort, workerData } = require("worker_threads");
const { solveHashcash } = require("../electron/downloads/hosts/megaHashcash");

try {
  const solved = solveHashcash({
    token: workerData.token,
    easiness: workerData.easiness,
    budgetMs: workerData.budgetMs,
    startNonce: workerData.startNonce,
    stride: workerData.stride,
  });
  // null means the budget ran out on this slice, which is a result rather than a
  // failure: the pool decides what to do about it.
  parentPort.postMessage({ ok: true, solved });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message || String(err) });
}
