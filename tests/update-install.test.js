import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const NSIS_TEMPLATES = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis')
const readTemplate = (...parts) => fs.readFileSync(path.join(NSIS_TEMPLATES, ...parts), 'utf8')

const installerNsh = () => read('build', 'installer.nsh')

// ── The change ──────────────────────────────────────────────────────────────

// Updates MUST install silently. installSection.nsh's assisted-installer branch
// only auto-starts the app when ${isForceRun} AND ${Silent}, so a non-silent
// update installs correctly and then leaves Atlas closed — which is exactly what
// happened when this was tried. Feedback comes from the banner instead.
test('updates install silently, everywhere', () => {
  const calls = [
    ...(read('electron', 'ipc', 'updater.js').match(/quitAndInstall\([^)]*\)/g) || []),
    ...(read('electron', 'main.js').match(/quitAndInstall\([^)]*\)/g) || []),
  ]
  expect(calls).toHaveLength(3)
  for (const call of calls) expect(call).toBe('quitAndInstall(true, true)')
})

// The trap that broke the relaunch: quitAndInstall discards its isForceRunAfter
// argument whenever isSilent is false, falling back to autoRunAppAfterInstall.
// Pin both the guard in the template and our explicit opt-in.
test('the app is opted in to relaunching after install', () => {
  expect(read('electron', 'main.js')).toMatch(/autoUpdater\.autoRunAppAfterInstall = true/)

  const base = read('node_modules', 'electron-updater', 'out', 'BaseUpdater.js')
  expect(base).toContain('isSilent ? isForceRunAfter : this.autoRunAppAfterInstall')
})

// This is what actually restarts Atlas. If the guard ever changes, a silent
// update would stop reopening the app.
test('the template still auto-starts the app on a silent forced run', () => {
  const section = readTemplate('installSection.nsh')
  const assisted = section.slice(section.lastIndexOf('!else'))
  expect(assisted).toMatch(/\$\{if\} \$\{isForceRun\}/)
  expect(assisted).toMatch(/\$\{andIf\} \$\{Silent\}/)
  expect(assisted).toContain('!insertmacro doStartApp')
})

// The banner is a plugin window, not an installer page, which is why it can be
// shown under /S at all. oneClick.nsh uses the same call.
test('a progress banner is shown for update installs', () => {
  const nsh = installerNsh()
  const init = nsh.slice(nsh.indexOf('!macro customInit'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInit')))
  expect(init).toContain('SpiderBanner::Show')
  // Plugin calls need the plugins dir; .onInit runs before installSection does it.
  expect(init.indexOf('InitPluginsDir')).toBeLessThan(init.indexOf('SpiderBanner::Show'))
  // Only on updates — a first install already has the full wizard.
  expect(init).toMatch(/\$\{If\} \$\{isUpdated\}/)
  expect(readTemplate('installSection.nsh')).toContain('SpiderBanner::Show')
})

// The previous attempt suppressed the finish page and hand-rolled the relaunch.
// Both are gone; the template's own path does it now.
test('the hand-rolled relaunch and finish-page override are gone', () => {
  const nsh = installerNsh()
  expect(nsh).not.toContain('customFinishPage')
  expect(nsh).not.toContain('ExecShellAsUser')
  expect(nsh).not.toContain('SetAutoClose')
})

// ── Assumptions about electron-builder's templates ──────────────────────────
//
// Going non-silent is only safe because no wizard page can appear on an update.
// That is a property of electron-builder's own templates, not of our code, so an
// upgrade could silently reintroduce a wizard for every user mid-update. These
// pin the assumptions to the installed version so that fails here instead.


// perMachine:true defines INSTALL_MODE_PER_ALL_USERS, and the page is only
// inserted when that is NOT defined. This was the "stale per-machine prompt"
// the silent install was originally working around.
test('the install-mode page is compiled out for perMachine builds', () => {
  const pkg = JSON.parse(read('package.json'))
  expect(pkg.build.nsis.perMachine).toBe(true)

  const nsisTarget = read('node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js')
  expect(nsisTarget).toMatch(/perMachine === true\)\s*\{\s*defines\.INSTALL_MODE_PER_ALL_USERS = null/)

  const assisted = readTemplate('assistedInstaller.nsh')
  const before = assisted.slice(0, assisted.indexOf('!insertmacro PAGE_INSTALL_MODE'))
  expect(before.slice(-80)).toContain('!ifndef INSTALL_MODE_PER_ALL_USERS')
})

// Defining customFinishPage is what removes MUI_PAGE_FINISH; if the template
// stopped honouring the hook, the finish page would come back and updates would
// hang waiting for a click.

// customInstall must still run after $launchLink is assigned, or the relaunch
// would exec an empty path.
test('customInstall still runs after $launchLink is set', () => {
  const section = readTemplate('installSection.nsh')
  expect(section.indexOf('StrCpy $launchLink'))
    .toBeLessThan(section.indexOf('!insertmacro customInstall'))
})

// ${isForceRun} and ${StdUtils.ExecShellAsUser} both come from the generated
// header rather than the templates, so they are only usable if the generator
// still emits them.
test('isForceRun and StdUtils are still provided by the generated header', () => {
  const nsisTarget = read('node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js')
  expect(nsisTarget).toContain('"StdUtils.nsh"')
  expect(nsisTarget).toMatch(/flags\(\[[^\]]*"force-run"/)

  const generator = read('node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'nsisScriptGenerator.js')
  // flags() emits `!macro _is<Flag>` + `!define is<Flag>`, which is what makes
  // ${isForceRun} a valid LogicLib condition.
  expect(generator).toContain('!macro _${variableName}')
  expect(generator).toContain('!define ${variableName}')
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
