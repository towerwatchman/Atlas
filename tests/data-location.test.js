import { test, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
const dl = require('../electron/dataLocation.js')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-dl-'))

test('a writable directory probes as writable', () => {
  const dir = path.join(tmp(), 'data')
  expect(dl.probeWritable(dir).writable).toBe(true)
})

// The regression that silently demoted users to AppData: antivirus holds the
// freshly written probe file open, unlink throws, and the old code treated that
// as "not writable" despite the write having succeeded.
test('a blocked cleanup does not count as unwritable', () => {
  const dir = tmp()
  const real = fs.unlinkSync
  fs.unlinkSync = () => {
    throw Object.assign(new Error('EPERM: locked by scanner'), { code: 'EPERM' })
  }
  try {
    expect(dl.probeWritable(dir).writable).toBe(true)
  } finally {
    fs.unlinkSync = real
  }
})

test('a stale probe file from a previous crash is overwritten', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, dl.PROBE_FILENAME), 'stale')
  expect(dl.probeWritable(dir).writable).toBe(true)
})

test('an unwritable directory reports a reason instead of throwing', () => {
  const result = dl.probeWritable('/mnt/skills/public/atlas-should-not-exist')
  expect(result.writable).toBe(false)
  expect(typeof result.error).toBe('string')
  expect(result.error.length).toBeGreaterThan(0)
})

test('migration copies, verifies, then removes the source', async () => {
  const base = tmp()
  const from = path.join(base, 'appdata', 'data')
  const to = path.join(base, 'install', 'data')
  fs.mkdirSync(path.join(from, 'images'), { recursive: true })
  fs.writeFileSync(path.join(from, 'atlas.db'), 'DB')
  fs.writeFileSync(path.join(from, 'images', 'a.png'), 'A')

  const result = await dl.migrateLegacyData(from, to)
  expect(result.success).toBe(true)
  expect(result.files).toBe(2)
  expect(fs.existsSync(from)).toBe(false)
  expect(fs.readFileSync(path.join(to, 'atlas.db'), 'utf8')).toBe('DB')
  expect(fs.existsSync(path.join(to, 'images', 'a.png'))).toBe(true)
})

test('migration never clobbers a file already in the destination', async () => {
  const base = tmp()
  const from = path.join(base, 'from')
  const to = path.join(base, 'to')
  fs.mkdirSync(from, { recursive: true })
  fs.mkdirSync(to, { recursive: true })
  fs.writeFileSync(path.join(from, 'config.ini'), 'OLD')
  fs.writeFileSync(path.join(to, 'config.ini'), 'CURRENT')

  await dl.migrateLegacyData(from, to)
  expect(fs.readFileSync(path.join(to, 'config.ini'), 'utf8')).toBe('CURRENT')
})

test('a failed copy leaves the source intact', async () => {
  const base = tmp()
  const from = path.join(base, 'from')
  fs.mkdirSync(from, { recursive: true })
  fs.writeFileSync(path.join(from, 'atlas.db'), 'DB')

  const result = await dl.migrateLegacyData(from, '/mnt/skills/public/nope/data')
  expect(result.success).toBe(false)
  expect(result.sourceKept).toBe(true)
  expect(fs.existsSync(path.join(from, 'atlas.db'))).toBe(true)
})

test('an empty source is reported rather than treated as a move', async () => {
  const base = tmp()
  const from = path.join(base, 'empty')
  fs.mkdirSync(from, { recursive: true })
  const result = await dl.migrateLegacyData(from, path.join(base, 'to'))
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/nothing to migrate/i)
})
