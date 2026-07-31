import { describe, test, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const {
  isPathCommand,
  parseRegistryValue,
  getWindowsRegistryInstallDirs,
  getWellKnownInstallDirs,
  getPathDirs,
  buildSevenZipCandidates,
  canRunSevenZip,
  detectSevenZipPath,
  ensureSevenZipConfigured,
} = require('../electron/utils/sevenZipDetect')

// Real reg.exe output, right down to the blank first line and the trailing
// backslash on the directory. Parsing this shape is the whole point of the
// Windows branch, so the fixture must not be tidied up.
const REG_OUTPUT = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\7-Zip',
  '    Path    REG_SZ    C:\\Program Files\\7-Zip\\',
  '',
].join('\r\n')

const noRegistry = () => ''

describe('parseRegistryValue', () => {
  test('reads the value out of reg.exe output', () => {
    expect(parseRegistryValue(REG_OUTPUT, 'Path')).toBe('C:\\Program Files\\7-Zip\\')
  })

  test('matches the value name case-insensitively', () => {
    // reg.exe echoes back the stored casing, not the casing we queried with.
    expect(parseRegistryValue(REG_OUTPUT, 'path')).toBe('C:\\Program Files\\7-Zip\\')
  })

  test('does not confuse Path with Path64', () => {
    const output = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\7-Zip',
      '    Path64    REG_SZ    C:\\Program Files\\7-Zip\\',
      '    Path      REG_SZ    C:\\Program Files (x86)\\7-Zip\\',
    ].join('\r\n')
    expect(parseRegistryValue(output, 'Path64')).toBe('C:\\Program Files\\7-Zip\\')
    expect(parseRegistryValue(output, 'Path')).toBe('C:\\Program Files (x86)\\7-Zip\\')
  })

  test('returns empty string for missing values and empty output', () => {
    expect(parseRegistryValue(REG_OUTPUT, 'InstallLocation')).toBe('')
    expect(parseRegistryValue('', 'Path')).toBe('')
    expect(parseRegistryValue(undefined, 'Path')).toBe('')
  })

  test('handles paths containing spaces without truncating them', () => {
    // The value is returned verbatim (trailing separator included); only
    // getWindowsRegistryInstallDirs strips that separator.
    const output = '    Path    REG_SZ    D:\\My Tools\\7 Zip Portable\\'
    expect(parseRegistryValue(output, 'Path')).toBe('D:\\My Tools\\7 Zip Portable\\')
  })
})

describe('getWindowsRegistryInstallDirs', () => {
  test('returns nothing on non-Windows platforms and never spawns reg.exe', () => {
    const runRegQuery = vi.fn()
    expect(getWindowsRegistryInstallDirs({ platform: 'linux', runRegQuery })).toEqual([])
    expect(getWindowsRegistryInstallDirs({ platform: 'darwin', runRegQuery })).toEqual([])
    expect(runRegQuery).not.toHaveBeenCalled()
  })

  test('strips the trailing separator so joining does not double it', () => {
    const dirs = getWindowsRegistryInstallDirs({
      platform: 'win32',
      runRegQuery: (key, value) =>
        key === 'HKLM\\SOFTWARE\\7-Zip' && value === 'Path' ? REG_OUTPUT : '',
    })
    expect(dirs).toEqual(['C:\\Program Files\\7-Zip'])
  })

  test('a non-default install location is found via the registry', () => {
    const dirs = getWindowsRegistryInstallDirs({
      platform: 'win32',
      runRegQuery: (key, value) =>
        value === 'Path' ? '    Path    REG_SZ    D:\\Tools\\7-Zip' : '',
    })
    expect(dirs).toContain('D:\\Tools\\7-Zip')
  })

  test('a throwing reg.exe runner is survivable', () => {
    // A locked-down machine must fall through to the folder scan, not crash boot.
    expect(() =>
      getWindowsRegistryInstallDirs({
        platform: 'win32',
        runRegQuery: () => {
          throw new Error('Access is denied.')
        },
      }),
    ).not.toThrow()
  })
})

describe('getWellKnownInstallDirs', () => {
  test('Windows covers Program Files, per-user, chocolatey and scoop', () => {
    const dirs = getWellKnownInstallDirs({
      platform: 'win32',
      env: {
        ProgramW6432: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        LOCALAPPDATA: 'C:\\Users\\bob\\AppData\\Local',
        ProgramData: 'C:\\ProgramData',
        USERPROFILE: 'C:\\Users\\bob',
      },
    })
    expect(dirs).toContain('C:\\Program Files\\7-Zip')
    expect(dirs).toContain('C:\\Program Files (x86)\\7-Zip')
    expect(dirs).toContain('C:\\Users\\bob\\AppData\\Local\\Programs\\7-Zip')
    expect(dirs).toContain('C:\\ProgramData\\chocolatey\\bin')
    expect(dirs).toContain('C:\\Users\\bob\\scoop\\apps\\7zip\\current')
  })

  test('Windows still returns the literal defaults when the env is empty', () => {
    // A stripped environment (service context, odd shell) must not turn the
    // lookup into a no-op.
    const dirs = getWellKnownInstallDirs({ platform: 'win32', env: {} })
    expect(dirs).toContain('C:\\Program Files\\7-Zip')
    expect(dirs).toContain('C:\\Program Files (x86)\\7-Zip')
  })

  test('Linux covers /usr/bin, p7zip, snap and flatpak', () => {
    const dirs = getWellKnownInstallDirs({ platform: 'linux', env: { HOME: '/home/bob' } })
    expect(dirs).toContain('/usr/bin')
    expect(dirs).toContain('/usr/local/bin')
    expect(dirs).toContain('/usr/lib/p7zip')
    expect(dirs).toContain('/snap/bin')
    expect(dirs).toContain('/var/lib/flatpak/exports/bin')
    expect(dirs).toContain('/home/bob/.local/bin')
  })

  test('Linux does not emit undefined-joined paths without HOME', () => {
    const dirs = getWellKnownInstallDirs({ platform: 'linux', env: {} })
    expect(dirs.every((dir) => typeof dir === 'string' && !dir.includes('undefined'))).toBe(true)
  })

  test('macOS prefers apple-silicon homebrew first', () => {
    const dirs = getWellKnownInstallDirs({ platform: 'darwin', env: {} })
    expect(dirs[0]).toBe('/opt/homebrew/bin')
  })
})

describe('getPathDirs', () => {
  test('splits on the platform separator', () => {
    expect(getPathDirs({ platform: 'linux', env: { PATH: '/usr/bin:/opt/bin' } }))
      .toEqual(['/usr/bin', '/opt/bin'])
    expect(getPathDirs({ platform: 'win32', env: { PATH: 'C:\\bin;D:\\bin' } }))
      .toEqual(['C:\\bin', 'D:\\bin'])
  })

  test('reads the Windows `Path` casing too, and strips quotes', () => {
    expect(getPathDirs({ platform: 'win32', env: { Path: '"C:\\Program Files\\bin"' } }))
      .toEqual(['C:\\Program Files\\bin'])
  })

  test('an unset PATH yields no directories', () => {
    expect(getPathDirs({ platform: 'linux', env: {} })).toEqual([])
  })
})

describe('buildSevenZipCandidates', () => {
  test('Windows candidates prefer the registry directory over Program Files', () => {
    const candidates = buildSevenZipCandidates({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files', PATH: '' },
      runRegQuery: (key, value) =>
        value === 'Path' ? '    Path    REG_SZ    D:\\Tools\\7-Zip\\' : '',
    })
    expect(candidates[0]).toBe('D:\\Tools\\7-Zip\\7z.exe')
    expect(candidates.indexOf('D:\\Tools\\7-Zip\\7z.exe'))
      .toBeLessThan(candidates.indexOf('C:\\Program Files\\7-Zip\\7z.exe'))
  })

  test('the full 7z build is preferred over the reduced 7za we already bundle', () => {
    const candidates = buildSevenZipCandidates({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files', PATH: '' },
      runRegQuery: noRegistry,
    })
    expect(candidates.indexOf('C:\\Program Files\\7-Zip\\7z.exe'))
      .toBeLessThan(candidates.indexOf('C:\\Program Files\\7-Zip\\7za.exe'))
  })

  test('Linux candidates include 7zz and 7z under /usr/bin', () => {
    const candidates = buildSevenZipCandidates({
      platform: 'linux',
      env: { PATH: '' },
      runRegQuery: noRegistry,
    })
    expect(candidates).toContain('/usr/bin/7zz')
    expect(candidates).toContain('/usr/bin/7z')
    expect(candidates).toContain('/usr/lib/p7zip/7z')
    // No .exe suffixes leaking onto unix.
    expect(candidates.some((candidate) => candidate.endsWith('.exe'))).toBe(false)
  })

  test('Windows candidates all carry an .exe suffix', () => {
    const candidates = buildSevenZipCandidates({
      platform: 'win32',
      env: {},
      runRegQuery: noRegistry,
    })
    expect(candidates.every((candidate) => candidate.endsWith('.exe'))).toBe(true)
  })

  test('PATH directories are included but rank after known install dirs', () => {
    const candidates = buildSevenZipCandidates({
      platform: 'linux',
      env: { PATH: '/opt/custom/bin' },
      runRegQuery: noRegistry,
    })
    expect(candidates).toContain('/opt/custom/bin/7zz')
    expect(candidates.indexOf('/usr/bin/7zz'))
      .toBeLessThan(candidates.indexOf('/opt/custom/bin/7zz'))
  })

  test('duplicates are removed, case-insensitively on Windows only', () => {
    const winCandidates = buildSevenZipCandidates({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files', PATH: 'c:\\program files\\7-zip' },
      runRegQuery: noRegistry,
    })
    const winSeen = winCandidates.map((c) => c.toLowerCase())
    expect(new Set(winSeen).size).toBe(winSeen.length)

    // On unix, /opt/Bin and /opt/bin are genuinely different directories.
    const nixCandidates = buildSevenZipCandidates({
      platform: 'linux',
      env: { PATH: '/opt/bin:/opt/Bin' },
      runRegQuery: noRegistry,
    })
    expect(nixCandidates).toContain('/opt/bin/7zz')
    expect(nixCandidates).toContain('/opt/Bin/7zz')
  })

  test('every candidate is an absolute path, never a bare command name', () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
      const candidates = buildSevenZipCandidates({
        platform,
        env: { PATH: '' },
        runRegQuery: noRegistry,
      })
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.every((candidate) => !isPathCommand(candidate))).toBe(true)
    }
  })
})

describe('detectSevenZipPath', () => {
  const linuxOpts = { platform: 'linux', env: { PATH: '' }, runRegQuery: noRegistry }

  test('returns the first existing candidate', async () => {
    const detected = await detectSevenZipPath({
      ...linuxOpts,
      isExecutableFile: (candidate) => candidate === '/usr/bin/7z',
    })
    expect(detected).toBe('/usr/bin/7z')
  })

  test('returns empty string when nothing is installed', async () => {
    expect(await detectSevenZipPath({ ...linuxOpts, isExecutableFile: () => false })).toBe('')
  })

  test('with verify off, no candidate is ever executed', async () => {
    const canRun = vi.fn()
    await detectSevenZipPath({
      ...linuxOpts,
      isExecutableFile: () => true,
      canRun,
      verify: false,
    })
    expect(canRun).not.toHaveBeenCalled()
  })

  test('with verify on, a present-but-unrunnable binary is skipped', async () => {
    const detected = await detectSevenZipPath({
      ...linuxOpts,
      isExecutableFile: (candidate) => candidate === '/usr/bin/7zz' || candidate === '/usr/bin/7z',
      canRun: async (candidate) => candidate === '/usr/bin/7z',
      verify: true,
    })
    expect(detected).toBe('/usr/bin/7z')
  })

  test('a Windows registry install wins over Program Files', async () => {
    const detected = await detectSevenZipPath({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files', PATH: '' },
      runRegQuery: (key, value) =>
        value === 'Path' ? '    Path    REG_SZ    D:\\Tools\\7-Zip\\' : '',
      isExecutableFile: () => true,
    })
    expect(detected).toBe('D:\\Tools\\7-Zip\\7z.exe')
  })
})

describe('ensureSevenZipConfigured', () => {
  const linuxOpts = { platform: 'linux', env: { PATH: '' }, runRegQuery: noRegistry }
  const quietLogger = { log: () => {}, warn: () => {} }

  test('populates an empty setting on first launch', async () => {
    const writeConfig = vi.fn()
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '' } },
      writeConfig,
      isExecutableFile: (candidate) => candidate === '/usr/bin/7zz',
      logger: quietLogger,
    })
    expect(result).toMatchObject({ changed: true, path: '/usr/bin/7zz', reason: 'detected' })
    expect(writeConfig).toHaveBeenCalledWith('/usr/bin/7zz')
  })

  test('works when the config has no Library section at all', async () => {
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: {},
      writeConfig: () => {},
      isExecutableFile: (candidate) => candidate === '/usr/bin/7z',
      logger: quietLogger,
    })
    expect(result.changed).toBe(true)
  })

  test('never overwrites a path the user chose that still exists', async () => {
    const writeConfig = vi.fn()
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '/opt/mine/7zz' } },
      writeConfig,
      // Both the configured path and a system copy are present.
      isExecutableFile: () => true,
      logger: quietLogger,
    })
    expect(result).toMatchObject({ changed: false, path: '/opt/mine/7zz', reason: 'configured' })
    expect(writeConfig).not.toHaveBeenCalled()
  })

  test('a bare command name is treated as configured, not stale', async () => {
    const writeConfig = vi.fn()
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '7zz' } },
      writeConfig,
      // A bare command is resolved via PATH at spawn time, so it must not be
      // existence-checked as if it were a filesystem path.
      isExecutableFile: () => false,
      logger: quietLogger,
    })
    expect(result).toMatchObject({ changed: false, reason: 'configured' })
    expect(writeConfig).not.toHaveBeenCalled()
  })

  test('repairs a configured path whose binary was uninstalled', async () => {
    const writeConfig = vi.fn()
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '/opt/gone/7zz' } },
      writeConfig,
      isExecutableFile: (candidate) => candidate === '/usr/bin/7zz',
      logger: quietLogger,
    })
    expect(result).toMatchObject({ changed: true, path: '/usr/bin/7zz', reason: 'replaced-stale' })
    expect(writeConfig).toHaveBeenCalledWith('/usr/bin/7zz')
  })

  test('keeps a stale path when nothing else can be found', async () => {
    // An unplugged external drive must not erase the user's setting.
    const writeConfig = vi.fn()
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '/mnt/usb/7zz' } },
      writeConfig,
      isExecutableFile: () => false,
      logger: quietLogger,
    })
    expect(result).toMatchObject({ changed: false, path: '/mnt/usb/7zz', reason: 'stale-kept' })
    expect(writeConfig).not.toHaveBeenCalled()
  })

  test('reports not-found without writing when 7-Zip is absent', async () => {
    const writeConfig = vi.fn()
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '' } },
      writeConfig,
      isExecutableFile: () => false,
      logger: quietLogger,
    })
    expect(result).toMatchObject({ changed: false, reason: 'not-found' })
    expect(writeConfig).not.toHaveBeenCalled()
  })

  test('a failed config write is reported, not thrown', async () => {
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '' } },
      writeConfig: () => {
        throw new Error('EACCES')
      },
      isExecutableFile: () => true,
      logger: quietLogger,
    })
    expect(result).toMatchObject({ changed: false, reason: 'write-failed' })
  })

  test('a throwing detector is reported, not thrown — startup must not break', async () => {
    const result = await ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '' } },
      writeConfig: () => {},
      isExecutableFile: () => {
        throw new Error('boom')
      },
      logger: quietLogger,
    })
    expect(result).toMatchObject({ changed: false, reason: 'error' })
  })

  test('detecting the same path already configured is not a change', () => {
    // The configured path failing its existence check and then turning up in the
    // candidate scan (a race with a mount, say) must not rewrite config.ini.
    let seen = 0
    const writeConfig = vi.fn()
    return ensureSevenZipConfigured({
      ...linuxOpts,
      config: { Library: { sevenZipPath: '/usr/bin/7zz' } },
      writeConfig,
      isExecutableFile: (candidate) => candidate === '/usr/bin/7zz' && seen++ > 0,
      logger: quietLogger,
    }).then((result) => {
      expect(result).toMatchObject({ changed: false, reason: 'configured' })
      expect(writeConfig).not.toHaveBeenCalled()
    })
  })
})

describe('canRunSevenZip', () => {
  const fakeChild = (behaviour) => ({
    on(event, handler) {
      if (behaviour.event === event) setImmediate(() => handler(behaviour.arg))
      return this
    },
    kill() {},
  })

  test('exit code 0 means usable', async () => {
    const spawn = () => fakeChild({ event: 'close', arg: 0 })
    expect(await canRunSevenZip('/usr/bin/7zz', { spawn })).toBe(true)
  })

  test('a non-zero exit code means unusable', async () => {
    const spawn = () => fakeChild({ event: 'close', arg: 1 })
    expect(await canRunSevenZip('/usr/bin/7zz', { spawn })).toBe(false)
  })

  test('a spawn error resolves false instead of rejecting', async () => {
    const spawn = () => fakeChild({ event: 'error', arg: new Error('ENOENT') })
    await expect(canRunSevenZip('/nope/7zz', { spawn })).resolves.toBe(false)
  })

  test('a synchronous spawn throw resolves false', async () => {
    const spawn = () => {
      throw new Error('EACCES')
    }
    await expect(canRunSevenZip('/nope/7zz', { spawn })).resolves.toBe(false)
  })

  test('a hung child is killed and reported unusable', async () => {
    let killed = false
    const spawn = () => ({
      on() {
        return this
      },
      kill() {
        killed = true
      },
    })
    expect(await canRunSevenZip('/usr/bin/7zz', { spawn, timeoutMs: 5 })).toBe(false)
    expect(killed).toBe(true)
  })

  test('it asks for the info listing, which needs no archive and no write access', async () => {
    const spawn = vi.fn(() => fakeChild({ event: 'close', arg: 0 }))
    await canRunSevenZip('/usr/bin/7zz', { spawn })
    expect(spawn).toHaveBeenCalledWith('/usr/bin/7zz', ['i'], expect.objectContaining({
      windowsHide: true,
    }))
  })
})

// Source-level contracts: these guard the wiring, which unit tests on the module
// alone cannot see. If the startup call is deleted, the setting silently stops
// being populated and nothing else fails.
describe('wiring', () => {
  const read = (relativePath) =>
    fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')

  test('main.js runs the lookup during startup', () => {
    const main = read('electron/main.js')
    expect(main).toContain("require('./utils/sevenZipDetect')")
    expect(main).toContain('ensureSevenZipConfigured({')
    // Must be inside app.whenReady, after the config file has been loaded.
    expect(main.indexOf('app.whenReady()')).toBeLessThan(main.indexOf('ensureSevenZipConfigured({'))
  })

  test('the importer shares one candidate list with the detector', () => {
    const importer = read('electron/ipc/importer.js')
    expect(importer).toContain("require('../utils/sevenZipDetect')")
    expect(importer).toContain('buildSevenZipCandidates()')
    // The old hardcoded Program Files list must not creep back in.
    const body = importer.slice(
      importer.indexOf('function getCommonSevenZipPaths'),
      importer.indexOf('function saveSevenZipPath'),
    )
    expect(body).not.toContain('Program Files')
  })

  test('the renderer can trigger a manual re-detect', () => {
    expect(read('electron/preload.js')).toContain('detect-seven-zip')
    expect(read('electron/ipc/settings.js')).toContain("ipcMain.handle('detect-seven-zip'")
    expect(read('src/components/settings/Library.jsx')).toContain('detectSevenZip')
  })
})
