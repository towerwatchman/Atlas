"use strict";

// ── MEGA hashcash worker pool ────────────────────────────────────────────────
//
// Splits the nonce space across worker threads and returns the first proof any
// of them finds.
//
// A pool rather than a single solve because of the cost: at MEGA's example
// easiness of 100 roughly one nonce in 57,000 passes, and every attempt rehashes
// the full 12MB message -- the nonce sits in SHA-256's first block and the hash
// is sequential, so nothing downstream can be reused. That is hundreds of
// gigabytes of hashing for one sign-in, which is why MEGA's own client uses up to
// 8 threads and a 300-second budget.
//
// Workers take disjoint slices by stride, so no coordination is needed beyond
// stopping the losers: worker i tries nonces i, i+N, i+2N, …
//
// One core is left alone. The app has a UI to keep responsive, and saturating
// every core to shave time off a once-per-SESSION cost is the wrong trade -- the
// session is persisted, so a signed-in user pays this once, not once per launch.
//
// ── WHY THIS RETURNS AN OBJECT ───────────────────────────────────────────────
//
// It used to return `string | null`, and null meant "the budget ran out". That
// single value was also what came back when every worker failed to LOAD, because
// `new Worker()` does not throw on an unresolvable module -- the failure arrives
// asynchronously on the 'error' event, so the try/catch around construction never
// fired and each dead worker just decremented the same counter.
//
// In a packaged build that is exactly what happened, every time, and the user was
// shown "the proof of work did not finish in time" for a worker that never ran a
// hash. The two states are now distinct outcomes, because a failure mode that
// cannot be told apart from a slow success cannot be diagnosed from a bug report.

const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");

const { resolveUnpacked } = require("../../unpackedPath");
const appLog = require("../../appLog");
const { verifyHashcash, expectedAttempts, toBase64Url } = require("./megaHashcash");

const MAX_WORKERS = 8; // Matches the SDK's desktop cap.
const DEFAULT_BUDGET_MS = 300000; // MEGA's own TTL, per the SDK.

// Easy enough to solve in a second or so (~15 expected attempts) while still
// exercising the real worker, the real message buffer and the real verifier.
const SELF_TEST_EASINESS = 200;
// The difficulty seen in MEGA's own documented example, used to turn a measured
// hash rate into an estimate a user can act on.
const REFERENCE_EASINESS = 100;

const WORKER_FILE = path.join(__dirname, "..", "..", "..", "workers", "megaHashcashWorker.js");

function defaultWorkerPathResolver() {
  return resolveUnpacked(WORKER_FILE);
}

function workerCount() {
  const cores = Number(os.cpus()?.length) || 2;
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

/** A syntactically valid challenge token: 48 random bytes as 64 base64url chars. */
function syntheticToken() {
  return toBase64Url(require("crypto").randomBytes(48));
}

/**
 * Run every worker to completion over a shared piece of work.
 *
 * Workers are all CONSTRUCTED before any listener is attached. The previous
 * version attached inside the construction loop and used
 * `workers.every((w) => w.threadId === -1)` to detect the end, which could be
 * satisfied by a single already-exited worker while later ones had not been
 * created yet -- resolving the attempt early and then leaking the stragglers.
 */
function runWorkers({ count, workerPath, workerData, onWorkerMessage }) {
  return new Promise((resolve) => {
    const workers = [];
    let settled = false;
    let exited = 0;
    let loadError = null;
    let finished = 0;

    const stop = () => {
      for (const worker of workers) worker.terminate().catch(() => {});
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      stop();
      resolve(value);
    };

    for (let index = 0; index < count; index += 1) {
      try {
        workers.push(new Worker(workerPath, { workerData: workerData(index) }));
      } catch (err) {
        // A synchronous throw is rare (a malformed path rather than a missing
        // module) but it is unambiguous, so report it as-is.
        stop();
        resolve({ outcome: "load-error", error: err.message || String(err) });
        return;
      }
    }

    for (const worker of workers) {
      worker.on("message", (message) => {
        const verdict = onWorkerMessage(message);
        if (verdict !== undefined) { finish(verdict); return; }
        finished += 1;
        if (finished + (loadError ? 1 : 0) >= count && !settled) {
          finish(loadError ? { outcome: "load-error", error: loadError } : { outcome: "budget" });
        }
      });
      worker.on("error", (err) => {
        // The load failure lives here, not in the try/catch above. A worker whose
        // top-level require cannot resolve is constructed successfully and then
        // emits MODULE_NOT_FOUND asynchronously.
        loadError = loadError || err?.message || String(err);
        finish({ outcome: "load-error", error: loadError });
      });
      worker.on("exit", () => {
        exited += 1;
        // Backstop for a worker that exits without posting anything, which would
        // otherwise leave this promise pending forever.
        if (exited >= count && !settled) {
          finish(loadError ? { outcome: "load-error", error: loadError } : { outcome: "budget" });
        }
      });
    }
  });
}

/**
 * Search for a proof.
 *
 * @returns {Promise<{prefix: string|null, outcome: 'solved'|'budget'|'load-error'|'worker-error',
 *   error: string|null, elapsedMs: number, workers: number}>}
 *   `outcome` is the field that matters. `solved` carries a prefix; `budget` means
 *   the difficulty beat the clock and retrying may help; `load-error` means the
 *   worker never ran and retrying cannot possibly help.
 */
async function solveWithWorkers({
  token,
  easiness,
  budgetMs = DEFAULT_BUDGET_MS,
  resolveWorkerPath = defaultWorkerPathResolver,
  onProgress = null,
} = {}) {
  const count = workerCount();
  const workerPath = resolveWorkerPath(WORKER_FILE);
  const started = Date.now();
  onProgress?.({ workers: count, easiness, budgetMs });

  const result = await runWorkers({
    count,
    workerPath,
    workerData: (index) => ({
      token, easiness, budgetMs, startNonce: index, stride: count,
    }),
    onWorkerMessage: (message) => {
      if (message?.ok && message.solved?.prefix) {
        return { outcome: "solved", prefix: message.solved.prefix };
      }
      if (message && message.ok === false) {
        return { outcome: "worker-error", error: message.error || "the solver threw" };
      }
      return undefined; // This slice ran out of budget; wait for the others.
    },
  });

  const elapsedMs = Date.now() - started;
  const final = {
    prefix: result.prefix || null,
    outcome: result.outcome,
    error: result.error || null,
    elapsedMs,
    workers: count,
  };
  appLog.write("mega-hashcash", {
    outcome: final.outcome,
    easiness,
    workers: count,
    elapsedMs,
    budgetMs,
    // The single most diagnostic pair in this file. A load error resolves in tens
    // of milliseconds; a real exhausted budget takes the whole budget. Reading
    // those two numbers together identifies the packaging bug immediately.
    workerPath: final.outcome === "load-error" ? workerPath : undefined,
    error: final.error || undefined,
  });
  return final;
}

/**
 * Prove the solver works on THIS machine, and measure how fast it is.
 *
 * This exists because MEGA does not challenge every client. Hashcash is applied
 * by server-side anti-abuse policy, so a developer whose own sign-ins are never
 * gated cannot reach this code by signing in -- which is how a worker that could
 * never load in a packaged build shipped and stayed shipped. Without a deliberate
 * trigger the happy path is unreachable on the one machine able to fix it.
 *
 * Two measurements, because they answer different questions:
 *   ok/verified     -- can this build solve a challenge at all?
 *   estimateSeconds -- if MEGA challenges this user for real, will it finish?
 */
async function selfTest({
  budgetMs = 60000,
  resolveWorkerPath = defaultWorkerPathResolver,
} = {}) {
  const token = syntheticToken();
  const count = workerCount();
  const workerPath = resolveWorkerPath(WORKER_FILE);
  const started = Date.now();

  // Rate first: if the worker cannot load, this fails in milliseconds and there
  // is no point running a solve that would report the same thing more slowly.
  const bench = await runWorkers({
    count: 1,
    workerPath,
    workerData: () => ({ mode: "benchmark", token, iterations: 8 }),
    onWorkerMessage: (message) => (
      message?.ok && message.benchmark
        ? { outcome: "solved", benchmark: message.benchmark }
        : { outcome: "worker-error", error: message?.error || "no benchmark returned" }
    ),
  });

  if (bench.outcome !== "solved") {
    const failed = {
      ok: false,
      outcome: bench.outcome,
      error: bench.error || null,
      workers: count,
      workerPath,
      elapsedMs: Date.now() - started,
    };
    appLog.write("mega-selftest", failed);
    return failed;
  }

  const msPerHash = bench.benchmark.msPerHash;
  const solve = await solveWithWorkers({
    token, easiness: SELF_TEST_EASINESS, budgetMs, resolveWorkerPath,
  });
  const verified = solve.outcome === "solved"
    && verifyHashcash(token, SELF_TEST_EASINESS, solve.prefix);

  // Mean, not a deadline: the search is memoryless, so about a third of real
  // attempts take longer than this. Presented as "about", never as a promise.
  const estimateSeconds = (expectedAttempts(REFERENCE_EASINESS) * msPerHash) / count / 1000;

  const result = {
    ok: solve.outcome === "solved" && verified,
    outcome: solve.outcome,
    verified,
    error: solve.error || null,
    workers: count,
    msPerHash,
    // MB/s of SHA-256, the number that varies most between machines: a CPU with
    // the SHA-NI extension is several times faster than one without, which is the
    // difference between a sign-in taking half a minute and one that cannot
    // finish inside any sane budget. Taken from the core rather than recomputed
    // here -- the first version of this line divided by 1024 once too often and
    // reported 20 MB/s for a machine doing 20 GB/s.
    throughputMBps: bench.benchmark.mbPerSecond * count,
    throughputPerThreadMBps: bench.benchmark.mbPerSecond,
    estimateSeconds,
    elapsedMs: Date.now() - started,
    workerPath,
  };
  appLog.write("mega-selftest", result);
  return result;
}

module.exports = {
  solveWithWorkers,
  selfTest,
  workerCount,
  MAX_WORKERS,
  DEFAULT_BUDGET_MS,
  SELF_TEST_EASINESS,
  REFERENCE_EASINESS,
};
