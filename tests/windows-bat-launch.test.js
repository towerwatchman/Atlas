import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Windows .bat/.cmd launching. These scripts are not executable images, so they
// must run inside cmd.exe. The spawn used to pass the script to Node with
// shell:true, which produced a `cmd /c "<spaced path>"` whose quoting splits the
// path at the first space; cmd then reported the truncated path as "not
// recognized" and the script never ran. The contract now is: spawn cmd.exe with
// ['/c', execPath] and shell:false, letting Node quote the path as one token.
//
// This is a source-anchored guard (it inspects games.js) so it runs on every
// platform — the real spawn only exercises cmd.exe on Windows. It fails if the
// Windows .bat/.cmd branch regresses to shell:true.

const src = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'ipc', 'games.js'),
  'utf8',
)

const branch = (() => {
  const start = src.indexOf("} else if (['exe', 'bat', 'cmd'].includes(extension)) {")
  expect(start).toBeGreaterThan(-1)
  // Take enough of the file to cover the whole Windows exe/bat/cmd branch
  // (bat/cmd is launched via cmd.exe /c with shell:false).
  return src.slice(start, start + 3500)
})()

test('.bat/.cmd is launched through cmd.exe with /c, not shell:true', () => {
  // cmd.exe must be the spawned program for bat/cmd, with the script as its own
  // argv element (['/c', execPath]).
  expect(branch).toContain("spawnTrackedGame('cmd.exe'")
  expect(branch).toContain("['/c', execPath]")
  // The shell flag must be false there (the old, broken value was true).
  // Anchor on the cmd.exe call so we don't accidentally match the .exe path.
  const cmdCall = branch.slice(branch.indexOf("spawnTrackedGame('cmd.exe'"))
  expect(cmdCall).toContain('shell: false')
  expect(cmdCall).not.toContain('shell: true')
  // cwd is the script folder, so a bat's relative `.\` / `..\` paths resolve.
  expect(cmdCall).toContain('cwd: path.dirname(execPath)')
})
