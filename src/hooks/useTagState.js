import { useCallback, useEffect, useState } from 'react'

const EMPTY = { tags: [], catalogTags: [], overridden: false }

/**
 * Loads and persists one game's tag list.
 *
 * The editor is seeded from whatever the database currently resolves — the
 * catalog list when there is no override — so a user's first edit starts from
 * the scraped tags rather than a blank field.
 *
 * Writes are optimistic: the chips update immediately and roll back if the main
 * process rejects. Tag edits are frequent and fiddly (add one, remove two), and
 * waiting on a round trip per chip makes the field feel broken.
 */
export function useTagState(recordId, { onSaved } = {}) {
  const [state, setState] = useState(EMPTY)
  const [loading, setLoading] = useState(Boolean(recordId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!recordId || !window.electronAPI?.getTagState) {
      setState(EMPTY)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await window.electronAPI.getTagState(recordId)
      setState({
        tags: Array.isArray(next?.tags) ? next.tags : [],
        catalogTags: Array.isArray(next?.catalogTags) ? next.catalogTags : [],
        overridden: next?.overridden === true,
      })
      setError('')
    } catch (err) {
      console.error('Failed to load tags:', err)
      setError(err?.message || 'Failed to load tags')
    } finally {
      setLoading(false)
    }
  }, [recordId])

  useEffect(() => { load() }, [load])

  const applyTags = useCallback(async (nextTags) => {
    if (!recordId) return
    const previous = state
    // Optimistic: `overridden` becomes true the moment they touch it, which is
    // what makes the Reset button appear without waiting for the write.
    setState((current) => ({ ...current, tags: nextTags, overridden: true }))
    setBusy(true)
    try {
      const result = await window.electronAPI.setTagOverride({ recordId, tags: nextTags })
      if (result?.success === false) {
        setState(previous)
        setError(result.error || 'Failed to save tags')
        return
      }
      setState({
        tags: Array.isArray(result?.tags) ? result.tags : nextTags,
        catalogTags: Array.isArray(result?.catalogTags) ? result.catalogTags : previous.catalogTags,
        overridden: result?.overridden !== false,
      })
      setError('')
      onSaved?.()
    } catch (err) {
      setState(previous)
      setError(err?.message || 'Failed to save tags')
    } finally {
      setBusy(false)
    }
  }, [recordId, state, onSaved])

  const resetTags = useCallback(async () => {
    if (!recordId) return
    const previous = state
    setBusy(true)
    try {
      const result = await window.electronAPI.resetTagOverride(recordId)
      if (result?.success === false) {
        setState(previous)
        setError(result.error || 'Failed to reset tags')
        return
      }
      setState({
        tags: Array.isArray(result?.tags) ? result.tags : previous.catalogTags,
        catalogTags: Array.isArray(result?.catalogTags) ? result.catalogTags : previous.catalogTags,
        overridden: false,
      })
      setError('')
      onSaved?.()
    } catch (err) {
      setState(previous)
      setError(err?.message || 'Failed to reset tags')
    } finally {
      setBusy(false)
    }
  }, [recordId, state, onSaved])

  return { ...state, loading, busy, error, applyTags, resetTags, reload: load }
}
