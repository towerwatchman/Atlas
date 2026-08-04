// Contract for the save-preservation restore step inside
// replaceInstalledVersionAfterImport.
//
// Regression origin: `saveBackup` was declared with `let` INSIDE the
// `if (hadOldFiles) { ... }` block, but read further down after that block had
// already closed. Reading an undeclared identifier throws, so every call to
// replaceInstalledVersionAfterImport that cleared the early-return guards died
// with `ReferenceError: saveBackup is not defined` -- on BOTH branches, because
// the read sits after the block regardless of whether old files existed.
//
// The user-visible damage was worse than a crash: backupSaveArtifacts ran and
// succeeded first, so player saves were copied into a backup directory and then
// silently never restored into the new game folder.
//
// These tests call the real function with no mocks. It stays off the database
// entirely as long as we pass oldVersionSnapshot (skips the version lookup),
// trustedOldPath (skips isAllowedDeletionPath), and deleteDatabaseRow: false.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

const { __testables: T } = require('../electron/ipc/importer')
const { replaceInstalledVersionAfterImport } = T

let tmpRoot

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-save-restore-'))
})

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // Best effort cleanup.
  }
})

// Base args that keep the function away from sqlite and away from the
// `(1)` folder-rename branch (which would issue DB reads/writes).
const baseArgs = (overrides = {}) => ({
  recordId: 4242,
  newVersion: '2.0',
  replaceVersion: '1.0',
  replaceVersionId: null,
  trustedOldPath: true,
  deleteDatabaseRow: false,
  libraryRoot: tmpRoot,
  auditDataDir: tmpRoot,
  sender: null,
  ...overrides,
})

describe('replaceInstalledVersionAfterImport - saveBackup scope regression', () => {
  it('is exported for testing', () => {
    expect(typeof replaceInstalledVersionAfterImport).toBe('function')
  })

  it('does not throw when the old version folder is missing (hadOldFiles = false)', async () => {
    // The restore step sits AFTER the `if (hadOldFiles)` block, so this branch
    // reached the bad read too. This is the tightest possible repro: no
    // filesystem deletion, no save files, nothing but the scope error.
    const oldPath = path.join(tmpRoot, 'GameV1-does-not-exist')
    const newPath = path.join(tmpRoot, 'GameV2')
    fs.mkdirSync(newPath, { recursive: true })

    const result = await replaceInstalledVersionAfterImport(
      baseArgs({
        newGamePath: newPath,
        oldVersionSnapshot: { version_id: 1, version: '1.0', game_path: oldPath, exec_path: '' },
      }),
    )

    expect(result.replaced).toBe(true)
    expect(result.deletedFiles).toBe(false)
  })

  it('does not throw when the old version folder exists but holds no saves', async () => {
    const oldPath = path.join(tmpRoot, 'GameV1')
    const newPath = path.join(tmpRoot, 'GameV2')
    fs.mkdirSync(oldPath, { recursive: true })
    fs.writeFileSync(path.join(oldPath, 'game.exe'), 'binary')
    fs.mkdirSync(newPath, { recursive: true })

    const result = await replaceInstalledVersionAfterImport(
      baseArgs({
        newGamePath: newPath,
        oldVersionSnapshot: { version_id: 1, version: '1.0', game_path: oldPath, exec_path: '' },
      }),
    )

    expect(result.replaced).toBe(true)
    // Old folder should have been removed.
    expect(fs.existsSync(oldPath)).toBe(false)
  })

  it('restores save files from the old version into the new version folder', async () => {
    // The behaviour the ReferenceError was silently destroying.
    const oldPath = path.join(tmpRoot, 'GameV1')
    const newPath = path.join(tmpRoot, 'GameV2')

    // `save/` is a recognised save folder; `.sav` is a recognised extension.
    fs.mkdirSync(path.join(oldPath, 'save'), { recursive: true })
    fs.writeFileSync(path.join(oldPath, 'save', 'file1.sav'), 'SAVE-SLOT-1')
    fs.writeFileSync(path.join(oldPath, 'save', 'file2.sav'), 'SAVE-SLOT-2')
    fs.writeFileSync(path.join(oldPath, 'game.exe'), 'binary')

    fs.mkdirSync(newPath, { recursive: true })
    fs.writeFileSync(path.join(newPath, 'game.exe'), 'binary-v2')

    const result = await replaceInstalledVersionAfterImport(
      baseArgs({
        newGamePath: newPath,
        oldVersionSnapshot: { version_id: 1, version: '1.0', game_path: oldPath, exec_path: '' },
      }),
    )

    expect(result.replaced).toBe(true)

    // The saves must now exist in the NEW folder, with content intact.
    const restored1 = path.join(newPath, 'save', 'file1.sav')
    const restored2 = path.join(newPath, 'save', 'file2.sav')
    expect(fs.existsSync(restored1)).toBe(true)
    expect(fs.existsSync(restored2)).toBe(true)
    expect(fs.readFileSync(restored1, 'utf8')).toBe('SAVE-SLOT-1')
    expect(fs.readFileSync(restored2, 'utf8')).toBe('SAVE-SLOT-2')

    // The new version's own files must be left alone.
    expect(fs.readFileSync(path.join(newPath, 'game.exe'), 'utf8')).toBe('binary-v2')
  })

  it('writes a save-restore-result entry to the replacement audit log', async () => {
    // The audit trail is how this is diagnosed in the field; if the restore
    // step throws before logging, there is no evidence it was even attempted.
    const oldPath = path.join(tmpRoot, 'GameV1')
    const newPath = path.join(tmpRoot, 'GameV2')
    fs.mkdirSync(path.join(oldPath, 'save'), { recursive: true })
    fs.writeFileSync(path.join(oldPath, 'save', 'persistent.sav'), 'DATA')
    fs.mkdirSync(newPath, { recursive: true })

    await replaceInstalledVersionAfterImport(
      baseArgs({
        newGamePath: newPath,
        oldVersionSnapshot: { version_id: 1, version: '1.0', game_path: oldPath, exec_path: '' },
      }),
    )

    const auditPath = path.join(tmpRoot, 'replacement-audit.jsonl')
    expect(fs.existsSync(auditPath)).toBe(true)
    const stages = fs
      .readFileSync(auditPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).stage)

    expect(stages).toContain('save-backup-result')
    expect(stages).toContain('save-restore-result')
    expect(stages).toContain('complete')
  })
})
