import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── Install must not re-validate the whole library ───────────────────────────
//
// getGames maps EVERY version of EVERY game through mapVersionRow
// (electron/db/versions.js), which without skipPathValidation runs a
// synchronous fs.existsSync on both game_path and exec_path. Two blocking stats
// per version, across the entire library, on the main process.
//
// On an SSD that is invisible, which is exactly why it shipped. A user with
// ~6000 games on a mechanical drive reported the app locking up after every
// install with "all version folders are being scanned" in Resource Monitor.
// They were right.
//
// Path validation is meant to be the deliberate pass in validate-library-paths:
// one record at a time, yielding every 25, gated behind
// Library.validatePathsOnStartup and only ever fired from requestIdleCallback.
// Finishing an install is not a request to re-verify everything on disk.
//
// This reads the source rather than mounting App, because the bug is not in any
// function's behaviour - fetchGames does exactly what it is asked - it is in
// what the call site asks for. A behavioural test would have to mount the whole
// application and count stat calls to see it. The wiring is the thing worth
// pinning, so the wiring is what this reads.

const appSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'App.jsx'),
  'utf8',
)

// The props passed to InstallFlowHost, isolated from the rest of the file.
function installFlowHostProps() {
  const start = appSource.indexOf('<InstallFlowHost')
  if (start === -1) return null
  const end = appSource.indexOf('/>', start)
  if (end === -1) return null
  return appSource.slice(start, end)
}

describe('the install completion handler', () => {
  it('is still wired up at all', () => {
    // If InstallFlowHost is renamed or unmounted, the assertions below would
    // pass vacuously on an empty string and this guard would quietly stop
    // guarding anything.
    const props = installFlowHostProps()
    expect(props).toBeTruthy()
    expect(props).toContain('onInstalled')
  })

  it('refreshes the library without re-validating every path on disk', () => {
    const props = installFlowHostProps()
    expect(props).toContain('fetchGames(')
    expect(props).toContain('skipPathValidation: true')
  })

  it('does not call fetchGames bare, which is what caused the freeze', () => {
    // `fetchGames()` with no options defaults skipPathValidation to false. That
    // single missing argument is the entire bug.
    const props = installFlowHostProps()
    expect(props).not.toMatch(/fetchGames\(\s*\)/)
  })
})
