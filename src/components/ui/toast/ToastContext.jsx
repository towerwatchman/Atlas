import { createContext, useContext, useCallback, useMemo, useRef, useState } from 'react'
import ToastViewport from './ToastViewport.jsx'

// Lightweight app-wide toast system. Toasts are dismissible, stack bottom-right
// above the footer, support an optional action button and an optional progress
// bar, and can be UPDATED IN PLACE by id (so a single toast can transition
// through states — e.g. app-update checking -> downloading -> downloaded —
// rather than spawning a new toast per state).

const ToastContext = createContext(null)

const MAX_VISIBLE = 3
let seq = 0
const nextId = () => `toast_${Date.now()}_${seq++}`

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const clearTimer = useCallback((id) => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
  }, [])

  const dismiss = useCallback((id) => {
    clearTimer(id)
    setToasts((list) => {
      const t = list.find((x) => x.id === id)
      if (t && typeof t.onDismiss === 'function') {
        try { t.onDismiss() } catch { /* ignore */ }
      }
      return list.filter((x) => x.id !== id)
    })
  }, [clearTimer])

  const scheduleAutoDismiss = useCallback((id, ms) => {
    clearTimer(id)
    if (ms && ms > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), ms))
    }
  }, [clearTimer, dismiss])

  // Create or update a toast. Pass an existing `id` to update in place.
  // Options: { id, variant, title, message, action:{label,onClick,busy},
  //            progress (0-100|null), dismissible, duration (ms, 0 = sticky) }
  const notify = useCallback((opts = {}) => {
    const id = opts.id || nextId()
    setToasts((list) => {
      const existingIdx = list.findIndex((t) => t.id === id)
      const base = existingIdx >= 0 ? list[existingIdx] : {
        id,
        variant: 'info',
        title: '',
        message: '',
        action: null,
        progress: null,
        dismissible: true,
        createdAt: Date.now(),
      }
      const next = { ...base, ...opts, id }
      let out
      if (existingIdx >= 0) {
        out = list.slice()
        out[existingIdx] = next
      } else {
        out = [...list, next]
      }
      return out
    })
    // Auto-dismiss only when an explicit positive duration is provided; sticky
    // (duration 0/undefined) toasts persist until acted on or dismissed.
    if (opts.duration && opts.duration > 0) scheduleAutoDismiss(id, opts.duration)
    else clearTimer(id)
    return id
  }, [scheduleAutoDismiss, clearTimer])

  // Convenience variant helpers.
  const info = useCallback((title, o = {}) => notify({ variant: 'info', title, ...o }), [notify])
  const success = useCallback((title, o = {}) => notify({ variant: 'success', title, duration: 4000, ...o }), [notify])
  const warning = useCallback((title, o = {}) => notify({ variant: 'warning', title, ...o }), [notify])
  const error = useCallback((title, o = {}) => notify({ variant: 'error', title, ...o }), [notify])

  const value = useMemo(() => ({ notify, dismiss, info, success, warning, error }),
    [notify, dismiss, info, success, warning, error])

  // Cap visible toasts; keep the newest MAX_VISIBLE (older ones drop off the
  // top of the stack). They aren't destroyed from state churn — we just render
  // the tail so the UI can't be buried.
  const visible = toasts.slice(-MAX_VISIBLE)

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={visible} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
