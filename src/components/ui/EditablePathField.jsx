import { useState, useEffect, useRef, useCallback } from 'react'

// Inline-editable path field shared by the four locations that let the user
// type a filesystem path directly (Importer Game Path, Library Default Game
// Folder, Library Downloads Folder, Emulator Program Path).
//
// Why controlled: the parent (Library.jsx, Importer.jsx, EmulatorLauncher.jsx)
// is the source of truth for the saved path. A controlled value lets the Reset
// button and the `onLibraryValidationProgress` subscription push a new value
// in without the field having to be reset manually. The `draft` is only the
// in-progress edit; `value` is what is persisted.
//
// Why picker bypasses IPC: a native dialog already guarantees existence and
// absoluteness, so re-statting it is wasted work and would flicker the error
// state on a slow drive.
//
// Why validating flag: blur and Enter can both fire for the same commit
// (Enter then blur). Without a guard the IPC runs twice and the second can
// overwrite the first.
export default function EditablePathField({
  value = '',
  mode = 'directory',
  allowEmpty = false,
  placeholder = '',
  pickerLabel = 'Set Folder',
  onPick,
  onSave,
  'data-tour': dataTour,
  wrapperClassName,
  inputClassName,
}) {
  const inputRef = useRef(null)
  const pickingRef = useRef(false)
  const successTimerRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState(false)
  const [validating, setValidating] = useState(false)
  const [success, setSuccess] = useState(false)

  // Keep draft in sync when parent value changes and we are not editing.
  // While editing the user's keystrokes own the draft.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  // Clear success flash timer on unmount
  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
  }, [])

  const flashSuccess = useCallback(() => {
    setSuccess(true)
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    successTimerRef.current = setTimeout(() => setSuccess(false), 450)
  }, [])

  const enterEdit = useCallback(() => {
    if (editing) return
    setEditing(true)
    setDraft(value)
    setError(false)
    setSuccess(false)
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    // Select all so typing replaces the whole path quickly (e.g. I:\XLibrary\RPGM).
    requestAnimationFrame(() => inputRef.current?.select())
  }, [editing, value])

  const doCommit = useCallback(async ({ keepFocus }) => {
    if (!editing || validating) return
    const trimmed = String(draft).trim().replace(/^["']|["']$/g, '')
    // Empty is only valid for Downloads Folder (allowEmpty).
    if (allowEmpty && trimmed === '') {
      setError(false)
      setEditing(false)
      setValidating(false)
      flashSuccess()
      onSave?.('')
      return
    }
    if (!trimmed) {
      setError(true)
      if (keepFocus) inputRef.current?.focus()
      return
    }
    setValidating(true)
    let result = null
    try {
      result = await window.electronAPI?.checkPath?.(trimmed)
    } catch {
      result = { exists: false }
    }
    setValidating(false)
    const exists = Boolean(result?.exists)
    const isDir = Boolean(result?.isDirectory)
    const isFile = Boolean(result?.isFile)
    const valid = mode === 'file' ? exists && isFile : exists && isDir
    if (valid) {
      setError(false)
      setEditing(false)
      flashSuccess()
      onSave?.(trimmed)
    } else {
      setError(true)
      // Stay in edit mode; blur drops focus but error+draft persist.
      if (keepFocus) inputRef.current?.focus()
    }
  }, [editing, validating, draft, allowEmpty, mode, onSave, flashSuccess])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doCommit({ keepFocus: true })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value)
      setError(false)
      setEditing(false)
      setValidating(false)
      setSuccess(false)
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [doCommit, value])

  const handleBlur = useCallback(() => {
    // Picker click causes blur before click; suppress commit so the picked
    // native path is used directly without an intervening validation.
    if (pickingRef.current) return
    doCommit({ keepFocus: false })
  }, [doCommit])

  const handlePick = useCallback(async () => {
    pickingRef.current = true
    try {
      const picked = await onPick?.()
      if (picked) {
        setError(false)
        setEditing(false)
        setDraft(picked)
        setValidating(false)
        flashSuccess()
        onSave?.(picked)
      }
    } finally {
      // Let blur handler see the flag, then clear it.
      setTimeout(() => { pickingRef.current = false }, 0)
    }
  }, [onPick, onSave, flashSuccess])

  const baseInput = 'flex-1 min-w-0 p-2 rounded border focus:outline-none transition-colors duration-300'
  const stateClass = error
    ? 'bg-primary border-danger ring-1 ring-danger/60 shadow-[0_0_8px_rgba(239,68,68,0.35)]'
    : success
      ? 'bg-secondary border-emerald-500 ring-1 ring-green-500/60 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
      : editing
        ? 'bg-primary border-accent focus:ring-1 focus:ring-accent'
        : 'bg-secondary border-border'
  const validatingClass = validating ? ' opacity-60 cursor-wait' : ''

  return (
    <div
      data-tour={dataTour}
      className={wrapperClassName || 'flex gap-3 flex-1 min-w-0'}
    >
      <input
        ref={inputRef}
        type="text"
        value={editing ? draft : (value ?? '')}
        readOnly={!editing}
        placeholder={placeholder}
        onFocus={enterEdit}
        onClick={enterEdit}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`${baseInput} ${stateClass}${validatingClass} ${inputClassName || ''}`.trim()}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handlePick}
        className="bg-accent px-5 py-2 rounded hover:bg-accentHover whitespace-nowrap shrink-0"
      >
        {pickerLabel}
      </button>
    </div>
  )
}
