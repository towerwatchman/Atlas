import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'ipc', 'importer.js'),
  'utf8',
)

// Mirrors TARBALL_SUFFIXES / getArchiveExtension in importer.js. Those are module
// -private, and importing importer.js pulls in electron, so the behaviour is
// restated here and the source is asserted against separately below.
const TARBALL_SUFFIXES = [
  '.tar.gz', '.tgz', '.tar.bz2', '.tbz2', '.tbz',
  '.tar.xz', '.txz', '.tar.zst', '.tzst', '.tar.lz4', '.tar.lzma',
]
const isCompoundTarball = (p) =>
  TARBALL_SUFFIXES.some((s) => String(p).toLowerCase().endsWith(s))

test.each([
  'Game.tar.bz2', 'Game.tar.gz', 'Game.tar.xz', 'Game.tgz',
  'Game.tbz2', 'Game.txz', 'GAME.TAR.BZ2',
])('%s is recognised as a compound tarball', (name) => {
  expect(isCompoundTarball(name)).toBe(true)
})

test.each(['Game.zip', 'Game.7z', 'Game.rar', 'Game.tar', 'Game.exe'])(
  '%s is not a compound tarball',
  (name) => {
    expect(isCompoundTarball(name)).toBe(false)
  },
)

// path.extname returns only the LAST extension, which is why these were missed:
// "Game.tar.bz2" reports "bz2", and "bz2" was not in the default extraction set.
test('path.extname alone cannot identify these', () => {
  expect(path.extname('Game.tar.bz2')).toBe('.bz2')
  expect(path.extname('Game.tar.gz')).toBe('.gz')
})

test('the default extraction set covers tarballs', () => {
  const match = src.match(/extractionExtensions\s*\|\|\s*\n?\s*"([^"]+)"/)
  expect(match).not.toBeNull()
  const defaults = match[1].split(',').map((s) => s.trim())
  // Without these a .tar.bz2 is not treated as an archive at all, so it imports
  // as one opaque file with no executable inside.
  for (const ext of ['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz']) {
    expect(defaults).toContain(ext)
  }
})

test('extraction unwraps a nested tar after the outer pass', () => {
  expect(src).toContain('async function unwrapNestedTarball')
  // Must run after the extracted tree is in place.
  const move = src.indexOf('await moveDirWithRetry(tempPath, finalPath)')
  const unwrap = src.indexOf('await unwrapNestedTarball(finalPath')
  expect(move).toBeGreaterThan(-1)
  expect(unwrap).toBeGreaterThan(move)
})

test('unwrapping is bounded and only acts on a lone tar', () => {
  const start = src.indexOf('async function unwrapNestedTarball')
  const body = src.slice(start, start + 2200)
  // Bounded recursion, so a pathological archive cannot loop forever.
  expect(body).toMatch(/depth >= 2/)
  // A .tar shipped alongside other files is left alone; unwrapping it there
  // would scatter its contents over the game folder.
  expect(body).toMatch(/visible\.length !== 1/)
  expect(body).toMatch(/endsWith\(["']\.tar["']\)/)
  // The outer extraction already succeeded, so a failed unwrap must not fail
  // the whole import.
  expect(body).toContain('console.warn')
})
