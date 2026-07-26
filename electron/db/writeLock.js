'use strict'

// ── Write lock ───────────────────────────────────────────────────────────────
//
// A SQLite connection has exactly ONE transaction. node-sqlite3 serializes
// individual statements, so single writes are safe — but a logical transaction
// spans several `await`s, and anything else issuing BEGIN/COMMIT inside that
// window operates on the same transaction. The result:
//
//   path A: BEGIN            <- transaction opens
//   path A: await insert...  <- control returns to the event loop
//   path B: BEGIN            <- "cannot start a transaction within a transaction"
//   path B: INSERT ...
//   path B: COMMIT           <- commits path A's transaction, including B's rows
//   path A: COMMIT           <- "cannot commit - no transaction is active"
//
// That is exactly the failure seen when a remote catalog update's snapshot prune
// interleaved with the background catalog-index build: both run at startup, and
// the index build deliberately yields between chunks to keep the UI responsive,
// which is precisely what hands control to the update path mid-transaction.
//
// The hazard predates the index build (the scanners, the importer and the update
// path could always collide with each other), but the build made it reliable
// because it runs at boot at the same moment as the update check and
// recomputeNormalizedTitles.
//
// This module is the fix: a promise-chain mutex that every multi-statement
// transaction acquires. It does NOT hold the lock for the whole of a long job —
// callers take it per transaction, so a chunked writer releases between chunks
// and other work still interleaves cleanly at transaction boundaries.
//
// This is cooperative. It only protects paths that opt in, so a new
// multi-statement transaction anywhere in the db layer should be wrapped in
// withWriteLock() rather than calling BEGIN directly.
//
// It is also REENTRANT. Several of these call trees nest — applyFullSnapshotPrune
// runs its own transactions and calls loadIdsIntoTemp, which runs more — and with
// a plain mutex the inner acquire would await a promise that only resolves once
// the outer one releases, deadlocking the whole database. AsyncLocalStorage lets
// a nested acquire detect that this async context already holds the lock and run
// inline instead of queueing.

const { AsyncLocalStorage } = require('async_hooks')

// Marks async contexts that already hold the lock, so nested acquires can run
// inline rather than deadlock.
const held = new AsyncLocalStorage()

// Tail of the queue. Each acquirer chains onto it; rejections are swallowed on
// the chain (but still propagate to the caller) so one failure cannot wedge the
// lock permanently.
let tail = Promise.resolve()
let depth = 0
let active = null

const withWriteLock = (label, fn) => {
  // Already inside a held lock on this async context: run inline. The outer
  // holder still guarantees no other path interleaves.
  const current = held.getStore()
  if (current) {
    current.nested.push(label)
    return Promise.resolve().then(fn)
  }

  const previous = tail
  let release
  tail = new Promise((resolve) => { release = resolve })

  const result = (async () => {
    await previous
    depth += 1
    active = label
    try {
      return await held.run({ label, nested: [] }, fn)
    } finally {
      depth -= 1
      if (depth === 0) active = null
      release()
    }
  })()

  return result
}

// True while some path holds the lock. Used by the background index build to
// defer its start rather than queue behind a long catalog sync.
const isWriteLockBusy = () => depth > 0

const activeWriteLockLabel = () => active

// Convenience wrapper for the common shape: BEGIN, do work, COMMIT, ROLLBACK on
// failure. `run` is the caller's own promisified db.run so this module stays
// free of a dependency on the db singleton.
const withTransaction = (label, run, fn) =>
  withWriteLock(label, async () => {
    await run('BEGIN')
    try {
      const value = await fn()
      await run('COMMIT')
      return value
    } catch (err) {
      // A failed COMMIT may already have unwound the transaction, so a failing
      // ROLLBACK here is expected and must not mask the original error.
      try { await run('ROLLBACK') } catch { /* already unwound */ }
      throw err
    }
  })

module.exports = { withWriteLock, withTransaction, isWriteLockBusy, activeWriteLockLabel }
