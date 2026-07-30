import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const NSIS_TEMPLATES = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis')
const readTemplate = (...parts) => fs.readFileSync(path.join(NSIS_TEMPLATES, ...parts), 'utf8')

const installerNsh = () => read('build', 'installer.nsh')

// ── The change ──────────────────────────────────────────────────────────────

// The installer is shown, not hidden. Its own window is the progress UI and its
// finish page is both the "done" signal and the relaunch. Nothing we render could
// cover the gap anyway, since this process must exit for the installer to replace
// its own files.
test('updates install non-silently, everywhere', () => {
  const calls = [
    ...(read('electron', 'ipc', 'updater.js').match(/quitAndInstall\([^)]*\)/g) || []),
    ...(read('electron', 'main.js').match(/quitAndInstall\([^)]*\)/g) || []),
  ]
  expect(calls).toHaveLength(3)
  for (const call of calls) expect(call).toBe('quitAndInstall(false, true)')
})

// The relaunch is MUI_FINISHPAGE_RUN -> StartApp. It only exists when
// HIDE_RUN_AFTER_FINISH is undefined, which requires runAfterFinish !== false.
// Setting runAfterFinish:false would install updates and never reopen Atlas.
test('runAfterFinish is enabled, so the finish page can relaunch', () => {
  expect(JSON.parse(read('package.json')).build.nsis.runAfterFinish).not.toBe(false)

  const nsisTarget = read('node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js')
  expect(nsisTarget).toMatch(/runAfterFinish === false\)\s*\{\s*defines\.HIDE_RUN_AFTER_FINISH = null/)

  const assisted = readTemplate('assistedInstaller.nsh')
  const run = assisted.slice(assisted.indexOf('!ifndef HIDE_RUN_AFTER_FINISH'))
  expect(run).toContain('!define MUI_FINISHPAGE_RUN')
  expect(run).toMatch(/MUI_FINISHPAGE_RUN_FUNCTION\s+"StartApp"/)
})

// StartApp is only compiled when customFinishPage is NOT defined. A previous
// attempt defined it as empty to remove the click, which deleted the only thing
// that relaunched the app: the install succeeded and Atlas stayed closed.
test('installer.nsh does not override the finish page or hand-roll a relaunch', () => {
  const nsh = installerNsh()
  expect(nsh).not.toContain('customFinishPage')
  expect(nsh).not.toContain('ExecShellAsUser')
  expect(nsh).not.toContain('SetAutoClose')
  expect(nsh).not.toContain('SpiderBanner')
})

// Atlas launches game executables, so it must not inherit the installer's
// elevated token. The stock StartApp uses ExecShellAsUser for exactly this.
test('the stock relaunch drops elevation and passes --updated', () => {
  const assisted = readTemplate('assistedInstaller.nsh')
  // Anchor the end search to the start: instFilesPre's FunctionEnd appears
  // earlier in the file, so an unanchored indexOf slices backwards.
  const startIdx = assisted.indexOf('Function StartApp')
  const fn = assisted.slice(startIdx, assisted.indexOf('FunctionEnd', startIdx))
  expect(fn).toContain('${StdUtils.ExecShellAsUser}')
  expect(fn).toContain('$launchLink')
  expect(fn).toContain('--updated')
  expect(fn).not.toMatch(/^\s*Exec(Wait)?\s/m)
})

// quitAndInstall discards isForceRunAfter when isSilent is false and reads
// autoRunAppAfterInstall instead, so it is set explicitly rather than left to a
// library default.
test('the relaunch opt-in is explicit, not inherited from a default', () => {
  expect(read('electron', 'main.js')).toMatch(/autoUpdater\.autoRunAppAfterInstall = true/)
  expect(read('node_modules', 'electron-updater', 'out', 'BaseUpdater.js'))
    .toContain('isSilent ? isForceRunAfter : this.autoRunAppAfterInstall')
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
// With the installer visible, this is what keeps an update from showing the
// wizard. If an upgrade dropped it, every user would get a directory prompt
// mid-update.
test('the directory page is still skipped on updates', () => {
  const assisted = readTemplate('assistedInstaller.nsh')
  const dirPage = assisted.slice(
    assisted.indexOf('!ifdef allowToChangeInstallationDirectory'),
    assisted.indexOf('!insertmacro MUI_PAGE_DIRECTORY'),
  )
  expect(dirPage).toContain('!insertmacro skipPageIfUpdated')

  const common = readTemplate('common.nsh')
  const macro = common.slice(
    common.indexOf('!macro skipPageIfUpdated'),
    common.indexOf('!macroend', common.indexOf('!macro skipPageIfUpdated')),
  )
  expect(macro).toContain('${if} ${isUpdated}')
  expect(macro).toContain('Abort')
})

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
