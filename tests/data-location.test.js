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

// A path that cannot be created on ANY platform: a directory underneath a
// regular file. The earlier version used a read-only mount path that only
// exists in one particular sandbox, so on Windows mkdirSync happily created
// C:\\mnt\\skills\\... and the test reported the folder as writable.
const unwritablePath = () => {
  const file = path.join(tmp(), 'not-a-directory')
  fs.writeFileSync(file, 'x')
  return path.join(file, 'data')
}

test('an unwritable directory reports a reason instead of throwing', () => {
  const result = dl.probeWritable(unwritablePath())
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

  const result = await dl.migrateLegacyData(from, unwritablePath())
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

// ── Platform-specific data root ─────────────────────────────────────────────
// On Arch (pacman) the install tree is /opt/Atlas, owned by root, and startup
// died with EACCES on mkdir '/opt/Atlas/data'. The reason is packaging, not
// permissions: /opt is for static application files and a package upgrade may
// replace the whole tree, while an AppImage runs from a read-only squashfs
// mounted at a different random path each launch.

const withPlatform = (value, fn) => {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value, configurable: true })
  try { return fn() } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  }
}

test('Linux keeps data in the per-user directory, never the install tree', () => {
  const home = tmp()
  const result = withPlatform('linux', () =>
    dl.resolveDataRoot({ installDir: '/opt/Atlas', isDev: false, userDataDir: home }),
  )
  expect(result.root).toBe(home)
  expect(result.root).not.toBe('/opt/Atlas')
  expect(result.writable).toBe(true)
  // Nothing to elevate for: the directory is already the user's own.
  expect(result.repairable).toBe(false)
})

test('Windows keeps data beside the executable', () => {
  const installDir = tmp()
  const result = withPlatform('win32', () =>
    dl.resolveDataRoot({ installDir, isDev: false, userDataDir: tmp() }),
  )
  expect(result.root).toBe(installDir)
  // Windows has an installer-granted ACL that a one-shot elevation can repair.
  expect(result.repairable).toBe(true)
})

test('explicit portable mode wins on Linux when the location is writable', () => {
  const installDir = tmp()
  const result = withPlatform('linux', () =>
    dl.resolveDataRoot({ installDir, isDev: false, userDataDir: tmp(), portable: true }),
  )
  expect(result.root).toBe(installDir)
  expect(result.portable).toBe(true)
})

// A packaged Linux install is exactly this case: portable.txt cannot help when
// /opt is root-owned, so it must fall through rather than fail.
test('portable mode falls back when the install tree is not writable', () => {
  const home = tmp()
  const unwritable = unwritablePath()
  const result = withPlatform('linux', () =>
    dl.resolveDataRoot({ installDir: unwritable, isDev: false, userDataDir: home, portable: true }),
  )
  expect(result.root).toBe(home)
  expect(result.portable).toBe(false)
})

test('a dev run uses the project directory', () => {
  const result = dl.resolveDataRoot({ installDir: '/src/atlas', isDev: true })
  expect(result.root).toBe('/src/atlas')
  expect(result.writable).toBe(true)
})
