'use strict'

// Locating a locally installed 7-Zip.
//
// Atlas ships 7za via the 7zip-bin package, but that build cannot open RAR
// archives and is slower than a real 7-Zip install, so Library.sevenZipPath in
// config.ini exists to point at the system copy. Nothing used to fill it in:
// the value stayed empty until the user either hit a failed RAR extraction and
// answered the "Locate 7-Zip" prompt, or found the field in Settings ->
// Library. On a machine that already had 7-Zip installed that prompt was pure
// noise. This module does the lookup so the FIRST launch can populate the
// setting.
//
// Lookup order, most authoritative first:
//   1. Windows registry (the installer records its own directory there, so this
//      is correct even for a non-default install location).
//   2. Well-known install directories per platform, including the package
//      managers people actually use (chocolatey, scoop, snap, homebrew).
//   3. Directories on PATH.
//
// Everything is injectable (platform, env, fs, the reg.exe runner) because the
// interesting cases — a Windows registry hit, a Linux /usr/bin/7zz — cannot be
// reproduced on whatever machine the test suite happens to run on.

const fs = require('fs')
const path = require('path')
const cp = require('child_process')

// 7z.exe first: it is the full build. 7za is the reduced standalone one and is
// what we bundle already, so preferring it over an installed 7z would defeat
// the point of this lookup.
const WINDOWS_EXECUTABLES = ['7z.exe', '7zz.exe', '7za.exe']
// 7zz is the modern upstream binary name (7-Zip for Linux); 7z on Debian and
// friends is the p7zip wrapper script. Both are fine, so order by capability.
const UNIX_EXECUTABLES = ['7zz', '7z', '7za', '7zr']

// `Path64` before `Path`: on 64-bit Windows the 64-bit installer writes both,
// and the 32-bit `Path` may point at a stale x86 copy.
const WINDOWS_REGISTRY_QUERIES = [
  { key: 'HKLM\\SOFTWARE\\7-Zip', value: 'Path64' },
  { key: 'HKLM\\SOFTWARE\\7-Zip', value: 'Path' },
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\7-Zip', value: 'Path' },
  { key: 'HKCU\\SOFTWARE\\7-Zip', value: 'Path64' },
  { key: 'HKCU\\SOFTWARE\\7-Zip', value: 'Path' },
  // The uninstall entry is a second source for the same directory and survives
  // in some upgrade scenarios where SOFTWARE\7-Zip does not.
  {
    key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip',
    value: 'InstallLocation',
  },
  {
    key: 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip',
    value: 'InstallLocation',
  },
]

/**
 * True when `candidate` is a bare command name to be resolved via PATH rather
 * than a filesystem path. Existence checks do not apply to these.
 */
function isPathCommand(candidate) {
  const value = String(candidate || '')
  return Boolean(
    value &&
      !path.isAbsolute(value) &&
      !value.includes('/') &&
      !value.includes('\\'),
  )
}

/**
 * Pull a value out of `reg.exe query` output. Output looks like:
 *
 *     HKEY_LOCAL_MACHINE\SOFTWARE\7-Zip
 *         Path    REG_SZ    C:\Program Files\7-Zip\
 *
 * The value name is matched case-insensitively because reg.exe echoes back
 * whatever casing is stored, not what we asked for.
 */
function parseRegistryValue(output, valueName) {
  if (!output || !valueName) return ''
  const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^\\s*${escaped}\\s+REG_[A-Z_]+\\s+(.+?)\\s*$`, 'im')
  const match = pattern.exec(String(output))
  return match ? match[1].trim() : ''
}

function defaultRunRegQuery(key, value) {
  // /reg:64 is deliberately NOT passed: the queries list handles both views
  // explicitly (WOW6432Node), and forcing a view fails outright on 32-bit hosts.
  const result = cp.spawnSync(
    'reg.exe',
    ['query', key, '/v', value],
    { encoding: 'utf8', windowsHide: true, timeout: 5000 },
  )
  if (result.error || result.status !== 0) return ''
  return result.stdout || ''
}

/**
 * Install directories recorded in the Windows registry. Returns [] on any other
 * platform, and never throws — a machine with a locked-down reg.exe should fall
 * through to the folder scan, not fail startup.
 */
function getWindowsRegistryInstallDirs({
  platform = process.platform,
  runRegQuery = defaultRunRegQuery,
} = {}) {
  if (platform !== 'win32') return []
  const dirs = []
  for (const { key, value } of WINDOWS_REGISTRY_QUERIES) {
    let output = ''
    try {
      output = runRegQuery(key, value)
    } catch {
      continue
    }
    const dir = parseRegistryValue(output, value)
    // Trailing separator is normal in the registry value ("C:\Program Files\7-Zip\").
    if (dir) dirs.push(dir.replace(/[\\/]+$/, ''))
  }
  return dirs
}

/**
 * Well-known install directories, in preference order, for `platform`.
 */
function getWellKnownInstallDirs({ platform = process.platform, env = process.env } = {}) {
  const dirs = []
  if (platform === 'win32') {
    const programDirs = [
      env.ProgramW6432,
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ].filter(Boolean)
    for (const base of programDirs) dirs.push(path.win32.join(base, '7-Zip'))
    // Per-user and package-manager installs, which never land in Program Files.
    if (env.LOCALAPPDATA) {
      dirs.push(path.win32.join(env.LOCALAPPDATA, 'Programs', '7-Zip'))
      dirs.push(path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'))
    }
    if (env.ProgramData) dirs.push(path.win32.join(env.ProgramData, 'chocolatey', 'bin'))
    if (env.USERPROFILE) {
      dirs.push(path.win32.join(env.USERPROFILE, 'scoop', 'apps', '7zip', 'current'))
      dirs.push(path.win32.join(env.USERPROFILE, 'scoop', 'shims'))
    }
    return dirs
  }

  if (platform === 'darwin') {
    // Apple silicon homebrew first, then intel homebrew, then MacPorts.
    return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin']
  }

  // Linux and other unices. /usr/lib/p7zip holds the real binary on distros
  // where /usr/bin/7z is only a wrapper script, and snap/flatpak export their
  // own bin directories that are not always on a non-login shell's PATH.
  dirs.push(
    '/usr/bin',
    '/usr/local/bin',
    '/bin',
    '/usr/lib/p7zip',
    '/usr/libexec/p7zip',
    '/opt/7zip',
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
  )
  if (env.HOME) {
    dirs.push(path.posix.join(env.HOME, '.local', 'bin'))
    dirs.push(path.posix.join(env.HOME, '.local', 'share', 'flatpak', 'exports', 'bin'))
  }
  return dirs
}

/**
 * Directories on PATH, so a 7-Zip installed somewhere we have never heard of is
 * still found as long as the user can run it from a shell.
 */
function getPathDirs({ platform = process.platform, env = process.env } = {}) {
  const raw = env.PATH || env.Path || ''
  if (!raw) return []
  const separator = platform === 'win32' ? ';' : ':'
  return String(raw)
    .split(separator)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}

/**
 * Every path worth probing, in priority order, with duplicates removed.
 * Returns absolute file paths — the caller decides whether to stat or execute.
 */
function buildSevenZipCandidates({
  platform = process.platform,
  env = process.env,
  runRegQuery = defaultRunRegQuery,
  includePathDirs = true,
} = {}) {
  const isWindows = platform === 'win32'
  const executables = isWindows ? WINDOWS_EXECUTABLES : UNIX_EXECUTABLES
  const joinPath = isWindows ? path.win32.join : path.posix.join

  const dirs = [
    ...getWindowsRegistryInstallDirs({ platform, runRegQuery }),
    ...getWellKnownInstallDirs({ platform, env }),
    ...(includePathDirs ? getPathDirs({ platform, env }) : []),
  ]

  const candidates = []
  const seen = new Set()
  for (const dir of dirs) {
    if (!dir) continue
    for (const executable of executables) {
      const candidate = joinPath(dir, executable)
      // Windows paths are case-insensitive, so C:\PROGRA~ vs c:\progra~ must not
      // be probed twice; on unix the case matters and must be preserved.
      const key = isWindows ? candidate.toLowerCase() : candidate
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(candidate)
    }
  }
  return candidates
}

function defaultIsExecutableFile(candidate) {
  try {
    if (!candidate) return false
    const stats = fs.statSync(candidate)
    if (!stats.isFile()) return false
    // On unix a non-executable file with the right name (a leftover, or a
    // 7z.1 man page in a bin dir) would otherwise be reported as usable.
    if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Confirm a candidate actually runs, by asking it for its own info listing
 * (`7z i`, which needs no archive and no write access). Resolves false rather
 * than rejecting for every failure mode — a missing file, a permission error, a
 * binary for the wrong architecture, or a hang.
 */
function canRunSevenZip(candidate, { spawn = cp.spawn, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (usable) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(usable)
    }

    let child = null
    try {
      child = spawn(candidate, ['i'], { stdio: 'ignore', windowsHide: true })
    } catch {
      finish(false)
      return
    }

    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish(false)
    }, timeoutMs)

    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

/**
 * First usable 7-Zip on this machine, or '' when there is none.
 *
 * `verify` runs each surviving candidate (`7z i`) to confirm it actually
 * executes. That costs a process spawn per candidate, so startup detection
 * leaves it off and relies on the existence check; the extraction path in
 * ipc/importer.js verifies before use anyway, and the Settings "Detect" button
 * turns it on because there a wrong answer is visible to the user.
 */
async function detectSevenZipPath({
  platform = process.platform,
  env = process.env,
  runRegQuery = defaultRunRegQuery,
  isExecutableFile = defaultIsExecutableFile,
  canRun = canRunSevenZip,
  verify = false,
} = {}) {
  const candidates = buildSevenZipCandidates({ platform, env, runRegQuery })
  for (const candidate of candidates) {
    if (!isExecutableFile(candidate)) continue
    if (verify && canRun && !(await canRun(candidate))) continue
    return candidate
  }
  return ''
}

/**
 * Fill in Library.sevenZipPath when it is empty, and repair it when it points at
 * a binary that no longer exists (a 7-Zip uninstall, or a config carried to a
 * different machine).
 *
 * A configured path that still exists is never touched — the user chose it, and
 * silently swapping it for something we found would be exactly the kind of
 * invisible settings change this codebase has been bitten by before. A stale
 * path is likewise KEPT when detection comes up empty, so a temporarily
 * unmounted drive does not erase the setting.
 *
 * @returns {Promise<{changed: boolean, path: string, reason: string}>}
 */
async function ensureSevenZipConfigured({
  config,
  writeConfig,
  platform = process.platform,
  env = process.env,
  runRegQuery = defaultRunRegQuery,
  isExecutableFile = defaultIsExecutableFile,
  canRun = canRunSevenZip,
  verify = false,
  logger = console,
} = {}) {
  const configured = String(config?.Library?.sevenZipPath || '').trim()

  if (configured && (isPathCommand(configured) || isExecutableFile(configured))) {
    return { changed: false, path: configured, reason: 'configured' }
  }

  let detected = ''
  try {
    detected = await detectSevenZipPath({
      platform,
      env,
      runRegQuery,
      isExecutableFile,
      canRun,
      verify,
    })
  } catch (err) {
    logger?.warn?.(`7-Zip detection failed: ${err?.message || err}`)
    return { changed: false, path: configured, reason: 'error' }
  }

  if (!detected) {
    return {
      changed: false,
      path: configured,
      reason: configured ? 'stale-kept' : 'not-found',
    }
  }

  if (detected === configured) {
    return { changed: false, path: configured, reason: 'configured' }
  }

  const reason = configured ? 'replaced-stale' : 'detected'
  try {
    await writeConfig?.(detected)
  } catch (err) {
    logger?.warn?.(`Could not save detected 7-Zip path: ${err?.message || err}`)
    return { changed: false, path: detected, reason: 'write-failed' }
  }

  logger?.log?.(
    reason === 'detected'
      ? `Detected local 7-Zip at ${detected}`
      : `Replaced missing 7-Zip path "${configured}" with ${detected}`,
  )
  return { changed: true, path: detected, reason }
}

module.exports = {
  WINDOWS_EXECUTABLES,
  UNIX_EXECUTABLES,
  WINDOWS_REGISTRY_QUERIES,
  isPathCommand,
  parseRegistryValue,
  getWindowsRegistryInstallDirs,
  getWellKnownInstallDirs,
  getPathDirs,
  buildSevenZipCandidates,
  canRunSevenZip,
  detectSevenZipPath,
  ensureSevenZipConfigured,
}
