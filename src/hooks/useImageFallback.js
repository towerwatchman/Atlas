import { useState, useEffect } from 'react'
import { toMediaSrc } from '../utils/mediaSrc.js'

// Given an ordered list of candidate image URLs, resolves to the first one that
// actually loads. Used to implement cross-source image fallback, for example
// Steam CDN to Steam shared.fastly to F95, without requiring every consumer to
// wire up onError handling.
//
// Returns { src, failed, loading }:
//   - src: the candidate currently believed best while probing, swapped to the
//          first that loads, or null when no candidate loads.
//   - failed: true once every candidate has errored.
//   - loading: true while probing is still in progress.
export function useImageFallback(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : []
  const key = list.join('|')

  const [src, setSrc] = useState(toMediaSrc(list[0]) || null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(list.length > 0)

  useEffect(() => {
    let cancelled = false
    setSrc(toMediaSrc(list[0]) || null)
    setFailed(list.length === 0)
    setLoading(list.length > 0)

    if (list.length === 0) return undefined

    const tryAt = (i) => {
      if (cancelled) return
      if (i >= list.length) {
        setSrc(null)
        setFailed(true)
        setLoading(false)
        return
      }
      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        setSrc(toMediaSrc(list[i]))
        setFailed(false)
        setLoading(false)
      }
      img.onerror = () => { if (!cancelled) tryAt(i + 1) }
      img.src = toMediaSrc(list[i])
    }
    tryAt(0)

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { src, failed, loading }
}

export default useImageFallback
