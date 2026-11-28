const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const EVENT_MODIFIERS = [
  ['ctrlKey', 'Ctrl'],
  ['altKey', 'Alt'],
  ['shiftKey', 'Shift'],
  ['metaKey', 'Meta'],
]
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta']

// These keys drive dialogs and text navigation, so they stay reserved when bare.
const RESERVED_BARE_KEYS = new Set([
  'Escape', 'Backspace', 'Tab', 'Enter', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])

const NAMED_KEYS = new Set([
  'Space', 'Escape', 'Backspace', 'Tab', 'Enter', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Mouse3', 'Mouse4',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
])

function canonicalKeyToken(part) {
  for (const key of NAMED_KEYS) {
    if (key.toLowerCase() === part.toLowerCase()) return key
  }
  // Uppercasing some characters expands them, which would break the round trip
  // through config. Keep the original in that case.
  if ([...part].length !== 1 || /[\p{C}\p{Z}]/u.test(part)) return null
  const upper = part.toUpperCase()
  return [...upper].length === 1 ? upper : part
}

export const SHORTCUT_CATEGORIES = ['Navigation', 'Panels', 'Game', 'Settings pages', 'Tools']

export const SHORTCUT_ACTIONS = [
  { id: 'openViewLibrary', label: 'Open Library', category: 'Navigation' },
  { id: 'openViewBrowse', label: 'Open Browse', category: 'Navigation' },
  { id: 'openViewFavorites', label: 'Open Favorites', category: 'Navigation' },
  { id: 'openViewCollections', label: 'Open Collections', category: 'Navigation' },
  { id: 'openViewWishlist', label: 'Open Wishlist', category: 'Navigation' },
  { id: 'openViewDownloads', label: 'Open Downloads', category: 'Navigation' },
  { id: 'navigateBack', label: 'Navigate back', category: 'Navigation' },
  { id: 'navigateForward', label: 'Navigate forward', category: 'Navigation' },
  { id: 'focusSearch', label: 'Focus search', category: 'Panels' },
  { id: 'toggleFilterSidebar', label: 'Toggle filter sidebar', category: 'Panels' },
  { id: 'toggleGameList', label: 'Toggle game list', category: 'Panels' },
  { id: 'wishlistCurrentGame', label: 'Wishlist current game', category: 'Game', requiresModifier: true },
  { id: 'blacklistCurrentGame', label: 'Blacklist current game', category: 'Game', requiresModifier: true },
  { id: 'installCurrentGame', label: 'Install current game', category: 'Game' },
  { id: 'openImporter', label: 'Open importer', category: 'Tools' },
  { id: 'importManually', label: 'Import manually', category: 'Tools' },
  { id: 'quit', label: 'Quit', category: 'Tools' },
  { id: 'openSettings', label: 'Open settings', category: 'Tools' },
]

const SETTINGS_PAGE_PREFIX = 'openSettingsPage:'

export function settingsPageActionId(name) {
  return `${SETTINGS_PAGE_PREFIX}${name}`
}

export function settingsPageAction(name) {
  // Extra bindings are built from the visible Settings tabs, not the core list.
  return { id: settingsPageActionId(name), label: `Open ${name}`, category: 'Settings pages' }
}

const ACTION_IDS = new Set(SHORTCUT_ACTIONS.map((action) => action.id))
const MODIFIER_REQUIRED_IDS = new Set(
  SHORTCUT_ACTIONS.filter((action) => action.requiresModifier).map((action) => action.id),
)

function isKnownActionId(id) {
  return ACTION_IDS.has(id) || id.startsWith(SETTINGS_PAGE_PREFIX)
}

export const DEFAULT_SHORTCUT_BINDINGS = {
  openViewLibrary: ['Ctrl+1'],
  openViewBrowse: ['Ctrl+2'],
  openViewFavorites: ['Ctrl+3'],
  openViewCollections: ['Ctrl+4'],
  openViewWishlist: ['Ctrl+5'],
  openViewDownloads: ['Ctrl+D'],
  navigateBack: ['Mouse3', 'Ctrl+ArrowLeft'],
  navigateForward: ['Mouse4', 'Ctrl+ArrowRight'],
  focusSearch: ['Ctrl+F'],
  toggleFilterSidebar: ['F'],
  toggleGameList: ['G'],
  'openSettingsPage:Shortcuts': ['Ctrl+K'],
  quit: ['Ctrl+Q'],
}

export function comboFromEvent(event) {
  if (!event || event.repeat) return null
  if (typeof event.key !== 'string' || !event.key) return null
  if (MODIFIER_KEYS.has(event.key)) return null

  const mods = EVENT_MODIFIERS.filter(([flag]) => event[flag]).map(([, label]) => label)
  const keyPart = canonicalKeyToken(event.key === ' ' ? 'Space' : event.key)
  if (!keyPart || (mods.length === 0 && RESERVED_BARE_KEYS.has(keyPart))) return null
  return [...mods, keyPart].join('+')
}

export function comboFromMouseEvent(event) {
  if (!event) return null
  if (event.button === 3) return 'Mouse3'
  if (event.button === 4) return 'Mouse4'
  return null
}

export function normalizeCombo(value) {
  if (typeof value !== 'string') return null
  const split = value.split('+')
  // A '+' key adds an extra empty segment: 'Ctrl++' splits into three parts.
  if (split.length > 2 && split[split.length - 1] === '' && split[split.length - 2] === '') {
    split.splice(split.length - 2, 1)
    split[split.length - 1] = '+'
  }
  if (split.some((part) => !part.trim())) return null
  const parts = split.map((part) => part.trim())

  const mods = new Set()
  const keys = []
  for (const part of parts) {
    const mod = MODIFIER_ORDER.find((label) => label.toLowerCase() === part.toLowerCase())
    if (mod) mods.add(mod)
    else keys.push(part)
  }
  if (keys.length !== 1) return null

  const keyPart = canonicalKeyToken(keys[0])
  if (!keyPart || (mods.size === 0 && RESERVED_BARE_KEYS.has(keyPart))) return null
  return [...MODIFIER_ORDER.filter((mod) => mods.has(mod)), keyPart].join('+')
}

export function hasModifier(combo) {
  const normalized = normalizeCombo(combo)
  return Boolean(normalized)
    && normalized.split('+').slice(0, -1).some((part) => MODIFIER_ORDER.includes(part))
}

function storedCombos(values) {
  return (Array.isArray(values) ? values : [values]).map(normalizeCombo).filter(Boolean)
}

export function conflictOwner(bindings, actionId, candidate) {
  const combo = normalizeCombo(candidate)
  if (!combo) return null
  for (const [id, values] of Object.entries(bindings || {})) {
    if (id !== actionId && storedCombos(values).includes(combo)) return id
  }
  return null
}

export function readBindings(config) {
  const raw = typeof config === 'string' ? config : config?.Shortcuts?.bindings
  let parsed = null
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      // A hand-edited config must not swallow the working defaults.
      parsed = null
    }
  }

  const bindings = {}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [id, value] of Object.entries(parsed)) {
      if (!isKnownActionId(id)) continue
      const combos = storedCombos(value).filter(
        (combo) => !MODIFIER_REQUIRED_IDS.has(id) || hasModifier(combo),
      )
      // An emptied row is a saved choice; a row with no usable combo is not.
      if (combos.length) bindings[id] = combos
      else if (Array.isArray(value) && value.length === 0) bindings[id] = []
    }
  }

  for (const [id, combos] of Object.entries(DEFAULT_SHORTCUT_BINDINGS)) {
    if (!Object.prototype.hasOwnProperty.call(bindings, id)) bindings[id] = combos.slice()
  }
  return bindings
}

export function writeBindings(bindings) {
  return JSON.stringify(bindings || {})
}

export function buildShortcutIndex(bindings) {
  const index = {}
  for (const [id, values] of Object.entries(bindings || {})) {
    for (const combo of storedCombos(values)) {
      if (!index[combo]) index[combo] = id
    }
  }
  return index
}
