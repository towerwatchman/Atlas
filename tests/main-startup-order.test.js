import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'main.js'),
  'utf8',
)
const at = (needle) => {
  const index = src.indexOf(needle)
  expect(index, `expected to find ${needle} in main.js`).toBeGreaterThan(-1)
  return index
}

// Chromium's ProcessSingleton is keyed to the user-data-dir, so acquiring the
// single-instance lock initialises that path. If the redirect has not run yet it
// initialises at Electron's default and creates %APPDATA%\atlas — the stray
// folder this ordering exists to prevent.
test('Chromium storage is redirected before the instance lock is acquired', () => {
  expect(at("app.setPath('userData'")).toBeLessThan(at('app.requestSingleInstanceLock()'))
})

test('the data root is resolved before the instance lock is acquired', () => {
  expect(at('const appDataRoot = resolveAppDataRoot()')).toBeLessThan(
    at('app.requestSingleInstanceLock()'),
  )
})

// Crashpad creates its database eagerly and would otherwise land under the
// default userData path regardless of the other redirects.
test('crashDumps is redirected too', () => {
  expect(src).toContain("setPath('crashDumps'")
})

// A failed redirect leaves Chromium on its default path, which silently puts
// cache and cookies in AppData. That has to be fatal, not a warning.
test('a failed storage redirect marks the data folder unwritable', () => {
  const marker = src.indexOf('Failed to redirect Electron storage')
  expect(marker).toBeGreaterThan(-1)
  const window = src.slice(Math.max(0, marker - 400), marker + 400)
  expect(window).toContain('dataWriteState = { writable: false')
})

// The repair dialog used to sit behind the single-instance gate, so a failed
// lock returned early and the user got console noise and a silent exit.
test('the writability check runs before the single-instance gate', () => {
  const ready = at('app.whenReady().then(async () => {')
  const tail = src.slice(ready)
  const check = tail.indexOf('await checkDataFolderWritable()')
  const gate = tail.indexOf('if (!hasSingleInstanceLock) return')
  expect(check).toBeGreaterThan(-1)
  expect(gate).toBeGreaterThan(-1)
  expect(check).toBeLessThan(gate)
})

// `node --check` parses but does not execute, so it cannot catch a temporal
// dead zone error. Moving the resolveAppDataRoot() call above the instance lock
// put it above the `let dataWriteState` it assigns to, and the app died at
// startup with "Cannot access 'dataWriteState' before initialization". Function
// declarations hoist; let/const do not.
//
// This checks the invariant directly: every module-scope let/const that
// resolveAppDataRoot() assigns must be declared before the call site.
test('bindings assigned by resolveAppDataRoot are declared before it is called', () => {
  const callSite = src.indexOf('const appDataRoot = resolveAppDataRoot()')
  expect(callSite).toBeGreaterThan(-1)

  const fnStart = src.indexOf('function resolveAppDataRoot() {')
  expect(fnStart).toBeGreaterThan(-1)
  // Body ends at the first line-start closing brace after the declaration.
  const bodyEnd = src.indexOf('\n}', fnStart)
  const body = src.slice(fnStart, bodyEnd)

  // Bare assignments to an identifier, i.e. writes to an outer binding.
  const assigned = new Set()
  for (const match of body.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*=\s*/gm)) {
    assigned.add(match[1])
  }
  expect(assigned.size).toBeGreaterThan(0)

  for (const name of assigned) {
    const declaration = src.search(new RegExp(`^(?:let|const|var)\\s+${name}\\b`, 'm'))
    if (declaration === -1) continue // not module scope, nothing to order
    expect(
      declaration,
      `'${name}' is declared at ${declaration} but resolveAppDataRoot() is called at ${callSite}; ` +
        'a let/const declared after its call site is in the temporal dead zone',
    ).toBeLessThan(callSite)
  }
})
