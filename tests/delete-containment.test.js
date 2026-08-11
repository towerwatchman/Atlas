import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// deleteUtils pulls in electron only for the elevation dialog.
let promptResponse = 1 // 1 = Skip
let promptCount = 0
vi.mock('electron', () => ({
  dialog: {
    showMessageBox: async () => {
      promptCount += 1
      return { response: promptResponse }
    },
  },
}))

const {
  deletePathWithElevationFallback,
  assertDeletionContainment,
  isStrictlyInside,
  isPathInside,
  isFilesystemRoot,
  STAGING_PREFIX,
} = require('../electron/deleteUtils')

// ── Deletion containment ─────────────────────────────────────────────────────
//
// Regression suite for the import that deleted a user's entire game archive.
// Three defects had to line up, and each is pinned here:
//
//   1. The scanner can record the LIBRARY ROOT as a game folder (loose
//      launchables at the top of the scanned directory make the scan root its
//      own scan target). So a delete target of "the library root" is reachable
//      from ordinary data, not just from a corrupted database.
//
//   2. isPathInside() returns true for a path compared against itself, because
//      path.relative() gives '' there. Every "is this inside my library"
//      deletion gate therefore said yes to the library itself.
//
//   3. The delete primitive ran fs.rm(recursive, force) FIRST and showed the
//      "administrator approval required" dialog from the catch block. Node's
//      recursive rm removes children in parallel and only rejects for the
//      entries it could not touch, so the tree was already gone by the time the
//      user was asked. Clicking Skip protected nothing.
//
// Test 'destroys nothing when it cannot complete' is the one that matters: it
// fails loudly against the old implementation.

let base
let library

const seed = (root) => {
  fs.rmSync(root, { recursive: true, force: true })
  for (const name of ['GameA', 'GameB', 'GameC']) {
    fs.mkdirSync(path.join(root, name), { recursive: true })
    fs.writeFileSync(path.join(root, name, 'data.bin'), 'x'.repeat(64))
  }
  return root
}

beforeEach(() => {
  promptCount = 0
  promptResponse = 1
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-delete-'))
  library = seed(path.join(base, 'Archive'))
})

afterEach(() => {
  try {
    fs.chmodSync(library, 0o755)
  } catch {}
  fs.rmSync(base, { recursive: true, force: true })
})

describe('path predicates', () => {
  it('isPathInside accepts the parent itself', () => {
    expect(isPathInside(library, library)).toBe(true)
  })

  it('isStrictlyInside rejects the parent itself', () => {
    expect(isStrictlyInside(library, library)).toBe(false)
    expect(isStrictlyInside(library, path.join(library, 'GameA'))).toBe(true)
    expect(isStrictlyInside(library, path.join(base, 'Elsewhere'))).toBe(false)
  })

  it('recognises filesystem roots', () => {
    expect(isFilesystemRoot(path.parse(process.cwd()).root)).toBe(true)
    expect(isFilesystemRoot(library)).toBe(false)
  })
})

describe('assertDeletionContainment', () => {
  it('rejects the containment root itself', () => {
    expect(() => assertDeletionContainment(library, library)).toThrow(/containment root itself/i)
  })

  it('rejects a missing root rather than falling through permissively', () => {
    expect(() => assertDeletionContainment(path.join(library, 'GameA'), null)).toThrow(
      /no containment root/i,
    )
    expect(() => assertDeletionContainment(path.join(library, 'GameA'), [])).toThrow(
      /no containment root/i,
    )
  })

  it('rejects a target outside every root', () => {
    expect(() => assertDeletionContainment(path.join(base, 'Other'), library)).toThrow(
      /outside every allowed root/i,
    )
  })

  it('accepts a target below any one of several roots', () => {
    const other = path.join(base, 'Downloads')
    expect(() => assertDeletionContainment(path.join(other, 'x'), [library, other])).not.toThrow()
  })
})

describe('deletePathWithElevationFallback', () => {
  it('refuses to delete the library root', async () => {
    await expect(
      deletePathWithElevationFallback(library, { containmentRoot: library }),
    ).rejects.toThrow(/containment root itself/i)
    expect(fs.existsSync(path.join(library, 'GameA', 'data.bin'))).toBe(true)
  })

  it('refuses when the caller names no containment root', async () => {
    await expect(
      deletePathWithElevationFallback(path.join(library, 'GameA'), {}),
    ).rejects.toThrow(/no containment root/i)
    expect(fs.existsSync(path.join(library, 'GameA'))).toBe(true)
  })

  it('refuses a filesystem root even when unconfined', async () => {
    await expect(
      deletePathWithElevationFallback(path.parse(process.cwd()).root, {
        allowUnconfinedDelete: true,
      }),
    ).rejects.toThrow(/filesystem root/i)
  })

  it('deletes a contained folder and leaves no staging directory behind', async () => {
    const result = await deletePathWithElevationFallback(path.join(library, 'GameA'), {
      containmentRoot: library,
    })
    expect(result.success).toBe(true)
    expect(fs.existsSync(path.join(library, 'GameA'))).toBe(false)
    expect(fs.existsSync(path.join(library, 'GameB', 'data.bin'))).toBe(true)
    expect(fs.readdirSync(library).some((e) => e.startsWith(STAGING_PREFIX))).toBe(false)
  })

  it('treats a missing target as done', async () => {
    const result = await deletePathWithElevationFallback(path.join(library, 'Nope'), {
      containmentRoot: library,
    })
    expect(result.success).toBe(true)
    expect(result.missing).toBe(true)
  })

  it('runs validatePath before touching anything', async () => {
    await expect(
      deletePathWithElevationFallback(path.join(library, 'GameA'), {
        containmentRoot: library,
        validatePath: () => {
          throw new Error('nope')
        },
      }),
    ).rejects.toThrow('nope')
    expect(fs.existsSync(path.join(library, 'GameA', 'data.bin'))).toBe(true)
  })

  // ── The one that reproduces the incident ───────────────────────────────────
  it('destroys nothing when it cannot complete', async () => {
    if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) return

    const victim = seed(path.join(library, 'Victim'))
    fs.chmodSync(library, 0o555) // parent unwritable: the staging rename fails

    let failed = false
    try {
      const res = await deletePathWithElevationFallback(victim, { containmentRoot: library })
      failed = res.success === false
    } catch {
      failed = true
    }
    fs.chmodSync(library, 0o755)

    expect(failed).toBe(true)
    // Under the previous implementation these were already gone: fs.rm had run
    // to completion on every child it could reach before anyone was asked.
    expect(fs.existsSync(path.join(victim, 'GameA', 'data.bin'))).toBe(true)
    expect(fs.existsSync(path.join(victim, 'GameB', 'data.bin'))).toBe(true)
    expect(fs.existsSync(path.join(victim, 'GameC', 'data.bin'))).toBe(true)
  })
})
