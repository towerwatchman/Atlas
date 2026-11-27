import { describe, it, expect } from 'vitest'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_CATEGORIES,
  settingsPageActionId,
  settingsPageAction,
  DEFAULT_SHORTCUT_BINDINGS,
  comboFromEvent,
  comboFromMouseEvent,
  hasModifier,
  normalizeCombo,
  conflictOwner,
  readBindings,
  writeBindings,
  buildShortcutIndex,
} from '../src/lib/keyboardShortcuts.js'

const key = (keyName, flags = {}) => ({ key: keyName, repeat: false, ...flags })

const CONFIG = (bindings) => ({ Shortcuts: { bindings } })

describe('keyboardShortcuts action list', () => {
  it('exports the categories used by the action list', () => {
    expect(SHORTCUT_CATEGORIES).toEqual(['Navigation', 'Panels', 'Game', 'Settings pages', 'Tools'])
    const coreCategories = new Set(SHORTCUT_ACTIONS.map((action) => action.category))
    for (const category of coreCategories) expect(SHORTCUT_CATEGORIES).toContain(category)
    // Settings-page rows are generated from settingsIcons, not the core list.
    expect(SHORTCUT_CATEGORIES.filter((category) => !coreCategories.has(category)))
      .toEqual(['Settings pages'])
  })

  it('has exactly the agreed actions in the agreed categories', () => {
    expect(SHORTCUT_ACTIONS.map((action) => [action.id, action.category])).toEqual([
      ['openViewLibrary', 'Navigation'],
      ['openViewBrowse', 'Navigation'],
      ['openViewFavorites', 'Navigation'],
      ['openViewCollections', 'Navigation'],
      ['openViewWishlist', 'Navigation'],
      ['openViewDownloads', 'Navigation'],
      ['navigateBack', 'Navigation'],
      ['navigateForward', 'Navigation'],
      ['focusSearch', 'Panels'],
      ['toggleFilterSidebar', 'Panels'],
      ['toggleGameList', 'Panels'],
      ['wishlistCurrentGame', 'Game'],
      ['blacklistCurrentGame', 'Game'],
      ['installCurrentGame', 'Game'],
      ['openImporter', 'Tools'],
      ['importManually', 'Tools'],
      ['quit', 'Tools'],
      ['openSettings', 'Tools'],
    ])
  })

  it('has no group, slot, scope, mouse or lifecycle fields', () => {
    const forbiddenIds = [
      'openView', 'openSubCategory', 'openSettingsPage', 'openQuickCustomizations',
      'togglePrivacy', 'cyclePrivacyBlur', 'restart', 'reload', 'currentShortcutGame',
    ]
    const ids = SHORTCUT_ACTIONS.map((action) => action.id)
    expect(ids.filter((id) => forbiddenIds.includes(id))).toEqual([])
    for (const action of SHORTCUT_ACTIONS) {
      for (const field of ['kind', 'slots', 'scope', 'button']) {
        expect(action[field]).toBeUndefined()
      }
    }
    expect(ids.some((id) => /mouse/i.test(id))).toBe(false)
  })

  it('requires a modifier only for the wishlist and blacklist game actions', () => {
    const modified = SHORTCUT_ACTIONS.filter((action) => action.requiresModifier)
    expect(modified.map((action) => action.id)).toEqual([
      'wishlistCurrentGame', 'blacklistCurrentGame',
    ])
    for (const action of modified) expect(action.requiresModifier).toBe(true)
    expect(SHORTCUT_ACTIONS.find((action) => action.id === 'installCurrentGame').requiresModifier)
      .toBeUndefined()
  })

  it('ships only non-conflicting ordinary defaults and none for Back or Forward', () => {
    expect(DEFAULT_SHORTCUT_BINDINGS).toEqual({
      openViewLibrary: ['Ctrl+1'],
      openViewBrowse: ['Ctrl+2'],
      openViewFavorites: ['Ctrl+3'],
      openViewCollections: ['Ctrl+4'],
      openViewWishlist: ['Ctrl+5'],
      openViewDownloads: ['Ctrl+D'],
      focusSearch: ['Ctrl+F'],
      toggleFilterSidebar: ['F'],
      toggleGameList: ['G'],
      'openSettingsPage:Shortcuts': ['Ctrl+K'],
      quit: ['Ctrl+Q'],
    })
    expect(DEFAULT_SHORTCUT_BINDINGS.navigateBack).toBeUndefined()
    expect(DEFAULT_SHORTCUT_BINDINGS.navigateForward).toBeUndefined()
    const defaults = Object.values(DEFAULT_SHORTCUT_BINDINGS).flat()
    expect(new Set(defaults).size).toBe(defaults.length)
  })
})

describe('settings page actions', () => {
  it('builds an id and a binding-row descriptor for a page', () => {
    expect(settingsPageActionId('Interface')).toBe('openSettingsPage:Interface')
    expect(settingsPageAction('Interface')).toEqual({
      id: 'openSettingsPage:Interface',
      label: 'Open Interface',
      category: 'Settings pages',
    })
  })

  it('accepts settings-page ids in stored bindings without adding core actions', () => {
    const bindings = readBindings(CONFIG(JSON.stringify({
      'openSettingsPage:Interface': ['Ctrl+9'],
      'openSettingsPage:Platforms': ['Ctrl+8'],
    })))
    expect(bindings['openSettingsPage:Interface']).toEqual(['Ctrl+9'])
    expect(bindings['openSettingsPage:Platforms']).toEqual(['Ctrl+8'])
    expect(SHORTCUT_ACTIONS).toHaveLength(18)
  })
})

describe('comboFromEvent', () => {
  it('captures a modified printable key in canonical form', () => {
    expect(comboFromEvent(key('a', { ctrlKey: true }))).toBe('Ctrl+A')
    expect(comboFromEvent(key('1', { ctrlKey: true }))).toBe('Ctrl+1')
    expect(comboFromEvent(key('b', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+B')
    expect(comboFromEvent(key(' ', { altKey: true }))).toBe('Alt+Space')
  })

  it('captures named keys with modifiers', () => {
    expect(comboFromEvent(key('F5', { ctrlKey: true }))).toBe('Ctrl+F5')
    expect(comboFromEvent(key('ArrowLeft', { ctrlKey: true }))).toBe('Ctrl+ArrowLeft')
  })

  it('ignores repeats, missing events, modifier-only presses and mouse buttons', () => {
    expect(comboFromEvent(null)).toBeNull()
    expect(comboFromEvent(key('a', { ctrlKey: true, repeat: true }))).toBeNull()
    expect(comboFromEvent(key('Control', { ctrlKey: true }))).toBeNull()
    expect(comboFromEvent(key('Shift', { shiftKey: true }))).toBeNull()
    expect(comboFromEvent({ button: 3 })).toBeNull()
  })

  it('reserves bare control keys but allows them with a modifier', () => {
    for (const keyName of ['Escape', 'Backspace', 'Tab', 'Enter', 'Delete', 'ArrowUp', 'ArrowLeft']) {
      expect(comboFromEvent(key(keyName))).toBeNull()
      expect(comboFromEvent(key(keyName, { ctrlKey: true }))).toBe(`Ctrl+${keyName}`)
    }
  })
})

describe('comboFromMouseEvent', () => {
  it('maps the back and forward mouse buttons to combos', () => {
    expect(comboFromMouseEvent({ button: 3 })).toBe('Mouse3')
    expect(comboFromMouseEvent({ button: 4 })).toBe('Mouse4')
  })

  it('ignores other buttons and missing events', () => {
    for (const event of [null, undefined, {}, { button: 0 }, { button: 1 }, { button: 2 }, { button: 5 }]) {
      expect(comboFromMouseEvent(event)).toBeNull()
    }
  })
})

describe('hasModifier', () => {
  it('recognizes modifiers regardless of order or case', () => {
    for (const combo of ['Ctrl+A', 'shift+ctrl+f', ' alt + b ', 'Meta+Mouse4']) {
      expect(hasModifier(combo)).toBe(true)
    }
  })

  it('rejects bare keys, mouse combos and invalid input', () => {
    for (const combo of ['A', 'F1', 'Mouse3', 'Mouse4', 'bogus', 'Ctrl+', null, undefined]) {
      expect(hasModifier(combo)).toBe(false)
    }
  })
})

describe('normalizeCombo', () => {
  it('orders modifiers and uppercases letters', () => {
    expect(normalizeCombo('shift+ctrl+a')).toBe('Ctrl+Shift+A')
    expect(normalizeCombo(' meta + alt + b ')).toBe('Alt+Meta+B')
    expect(normalizeCombo('ctrl+ctrl+c')).toBe('Ctrl+C')
  })

  it('keeps a plus key and a multi-character key name intact', () => {
    expect(normalizeCombo('ctrl++')).toBe('Ctrl++')
    expect(normalizeCombo('Ctrl+PageDown')).toBe('Ctrl+PageDown')
    expect(normalizeCombo('F1')).toBe('F1')
  })

  it('keeps mouse button combos intact', () => {
    expect(normalizeCombo('Mouse3')).toBe('Mouse3')
    expect(normalizeCombo('ctrl+mouse4')).toBe('Ctrl+Mouse4')
  })

  it('rejects malformed combos and reserved bare keys', () => {
    for (const value of [null, '', '   ', 'Ctrl+', 'A+B', 'Ctrl+AB', 'Ctrl++A', 'Escape', 'Tab']) {
      expect(normalizeCombo(value)).toBeNull()
    }
  })
})

describe('conflictOwner', () => {
  const bindings = {
    openViewLibrary: ['Ctrl+1'],
    focusSearch: ['Ctrl+F'],
  }

  it('finds another action claiming the candidate combo', () => {
    expect(conflictOwner(bindings, 'openViewBrowse', 'ctrl+1')).toBe('openViewLibrary')
    expect(conflictOwner(bindings, 'openSettings', 'CTRL+f')).toBe('focusSearch')
  })

  it('ignores the edited action and unclaimed combos', () => {
    expect(conflictOwner(bindings, 'openViewLibrary', 'Ctrl+1')).toBeNull()
    expect(conflictOwner(bindings, 'openViewBrowse', 'Ctrl+9')).toBeNull()
    expect(conflictOwner(bindings, 'openViewBrowse', 'nonsense')).toBeNull()
  })

  it('returns the first owner in binding order', () => {
    expect(conflictOwner({ focusSearch: ['Ctrl+K'], openSettings: ['Ctrl+K'] }, 'openImporter', 'Ctrl+K'))
      .toBe('focusSearch')
  })

  it('checks every combo of every other action', () => {
    const multi = { focusSearch: ['Ctrl+F', 'Ctrl+K'] }
    expect(conflictOwner(multi, 'openSettings', 'ctrl+k')).toBe('focusSearch')
    expect(conflictOwner(multi, 'focusSearch', 'Ctrl+K')).toBeNull()
  })
})

describe('config encode and decode', () => {
  it('applies defaults only to actions the user did not configure', () => {
    const bindings = readBindings(CONFIG(JSON.stringify({ focusSearch: ['Ctrl+F'] })))
    expect(bindings.focusSearch).toEqual(['Ctrl+F'])
    expect(bindings.openViewLibrary).toEqual(['Ctrl+1'])
    expect(bindings.navigateBack).toBeUndefined()
  })

  it('treats an explicitly emptied row as configured', () => {
    const bindings = readBindings(CONFIG(JSON.stringify({ openViewLibrary: [] })))
    expect(bindings.openViewLibrary).toEqual([])
    expect(bindings.openViewBrowse).toEqual(['Ctrl+2'])
  })

  it('normalizes stored combos and drops unusable ones', () => {
    const bindings = readBindings(CONFIG(JSON.stringify({
      focusSearch: ['shift+ctrl+f'],
      toggleGameList: ['bogus'],
      openImporter: ['Ctrl++'],
    })))
    expect(bindings.focusSearch).toEqual(['Ctrl+Shift+F'])
    expect(bindings.toggleGameList).toEqual(['G'])
    expect(bindings.openImporter).toEqual(['Ctrl++'])
  })

  it('ignores bad JSON and unknown action ids without throwing', () => {
    expect(readBindings(CONFIG('{not json'))).toEqual(DEFAULT_SHORTCUT_BINDINGS)
    expect(readBindings(CONFIG(JSON.stringify({ obsoleteAction: ['Ctrl+9'] }))))
      .toEqual(DEFAULT_SHORTCUT_BINDINGS)
    expect(readBindings(undefined)).toEqual(DEFAULT_SHORTCUT_BINDINGS)
  })

  it('round trips through writeBindings as a JSON string', () => {
    const bindings = { focusSearch: ['Ctrl+F'], openViewLibrary: ['Ctrl+1'] }
    const serialized = writeBindings(bindings)
    expect(typeof serialized).toBe('string')
    expect(JSON.parse(serialized)).toEqual(bindings)
    expect(readBindings(CONFIG(serialized))).toEqual({
      focusSearch: ['Ctrl+F'],
      openViewLibrary: ['Ctrl+1'],
      openViewBrowse: ['Ctrl+2'],
      openViewFavorites: ['Ctrl+3'],
      openViewCollections: ['Ctrl+4'],
      openViewWishlist: ['Ctrl+5'],
      openViewDownloads: ['Ctrl+D'],
      toggleFilterSidebar: ['F'],
      toggleGameList: ['G'],
      'openSettingsPage:Shortcuts': ['Ctrl+K'],
      quit: ['Ctrl+Q'],
    })
  })

  it('round trips multiple combos for one action', () => {
    const bindings = { focusSearch: ['Ctrl+F', 'Alt+F'], openViewLibrary: ['ctrl+1', 'CTRL+9'] }
    const parsed = readBindings(CONFIG(writeBindings(bindings)))
    expect(parsed.focusSearch).toEqual(['Ctrl+F', 'Alt+F'])
    expect(parsed.openViewLibrary).toEqual(['Ctrl+1', 'Ctrl+9'])
  })

  it('preserves mouse combos through a round trip', () => {
    const bindings = { navigateBack: ['Mouse3'], navigateForward: ['Mouse4'] }
    expect(readBindings(CONFIG(writeBindings(bindings)))).toMatchObject(bindings)
  })

  it('drops modifier-less combos from actions that require a modifier', () => {
    const bindings = readBindings(CONFIG(JSON.stringify({
      wishlistCurrentGame: ['F2', 'Ctrl+W'],
      blacklistCurrentGame: ['Ctrl+B', 'B'],
    })))
    expect(bindings.wishlistCurrentGame).toEqual(['Ctrl+W'])
    expect(bindings.blacklistCurrentGame).toEqual(['Ctrl+B'])
    expect(readBindings(CONFIG(JSON.stringify({ wishlistCurrentGame: ['F2', 'bogus'] }))))
      .not.toHaveProperty('wishlistCurrentGame')
  })

  it('keeps an explicitly cleared modifier-required row empty', () => {
    const bindings = readBindings(CONFIG(JSON.stringify({ wishlistCurrentGame: [] })))
    expect(bindings.wishlistCurrentGame).toEqual([])
  })
})

describe('buildShortcutIndex', () => {
  it('maps normalized combos to one action id with no expansion', () => {
    const index = buildShortcutIndex({
      openViewLibrary: ['ctrl+1'],
      focusSearch: ['SHIFT+CTRL+f'],
    })
    expect(index).toEqual({ 'Ctrl+1': 'openViewLibrary', 'Ctrl+Shift+F': 'focusSearch' })
    expect(Object.keys(index)).toHaveLength(2)
    expect(index['Ctrl+1+1']).toBeUndefined()
  })

  it('keeps the first claim when a combo is duplicated and skips invalid values', () => {
    const index = buildShortcutIndex({
      openViewLibrary: ['Ctrl+1'],
      openViewBrowse: ['ctrl+1', 'bogus'],
    })
    expect(index).toEqual({ 'Ctrl+1': 'openViewLibrary' })
  })
})
