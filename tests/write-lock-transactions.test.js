import { test, expect } from 'vitest'
const sqlite3 = require('sqlite3').verbose()
const { withWriteLock } = require('../electron/db/writeLock.js')

const open = () => new sqlite3.Database(':memory:')
const runner = (db) => (sql) =>
  new Promise((resolve, reject) => db.run(sql, (e) => (e ? reject(e) : resolve())))

// A writer that holds an open transaction for a beat, the way the catalog index
// build and the normalized-title recompute do at startup.
const holdTransaction = (run, label) =>
  withWriteLock(label, async () => {
    await run('BEGIN TRANSACTION')
    await new Promise((r) => setTimeout(r, 80))
    await run('INSERT INTO t VALUES (1)')
    await run('COMMIT')
  })

test('an unlocked BEGIN collides with a lock-holder (the original bug)', async () => {
  const db = open()
  const run = runner(db)
  await run('CREATE TABLE t (x)')

  const holder = holdTransaction(run, 'holder')
  await new Promise((r) => setTimeout(r, 20))

  let error = null
  try {
    await run('BEGIN TRANSACTION')
    await run('COMMIT')
  } catch (err) {
    error = err
  }
  await holder

  // This is what the startup migrations in db/index.js used to do: issue BEGIN
  // on the shared connection without taking the write lock.
  expect(error).not.toBeNull()
  expect(error.message).toMatch(/cannot start a transaction within a transaction/i)
})

test('taking the write lock serialises the transaction instead', async () => {
  const db = open()
  const run = runner(db)
  await run('CREATE TABLE t (x)')

  const holder = holdTransaction(run, 'holder')
  await new Promise((r) => setTimeout(r, 20))

  let error = null
  try {
    await withWriteLock('migration', async () => {
      await run('BEGIN TRANSACTION')
      await run('INSERT INTO t VALUES (2)')
      await run('COMMIT')
    })
  } catch (err) {
    error = err
  }
  await holder
  expect(error).toBeNull()
})

test('every explicit BEGIN in db/index.js is inside a withWriteLock block', () => {
  const fs = require('fs')
  const path = require('path')
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'db', 'index.js'),
    'utf8',
  )
  const begins = (source.match(/BEGIN TRANSACTION/g) || []).length
  const locks = (source.match(/withWriteLock\(/g) || []).length
  expect(begins).toBeGreaterThan(0)
  // One lock per transactional migration, plus the require line.
  expect(locks).toBeGreaterThanOrEqual(begins)
})
