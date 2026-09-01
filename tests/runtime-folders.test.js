import { describe, it, expect } from 'vitest'

const {
  isRuntimeSegment,
  isRuntimePath,
  nearestGameRoot,
  resolveGameRoots,
} = require('../electron/scanners/runtimeFolders')

// ── Engine runtime folders are not games ─────────────────────────────────────
//
// An unstructured scan treats any directory holding a launchable as a game.
// Ren'Py and friends put executables in `lib/windows-i686/` and
// `renpy/windows-x86_64/`, so a migrated library produced a row per runtime
// folder -- entries titled "windows i686", plus a duplicate of every game that
// already had a row of its own.
//
// This was fixed once (CHANGELOG 1.0.66) and lost again when the scanner moved
// from src/core/ to electron/. scripts/check-library-resync.js caught it and
// was itself unwired from `npm run check` in the same period, so nothing
// noticed. These tests exist because that script was the only coverage the
// scanner had, and a check script only runs when someone remembers to wire it.

describe('isRuntimeSegment', () => {
  it('knows the engine container folders', () => {
    for (const name of ['lib', 'libs', 'renpy', 'www', 'runtime', 'engine']) {
      expect(isRuntimeSegment(name)).toBe(true)
    }
  })

  it('is case insensitive', () => {
    expect(isRuntimeSegment('RenPy')).toBe(true)
    expect(isRuntimeSegment('LIB')).toBe(true)
  })

  it('matches per-architecture build folders', () => {
    for (const name of [
      'windows-i686',
      'windows-x86_64',
      'py3-windows-x86_64',
      'linux-x86_64',
      'mac-universal',
      'darwin-arm64',
    ]) {
      expect(isRuntimeSegment(name)).toBe(true)
    }
  })

  it('does not claim ordinary folder names', () => {
    // The arch pattern is anchored at both ends precisely so a real game whose
    // title starts with a platform word survives. A false positive here folds a
    // game into its parent and it silently never appears -- strictly worse than
    // the junk row this is preventing, because there is nothing to see.
    for (const name of [
      'Windows',
      'Linux Adventure',
      'Game A',
      'v1.0',
      'Final',
      'macabre',
      'library',
    ]) {
      expect(isRuntimeSegment(name)).toBe(false)
    }
  })
})

describe('isRuntimePath', () => {
  it('rejects on any segment, not just the last', () => {
    // `lib` alone is enough, so an arch folder naming scheme this module has
    // never seen is still handled as long as one level is recognised.
    expect(isRuntimePath('Creator/Game/v1.0/lib/some-future-arch')).toBe(true)
  })

  it('accepts a path with no runtime segment', () => {
    expect(isRuntimePath('Creator/Game/v1.0')).toBe(false)
  })
})

describe('nearestGameRoot', () => {
  it('returns the folder a runtime directory belongs to', () => {
    expect(nearestGameRoot('Creator/Game/v2.0/lib/windows-i686')).toBe(
      'Creator/Game/v2.0',
    )
    expect(nearestGameRoot('Creator/Game/Final/renpy/windows-x86_64')).toBe(
      'Creator/Game/Final',
    )
  })

  it('refuses to promote when every segment is runtime', () => {
    // Promoting to the scan root would collapse an entire library into one
    // game, which is far worse than the junk row being avoided.
    expect(nearestGameRoot('lib/windows-i686')).toBeNull()
  })
})

describe('resolveGameRoots', () => {
  const scanned = [
    'Creator A',
    'Creator A/Game A',
    'Creator A/Game A/v1.0',
    'Creator A/Game A/v1.0/lib',
    'Creator A/Game A/v1.0/lib/windows-i686',
    'Creator A/Game A/v2.0',
    'Creator A/Game A/v2.0/lib',
    'Creator A/Game A/v2.0/lib/windows-i686',
    'Creator B/Game B/Final',
    'Creator B/Game B/Final/renpy',
    'Creator B/Game B/Final/renpy/windows-x86_64',
  ]

  it('drops runtime directories entirely', () => {
    const paths = resolveGameRoots(scanned).map((r) => r.path)
    expect(paths.some((p) => p.includes('windows-i686'))).toBe(false)
    expect(paths.some((p) => p.includes('windows-x86_64'))).toBe(false)
    expect(paths.some((p) => p.split('/').includes('lib'))).toBe(false)
    expect(paths.some((p) => p.split('/').includes('renpy'))).toBe(false)
  })

  it('keeps the real version folders', () => {
    const paths = resolveGameRoots(scanned).map((r) => r.path)
    expect(paths).toContain('Creator A/Game A/v1.0')
    expect(paths).toContain('Creator A/Game A/v2.0')
    expect(paths).toContain('Creator B/Game B/Final')
  })

  it('flags the folders whose only launcher is nested', () => {
    const byPath = Object.fromEntries(
      resolveGameRoots(scanned).map((r) => [r.path, r.ownsRuntimeChild]),
    )
    // v2.0 has no launcher of its own, so the caller must search recursively
    // or the version disappears.
    expect(byPath['Creator A/Game A/v2.0']).toBe(true)
    expect(byPath['Creator B/Game B/Final']).toBe(true)
    // v1.0 is both an ordinary candidate and the owner of a runtime child. The
    // flag is OR-ed, so it still gets the recursive search; findExecutables
    // returns its root launcher and never descends.
    expect(byPath['Creator A/Game A/v1.0']).toBe(true)
  })

  it('does not flag ancestors that merely contain a game', () => {
    const byPath = Object.fromEntries(
      resolveGameRoots(scanned).map((r) => [r.path, r.ownsRuntimeChild]),
    )
    // The regression this guards: searching recursively from every directory
    // finds v2.0/lib/windows-i686/GameA.exe from the creator folder and turns
    // "Creator A" into a game. Unflagged folders get a root-level search only,
    // find nothing, and are skipped.
    expect(byPath['Creator A']).toBe(false)
    expect(byPath['Creator A/Game A']).toBe(false)
  })

  it('lists each directory once', () => {
    const paths = resolveGameRoots(scanned).map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
