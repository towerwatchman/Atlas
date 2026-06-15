import { useState, useEffect } from 'react'

// Given an ordered list of candidate image URLs, resolves to the first one that
// actually loads. Used to implement cross-source image fallback (e.g. Steam CDN
// → Steam shared.fastly → F95) without requiring the consuming markup to wire
// up onError — handy for user-provided banner templates that just read a url.
//
// Returns { src, failed, loading }:
//   - src:     the candidate currently believed best (optimistically the first
//              while probing; swapped to the first that loads).
//   - failed:  true once every candidate has errored.
//   - loading: true while probing is still in progress.
export function useImageFallback(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : []
  const key = list.join('|')

  const [src, setSrc] = useState(list[0] || null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(list.length > 0)

  useEffect(() => {
    let cancelled = false
    setSrc(list[0] || null)
    setFailed(list.length === 0)
    setLoading(list.length > 0)

    if (list.length === 0) return undefined
    // A single candidate needs no probing — render it directly.
    if (list.length === 1) {
      setLoading(false)
      return undefined
    }

    const tryAt = (i) => {
      if (cancelled) return
      if (i >= list.length) {
        // Nothing loaded; leave the first candidate in place (it'll show the
        // browser's broken-image / alt handling) and report failure.
        setFailed(true)
        setLoading(false)
        return
      }
      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        setSrc(list[i])
        setFailed(false)
        setLoading(false)
      }
      img.onerror = () => { if (!cancelled) tryAt(i + 1) }
      img.src = list[i]
    }
    tryAt(0)

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { src, failed, loading }
}

export default useImageFallback
