import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const NSIS_TEMPLATES = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis')
const readTemplate = (...parts) => fs.readFileSync(path.join(NSIS_TEMPLATES, ...parts), 'utf8')

const installerNsh = () => read('build', 'installer.nsh')

// ── Regression guards ───────────────────────────────────────────────────────

// Updates MUST install silently on this configuration. Three attempts at showing
// the installer all broke updates; see electron/ipc/updater.js for the log. The
// failure mode is the dangerous kind: the install succeeds and the app never
// reopens, so the user is left on a working-but-closed install.
test('updates install silently, everywhere', () => {
  const calls = [
    ...(read('electron', 'ipc', 'updater.js').match(/quitAndInstall\([^)]*\)/g) || []),
    ...(read('electron', 'main.js').match(/quitAndInstall\([^)]*\)/g) || []),
  ]
  expect(calls).toHaveLength(3)
  for (const call of calls) expect(call).toBe('quitAndInstall(true, true)')
})

// This is the only thing that reopens Atlas after a silent update. Both halves of
// the guard matter: a non-silent install fails it and the app stays closed.
test('the template still auto-starts the app on a silent forced run', () => {
  const section = readTemplate('installSection.nsh')
  const assisted = section.slice(section.lastIndexOf('!else'))
  expect(assisted).toMatch(/\$\{if\} \$\{isForceRun\}/)
  expect(assisted).toMatch(/\$\{andIf\} \$\{Silent\}/)
  expect(assisted).toContain('!insertmacro doStartApp')
})

// StartApp/doStartApp uses ExecShellAsUser so Atlas does not inherit the
// installer's elevated token — Atlas launches game executables, which would
// otherwise all run as administrator.
test('the relaunch drops elevation and passes --updated', () => {
  const common = readTemplate('common.nsh')
  const start = common.indexOf('!macro StartApp')
  const macro = common.slice(start, common.indexOf('!macroend', start))
  expect(macro).toContain('${StdUtils.ExecShellAsUser}')
  expect(macro).toContain('$launchLink')
  expect(macro).toContain('--updated')
})

// installer.nsh must stay free of the workarounds from the failed attempts. Each
// of these broke updates: customFinishPage deleted the stock relaunch, the
// hand-rolled ExecShellAsUser did not replace it, and SpiderBanner never showed.
test('installer.nsh carries none of the failed workarounds', () => {
  const nsh = installerNsh()
  for (const token of ['customFinishPage', 'ExecShellAsUser', 'SetAutoClose', 'SpiderBanner']) {
    expect(nsh, `installer.nsh should not contain ${token}`).not.toContain(token)
  }
})

// quitAndInstall discards isForceRunAfter when isSilent is false and reads
// autoRunAppAfterInstall instead. Irrelevant while we stay silent, but set
// explicitly so a future switch does not depend on a library default.
test('the relaunch opt-in is explicit, not inherited from a default', () => {
  expect(read('electron', 'main.js')).toMatch(/autoUpdater\.autoRunAppAfterInstall = true/)
  expect(read('node_modules', 'electron-updater', 'out', 'BaseUpdater.js'))
    .toContain('isSilent ? isForceRunAfter : this.autoRunAppAfterInstall')
})

// ── UAC still fires, but only when elevation is actually needed ─────────────
//
// perMachine:false removes RequestExecutionLevel admin, so the manifest no longer
// forces elevation. It is NOT gone — it moves from unconditional to on-demand,
// via three paths. These pin all three, because the failure mode if any were
// missing is an install that silently cannot write its target directory.

// Path 1: a fresh install where the user picks "all users". The mode page's LEAVE
// handler elevates before continuing.
test('choosing an all-users install elevates', () => {
  const ui = readTemplate('multiUserUi.nsh')
  const leave = ui.slice(ui.indexOf('SendMessage $MultiUser.InstallModePage.AllUsers'))
  expect(leave).toMatch(/\$\{IfNot\} \$\{UAC_IsAdmin\}/)
  expect(leave).toContain('!insertmacro UAC_RunElevated')
  // Cancelling UAC returns to the radio buttons rather than killing the install.
  expect(leave).toContain('${Case} 1223')
  expect(leave).toContain('Abort')
})

// The mode page only exists when perMachine is off, so path 1 depends on it.
test('the install-mode page is compiled in now that perMachine is off', () => {
  const assisted = readTemplate('assistedInstaller.nsh')
  const before = assisted.slice(0, assisted.indexOf('!insertmacro PAGE_INSTALL_MODE'))
  expect(before.slice(-80)).toContain('!ifndef INSTALL_MODE_PER_ALL_USERS')
  expect(JSON.parse(read('package.json')).build.nsis.perMachine).toBe(false)
  // allowElevation must stay on, or MULTIUSER_INSTALLMODE_ALLOW_ELEVATION is
  // undefined and the all-users option cannot elevate at all.
  expect(JSON.parse(read('package.json')).build.nsis.allowElevation).not.toBe(false)
  expect(readTemplate('multiUserUi.nsh')).toContain('MULTIUSER_INSTALLMODE_ALLOW_ELEVATION')
})

// Path 2, and the important one for updates: a SILENT upgrade of an install that
// is already per-machine elevates itself, since no page runs to ask.
//
// Note this block is guarded by !ifndef INSTALL_MODE_PER_ALL_USERS — it was
// COMPILED OUT under perMachine:true, which relied on the manifest instead.
// Turning perMachine off is what makes conditional elevation exist at all.
test('a silent upgrade of a per-machine install elevates itself', () => {
  const nsi = readTemplate('installer.nsi')
  const block = nsi.slice(
    nsi.indexOf("# If we're running a silent upgrade"),
    nsi.indexOf('!include "installSection.nsh"'),
  )
  expect(block).toContain('!ifndef INSTALL_MODE_PER_ALL_USERS')
  expect(block).toMatch(/\$hasPerMachineInstallation == "1"/)
  expect(block).toMatch(/\$\{andIf\} \$\{Silent\}/)
  expect(block).toMatch(/\$\{ifNot\} \$\{UAC_IsAdmin\}/)
  expect(block).toContain('!insertmacro UAC_RunElevated')
})

// Path 3: uninstalling a per-machine install.
test('uninstalling a per-machine install elevates', () => {
  const ui = readTemplate('multiUserUi.nsh')
  expect(ui.match(/!insertmacro UAC_RunElevated/g).length).toBeGreaterThanOrEqual(3)
})

// ── Elevation: why updates could not relaunch ───────────────────────────────
//
// The real cause of "update installs, app never reopens" — across silent AND
// non-silent builds, which is why chasing that distinction never fixed it.
//
// From a failing run's atlas-updater.log:
//   Install: isSilent: true, isForceRunAfter: true
//   Executing: ...Atlas-Setup-<v>.exe with args: --updated,/S,--force-run,
//     /D=C:\Users\tower\AppData\Local\Programs\Atlas
//   Cannot run installer: error code: EACCES ... will be executed again using elevate
//   Executing: ...\resources\elevate.exe with args: <installer>,--updated,/S,...
//
// perMachine:true put RequestExecutionLevel admin on the installer, so the
// non-elevated spawn was rejected (EACCES) and electron-updater fell back to
// elevate.exe — producing a UAC prompt and an ELEVATED installer. The relaunch
// then had to hop back down across the integrity boundary via ExecShellAsUser,
// and that is the step that failed.
//
// The install target is %LOCALAPPDATA%\Programs\Atlas, a per-user directory that
// never needed elevation to write to in the first place.

test('perMachine is off, so the installer needs no elevation', () => {
  expect(JSON.parse(read('package.json')).build.nsis.perMachine).toBe(false)
})

// The chain being defended: perMachine:true -> INSTALL_MODE_PER_ALL_USERS ->
// RequestExecutionLevel admin. Turning perMachine back on reintroduces all of it.
test('only perMachine would force an admin manifest', () => {
  const nsisTarget = read('node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js')
  expect(nsisTarget).toMatch(/perMachine === true\)\s*\{\s*defines\.INSTALL_MODE_PER_ALL_USERS = null/)

  const nsi = readTemplate('installer.nsi')
  const block = nsi.slice(
    nsi.indexOf('!ifdef INSTALL_MODE_PER_ALL_USERS'),
    nsi.indexOf('!ifdef BUILD_UNINSTALLER', nsi.indexOf('RequestExecutionLevel user\n!endif')),
  )
  expect(block).toContain('RequestExecutionLevel admin')
  // ...and without that define, the installer runs as the plain user.
  expect(block).toMatch(/!else\s*\n\s*RequestExecutionLevel user/)
})

// Why an admin manifest is fatal rather than merely noisy: a non-elevated parent
// cannot CreateProcess it, so electron-updater never gets to spawn it directly.
test('an admin-manifested installer forces the elevate.exe fallback', () => {
  const updater = read('node_modules', 'electron-updater', 'out', 'NsisUpdater.js')
  expect(updater).toContain('elevate.exe')
  expect(updater).toMatch(/errorCode === "UNKNOWN" \|\| errorCode === "EACCES"/)
})

// Both perMachine transitions have now happened in this build, so an existing
// install may be recorded under either hive. Adopting only one of them makes an
// upgrade from the other era look like a fresh install and relocate.
test('customInit adopts an existing install from either registry hive', () => {
  const init = installerNsh()
  const macro = init.slice(init.indexOf('!macro customInit'), init.indexOf('!macroend', init.indexOf('!macro customInit')))
  expect(macro).toContain('ReadRegStr $0 HKLM')
  expect(macro).toContain('ReadRegStr $0 HKCU')
  // The HKLM value must be checked for existence, not just non-emptiness — a
  // stale per-machine record pointing at a deleted folder must fall through.
  expect(macro).toMatch(/\$\{OrIfNot\} \$\{FileExists\}/)
})

// A per-machine install can still happen if the user picks it on the install-mode
// page, and installer.nsi handles elevating that case for silent upgrades. That
// path is only compiled when perMachine is off, so it must stay reachable.
test('silent upgrades of a per-machine install can still elevate themselves', () => {
  const nsi = readTemplate('installer.nsi')
  const block = nsi.slice(
    nsi.indexOf("# If we're running a silent upgrade"),
    nsi.indexOf('!include "installSection.nsh"'),
  )
  expect(block).toContain('!ifndef INSTALL_MODE_PER_ALL_USERS')
  expect(block).toMatch(/\$\{andIf\} \$\{Silent\}/)
  expect(block).toContain('UAC_RunElevated')
})


// /D= is appended regardless of silence, so the update still lands in the folder
// the app is currently installed in.
test('the install directory switch is not conditional on silence', () => {
  const updater = read('node_modules', 'electron-updater', 'out', 'NsisUpdater.js')
  const doInstall = updater.slice(updater.indexOf('doInstall(options)'))
  const silentPush = doInstall.indexOf('args.push("/S")')
  const dirPush = doInstall.indexOf('/D=')
  expect(silentPush).toBeGreaterThan(-1)
  expect(dirPush).toBeGreaterThan(-1)
  // NSIS requires /D= to be the final argument.
  expect(dirPush).toBeGreaterThan(silentPush)
  const dirBlock = doInstall.slice(doInstall.indexOf('if (this.installDirectory)'), dirPush)
  expect(dirBlock).not.toContain('isSilent')
})
