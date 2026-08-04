'use strict'

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const {
  detectSaveArtifacts,
  backupSaveArtifacts,
  restoreSaveArtifacts,
} = require('../electron/utils/savePreservation')

describe('Save Preservation System', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-save-test-'))
  })

  afterEach(async () => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('detects RPG Maker MV/MZ save files in www/save/', async () => {
    const gameDir = path.join(tmpDir, 'rpgm-mv-game')
    const saveDir = path.join(gameDir, 'www', 'save')
    await fsp.mkdir(saveDir, { recursive: true })
    await fsp.writeFile(path.join(saveDir, 'file1.rpgsave'), 'save-data-1')
    await fsp.writeFile(path.join(saveDir, 'config.rpgsave'), 'config-data')

    const detected = await detectSaveArtifacts(gameDir)
    expect(detected).toContain(path.join('www', 'save'))
    expect(detected).toContain(path.join('www', 'save', 'file1.rpgsave'))
    expect(detected).toContain(path.join('www', 'save', 'config.rpgsave'))
  })

  it('detects RPG Maker VX Ace root save files (*.rvdata2)', async () => {
    const gameDir = path.join(tmpDir, 'rpgm-vx-game')
    await fsp.mkdir(gameDir, { recursive: true })
    await fsp.writeFile(path.join(gameDir, 'Save01.rvdata2'), 'save-data-vx')
    await fsp.writeFile(path.join(gameDir, 'System.rvdata2'), 'system-data-vx')

    const detected = await detectSaveArtifacts(gameDir)
    expect(detected).toContain('Save01.rvdata2')
    expect(detected).toContain('System.rvdata2')
  })

  it('backs up and restores save artifacts successfully', async () => {
    const oldGameDir = path.join(tmpDir, 'OldGame')
    const newGameDir = path.join(tmpDir, 'NewGame')
    const saveDir = path.join(oldGameDir, 'save')

    await fsp.mkdir(saveDir, { recursive: true })
    await fsp.mkdir(newGameDir, { recursive: true })
    await fsp.writeFile(path.join(saveDir, 'Save01.rvdata2'), 'my-progress')

    const backup = await backupSaveArtifacts({
      oldGamePath: oldGameDir,
      recordId: 'game-123',
      appDataDir: tmpDir,
    })

    expect(backup.success).toBe(true)
    expect(backup.artifacts.length).toBeGreaterThan(0)

    const restore = await restoreSaveArtifacts({
      backupManifest: backup,
      newGamePath: newGameDir,
    })

    expect(restore.restored).toBe(true)
    expect(restore.count).toBe(1)
    expect(fs.existsSync(path.join(newGameDir, 'save', 'Save01.rvdata2'))).toBe(true)

    const restoredContent = await fsp.readFile(
      path.join(newGameDir, 'save', 'Save01.rvdata2'),
      'utf8'
    )
    expect(restoredContent).toBe('my-progress')
  })

  it('adapts www/save path when new game folder lacks www directory', async () => {
    const oldGameDir = path.join(tmpDir, 'OldGameWww')
    const newGameDir = path.join(tmpDir, 'NewGameNoWww')
    const oldSaveDir = path.join(oldGameDir, 'www', 'save')

    await fsp.mkdir(oldSaveDir, { recursive: true })
    await fsp.mkdir(newGameDir, { recursive: true })
    await fsp.writeFile(path.join(oldSaveDir, 'file1.rpgsave'), 'save-content')

    const backup = await backupSaveArtifacts({
      oldGamePath: oldGameDir,
      recordId: 'game-456',
      appDataDir: tmpDir,
    })

    const restore = await restoreSaveArtifacts({
      backupManifest: backup,
      newGamePath: newGameDir,
    })

    expect(restore.restored).toBe(true)
    // Should adapt www/save/file1.rpgsave -> save/file1.rpgsave because newGameDir has no www folder
    expect(fs.existsSync(path.join(newGameDir, 'save', 'file1.rpgsave'))).toBe(true)
  })
})
