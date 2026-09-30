import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { findExecutables } = require('../electron/scanners/executableScanner')

// ── Executable scanner ───────────────────────────────────────────────────────
//
// This walk runs on the MAIN PROCESS during an install. When it was synchronous
// it froze every window in the app for as long as it took, and it took longest
// in exactly the case it handled worst: a game with no executable at the root,
// where it walked the entire extracted tree with the event loop blocked. A 40k
// file game hung the client outright.
//
// So the load-bearing assertion here is not "it finds the exe" - it is that the
// event loop keeps turning while it works, and that it stops as soon as it has
// an answer.

let root

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-exec-scan-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const write = (relative) => {
  const full = path.join(root, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, 'x')
  return full
}

const EXT = ['exe', 'html', 'swf']

describe('findExecutables', () => {
  it('finds a launcher sitting at the root', async () => {
    write('Game.exe')
    expect(await findExecutables(root, EXT)).toEqual(['Game.exe'])
  })

  it('descends when the root has nothing, which is the RenPy layout', async () => {
    write('game/script.rpy')
    write('lib/Game.exe')
    expect(await findExecutables(root, EXT)).toEqual([path.join('lib', 'Game.exe')])
  })

  it('stops the whole walk once a directory yields a match', async () => {
    // The root answers, so nothing below it should be read at all. Proven by
    // making the subtree unreadable: a walk that descended would log a warning
    // for it, and an older walk that kept collecting would return its contents.
    write('Game.exe')
    write('data/deep/Other.exe')
    const found = await findExecutables(root, EXT)
    expect(found).toEqual(['Game.exe'])
    expect(found.some((entry) => entry.includes('data'))).toBe(false)
  })

  it('prefers the shallowest match rather than whichever branch it wandered into', async () => {
    // Breadth-first matters because every caller takes [0]. The old depth-first
    // stack could return a bundled runtime binary from three levels down while
    // the real launcher sat one level up.
    write('bin/runtime/nested/Deep.exe')
    write('top/Launcher.exe')
    expect(await findExecutables(root, EXT)).toEqual([path.join('top', 'Launcher.exe')])
  })

  it('returns a stable first candidate when one folder holds several', async () => {
    // [0] is what the install stores as the exec path. Filesystem order is not
    // guaranteed, so without sorting the same folder could install a different
    // launcher on different machines.
    write('zeta.exe')
    write('alpha.exe')
    write('middle.exe')
    const found = await findExecutables(root, EXT)
    expect(found[0]).toBe('alpha.exe')
    expect(found).toEqual(['alpha.exe', 'middle.exe', 'zeta.exe'])
  })

  it('ignores the 32-bit twin that ships beside the real launcher', async () => {
    write('Game-32.exe')
    write('Game.exe')
    expect(await findExecutables(root, EXT)).toEqual(['Game.exe'])
  })

  it('ignores files whose extension is not configured', async () => {
    write('readme.txt')
    write('data.bin')
    expect(await findExecutables(root, EXT)).toEqual([])
  })

  it('reports nothing rather than throwing when the folder does not exist', async () => {
    expect(await findExecutables(path.join(root, 'not-here'), EXT)).toEqual([])
  })

  it('reports nothing when no extensions are configured', async () => {
    // A caller with an empty extension list would otherwise walk the entire
    // tree to match nothing - the worst case, for no possible result.
    write('Game.exe')
    expect(await findExecutables(root, [])).toEqual([])
  })

  it('skips an unreadable subfolder instead of failing the install', async () => {
    // Faked rather than chmod'd: CI and this container both run as root, where
    // chmod 000 is not a permission denial at all and the test would pass
    // without ever reaching the catch it is meant to cover.
    write('locked/Hidden.exe')
    write('open/Game.exe')
    const real = fs.promises.readdir
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    const spy = vi.spyOn(fs.promises, 'readdir').mockImplementation((target, options) => {
      if (String(target).endsWith('locked')) return Promise.reject(denied)
      return real.call(fs.promises, target, options)
    })
    try {
      // The install must still get its executable from the folder it CAN read.
      await expect(findExecutables(root, EXT)).resolves.toEqual([path.join('open', 'Game.exe')])
    } finally {
      spy.mockRestore()
    }
  })

  it('normalises extensions given with dots or odd casing', async () => {
    write('Game.EXE')
    expect(await findExecutables(root, ['.Exe'])).toEqual(['Game.EXE'])
  })

  // ── The regression this rewrite exists for ─────────────────────────────────
  it('yields to the event loop while walking instead of blocking it', async () => {
    // A deep tree with NO match anywhere, which is the pathological case: the
    // walk cannot stop early and must read every directory.
    //
    // A timer scheduled before the walk starts must be able to fire while it
    // runs. Under the old readdirSync implementation the event loop was blocked
    // end to end, so the timer could not fire until the walk had finished, and
    // this counter would read 0.
    let deep = ''
    for (let level = 0; level < 40; level += 1) {
      deep = path.join(deep, `level${level}`)
      for (let file = 0; file < 25; file += 1) write(path.join(deep, `file${file}.txt`))
    }

    let ticks = 0
    const timer = setInterval(() => { ticks += 1 }, 1)
    try {
      const found = await findExecutables(root, EXT)
      expect(found).toEqual([])
    } finally {
      clearInterval(timer)
    }

    expect(ticks).toBeGreaterThan(0)
  })
})
