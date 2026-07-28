import { useEffect, useMemo, useState } from 'react'

/**
 * Every tag used anywhere in the library, ordered by how often it appears.
 *
 * Shared by the per-game editor and the bulk dialog so both suggest from the
 * same set — the point of autocomplete here is to stop one concept drifting into
 * "3DCG" / "3dcg" / "3d cg", which only works if every entry point agrees.
 */
export function useKnownTags({ enabled = true } = {}) {
  const [tags, setTags] = useState(null)

  useEffect(() => {
    if (!enabled || !window.electronAPI?.getKnownTags) return undefined
    let cancelled = false
    window.electronAPI.getKnownTags()
      .then((list) => { if (!cancelled) setTags(Array.isArray(list) ? list : []) })
      .catch(() => { if (!cancelled) setTags([]) })
    return () => { cancelled = true }
  }, [enabled])

  return tags
}

/**
 * Filter a tag pool by what the user has typed, hiding anything already chosen.
 * Kept separate from the fetch so callers can suggest from a narrower pool — the
 * bulk dialog's "remove" field suggests only tags actually present in the
 * selection, since offering library-wide tags there would be noise.
 */
export function useTagSuggestions(pool, query, chosen = [], limit = 8) {
  return useMemo(() => {
    const text = String(query || '').trim().toLowerCase()
    if (!text || !pool) return []
    const taken = new Set(chosen.map((tag) => String(tag).toLowerCase()))
    return pool
      .filter((tag) => tag.toLowerCase().includes(text) && !taken.has(tag.toLowerCase()))
      .slice(0, limit)
  }, [pool, query, chosen, limit])
}
