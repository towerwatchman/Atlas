// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { readBindings, buildShortcutIndex, settingsPageActionId } from '../src/lib/keyboardShortcuts.js'
import Settings from '../src/components/settings/Settings.jsx'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')
const has = (src, needle) => expect(src.includes(needle), needle).toBe(true)

const bodyOf = (src, declaration) => {
  const start = src.indexOf(declaration)
  if (start < 0) return ''
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return ''
}

let onSettingsTabCallback
let offSettingsTab
let quitApp

beforeEach(() => {
  cleanup()
  onSettingsTabCallback = null
  offSettingsTab = vi.fn()
  quitApp = vi.fn()
  window.history.replaceState({}, '', '/settings.html')
  vi.stubGlobal('window', Object.assign(window, {
    electronAPI: {
      getConfig: async () => ({}),
      onSettingsTab: (callback) => { onSettingsTabCallback = callback; return offSettingsTab },
      onShortcutsChanged: () => () => {},
      onStartSettingsTour: () => () => {},
      onWindowStateChanged: () => () => {},
      onUpdateStatus: () => () => {},
      getKnownTags: async () => ['3dcg', 'fantasy'],
      getTagState: async () => ({ tags: [], catalogTags: [], overridden: false }),
      setTagOverride: async () => ({ success: true }),
      resetTagOverride: async () => ({ success: true }),
      bulkEditTags: async () => ({ success: true }),
      getUniqueFilterOptions: async () => ({
        tags: [], categories: [], engines: [], statuses: [], censored: [],
      }),
      getAppUpdateState: async () => ({ status: 'idle' }),
      getExtensionStatus: async () => ({ running: false, port: 57096, extensionPath: '/test/ext' }),
      getExtensionPath: async () => ({ extensionPath: '/test/ext', exists: false }),
      showContextMenu: () => {},
      minimizeWindow: () => {},
      maximizeWindow: () => {},
      closeWindow: () => {},
      quitApp,
    },
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mount = async () => {
  let result
  await act(async () => { result = render(<Settings />) })
  return result
}

const heading = (name) => screen.getAllByRole('heading', { name })[0]

describe('Settings reacts to settings-page shortcuts', () => {
  const settings = () => read('src/components/settings/Settings.jsx')

  it('uses the URL tab and checks it against the visible tabs', () => {
    const src = settings()
    has(src, "from '../../lib/keyboardShortcuts.js'")
    for (const name of ['buildShortcutIndex', 'comboFromEvent', 'readBindings', 'settingsPageActionId']) {
      has(src, name)
    }
    has(src, "const SETTINGS_PAGE_PREFIX = settingsPageActionId('')")
    has(src, 'const isVisibleTab = (tab) => visibleSettingsTabs.some((item) => item.name === tab)')
    has(src, "new URLSearchParams(window.location.search).get('tab')")
    has(src, 'if (isVisibleTab(tab)) setSelected(tab)')
  })

  it('subscribes to settings-tab and unsubscribes on unmount', () => {
    const src = settings()
    has(src, 'window.electronAPI.onSettingsTab?.((tab) =>')
    has(src, 'if (isVisibleTab(tab)) setSelected(tab)')
    has(src, 'if (typeof off === \'function\') off()')
  })

  it('keeps the local shortcut index in step with saved bindings', () => {
    const src = settings()
    has(src, 'const shortcutIndex = useMemo(() => buildShortcutIndex(shortcutBindings), [shortcutBindings])')
    has(src, 'window.electronAPI?.onShortcutsChanged?.((bindings) =>')
    has(src, 'setShortcutBindings(readBindings(bindings))')
  })

  it('switches tabs only for visible settings-page combos and guards repeats, typing and modals', () => {
    const src = settings()
    const keyDown = bodyOf(src, 'const onKeyDown = (event) =>')
    has(keyDown, 'if (event.repeat || event.defaultPrevented || tourOpen || isTextInputTarget(event.target)) return')
    has(keyDown, 'const combo = comboFromEvent(event)')
    has(keyDown, 'const actionId = shortcutIndex[combo]')
    has(keyDown, 'actionId?.startsWith(SETTINGS_PAGE_PREFIX)')
    has(keyDown, 'if (!isVisibleTab(tab)) return')
    has(keyDown, 'event.preventDefault()')
    has(keyDown, 'setSelected(tab)')
    has(src, "window.addEventListener('keydown', onKeyDown)")
    has(src, "window.removeEventListener('keydown', onKeyDown)")
  })

  it('dispatches quit globally but keeps other non-tab actions gated', () => {
    const keyDown = bodyOf(settings(), 'const onKeyDown = (event) =>')
    has(keyDown, "if (actionId === 'quit')")
    has(keyDown, 'window.electronAPI.quitApp?.()')
    has(keyDown, 'if (!actionId?.startsWith(SETTINGS_PAGE_PREFIX)) return')
  })

  it('records Ctrl+K for the Shortcuts page in the shared defaults', () => {
    const bindings = readBindings({})
    expect(bindings[settingsPageActionId('Shortcuts')]).toEqual(['Ctrl+K'])
    expect(buildShortcutIndex(bindings)['Ctrl+K']).toBe(settingsPageActionId('Shortcuts'))
  })
})

describe('Settings tab switching at runtime', () => {
  it('starts on a visible tab from the URL and ignores hidden ones', async () => {
    window.history.replaceState({}, '', '/settings.html?tab=Shortcuts')
    await mount()
    expect(heading('Shortcuts')).toBeTruthy()

    cleanup()
    window.history.replaceState({}, '', '/settings.html?tab=Platforms')
    await mount()
    expect(heading('Interface')).toBeTruthy()
  })

  it('switches on settings-tab broadcasts and cleans up its listener', async () => {
    const { unmount } = await mount()
    expect(typeof onSettingsTabCallback).toBe('function')

    await act(async () => { onSettingsTabCallback('Database') })
    expect(heading('Database')).toBeTruthy()

    await act(async () => { onSettingsTabCallback('Platforms') })
    expect(heading('Database')).toBeTruthy()

    unmount()
    expect(offSettingsTab).toHaveBeenCalled()
  })

  it('switches to Shortcuts on Ctrl+K but ignores repeats and typing targets', async () => {
    await mount()
    expect(heading('Interface')).toBeTruthy()

    await act(async () => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
    expect(heading('Shortcuts')).toBeTruthy()

    await act(async () => { onSettingsTabCallback('Interface') })
    await act(async () => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true, repeat: true }) })
    expect(heading('Interface')).toBeTruthy()

    const input = document.createElement('input')
    document.body.appendChild(input)
    await act(async () => { fireEvent.keyDown(input, { key: 'k', ctrlKey: true }) })
    expect(heading('Interface')).toBeTruthy()
    input.remove()
  })

  it('quits on Ctrl+Q but ignores main-window view combos', async () => {
    await mount()
    await act(async () => { fireEvent.keyDown(window, { key: 'q', ctrlKey: true }) })
    expect(quitApp).toHaveBeenCalledTimes(1)

    await act(async () => { fireEvent.keyDown(window, { key: '1', ctrlKey: true }) })
    expect(quitApp).toHaveBeenCalledTimes(1)
  })
})
