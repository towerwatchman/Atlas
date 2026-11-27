export const HISTORY_LIMIT = 50

export const VIEWS = ['library', 'browse', 'favorites', 'collections', 'downloads', 'wishlist', 'detail']

export function createHistory() {
  return { entries: [], index: -1 }
}

// Only detail pages carry a game; other views are identified by their filters.
const gameKey = (game) => game?.record_id ?? game?.id ?? null

export function isSamePage(a, b) {
  if (!a || !b || a.view !== b.view) return false
  if (a.view === 'detail') return gameKey(a.game) === gameKey(b.game)
  return a.savedFilterId === b.savedFilterId && a.collectionId === b.collectionId
}

export function currentSnapshot(history) {
  return history.index < 0 ? null : (history.entries[history.index] ?? null)
}

export function pushSnapshot(history, snapshot) {
  if (isSamePage(currentSnapshot(history), snapshot)) {
    const entries = history.entries.slice()
    entries[history.index] = snapshot
    return { entries, index: history.index }
  }

  const kept = history.entries.slice(0, history.index + 1)
  kept.push(snapshot)
  const entries = kept.slice(Math.max(0, kept.length - HISTORY_LIMIT))
  return { entries, index: entries.length - 1 }
}

export function goBack(history) {
  if (history.index <= 0) return null
  const index = history.index - 1
  return { history: { entries: history.entries, index }, snapshot: history.entries[index] }
}

export function goForward(history) {
  if (history.index >= history.entries.length - 1) return null
  const index = history.index + 1
  return { history: { entries: history.entries, index }, snapshot: history.entries[index] }
}

const STORAGE_KEY = 'atlas:view-history-v2'

// Storage can be blocked or full; navigation still works without persistence.
export function saveHistory(history) {
  try {
    const entries = Array.isArray(history?.entries) ? history.entries : []
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, index: history?.index }))
  } catch {
    // Nothing to save if storage is unavailable.
  }
}

const isOptionalString = (value) => value === null || typeof value === 'string'

function isValidEntry(entry) {
  if (!entry || !VIEWS.includes(entry.view)) return false
  if (!isOptionalString(entry.savedFilterId) || !isOptionalString(entry.collectionId)) return false
  if (entry.view !== 'detail') return true
  return Boolean(entry.game) && typeof entry.game === 'object' && !Array.isArray(entry.game)
}

export function loadHistory() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const { entries, index } = JSON.parse(raw)
    if (!Array.isArray(entries) || !entries.every(isValidEntry)) return null
    const inBounds = index === -1
      ? entries.length === 0
      : Number.isInteger(index) && index >= 0 && index < entries.length
    return inBounds ? { entries, index } : null
  } catch {
    return null
  }
}

export function clearHistory() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
