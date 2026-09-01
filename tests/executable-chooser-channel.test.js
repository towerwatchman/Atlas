import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The executable chooser modal originally listened on `init-chooser` while the
// main process sent `init-executable-chooser`, so the candidate list never
// populated and every multi-executable import was unusable. This guards the
// channel alignment across the IPC boundary -- the same class of bug that
// check-ipc-channels.js catches for ipcMain.handle, but the chooser's renderer
// listener lives in a standalone HTML file the channel script does not scan.
//
// The assertions fail against the unfixed code (which only knew `init-chooser`
// and registered its picker listener with `once`) and pass now that both sides
// of each channel agree.

const html = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'assets', 'ui', 'executable-chooser.html'),
  'utf8',
)
const main = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'main.js'),
  'utf8',
)
const importer = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'ipc', 'importer.js'),
  'utf8',
)

describe('executable chooser IPC channel alignment', () => {
  it('renderer listens on the channel main sends to initialise it', () => {
    expect(main).toContain("'init-executable-chooser'")
    expect(html).toContain("electronIPC.on('init-executable-chooser'")
  })

  it('renderer does not listen on the old, mismatched channel', () => {
    // The original bug: it waited on `init-chooser` and the list never filled.
    expect(html).not.toContain("electronIPC.on('init-chooser'")
  })

  it('renderer sends its choice on the channel the importer listens on', () => {
    // The other half of the same boundary: the pick must arrive where the
    // importer is waiting. If either side renames this channel the modal would
    // resolve to null and the import would be skipped. This pins down that
    // the importer listens with `once` on this channel.
    expect(importer).toContain('ipcMain.once("executable-chosen"')
    expect(html).toContain("electronIPC.send('executable-chosen'")
  })
})

// ── showExecutableChooser window changes ─────────────────────────────────────
//
// The chooser window was reskinned and made responsive. These guard the new
// sizing, reuse, and lifecycle behaviour.

const scanner = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'scanners', 'executableScanner.js'),
  'utf8',
)

describe('showExecutableChooser window', () => {
  it('reuses existing window instead of creating a new one', () => {
    expect(main).toContain('executableChooserWindow && !executableChooserWindow.isDestroyed()')
    expect(main).toContain('focusWindow(executableChooserWindow)')
  })

  it('uses responsive sizing based on primary display', () => {
    expect(main).toContain('screen.getPrimaryDisplay().workAreaSize')
    expect(main).toContain('Math.round(sw / 5)')
    expect(main).toContain('Math.round(sh / 2)')
  })

  it('loads saved bounds via applySavedWindowBounds, falling back to responsive size', () => {
    // applySavedWindowBounds loads persisted dimensions from the config; when
    // none exist it returns the defaults passed in (sw/5, sh/2). This is the
    // mechanism that lets the window remember a user-resized size across
    // sessions while still starting responsive on first open.
    expect(main).toContain("applySavedWindowBounds('executableChooser'")
  })

  it('allows resizing the window', () => {
    expect(main).toContain('resizable: true')
  })

  it('nulls executableChooserWindow on close', () => {
    expect(main).toContain("executableChooserWindow.on('closed', () => { executableChooserWindow = null })")
  })

  it('sends data after did-finish-load, not before', () => {
    expect(main).toContain("did-finish-load")
    expect(main).toContain("executableChooserWindow.webContents.send('init-executable-chooser'")
  })
})

// ── Executable scanner logging ───────────────────────────────────────────────
//
// The scanner log was updated to use path.basename(current) instead of the
// full path and to join multiple candidates so blacklist reports are easier.

describe('executable scanner logging', () => {
  it('logs basename only, not full path', () => {
    expect(scanner).toContain('path.basename(current)')
  })

  it('joins multiple candidates in the log message', () => {
    expect(scanner).toContain("matches.join(', ')")
  })

  it('only joins when there are multiple candidates', () => {
    expect(scanner).toContain('matches.length > 1 ?')
  })
})

// ── HTML renderer behaviour ──────────────────────────────────────────────────
//
// The renderer was redesigned from a <select> to a card list with theme
// support. These guard the new renderer's key behaviours.

describe('executable chooser renderer', () => {
  it('applies theme before rendering', () => {
    expect(html).toContain('await applyCurrentTheme()')
  })

  it('reads config and external themes for theme resolution', () => {
    expect(html).toContain('window.electronAPI?.getConfig')
    expect(html).toContain('window.electronAPI.getAvailableThemes')
  })

  it('supports custom themes parsed from JSON', () => {
    expect(html).toContain('appearance.customTheme')
    expect(html).toContain('JSON.parse(appearance.customTheme)')
  })

  it('renders each executable as a clickable item', () => {
    expect(html).toContain("item.className = 'exe-item'")
    expect(html).toContain('item.onclick = () => selectItem(item, exe)')
  })

  it('disables confirm button by default and on re-init', () => {
    expect(html).toContain('disabled')
    expect(html).toContain("document.getElementById('confirm').disabled = true")
  })

  it('enables confirm button when an item is selected', () => {
    expect(html).toContain("document.getElementById('confirm').disabled = false")
  })

  it('sends executable-chosen with selectedExecutable on confirm', () => {
    expect(html).toContain("electronIPC.send('executable-chosen', { selectedExecutable: selectedExe })")
  })

  it('sends executable-chosen with null on cancel', () => {
    expect(html).toContain("electronIPC.send('executable-chosen', { selectedExecutable: null })")
  })

  it('sends executable-chosen with null on close button', () => {
    // The close (x) button must also send null, not just silently close.
    // Without the IPC send the importer's promise would never resolve.
    const closeBtnSection = html.substring(html.indexOf('close-btn'))
    expect(closeBtnSection).toContain("electronIPC.send('executable-chosen', { selectedExecutable: null })")
  })

  it('resets selectedExe on re-init so stale state does not carry over', () => {
    expect(html).toContain('selectedExe = null')
  })

  it('does not reference the old init-chooser channel', () => {
    expect(html).not.toContain('init-chooser')
  })
})
