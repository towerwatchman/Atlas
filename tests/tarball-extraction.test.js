import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// These moved from ipc/importer.js to library/importRules.js. The source-text
// assertion below follows them.
// The source-text assertions span BOTH files now: the extension defaults moved
// to importRules.js, while extractArchive / unwrapNestedTarball stayed in
// importer.js. Concatenated so each assertion finds its target wherever it
// currently lives, and so a future move of either does not silently pass by
// matching nothing.
const src = [
  path.join(__dirname, '..', 'electron', 'library', 'importRules.js'),
  path.join(__dirname, '..', 'electron', 'ipc', 'importer.js'),
].map((file) => fs.readFileSync(file, 'utf8')).join('\n')

// Previously this file re-declared TARBALL_SUFFIXES and isCompoundTarball,
// because importing importer.js dragged in electron and the originals were
// module-private. importRules.js has no electron dependency, so the REAL
// implementations can be imported and a duplicated copy that could silently
// drift out of step is no longer needed.
const {
  TARBALL_SUFFIXES,
  isCompoundTarballPath: isCompoundTarball,
} = require('../electron/library/importRules')

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
  // Matched on the call PREFIX, not the full argument list. The exact-string
  // form broke the moment moveDirWithRetry gained a containment root, which is
  // an argument change this test has no opinion about -- it only asserts the
  // ORDER of the two calls.
  const move = src.indexOf('await moveDirWithRetry(tempPath, finalPath')
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
