import React, { useState, useEffect, useRef } from 'react'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_CATEGORIES,
  settingsPageAction,
  comboFromEvent,
  comboFromMouseEvent,
  conflictOwner,
  hasModifier,
  readBindings,
  writeBindings,
} from '../../lib/keyboardShortcuts.js'
import { settingsIcons } from './settingsIcons.js'

// Every visible Settings page gets its own binding, including this one.
const ACTIONS = [...SHORTCUT_ACTIONS, ...settingsIcons.filter((item) => !item.hidden).map((item) => settingsPageAction(item.name))]
const LABELS = Object.fromEntries(ACTIONS.map((action) => [action.id, action.label]))
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

// Keep generated page bindings beside the actions of the same category.
const CATEGORIES = SHORTCUT_CATEGORIES
  .map((name) => ({ name, actions: ACTIONS.filter((action) => action.category === name) }))
  .filter((category) => category.actions.length > 0)

const ShortcutsSettings = () => {
  const [bindings, setBindings] = useState({})
  const [messages, setMessages] = useState({})
  const [recording, setRecording] = useState(null)
  const [collapsed, setCollapsed] = useState({})
  const [selected, setSelected] = useState(null)
  const bindingsRef = useRef({})
  const persistedRef = useRef({})
  const saveChain = useRef(Promise.resolve())

  // Another window can change bindings while Settings is open, so reload from
  // config on mount and whenever the broadcast arrives instead of keeping a copy.
  useEffect(() => {
    const load = (config) => {
      const loaded = readBindings(config)
      bindingsRef.current = loaded
      persistedRef.current = loaded
      setBindings(loaded)
    }
    window.electronAPI.getConfig().then(load)
    const off = window.electronAPI?.onShortcutsChanged?.((value) => load(value))
    return () => { if (typeof off === 'function') off() }
  }, [])

  const showMessage = (actionId, text) => {
    setMessages((prev) => ({ ...prev, [actionId]: text }))
  }

  // Writes run in order so a slow save cannot overwrite a newer one, and a
  // failed save restores the last map that reached config.
  const persist = (actionId) => {
    saveChain.current = saveChain.current.then(async () => {
      const config = await window.electronAPI.getConfig()
      const next = bindingsRef.current
      const updated = {
        ...config,
        Shortcuts: { ...config.Shortcuts, bindings: writeBindings(next) },
      }
      const result = await window.electronAPI.saveSettings(updated)
      if (result?.success === false) {
        bindingsRef.current = persistedRef.current
        setBindings(persistedRef.current)
        showMessage(actionId, 'Could not save')
        return
      }
      persistedRef.current = next
    }).catch(() => {
      // A failed IPC call must not poison the chain and silently block later saves.
      bindingsRef.current = persistedRef.current
      setBindings(persistedRef.current)
      showMessage(actionId, 'Could not save')
    })
  }

  const commit = (actionId, combo) => {
    const current = bindingsRef.current
    setRecording(null)
    if ((current[actionId] || []).includes(combo)) {
      showMessage(actionId, 'Already bound here')
      return
    }
    const owner = conflictOwner(current, actionId, combo)
    if (owner) {
      showMessage(actionId, `Already used by ${LABELS[owner] || owner}`)
      return
    }
    // Bare keys would fire while typing in game fields, so these actions only
    // accept a binding with a modifier.
    const action = ACTIONS.find((item) => item.id === actionId)
    if (action?.requiresModifier && !hasModifier(combo)) {
      showMessage(actionId, 'Needs a modifier key')
      return
    }
    const next = { ...current, [actionId]: [...(current[actionId] || []), combo] }
    bindingsRef.current = next
    setBindings(next)
    showMessage(actionId, '')
    persist(actionId)
  }

  useEffect(() => {
    if (!recording) return undefined
    const actionId = recording
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setRecording(null)
        return
      }
      if (MODIFIER_KEYS.has(event.key)) return
      const combo = comboFromEvent(event)
      if (!combo) {
        showMessage(actionId, 'That key cannot be used')
        return
      }
      event.preventDefault()
      commit(actionId, combo)
    }
    const onMouseDown = (event) => {
      const combo = comboFromMouseEvent(event)
      if (!combo) return
      event.preventDefault()
      commit(actionId, combo)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onMouseDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [recording])

  const startCapture = (actionId) => {
    showMessage(actionId, '')
    setRecording(actionId)
  }

  const startOnKey = (actionId) => (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      startCapture(actionId)
    }
  }

  const remove = (actionId, combo) => {
    const next = {
      ...bindingsRef.current,
      [actionId]: (bindingsRef.current[actionId] || []).filter((item) => item !== combo),
    }
    bindingsRef.current = next
    setBindings(next)
    persist(actionId)
  }

  const clear = (actionId) => {
    const next = { ...bindingsRef.current, [actionId]: [] }
    bindingsRef.current = next
    setBindings(next)
    persist(actionId)
  }

  return (
    <div className="p-5 text-text" onClick={() => { setSelected(null); setMessages({}) }}>
      <h2 className="text-xl font-bold mb-2">Keyboard shortcuts</h2>
      <p className="text-sm text-muted mb-4">
        A modifier is optional, but some keys and actions need one. Click a row's key area
        to add a binding, click a key to remove it, or ↺ to clear a row.
      </p>
      {CATEGORIES.map(({ name, actions }) => (
        <section key={name} className="category bg-primary rounded p-3 mb-3">
          <button
            type="button"
            className="category-header relative -ml-3 w-full flex items-center text-left text-sm font-semibold uppercase tracking-wide text-muted"
            onClick={() => setCollapsed((state) => ({ ...state, [name]: !state[name] }))}
            aria-expanded={!collapsed[name]}
          >
            <span
              className="category-toggle w-3 text-center"
              style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)' }}
            >
              {collapsed[name] ? '+' : '−'}
            </span>
            <span className="category-name pl-3">{name}</span>
          </button>
          {!collapsed[name] && (
            <div className="category-body mt-3" style={{ columnWidth: '290px', columnCount: 3, columnGap: '22px' }}>
              {actions.map((action) => {
                const values = bindings[action.id] || []
                const isRecording = recording === action.id
                const rowMessage = messages[action.id] || ''
                return (
                  <div key={action.id} className="row group grid grid-cols-[185px_1fr] items-center gap-2 py-1" style={{ breakInside: 'avoid' }}>
                    <span className="text-left text-sm leading-tight">{action.label}</span>
                    <div
                      className="min-w-0 flex flex-wrap gap-1 items-center cursor-pointer"
                      tabIndex={0}
                      onClick={() => { if (!isRecording) startCapture(action.id) }}
                      onKeyDown={isRecording ? undefined : startOnKey(action.id)}
                    >
                      {values.map((value, index) => {
                        const active = selected?.id === action.id && selected.index === index
                        return (
                          <span key={`${value}-${index}`} className="flex items-center gap-1">
                            <kbd
                              onClick={(event) => {
                                event.stopPropagation()
                                setSelected(active ? null : { id: action.id, index })
                              }}
                              className={`bg-button border border-border text-[11px] px-1.5 py-0.5 rounded cursor-pointer${active ? ' ring-1 ring-accent' : ''}`}
                            >
                              {value}
                            </kbd>
                            {active && (
                              <button
                                type="button"
                                aria-label={`Remove ${value}`}
                                onClick={(event) => { event.stopPropagation(); remove(action.id, value) }}
                                className="w-4 h-4 flex items-center justify-center rounded bg-tertiary text-[11px] leading-none hover:bg-selected"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        )
                      })}
                      {values.length === 0 && !isRecording && (
                        <span className="text-muted text-[11px] px-1.5 py-0.5 rounded border border-dashed border-border">
                          Click to add
                        </span>
                      )}
                      {isRecording && (
                        <span className="flex items-center gap-1">
                          <kbd className="bg-button border border-border text-[11px] px-1.5 py-0.5 rounded">
                            Press keys…
                          </kbd>
                          <button
                            type="button"
                            aria-label="Cancel recording"
                            onClick={(event) => { event.stopPropagation(); setRecording(null) }}
                            className="w-4 h-4 flex items-center justify-center rounded bg-tertiary text-[11px] leading-none hover:bg-selected"
                          >
                            ✕
                          </button>
                        </span>
                      )}
                      {rowMessage && <span role="alert" className="text-danger text-[11px]">{rowMessage}</span>}
                      {values.length > 0 && (
                        <span className="flex gap-1 ml-auto opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            aria-label={`Clear all shortcuts for ${action.label}`}
                            onClick={(event) => { event.stopPropagation(); clear(action.id) }}
                            className="w-5 h-5 flex items-center justify-center rounded bg-button hover:bg-selected text-xs leading-none"
                          >
                            ↺
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

export default ShortcutsSettings
