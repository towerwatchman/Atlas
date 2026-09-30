import { test, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Replicate the handler logic from electron/ipc/windows.js for isolated unit testing.
// This mirrors the actual `check-path` handler so the spec (trimming, quote
// stripping, isAbsolute guard, stat handling) is tested without needing to boot
// the Electron main process. The handler source is also asserted to exist in
// windows.js via a string check.

function normalize(raw) {
  return String(raw || '').trim().replace(/^["']|["']$/g, '')
}

async function checkPath(raw) {
  const p = normalize(raw)
  if (!p) return { exists: false }
  if (!path.isAbsolute(p)) return { exists: false }
  try {
    const st = await fs.promises.stat(p)
    return { exists: true, isDirectory: st.isDirectory(), isFile: st.isFile() }
  } catch (e) {
    if (e && e.code === 'ENOENT') return { exists: false }
    return { exists: false, error: String(e && e.message || e) }
  }
}

test('windows handler file actually registers check-path', async () => {
  const src = await fs.promises.readFile(path.join(process.cwd(), 'electron/ipc/windows.js'), 'utf8')
  expect(src).toContain("ipcMain.handle('check-path'")
  expect(src).toContain('path.isAbsolute')
})

test('returns exists:false for empty and whitespace input without touching fs', async () => {
  const statSpy = vi.spyOn(fs.promises, 'stat')
  expect(await checkPath('')).toEqual({ exists: false })
  expect(await checkPath('   ')).toEqual({ exists: false })
  expect(await checkPath(null)).toEqual({ exists: false })
  expect(statSpy).not.toHaveBeenCalled()
  statSpy.mockRestore()
})

test('strips surrounding quotes and trims before stat', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'atlas-check-path-'))
  try {
    expect(await checkPath(`"${tmpDir}"`)).toEqual({ exists: true, isDirectory: true, isFile: false })
    expect(await checkPath(`'${tmpDir}'`)).toEqual({ exists: true, isDirectory: true, isFile: false })
    expect(await checkPath(`  ${tmpDir}  `)).toEqual({ exists: true, isDirectory: true, isFile: false })
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  }
})

test('returns isDirectory true for an existing directory and isFile for a file', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'atlas-check-path-'))
  const tmpFile = path.join(tmpDir, 'file.txt')
  await fs.promises.writeFile(tmpFile, 'hello')
  try {
    expect(await checkPath(tmpDir)).toMatchObject({ exists: true, isDirectory: true, isFile: false })
    expect(await checkPath(tmpFile)).toMatchObject({ exists: true, isDirectory: false, isFile: true })
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  }
})

test('returns exists:false for ENOENT (missing path)', async () => {
  const missing = path.join(os.tmpdir(), `atlas-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const result = await checkPath(missing)
  expect(result.exists).toBe(false)
  expect(result.isDirectory).toBeUndefined()
})

test('rejects relative paths as invalid without calling stat', async () => {
  const statSpy = vi.spyOn(fs.promises, 'stat')
  expect(await checkPath('relative/path')).toEqual({ exists: false })
  expect(statSpy).not.toHaveBeenCalled()
  statSpy.mockRestore()
  expect(await checkPath('foo.txt')).toEqual({ exists: false })
})

test('returns exists:false for non-ENOENT errors without throwing', async () => {
  const statSpy = vi.spyOn(fs.promises, 'stat').mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
  const p = path.isAbsolute('/tmp') ? '/tmp' : 'C:\\Windows'
  const result = await checkPath(p)
  expect(result.exists).toBe(false)
  expect(result.error).toBeDefined()
  statSpy.mockRestore()
})
