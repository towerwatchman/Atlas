// Maps a clicked Details value to the search payload the grid understands.
//
// Only rows with index coverage become links: Status/Engine/Category travel
// as the structured filters the sidebar uses because their text columns are
// opt-in and absent from the default title/creator/id set. Language has no
// sidebar section, so it travels as `language:` prefixed text the search box
// shows instead. Publisher/Genre/etc. have no field or filter at all and stay
// plain text.
const LABEL_FIELD = {
  Developer: 'developer',
  Category: 'category',
  Engine: 'engine',
  Status: 'status',
  Language: 'language',
}

export function isSearchableDetailField(label) {
  return Object.hasOwn(LABEL_FIELD, String(label))
}

export function detailFieldForLabel(label) {
  return LABEL_FIELD[String(label)] || 'detail'
}

// "English, Japanese" searched literally would match nothing, so multi-value
// rows split into one button per token — the same values the sidebar holds.
const MULTI_VALUE_FIELDS = new Set(['Language', 'Category'])

export function splitDetailValue(label, value) {
  const text = String(value || '').trim()
  if (!text) return []
  if (!MULTI_VALUE_FIELDS.has(String(label))) return [text]
  return text.split(',').map((token) => token.trim()).filter(Boolean)
}

const FILTER_FIELDS = new Set(['tag', 'category', 'engine', 'status'])

export function resolveMetadataSearch(field, value) {
  const text = String(value || '').trim()
  if (!text) return { text: '', filters: {} }
  const key = String(field || '').toLowerCase()
  // Language has no sidebar section, so it travels as prefixed text the search
  // box shows. The prefix scopes to the language field in both modes no
  // matter which fields the user configured.
  if (key === 'language') return { text: `language:${text}`, filters: {} }
  if (FILTER_FIELDS.has(key)) return { text: '', filters: { [key === 'tag' ? 'tags' : key]: [text] } }
  return { text, filters: {} }
}

// Long values would make a giant tooltip, so they name the type instead.
// Kept beside the gesture marker: a remap changes both lines at once.
const TOOLTIP_VALUE_LIMIT = 40

const TYPE_LABEL = {
  tag: 'tag', developer: 'developer', category: 'category',
  engine: 'engine', status: 'status', language: 'language', detail: 'entry',
}

export function searchTooltip(field, token, defaultMode = 'browse') {
  const toBrowse = defaultMode !== 'library'
  const text = String(token || '').trim()
  const subject = text.length > TOOLTIP_VALUE_LIMIT
    ? `this ${TYPE_LABEL[String(field || '').toLowerCase()] || TYPE_LABEL.detail}`
    : `"${text}"`
  if (toBrowse) return `Browse catalog for ${subject}\nShift-click to search Library`
  return `Search Library for ${subject}\nShift-click to browse catalog`
}

// Maps the click-to-search setting + gesture to App's libraryMode.
// 'catalog' is Browse, 'local' is Library. Unknown settings fall back to
// Browse, the same default the tooltips assume.
export function resolveSearchTarget(defaultMode, secondaryMode) {
  const primary = defaultMode === 'library' ? 'local' : 'catalog'
  if (!secondaryMode) return primary
  return primary === 'local' ? 'catalog' : 'local'
}

// Whether an Escape keydown with the detail page open should close it. The
// lightbox closes itself and open modals keep focus, so only a bare Escape
// navigates — and never out of a text input on the first press.
export function escClosesDetail({ lightboxOpen = false, modalOpen = false, inTextInput = false, consumed = false } = {}) {
  return !consumed && !lightboxOpen && !modalOpen && !inTextInput
}

// keymap:search-mode-gesture — Shift-click is the secondary-mode gesture. The
// setting picks what plain click does, so this is the only modifier
// GameDetailPage needs to report. Hard-coded for now; wire to the keymap
// settings when click-gesture remapping lands.
export function isSecondaryModeClick(event) {
  return event?.shiftKey === true
}
