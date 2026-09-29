import { useState, useEffect, useRef, useCallback } from 'react'

// Keeps the search input visually instant while the expensive work waits
// for a pause in typing.
//
// Originally SearchBox/SearchSidebar called onSearchChange per keystroke, so
// Library filtered and Browse fetched per character. Even though Browse had
// a fetch-side debounce, activeFilters still updated per keystroke, forcing
// a full App re-render and a wasted local-filter pass via useFilters.js
// when Browse was showing. Debouncing before setActiveFilters fixes both at
// the source and the input still echoes from local state.
export function useDebouncedSearch({ value = '', onSearchChange, delay = 300, resetInputSignal } = {}) {
  const [localValue, setLocalValue] = useState(value)
  const timeoutRef = useRef(null)
  const onSearchChangeRef = useRef(onSearchChange)
  const lastSentRef = useRef(null)
  const prevResetInputSignalRef = useRef(resetInputSignal)

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange
  }, [onSearchChange])

  // Reset signal bails out the pending debounce even when `value` hasn't
  // changed (e.g. committed text already '' on fresh load, user types then
  // hits Reset within the debounce window). The normal [value] effect below
  // never runs in that case because the prop is still ''. The parent
  // (App.jsx) increments resetInputSignal on resetFilters so both SearchBox and
  // SearchSidebar cancel their pending timers and sync to the authoritative
  // value. Without this, the stale timer fires and re-applies the typed
  // text after the grid was already reset.
  useEffect(() => {
    if (resetInputSignal === undefined) return
    if (prevResetInputSignalRef.current === resetInputSignal) return
    prevResetInputSignalRef.current = resetInputSignal
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    lastSentRef.current = value
    setLocalValue((prev) => (prev === value ? prev : value))
  }, [resetInputSignal, value])

  // Adopt external `value` changes (resetFilters, applySavedFilter, clear
  // from the other search box) but do not overwrite active typing with the
  // echo of our own debounce. While a debounce is pending, `value` is still
  // the previous committed filter; when the timeout fires we send the new
  // local value and the parent echoes it back. That echo must not clobber a
  // more recent local edit. Tracking `lastSent` lets us distinguish an echo
  // (value === lastSent) from a genuine external change.
  // Deps is [value] only — adding localValue would run the effect on every
  // keystroke.
  useEffect(() => {
    setLocalValue((prev) => {
      if (value === lastSentRef.current) {
        // Echo of our own debounced emit. If we have already typed ahead
        // (timeout pending), keep the ahead value; otherwise sync.
        if (timeoutRef.current) return prev
        return prev === value ? prev : value
      }
      if (timeoutRef.current) {
        // External change while typing (e.g. saved filter applied) — cancel
        // the pending local emit and adopt the authoritative value.
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return prev === value ? prev : value
    })
  }, [value])

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const schedule = useCallback((next) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      lastSentRef.current = next
      onSearchChangeRef.current?.(next)
    }, delay)
  }, [delay])

  const handleChange = useCallback((next) => {
    setLocalValue(next)
    schedule(next)
  }, [schedule])

  // Clear is user-intent to see "all" again; bypass the delay so the grid
  // updates without waiting for the trailing edge.
  const handleClear = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    lastSentRef.current = ''
    setLocalValue('')
    onSearchChangeRef.current?.('')
  }, [])

  return { localValue, handleChange, handleClear, setLocalValue }
}
