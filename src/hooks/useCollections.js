import { useCallback, useEffect, useMemo, useState } from 'react'

// Sentinel for the derived "no collections" bucket. Mirrors UNCATEGORIZED_ID in
// electron/db/collections.js — main and renderer are separate bundles and can't
// share a module, so keep the two in sync.
export const UNCATEGORIZED_ID = 'uncategorized'
export const UNCATEGORIZED_LABEL = 'Uncategorized'

const EMPTY_STATE = { collections: [], memberships: [], artRecordIds: {} }

/**
 * Owns collection state for the library window: the collections themselves,
 * both directions of the membership lookup, and the record ids backing each
 * tile's art. Refetches whenever the main process broadcasts a change, so a
 * mutation made from a native context menu lands here too.
 */
export function useCollections({ enabled = true } = {}) {
  const [state, setState] = useState(EMPTY_STATE)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!enabled || !window.electronAPI?.getCollections) {
      setState(EMPTY_STATE)
      setLoading(false)
      return
    }
    try {
      const next = await window.electronAPI.getCollections()
      setState({
        collections: Array.isArray(next?.collections) ? next.collections : [],
        memberships: Array.isArray(next?.memberships) ? next.memberships : [],
        artRecordIds: next?.artRecordIds && typeof next.artRecordIds === 'object'
          ? next.artRecordIds
          : {},
      })
      setError(next?.error || '')
    } catch (err) {
      console.error('Failed to load collections:', err)
      setError(err?.message || 'Failed to load collections')
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!enabled) return undefined
    const remove = window.electronAPI?.onCollectionsChanged?.(() => { refresh() })
    return () => { if (typeof remove === 'function') remove() }
  }, [enabled, refresh])

  // record_id -> [collectionId]. Built once per membership change rather than
  // queried per game, which matters on a 6k-title library.
  const collectionIdsByRecord = useMemo(() => {
    const map = new Map()
    for (const { collectionId, recordId } of state.memberships) {
      const key = Number(recordId)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(Number(collectionId))
    }
    return map
  }, [state.memberships])

  // collectionId -> Set(record_id), for membership tests while filtering.
  const recordIdsByCollection = useMemo(() => {
    const map = new Map()
    for (const { collectionId, recordId } of state.memberships) {
      const key = Number(collectionId)
      if (!map.has(key)) map.set(key, new Set())
      map.get(key).add(Number(recordId))
    }
    return map
  }, [state.memberships])

  const getCollectionsForRecord = useCallback(
    (recordId) => collectionIdsByRecord.get(Number(recordId)) || [],
    [collectionIdsByRecord],
  )

  const isUncategorized = useCallback(
    (recordId) => !collectionIdsByRecord.has(Number(recordId)),
    [collectionIdsByRecord],
  )

  return {
    collections: state.collections,
    artRecordIds: state.artRecordIds,
    collectionIdsByRecord,
    recordIdsByCollection,
    getCollectionsForRecord,
    isUncategorized,
    loading,
    error,
    refresh,
  }
}

/**
 * Groups games into collection buckets for the tree, preserving the incoming
 * (already filtered and sorted) game order within each bucket. Uncategorized is
 * derived here — it is simply every game with no membership — and always sorts
 * last.
 */
export function groupGamesByCollection(games = [], collections = [], collectionIdsByRecord) {
  const buckets = new Map()
  for (const collection of collections) {
    buckets.set(Number(collection.id), {
      id: Number(collection.id),
      name: collection.name,
      color: collection.color || null,
      games: [],
    })
  }
  const uncategorized = {
    id: UNCATEGORIZED_ID,
    name: UNCATEGORIZED_LABEL,
    color: null,
    games: [],
  }

  for (const game of games) {
    if (!game) continue
    const ids = collectionIdsByRecord?.get(Number(game.record_id)) || []
    if (ids.length === 0) {
      uncategorized.games.push(game)
      continue
    }
    // A title in several collections appears under each of them, matching how
    // Steam shows multi-collection titles.
    for (const id of ids) {
      const bucket = buckets.get(Number(id))
      if (bucket) bucket.games.push(game)
    }
  }

  const ordered = [...buckets.values()]
  // Uncategorized has no button on the collections screen and always sits at
  // the bottom of the tree.
  if (uncategorized.games.length > 0) ordered.push(uncategorized)
  return ordered
}
