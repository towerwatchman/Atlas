import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8')

// Read from the installed electron-builder template rather than hardcoding the
// order, so this test tracks the real macro sequence if the dependency changes.
const templatePath = path.join(
  __dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'installer.nsi',
)
const template = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8') : null

test.skipIf(!template)(
  'electron-builder still runs preInit before the registry view is set and before initMultiUser',
  () => {
    const preInit = template.indexOf('!insertmacro preInit')
    const regView = template.indexOf('!insertmacro check64BitAndSetRegView')
    const multiUser = template.indexOf('!insertmacro initMultiUser')
    const customInit = template.indexOf('!insertmacro customInit')
    expect(preInit).toBeGreaterThan(-1)
    // Why $INSTDIR must not be set in preInit: the 64-bit registry view is not
    // active yet, so a HKLM read hits WOW6432Node, and initMultiUser overwrites
    // $INSTDIR afterwards anyway.
    expect(preInit).toBeLessThan(regView)
    expect(regView).toBeLessThan(multiUser)
    expect(multiUser).toBeLessThan(customInit)
  },
)

test('installer.nsh does not set $INSTDIR from preInit', () => {
  // Comments may mention preInit; a macro definition must not exist.
  expect(nsh).not.toMatch(/^!macro\s+preInit/m)
})

test('the install directory is adopted in customInit', () => {
  expect(nsh).toMatch(/^!macro\s+customInit/m)
  const start = nsh.search(/^!macro\s+customInit/m)
  const body = nsh.slice(start, nsh.indexOf('!macroend', start))
  // HKLM first, then HKCU: installs from the older perMachine:false build
  // recorded themselves under HKCU, and setInstallModePerAllUsers only reads
  // HKLM, so those upgrades relocated to Program Files.
  expect(body).toContain('HKLM')
  expect(body).toContain('HKCU')
  expect(body.indexOf('HKLM')).toBeLessThan(body.indexOf('HKCU'))
  expect(body).toContain('StrCpy $INSTDIR')
})

// The data folder grant must never be applied to $INSTDIR itself, which holds
// Atlas.exe — a user-writable folder of executables is a privilege-escalation
// route.
test('the icacls grant is scoped to data and launchers, never $INSTDIR', () => {
  const grants = [...nsh.matchAll(/icacls\.exe"\s+"([^"]+)"/g)].map((m) => m[1])
  expect(grants.length).toBeGreaterThan(0)
  for (const target of grants) {
    expect(target).toMatch(/\$INSTDIR\\(data|launchers)/)
  }
})

test('the grant uses the well-known Users SID, not a localised name', () => {
  expect(nsh).toContain('*S-1-5-32-545')
  expect(nsh).not.toMatch(/icacls[^\n]*"Users:/)
})
