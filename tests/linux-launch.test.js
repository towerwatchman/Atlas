import { test, expect, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
const le = require('../electron/launchEnv.js')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lx-'))
const APPDIR = '/tmp/.mount_AtlasXk3n2'

// Exactly what electron-builder's AppRun leaves in the environment. It saves no
// *_ORIG copies, so the AppDir entries must be stripped rather than restored.
const appImageEnv = () => ({
  APPDIR,
  APPIMAGE: '/home/u/Atlas.AppImage',
  OWD: '/home/u',
  ARGV0: 'Atlas.AppImage',
  LD_LIBRARY_PATH: `${APPDIR}/usr/lib:/usr/local/lib`,
  PATH: `${APPDIR}:${APPDIR}/usr/sbin:/usr/bin:/bin`,
  XDG_DATA_DIRS: `${APPDIR}/usr/share/:/usr/share/gnome:/usr/share/`,
  GSETTINGS_SCHEMA_DIR: `${APPDIR}/usr/share/glib-2.0/schemas`,
  HOME: '/home/u',
})

beforeEach(() => le.resetWineCache())

// The AppImage launch breaker: a game inheriting LD_LIBRARY_PATH pointed at
// Electron's bundled libs picks up the wrong libstdc++/libgcc. Ren'Py and Unity
// titles bundle their own runtime and crash.
test('AppDir entries are stripped from LD_LIBRARY_PATH, system paths kept', () => {
  const clean = le.sanitizeChildEnv(appImageEnv())
  expect(clean.LD_LIBRARY_PATH).toBe('/usr/local/lib')
  expect(clean.LD_LIBRARY_PATH).not.toContain(APPDIR)
})

test('PATH and XDG_DATA_DIRS keep only system entries', () => {
  const clean = le.sanitizeChildEnv(appImageEnv())
  expect(clean.PATH).toBe('/usr/bin:/bin')
  expect(clean.XDG_DATA_DIRS).toBe('/usr/share/gnome:/usr/share/')
})

// An empty LD_LIBRARY_PATH is NOT the same as an unset one: the loader then
// searches the current directory, which is both wrong and unsafe.
test('a variable made up entirely of AppDir paths is deleted, not emptied', () => {
  const clean = le.sanitizeChildEnv(appImageEnv())
  expect('GSETTINGS_SCHEMA_DIR' in clean).toBe(false)
})

test('AppImage markers are removed and unrelated variables preserved', () => {
  const clean = le.sanitizeChildEnv(appImageEnv())
  for (const key of ['APPDIR', 'APPIMAGE', 'OWD', 'ARGV0']) {
    expect(key in clean).toBe(false)
  }
  expect(clean.HOME).toBe('/home/u')
  expect(clean.ATLAS_LAUNCHED_FROM_APPIMAGE).toBe('1')
})

// deb and pacman install to /opt with a clean environment, so this must not
// touch anything there.
test('a non-AppImage environment is returned unchanged', () => {
  const env = { LD_LIBRARY_PATH: '/usr/lib', PATH: '/usr/bin:/bin', HOME: '/home/u' }
  expect(le.sanitizeChildEnv(env)).toEqual(env)
})

// X_OK on a directory tests traversability and is true for any readable folder,
// so an access()-only check treated directories as launchable and spawn failed
// with EACCES.
test('a directory is never treated as executable', () => {
  expect(le.isExecutableFile(tmp())).toBe(false)
})

test('a missing path is not executable', () => {
  expect(le.isExecutableFile(path.join(tmp(), 'nope'))).toBe(false)
  expect(le.isExecutableFile('')).toBe(false)
  expect(le.isExecutableFile(null)).toBe(false)
})

// The common case, not an edge case: archives built on Windows carry no Unix
// mode, so an extracted launcher arrives at 0644 and cannot be spawned.
test('a missing execute bit is added', () => {
  const script = path.join(tmp(), 'Game.sh')
  fs.writeFileSync(script, '#!/bin/sh\n', { mode: 0o644 })
  expect(le.isExecutableFile(script)).toBe(false)

  const result = le.ensureExecutable(script)
  expect(result.ok).toBe(true)
  expect(result.changed).toBe(true)
  expect(le.isExecutableFile(script)).toBe(true)
})

// Execute mirrors read, so a private file does not become world-executable.
test('permissions are widened only as far as read access already allows', () => {
  const script = path.join(tmp(), 'private.sh')
  fs.writeFileSync(script, '#!/bin/sh\n', { mode: 0o600 })
  le.ensureExecutable(script)
  expect(fs.statSync(script).mode & 0o777).toBe(0o700)
})

test('an already-executable file is left alone', () => {
  const script = path.join(tmp(), 'ok.sh')
  fs.writeFileSync(script, '#!/bin/sh\n', { mode: 0o755 })
  const result = le.ensureExecutable(script)
  expect(result.ok).toBe(true)
  expect(result.changed).toBe(false)
})

test('a directory cannot be made executable', () => {
  expect(le.ensureExecutable(tmp()).ok).toBe(false)
})

// Most of this library is Windows builds. Spawning a PE binary directly gives an
// opaque failure, so these are routed through Wine or reported plainly.
test('Windows builds report a useful error when Wine is absent', () => {
  const plan = le.resolveLinuxLaunch({ execPath: '/games/Game.exe', extension: 'exe' })
  if (plan.error) {
    expect(plan.error).toMatch(/wine/i)
  } else {
    // Wine is installed in this environment, so it should be used.
    expect(plan.viaWine).toBe(true)
    expect(plan.args).toEqual(['/games/Game.exe'])
  }
})

test.each(['exe', 'bat', 'cmd', 'msi', 'EXE', '.exe'])(
  'extension %s is treated as a Windows build',
  (extension) => {
    const plan = le.resolveLinuxLaunch({ execPath: '/games/Game.bin', extension })
    expect(plan.error ? true : plan.viaWine).toBeTruthy()
  },
)

test('a native launcher resolves to itself and is made executable', () => {
  const script = path.join(tmp(), 'Game.sh')
  fs.writeFileSync(script, '#!/bin/sh\n', { mode: 0o644 })
  const plan = le.resolveLinuxLaunch({ execPath: script, extension: 'sh' })
  expect(plan.error).toBeUndefined()
  expect(plan.command).toBe(script)
  expect(plan.args).toEqual([])
  expect(plan.viaWine).toBe(false)
  expect(plan.madeExecutable).toBe(true)
})

test('a native launcher that cannot be prepared reports why', () => {
  const plan = le.resolveLinuxLaunch({ execPath: path.join(tmp(), 'missing'), extension: 'sh' })
  expect(plan.error).toBeTruthy()
})

// ── Emulator / wrapper launching ────────────────────────────────────────────
// The emulator mapping is the general mechanism for running a game through
// something else — Wine, Proton, an interpreter, a Flatpak wrapper. It was built
// for Windows and had three problems that only really bite on Linux.

// A plain .split(' ') turned `-w "My Prefix"` into ["-w", "\"My", "Prefix\""].
test('parameters are split respecting quotes', () => {
  expect(le.parseCommandArgs('wine -w "My Prefix"')).toEqual(['wine', '-w', 'My Prefix'])
  expect(le.parseCommandArgs("--opt 'a b' -x")).toEqual(['--opt', 'a b', '-x'])
})

test('parameter parsing handles empty and padded input', () => {
  expect(le.parseCommandArgs('')).toEqual([])
  expect(le.parseCommandArgs(null)).toEqual([])
  expect(le.parseCommandArgs('  -a    -b  ')).toEqual(['-a', '-b'])
  // An explicitly empty argument is meaningful and must survive.
  expect(le.parseCommandArgs('-p ""')).toEqual(['-p', ''])
})

test('the game path is appended when no placeholder is given', () => {
  const plan = le.resolveEmulatorLaunch({
    emulator: { program_path: 'wine' },
    execPath: '/games/My Game/game.exe',
  })
  expect(plan.command).toBe('wine')
  expect(plan.args).toEqual(['/games/My Game/game.exe'])
  expect(plan.usedPlaceholder).toBe(false)
})

// Appending is wrong for anything taking trailing options of its own, e.g.
// `java -jar game.jar --fullscreen` or `retroarch -L core.so rom`.
test.each(['%GAME%', '{game}', '%ROM%', '{file}'])(
  'the %s placeholder positions the game path',
  (token) => {
    const plan = le.resolveEmulatorLaunch({
      emulator: { program_path: 'java', parameters: `-jar ${token} --fullscreen` },
      execPath: '/g/game.jar',
    })
    expect(plan.args).toEqual(['-jar', '/g/game.jar', '--fullscreen'])
    expect(plan.usedPlaceholder).toBe(true)
  },
)

test('a placeholder inside quotes is still substituted', () => {
  const plan = le.resolveEmulatorLaunch({
    emulator: { program_path: 'x', parameters: '--path "%GAME%"' },
    execPath: '/games/My Game/game.exe',
  })
  expect(plan.args).toEqual(['--path', '/games/My Game/game.exe'])
})

// Configuring `wine` by name is the normal Linux setup; spawn resolves it from
// PATH, and sanitizeChildEnv has already removed AppDir entries from that PATH.
test('a bare program name is accepted without filesystem checks', () => {
  const plan = le.resolveEmulatorLaunch({
    emulator: { program_path: 'wine' },
    execPath: '/g/game.exe',
  })
  expect(plan.error).toBeUndefined()
})

test('a bad program path is reported rather than left to fail at spawn', () => {
  expect(
    le.resolveEmulatorLaunch({
      emulator: { program_path: '/nope/wine' },
      execPath: '/g/game.exe',
    }).error,
  ).toMatch(/not found/i)

  expect(
    le.resolveEmulatorLaunch({ emulator: { program_path: tmp() }, execPath: '/g/game.exe' }).error,
  ).toMatch(/not a file/i)

  expect(
    le.resolveEmulatorLaunch({ emulator: { program_path: '' }, execPath: '/g/game.exe' }).error,
  ).toMatch(/no program path/i)
})

// The emulator is the user's own tool, so this reports instead of chmod'ing it —
// changing permissions outside our data directory is not ours to do.
test('a non-executable emulator program explains the fix', () => {
  const program = path.join(tmp(), 'wine')
  fs.writeFileSync(program, '#!/bin/sh\n', { mode: 0o644 })
  const plan = le.resolveEmulatorLaunch({ emulator: { program_path: program }, execPath: '/g/g.exe' })
  expect(plan.error).toMatch(/not executable/i)
  expect(plan.error).toContain('chmod +x')
})

// End to end through a real wrapper script: proves the quoted argument survives
// as ONE argv entry, that cwd is the game folder, and that the AppImage
// LD_LIBRARY_PATH does not reach the child.
test('a wrapper receives correct argv, cwd and a sanitised environment', () => {
  const cp = require('child_process')
  const root = tmp()
  const gameDir = path.join(root, 'My Game')
  fs.mkdirSync(gameDir)
  const game = path.join(gameDir, 'game.exe')
  fs.writeFileSync(game, 'PE')
  fs.writeFileSync(path.join(gameDir, 'assets.dat'), 'data')

  const wrapper = path.join(root, 'wine')
  fs.writeFileSync(
    wrapper,
    '#!/bin/sh\n'
      + 'echo "argc=$#"\n'
      + 'echo "assets=$([ -f assets.dat ] && echo yes || echo no)"\n'
      + 'echo "ld=[$LD_LIBRARY_PATH]"\n'
      + 'echo "appdir=[$APPDIR]"\n',
    { mode: 0o755 },
  )

  const plan = le.resolveEmulatorLaunch({
    emulator: { program_path: wrapper, parameters: '-w "My Prefix"' },
    execPath: game,
  })
  const out = cp.spawnSync(plan.command, plan.args, {
    cwd: path.dirname(game),
    env: le.sanitizeChildEnv({ ...process.env, APPDIR, LD_LIBRARY_PATH: `${APPDIR}/usr/lib:/usr/local/lib` }),
    encoding: 'utf8',
  })
  // 3, not 4: the quoted prefix stayed a single argument.
  expect(out.stdout).toContain('argc=3')
  expect(out.stdout).toContain('assets=yes')
  expect(out.stdout).toContain('ld=[/usr/local/lib]')
  expect(out.stdout).toContain('appdir=[]')
})

test('the emulator branch passes a working directory', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'ipc', 'games.js'),
    'utf8',
  )
  const start = src.indexOf('const emulator = await getEmulatorByExtension')
  expect(start).toBeGreaterThan(-1)
  const branch = src.slice(start, start + 900)
  expect(branch).toContain('resolveEmulatorLaunch')
  // Omitting cwd left emulated games inheriting /opt/Atlas or the AppImage mount.
  expect(branch).toContain('cwd: path.dirname(execPath)')
  expect(branch).not.toContain("parameters.split(' ')")
})
