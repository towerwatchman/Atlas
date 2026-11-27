import { useEffect, useRef } from 'react'

// Capture phase spends Escape before the detail page can treat it as its own
// back key. The page reads event.defaultPrevented and stays open.
// One overlay at a time: nested popups would both close on a single press.
export function useEscapeKey(onClose, enabled = true) {
  const closeRef = useRef(onClose)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!enabled) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeRef.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
}
