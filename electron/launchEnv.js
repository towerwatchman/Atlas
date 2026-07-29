'use strict'

// ── Launching child processes on Linux ───────────────────────────────────────
//
// Atlas ships as deb, pacman and AppImage, and a game has to launch from all
// three. The differences that matter:
//
//   deb / pacman  Installed to /opt/Atlas, started via a /usr/bin symlink. The
//                 environment is clean, so spawning is straightforward.
//
//   AppImage      AppRun exports LD_LIBRARY_PATH, PATH, XDG_DATA_DIRS and
//                 GSETTINGS_SCHEMA_DIR pointing INTO the mounted AppDir before
//                 Electron starts, and electron-builder's AppRun keeps no
//                 *_ORIG copies to restore from. A child process inherits all of
//                 it, so a game gets Electron's bundled libstdc++/libgcc ahead
//                 of the system ones. Ren'Py and Unity titles bundle their own
//                 runtime and either crash or fail to start.
//
// So the AppDir entries have to be stripped from the child environment rather
// than restored from an original.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

// Variables AppRun prepends AppDir paths to. Order is not significant.
const APPIMAGE_INJECTED_VARS = [
  'LD_LIBRARY_PATH',
  'PATH',
  'XDG_DATA_DIRS',
  'GSETTINGS_SCHEMA_DIR',
  // Not set by electron-builder's AppRun today but commonly added by other
  // AppImage tooling; harmless to clean if absent.
  'GTK_PATH',
  'GDK_PIXBUF_MODULE_FILE',
  'GIO_MODULE_DIR',
  'QT_PLUGIN_PATH',
  'PYTHONPATH',
  'PERLLIB',
  'LD_PRELOAD',
]

/**
 * A copy of `env` with AppImage AppDir entries removed.
 *
 * Only does anything when APPDIR is set, so it is a no-op under deb and pacman
 * and can be applied unconditionally.
 */
function sanitizeChildEnv(env = process.env) {
  const appDir = env.APPDIR
  const appImage = env.APPIMAGE
  const next = { ...env }
  if (!appDir) return next

  const prefix = path.resolve(appDir)
  const insideAppDir = (entry) => {
    if (!entry) return false
    const resolved = path.resolve(entry)
    return resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`)
  }

  for (const key of APPIMAGE_INJECTED_VARS) {
    const value = next[key]
    if (!value) continue
    const kept = value.split(path.delimiter).filter((entry) => entry && !insideAppDir(entry))
    if (kept.length > 0) next[key] = kept.join(path.delimiter)
    // Nothing left means every entry came from the AppDir. Delete rather than
    // set an empty string: an empty PATH or LD_LIBRARY_PATH is not the same as
    // an unset one, and an empty LD_LIBRARY_PATH makes the loader search the
    // CURRENT DIRECTORY, which is both wrong and a security problem.
    else delete next[key]
  }

  // These tell a child it is running inside our AppImage, which it is not.
  delete next.APPDIR
  delete next.APPIMAGE
  delete next.OWD
  delete next.ARGV0
  if (appImage) next.ATLAS_LAUNCHED_FROM_APPIMAGE = '1'

  return next
}

/**
 * Is this a file we can exec?
 *
 * Requires a regular FILE, not just something with the execute bit. X_OK on a
 * directory tests traversability and is true for essentially every readable
 * folder, so a check that only used access() treated directories as launchable
 * and then failed with EACCES on spawn.
 */
function isExecutableFile(filePath) {
  if (!filePath) return false
  try {
    if (!fs.statSync(filePath).isFile()) return false
  } catch {
    return false
  }
  if (process.platform === 'win32') return true
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Add the execute bit if it is missing.
 *
 * This is the common case rather than an edge case: archives produced on Windows
 * carry no Unix permission data, so an extracted Game.sh lands at 0644 and
 * cannot be spawned. Without this, the most frequent Linux import is unlaunchable.
 */
function ensureExecutable(filePath) {
  if (process.platform === 'win32') return { ok: true, changed: false }
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch (err) {
    return { ok: false, changed: false, error: err.message }
  }
  if (!stat.isFile()) return { ok: false, changed: false, error: 'Not a regular file' }
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return { ok: true, changed: false }
  } catch { /* needs the bit */ }
  try {
    // Mirror read permission into execute: a 644 file becomes 755, a 600 becomes
    // 700. Avoids granting group/other more than they could already read.
    const mode = stat.mode & 0o777
    const next = mode | ((mode & 0o444) >> 2)
    fs.chmodSync(filePath, next)
    return { ok: true, changed: true, mode: next }
  } catch (err) {
    return { ok: false, changed: false, error: err.message }
  }
}

let cachedWine
/** Path to a wine binary, or null. Cached: this shells out. */
function findWine() {
  if (cachedWine !== undefined) return cachedWine
  if (process.platform === 'win32') {
    cachedWine = null
    return cachedWine
  }
  for (const candidate of ['wine64', 'wine']) {
    try {
      const found = execFileSync('which', [candidate], {
        encoding: 'utf8',
        // Look on the SYSTEM path, not the AppImage-prefixed one.
        env: sanitizeChildEnv(process.env),
      }).trim()
      if (found) {
        cachedWine = found
        return cachedWine
      }
    } catch { /* not installed */ }
  }
  cachedWine = null
  return cachedWine
}

/** Test seam. */
function resetWineCache() {
  cachedWine = undefined
}

const WINDOWS_ONLY_EXTENSIONS = new Set(['exe', 'bat', 'cmd', 'msi'])

/**
 * How to spawn `execPath` on Linux: the command, its arguments, and whether the
 * executable bit had to be added.
 *
 * Returns `{ error }` instead of throwing so the caller can surface something
 * more useful than a raw ENOEXEC — most titles in this library are Windows
 * builds, and "install Wine" is a far better message than "spawn failed".
 */
function resolveLinuxLaunch({ execPath, extension }) {
  const ext = String(extension || '').replace(/^\./, '').toLowerCase()

  if (WINDOWS_ONLY_EXTENSIONS.has(ext)) {
    const wine = findWine()
    if (!wine) {
      return {
        error:
          `This is a Windows build (.${ext}) and Wine was not found on PATH.\n\n` +
          'Either install Wine, or configure a launcher for this file type under ' +
          `Settings > Emulators (map "${ext}" to wine, Proton, or another wrapper).`,
      }
    }
    return { command: wine, args: [execPath], viaWine: true, madeExecutable: false }
  }

  const prepared = ensureExecutable(execPath)
  if (!prepared.ok) {
    return { error: `Cannot make ${path.basename(execPath)} executable: ${prepared.error}` }
  }
  return { command: execPath, args: [], viaWine: false, madeExecutable: prepared.changed }
}

/**
 * Split an emulator parameter string into argv, respecting quotes.
 *
 * A plain .split(' ') breaks on any quoted argument — `-w "My Prefix"` became
 * three broken arguments — and that matters more on Linux, where wrapper
 * commands routinely carry paths with spaces.
 *
 * Not a full shell parser: no variable expansion, globbing or pipes. Arguments
 * are passed to spawn() directly with shell:false, so shell metacharacters are
 * literal by design rather than by accident.
 */
function parseCommandArgs(input) {
  const text = String(input ?? '')
  const args = []
  let current = ''
  let quote = null
  let started = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started || current) args.push(current)
      current = ''
      started = false
      continue
    }
    current += char
  }
  if (started || current) args.push(current)
  return args
}

// Placeholders a user can put in the parameter string to control WHERE the game
// path lands. Without one the path is appended, which is right for `wine
// game.exe` but wrong for anything that takes trailing options of its own —
// `java -jar game.jar`, `retroarch -L core.so rom`, or a wrapper that needs
// `-- ` before the target.
const GAME_PLACEHOLDERS = ['%GAME%', '{game}', '%ROM%', '{file}']

/**
 * How to launch `execPath` through a configured emulator/wrapper.
 *
 * This is the general mechanism for Wine, Proton, an interpreter, or any other
 * wrapper: the user maps an extension to a program and its arguments, and it
 * takes precedence over the built-in handling.
 */
function resolveEmulatorLaunch({ emulator, execPath }) {
  const program = String(emulator?.program_path || '').trim()
  if (!program) return { error: 'This emulator has no program path configured.' }

  const parsed = parseCommandArgs(emulator?.parameters)
  const placeholder = GAME_PLACEHOLDERS.find((token) =>
    parsed.some((arg) => arg.includes(token)),
  )

  const args = placeholder
    ? parsed.map((arg) => arg.split(placeholder).join(execPath))
    : [...parsed, execPath]

  // A bare name like "wine" is resolved from PATH by spawn, which is the normal
  // way to configure this on Linux. Only validate when an actual path is given.
  const looksLikePath = program.includes('/') || program.includes('\\')
  if (looksLikePath) {
    let stat
    try {
      stat = fs.statSync(program)
    } catch {
      return { error: `Emulator program not found: ${program}` }
    }
    if (!stat.isFile()) {
      return { error: `Emulator program is not a file: ${program}` }
    }
    // The emulator is the user's own tool, so report rather than chmod it —
    // silently changing permissions on something outside our data directory is
    // not ours to do.
    if (process.platform !== 'win32' && !isExecutableFile(program)) {
      return {
        error:
          `Emulator program is not executable: ${program}\n` +
          `Run: chmod +x "${program}"`,
      }
    }
  }

  return { command: program, args, usedPlaceholder: Boolean(placeholder) }
}

module.exports = {
  parseCommandArgs,
  resolveEmulatorLaunch,
  GAME_PLACEHOLDERS,
  APPIMAGE_INJECTED_VARS,
  sanitizeChildEnv,
  isExecutableFile,
  ensureExecutable,
  findWine,
  resetWineCache,
  resolveLinuxLaunch,
  WINDOWS_ONLY_EXTENSIONS,
}
