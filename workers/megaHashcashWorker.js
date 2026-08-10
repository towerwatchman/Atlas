"use strict";

// ── MEGA hashcash worker ─────────────────────────────────────────────────────
//
// One slice of the nonce space, off the main thread because a MEGA sign-in is
// genuinely expensive: each nonce rehashes 12MB in full, and at MEGA's real
// difficulty that is hundreds of gigabytes of SHA-256. On the main thread it
// would freeze the app for the entire time.
//
// ── THE REQUIRE BELOW IS LOAD-BEARING ────────────────────────────────────────
//
// It must resolve to a SIBLING in this directory. `workers/**/*` is in
// build.asarUnpack, so everything here is a real file on disk in a packaged
// build; anything outside it is inside app.asar and unreachable from a worker
// thread. This file used to require ../electron/downloads/hosts/megaHashcash,
// which resolved to app.asar.unpacked/electron/... -- a directory electron-builder
// never creates -- so the worker died with MODULE_NOT_FOUND before running a
// single hash, on every packaged machine, for every user MEGA challenged.
//
// scripts/check-worker-packaging.js now fails the build for any require in this
// directory that would not survive packaging. Do not reach outside workers/.

const { parentPort, workerData } = require("worker_threads");
const { solveHashcash, benchmarkHash } = require("./megaHashcashCore");

try {
  // The self-test in Settings needs a hash RATE, not a proof: it has to tell a
  // machine that is merely slow apart from one where the solver is broken, and
  // a solve time alone cannot do that.
  if (workerData?.mode === "benchmark") {
    parentPort.postMessage({
      ok: true,
      benchmark: benchmarkHash({
        token: workerData.token,
        iterations: workerData.iterations,
      }),
    });
  } else {
    const solved = solveHashcash({
      token: workerData.token,
      easiness: workerData.easiness,
      budgetMs: workerData.budgetMs,
      startNonce: workerData.startNonce,
      stride: workerData.stride,
    });
    // null means the budget ran out on this slice, which is a result rather than
    // a failure: the pool decides what to do about it.
    parentPort.postMessage({ ok: true, solved });
  }
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message || String(err) });
}
