import { describe, test, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { listInstalledBrowsers } = require('../electron/utils/browserDetect')

// PATH is walked in order and each candidate must be an executable file: a
// present-but-not-executable entry must not list, and relative entries are
// skipped (never probed against the app's cwd). The mock models the
// isExecutableFile contract (real helper: stat isFile plus the X_OK bit,
// so directories never qualify on any platform).
const linuxFs = (executables) => ({
  isExecutableFile: (p) => executables.has(p),
})

// Verbatim excerpt of the 2026-10-09 box (HKCU view). The hash suffixes are
// the point. Mapping must ignore the key name. Do not tidy this fixture.
const REG_HKCU = [
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.64XATULHQ53463XA5N4NLLZX3E',
  '    (Default)    REG_SZ    Brave',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.64XATULHQ53463XA5N4NLLZX3E\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Users\\phand\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"',
  '',
].join('\r\n')

describe('listInstalledBrowsers (win32)', () => {
  test('maps hash-suffixed keys via exe basename, never key-name equality', () => {
    const browsers = listInstalledBrowsers({
      platform: 'win32',
      runRegQuery: () => REG_HKCU,
      isExecutableFile: () => true,
    })
    expect(browsers.map((b) => b.id)).toContain('brave')
  })
})

test('macOS lists the installed subset only (injected fs)', () => {
  const browsers = listInstalledBrowsers({
    platform: 'darwin',
    fs: {
      existsSync: (p) => p === '/Applications/Google Chrome.app',
    },
    runCommand: () => '',
  })
  expect(browsers.map((b) => b.id)).toEqual(['chrome'])
})

// BrowserTamer registers a real StartMenuInternet entry but is not a known
// browser: it must list under an id derived from its own exe basename.
const REG_BROWSERTAMER = [
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\BrowserTamer',
  '    (Default)    REG_SZ    BrowserTamer',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\BrowserTamer\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Tools\\bt.exe"',
  '',
].join('\r\n')

test('unknown entries with a valid exe list under a derived id', () => {
  const browsers = listInstalledBrowsers({
    platform: 'win32',
    runRegQuery: () => REG_BROWSERTAMER,
    isExecutableFile: (p) => p === 'C:\\Tools\\bt.exe',
  })
  expect(browsers).toEqual([{ id: 'bt', name: 'bt' }])
})

test('locked-down reg.exe returns [], never throws', () => {
  expect(listInstalledBrowsers({
    platform: 'win32',
    runRegQuery: () => { throw new Error('Access is denied.') },
  })).toEqual([])
})

test('linux with an empty PATH lists nothing, never throws', () => {
  expect(listInstalledBrowsers({
    platform: 'linux',
    env: { PATH: '' },
    ...linuxFs(new Set()),
  })).toEqual([])
})

test('relative PATH entries are skipped, never probed against cwd', () => {
  expect(listInstalledBrowsers({
    platform: 'linux',
    env: { PATH: '.:/usr/bin' },
    ...linuxFs(new Set(['./firefox'])),
  })).toEqual([])
})

test('dedupes duplicate live entries by stable id', () => {
  // Old-hash and new-hash keys pointing at the same brave.exe: different
  // subkey names, one exe, one brave in the list.
  const twoHashes = REG_HKCU.replace(/64XATULHQ53463XA5N4NLLZX3E/g, 'OLDHASH') +
    REG_HKCU.replace(/64XATULHQ53463XA5N4NLLZX3E/g, 'NEWHASH')
  const browsers = listInstalledBrowsers({
    platform: 'win32',
    runRegQuery: () => twoHashes,
    isExecutableFile: () => true,
  })
  expect(browsers.filter((b) => b.id === 'brave')).toHaveLength(1)
})

test('stale keys whose exe is gone are hidden, stored id untouched', () => {
  const browsers = listInstalledBrowsers({
    platform: 'win32',
    runRegQuery: () => REG_HKCU,
    isExecutableFile: () => false,
  })
  expect(browsers).toEqual([])
})

test('lists alphabetically by display name (macOS fixture)', () => {
  const browsers = listInstalledBrowsers({
    platform: 'darwin',
    fs: {
      existsSync: (p) => [
        '/Applications/Google Chrome.app',
        '/Applications/Brave Browser.app',
        '/Applications/Zen.app',
      ].includes(p),
    },
    runCommand: () => '',
  })
  expect(browsers.map((b) => b.id)).toEqual(['brave', 'chrome', 'zen'])
})

// Registry order is Vivaldi-first; the dropdown contract is alphabetical,
// so the source must sort rather than rely on key order.
const REG_VIVALDI_THEN_BRAVE = [
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Vivaldi.64XAAA',
  '    (Default)    REG_SZ    Vivaldi',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Vivaldi.64XAAA\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Users\\t\\AppData\\Local\\Vivaldi\\Application\\vivaldi.exe"',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.64XBBB',
  '    (Default)    REG_SZ    Brave',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.64XBBB\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Users\\t\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"',
  '',
].join('\r\n')

test('lists alphabetically by display name (Windows fixture)', () => {
  const browsers = listInstalledBrowsers({
    platform: 'win32',
    runRegQuery: () => REG_VIVALDI_THEN_BRAVE,
    isExecutableFile: () => true,
  })
  expect(browsers.map((b) => b.id)).toEqual(['brave', 'vivaldi'])
})

// Same subkey name in both hives: a stale HKLM entry must not mask the valid
// HKCU install. Entries are keyed by full registry path, so each hive parses
// separately and the stable-id dedupe downstream keeps one brave.
const REG_SAME_SUBKEY_TWO_HIVES = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.OLDHASH\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Stale\\brave.exe"',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\Brave.OLDHASH\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Valid\\brave.exe"',
  '',
].join('\r\n')

test('same subkey name in HKLM/HKCU parses per hive (stale HKLM never masks HKCU)', () => {
  const browsers = listInstalledBrowsers({
    platform: 'win32',
    runRegQuery: () => REG_SAME_SUBKEY_TWO_HIVES,
    isExecutableFile: (p) => p === 'C:\\Valid\\brave.exe',
  })
  expect(browsers.map((b) => b.id)).toEqual(['brave'])
})

// 'Research Center' contains the substring 'arc' but is not Arc. The
// display-name hint fallback must match whole words, not substrings.
const REG_SUBSTRING_HINT = [
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\ContosoSearch',
  '    (Default)    REG_SZ    Contoso Search',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\ContosoSearch\\Capabilities',
  '    ApplicationName    REG_SZ    Research Center',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Clients\\StartMenuInternet\\ContosoSearch\\shell\\open\\command',
  '    (Default)    REG_SZ    "C:\\Tools\\mybrowser.exe"',
  '',
].join('\r\n')

test('display-name hint fallback does not substring-match (arc/zen)', () => {
  const browsers = listInstalledBrowsers({
    platform: 'win32',
    runRegQuery: () => REG_SUBSTRING_HINT,
    isExecutableFile: () => true,
  })
  expect(browsers).toEqual([{ id: 'mybrowser', name: 'Research Center' }])
})

test('display-name hint still matches on exact name (guard against over-tightening)', () => {
  const output = REG_SUBSTRING_HINT.replace(/Research Center/g, 'Brave')
  const browsers = listInstalledBrowsers({
    platform: 'win32',
    runRegQuery: () => output,
    isExecutableFile: () => true,
  })
  expect(browsers).toEqual([{ id: 'brave', name: 'Brave' }])
})

describe('Interface.browserId config', () => {
  test('defaults to default', () => {
    const { buildDefaultConfig } = require('../electron/config/configSchema')
    expect(buildDefaultConfig().Interface.browserId).toBe('default')
  })

  test('round-trip preserves the key and unknown ids pass through', () => {
    const { buildDefaultConfig, mergeWithDefaults } = require('../electron/config/configSchema')
    const merged = mergeWithDefaults(
      { Interface: { ...buildDefaultConfig().Interface, browserId: 'brave' } },
      buildDefaultConfig(),
    )
    expect(merged.Interface.browserId).toBe('brave')
    const newer = mergeWithDefaults(
      { Interface: { ...buildDefaultConfig().Interface, browserId: 'future-browser' } },
      buildDefaultConfig(),
    )
    expect(newer.Interface.browserId).toBe('future-browser')
  })
})

describe('listInstalledBrowsers (linux native)', () => {
  test('lists PATH binaries with the executable bit set', () => {
    const browsers = listInstalledBrowsers({
      platform: 'linux',
      env: { PATH: '/usr/bin:/snap/bin' },
      ...linuxFs(new Set(['/usr/bin/firefox', '/snap/bin/brave-browser'])),
    })
    expect(browsers.map((b) => b.id).sort()).toEqual(['brave', 'firefox'])
  })

  test('present-but-not-executable binaries do not list', () => {
    const browsers = listInstalledBrowsers({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      ...linuxFs(new Set()),
    })
    expect(browsers).toEqual([])
  })

  test('alias binaries resolve to the same stable id once', () => {
    const browsers = listInstalledBrowsers({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      ...linuxFs(new Set(['/usr/bin/vivaldi', '/usr/bin/vivaldi-stable'])),
    })
    expect(browsers).toEqual([{ id: 'vivaldi', name: 'Vivaldi' }])
  })

  // Real fs, no mocks: accessSync(X_OK) succeeds on directories, so the
  // executable-bit check alone would list a `firefox/` folder as Firefox.
  test('an executable directory on PATH does not list as a browser', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'atlas-bin-'))
    await fs.promises.mkdir(path.join(dir, 'firefox'))
    try {
      expect(listInstalledBrowsers({
        platform: 'linux',
        env: { PATH: dir },
      })).toEqual([])
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})
