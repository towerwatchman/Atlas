import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const pool = require('../electron/downloads/hosts/megaHashcashPool')
const hashcash = require('../electron/downloads/hosts/megaHashcash')

// ── The pool, not the maths ──────────────────────────────────────────────────
//
// mega-hashcash.test.js covers the solver thoroughly and always passed. The
// solver was never the problem: in a packaged build the WORKER could not load
// at all, because workers/** is in build.asarUnpack and electron/** is not, so
// the worker's `require("../electron/downloads/hosts/megaHashcash")` resolved to
// a path inside app.asar.unpacked that does not exist.
//
// That produced the user-visible bug in the worst possible shape. `new Worker()`
// does NOT throw on a bad module -- the failure arrives asynchronously as an
// 'error' event -- so the pool's try/catch never fired, every slice decremented
// the same `outstanding` counter, and the attempt resolved null in ~30ms. Null
// already meant "budget exhausted", so a total load failure was reported to the
// user as "the proof of work did not finish in time". Every packaged user who
// MEGA challenged saw a timeout message for a defect that never ran a hash.
//
// So the assertions here are about telling those two states apart. A pool that
// returns the same value for both cannot be debugged from a user's machine.

const TOKEN = 'RUvIePV2PNO8ofg8xp1aT5ugBcKSEzwKoLBw9o4E6F_fmn44eC3oMpv388UtFl2K'

/** A worker file whose top-level require cannot resolve, as in a packaged build. */
function brokenWorker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pool-'))
  const file = path.join(dir, 'brokenWorker.js')
  fs.writeFileSync(file, 'require("./definitely-not-here/megaHashcash");\n')
  return file
}

describe('solveWithWorkers outcomes', () => {
  it('reports a worker that cannot load as a load error, not a timeout', async () => {
    const file = brokenWorker()
    const result = await pool.solveWithWorkers({
      token: TOKEN,
      easiness: 200,
      budgetMs: 5000,
      resolveWorkerPath: () => file,
    })
    // The whole point: this must not look like running out of time.
    expect(result.outcome).toBe('load-error')
    expect(result.prefix).toBeNull()
    expect(String(result.error || '')).toMatch(/cannot find module|module_not_found/i)
  })

  it('a load error fails fast rather than burning the budget', async () => {
    const file = brokenWorker()
    const result = await pool.solveWithWorkers({
      token: TOKEN,
      easiness: 200,
      budgetMs: 60000,
      resolveWorkerPath: () => file,
    })
    // Elapsed time is the field that would have identified this bug from a log.
    expect(result.elapsedMs).toBeLessThan(5000)
  })

  it('solves a real challenge and reports outcome solved', async () => {
    // Easiness 200 is ~15 expected attempts, so this is a genuine end-to-end run
    // through the real worker file rather than a stub.
    const result = await pool.solveWithWorkers({ token: TOKEN, easiness: 200, budgetMs: 60000 })
    expect(result.outcome).toBe('solved')
    expect(hashcash.verifyHashcash(TOKEN, 200, result.prefix)).toBe(true)
  }, 70000)

  it('reports an exhausted budget as budget, distinctly from a load error', async () => {
    // Easiness 1 is far beyond reach; the budget is what ends this.
    const result = await pool.solveWithWorkers({ token: TOKEN, easiness: 1, budgetMs: 1200 })
    expect(result.outcome).toBe('budget')
    expect(result.prefix).toBeNull()
  }, 30000)
})

describe('selfTest', () => {
  // The diagnostic exists because MEGA does not challenge every client. A
  // developer whose sign-ins are never gated cannot reach this code path by
  // signing in, so without a deliberate trigger the happy path is untestable on
  // the one machine able to fix it.
  it('runs the real worker end to end and verifies its own proof', async () => {
    const result = await pool.selfTest({ budgetMs: 60000 })
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.workers).toBeGreaterThan(0)
    // Measured, so a slow machine can be recognised as slow rather than broken.
    expect(result.msPerHash).toBeGreaterThan(0)
    expect(result.estimateSeconds).toBeGreaterThan(0)
  }, 70000)

  it('surfaces a load failure instead of claiming success', async () => {
    const file = brokenWorker()
    const result = await pool.selfTest({ budgetMs: 5000, resolveWorkerPath: () => file })
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('load-error')
  }, 30000)
})
