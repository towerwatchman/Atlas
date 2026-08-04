"use strict";

// ── MEGA hashcash worker pool ────────────────────────────────────────────────
//
// Splits the nonce space across worker threads and returns the first proof any of
// them finds.
//
// A pool rather than a single solve because of the cost: at MEGA's example
// easiness of 100 roughly one nonce in 57,000 passes, and every attempt rehashes
// the full 12MB message -- the nonce sits in SHA-256's first block and the hash is
// sequential, so nothing downstream can be reused. That is hundreds of gigabytes
// of hashing for one sign-in, which is why MEGA's own client uses up to 8 threads
// and a 300-second budget.
//
// Workers take disjoint slices by stride, so no coordination is needed beyond
// stopping the losers: worker i tries nonces i, i+N, i+2N, …
//
// One core is left alone. The app has a UI to keep responsive, and saturating
// every core to shave a few seconds off a once-per-session cost is the wrong
// trade.

const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");

const MAX_WORKERS = 8; // Matches the SDK's desktop cap.
const DEFAULT_BUDGET_MS = 300000; // MEGA's own TTL.

/**
 * Inside a packaged app the worker cannot be loaded from within app.asar, so the
 * path is redirected to the unpacked copy -- the same rule importer.js applies to
 * extractWorker.js. Guarded, because this module is also loaded by tests running
 * outside Electron where `electron` does not resolve.
 */
function defaultWorkerPathResolver(modulePath) {
  try {
    const { app } = require("electron");
    if (app?.isPackaged && modulePath.includes(`${path.sep}app.asar${path.sep}`)) {
      return modulePath.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`,
      );
    }
  } catch {
    // Not in Electron. The path on disk is already correct.
  }
  return modulePath;
}

function workerCount() {
  const cores = Number(os.cpus()?.length) || 2;
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

/**
 * @param {object} options
 * @param {(info: object) => void} [options.onProgress] called once when work starts,
 *   so a caller can tell the user why it is about to sit still for a while.
 * @returns {Promise<string|null>} the base64url prefix, or null when the budget ran out.
 */
async function solveWithWorkers({
  token,
  easiness,
  budgetMs = DEFAULT_BUDGET_MS,
  resolveWorkerPath = defaultWorkerPathResolver,
  onProgress = null,
} = {}) {
  const count = workerCount();
  const workerPath = resolveWorkerPath(
    path.join(__dirname, "..", "..", "..", "workers", "megaHashcashWorker.js"),
  );
  const started = Date.now();
  onProgress?.({ workers: count, easiness, budgetMs });

  const workers = [];
  const stop = () => {
    for (const worker of workers) worker.terminate().catch(() => {});
  };

  try {
    return await new Promise((resolve, reject) => {
      let outstanding = count;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        stop();
        resolve(value);
      };

      for (let index = 0; index < count; index += 1) {
        let worker;
        try {
          worker = new Worker(workerPath, {
            workerData: {
              token, easiness, budgetMs, startNonce: index, stride: count,
            },
          });
        } catch (err) {
          // A worker that cannot even start is fatal for the whole attempt: the
          // path is wrong, and the other workers will fail identically.
          if (!settled) { settled = true; stop(); reject(err); }
          return;
        }
        workers.push(worker);
        worker.on("message", (message) => {
          if (message?.ok && message.solved?.prefix) {
            finish(message.solved.prefix);
            return;
          }
          // This slice gave up or errored. Only when every slice has is the
          // whole attempt out of budget.
          outstanding -= 1;
          if (outstanding <= 0) finish(null);
        });
        worker.on("error", () => {
          outstanding -= 1;
          if (outstanding <= 0) finish(null);
        });
        worker.on("exit", () => {
          // Guards against a worker exiting without posting anything, which would
          // otherwise leave the promise pending forever.
          if (!settled && workers.every((w) => w.threadId === -1)) finish(null);
        });
      }
    });
  } finally {
    stop();
    const elapsed = Date.now() - started;
    console.log("[mega-hashcash]", JSON.stringify({
      easiness, workers: count, elapsedMs: elapsed,
    }));
  }
}

module.exports = { solveWithWorkers, workerCount, MAX_WORKERS, DEFAULT_BUDGET_MS };
