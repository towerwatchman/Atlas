import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')
const has = (src, needle) => expect(src.includes(needle), needle).toBe(true)
const lacks = (src, needle) => expect(src.includes(needle), needle).toBe(false)
const matches = (src, pattern) => expect(pattern.test(src), String(pattern)).toBe(true)

// Pull one function body out so an assertion cannot match a different handler
// that happens to call the same helper.
const bodyOf = (src, declaration) => {
  const start = src.indexOf(declaration)
  if (start < 0) return ''
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return ''
}

const editor = () => read('src/components/settings/ShortcutsSettings.jsx')

describe('Shortcuts settings editor', () => {
  it('is a visible Settings tab with its own keyboard icon', () => {
    const icons = read('src/components/settings/settingsIcons.js')
    const start = icons.indexOf('name: "Shortcuts"')
    expect(start).toBeGreaterThan(-1)
    const entry = icons.slice(start, icons.indexOf('viewBox:', start))
    lacks(entry, 'hidden')
    matches(entry, /path: "[^"]+"/)

    const settings = read('src/components/settings/Settings.jsx')
    has(settings, "import ShortcutsSettings from './ShortcutsSettings.jsx'")
    has(settings, 'case "Shortcuts": return <ShortcutsSettings />')
  })

  it('generates a binding for every visible settings page', () => {
    const src = editor()
    matches(src, /from '\.\.\/\.\.\/lib\/keyboardShortcuts\.js'/)
    has(src, 'settingsPageAction')
    has(src, "import { settingsIcons } from './settingsIcons.js'")
    has(src, 'const ACTIONS = [...SHORTCUT_ACTIONS, ...settingsIcons.filter((item) => !item.hidden).map((item) => settingsPageAction(item.name))]')
    has(src, 'const LABELS = Object.fromEntries(ACTIONS.map((action) => [action.id, action.label]))')
    lacks(src, 'const CATEGORIES = [...new Set(')
    lacks(src, 'settingsPageActionId')
    // The page ids come from settingsIcons, not a duplicated list here.
    for (const name of ['Interface', 'Library', 'Shortcuts', 'Database']) lacks(src, `'${name}'`)
  })

  it('loads bindings from the whole config and keeps a persisted snapshot', () => {
    const src = editor()
    for (const name of [
      'SHORTCUT_ACTIONS', 'SHORTCUT_CATEGORIES', 'comboFromEvent', 'comboFromMouseEvent',
      'conflictOwner', 'hasModifier', 'readBindings', 'writeBindings',
    ]) {
      has(src, name)
    }
    has(src, 'window.electronAPI.getConfig()')
    has(src, 'readBindings(config)')
    const load = bodyOf(src, 'const load = (config) =>')
    has(load, 'bindingsRef.current = loaded')
    has(load, 'persistedRef.current = loaded')
    has(load, 'setBindings(loaded)')
  })

  it('reloads when another window broadcasts a change', () => {
    const src = editor()
    has(src, 'window.electronAPI?.onShortcutsChanged?.(')
    has(src, '(value) => load(value)')
    has(src, "typeof off === 'function'")
    has(src, 'off()')
  })

  it('starts capture from the key area and installs capture-phase key and mouse listeners', () => {
    const src = editor()
    has(src, 'onClick={() => { if (!isRecording) startCapture(action.id) }}')
    has(src, 'Press keys…')
    has(src, 'aria-label="Cancel recording"')
    has(src, "window.addEventListener('keydown', onKeyDown, true)")
    has(src, "window.addEventListener('mousedown', onMouseDown, true)")
    has(src, "window.removeEventListener('keydown', onKeyDown, true)")
    has(src, "window.removeEventListener('mousedown', onMouseDown, true)")

    const keys = bodyOf(src, 'const onKeyDown = (event) =>')
    has(keys, "event.key === 'Escape'")
    has(keys, 'setRecording(null)')
    has(keys, 'MODIFIER_KEYS.has(event.key)')
    has(keys, 'comboFromEvent(event)')
    has(keys, "showMessage(actionId, 'That key cannot be used')")
    has(keys, 'event.preventDefault()')
    has(keys, 'commit(actionId, combo)')
    expect(keys.indexOf('setRecording(null)')).toBeLessThan(keys.indexOf('MODIFIER_KEYS.has(event.key)'))
    expect(keys.indexOf('comboFromEvent(event)')).toBeLessThan(keys.indexOf('commit(actionId, combo)'))

    const mouse = bodyOf(src, 'const onMouseDown = (event) =>')
    has(mouse, 'comboFromMouseEvent(event)')
    has(mouse, 'commit(actionId, combo)')
  })

  it('appends a new combo and rejects duplicates, conflicts and modifier-less binds', () => {
    const commitBody = bodyOf(editor(), 'const commit = (actionId, combo) =>')
    has(commitBody, '(current[actionId] || []).includes(combo)')
    has(commitBody, "showMessage(actionId, 'Already bound here')")
    has(commitBody, 'conflictOwner(current, actionId, combo)')
    has(commitBody, '`Already used by ${LABELS[owner] || owner}`')
    has(commitBody, 'action?.requiresModifier && !hasModifier(combo)')
    has(commitBody, "showMessage(actionId, 'Needs a modifier key')")
    has(commitBody, '[actionId]: [...(current[actionId] || []), combo]')
    has(commitBody, 'persist(actionId)')
    const append = commitBody.indexOf('[actionId]: [...(current[actionId] || []), combo]')
    expect(commitBody.indexOf('conflictOwner(current, actionId, combo)')).toBeLessThan(append)
    expect(append).toBeLessThan(commitBody.indexOf('persist(actionId)'))
  })

  it('renders selectable keycaps with remove and clear controls', () => {
    const src = editor()
    const remove = bodyOf(src, 'const remove = (actionId, combo) =>')
    has(remove, '.filter((item) => item !== combo)')
    has(remove, 'persist(actionId)')
    const clear = bodyOf(src, 'const clear = (actionId) =>')
    has(clear, '[actionId]: []')
    has(src, 'aria-label={`Remove ${value}`}')
    has(src, 'remove(action.id, value)')
    has(src, 'aria-label={`Clear all shortcuts for ${action.label}`}')
    has(src, 'clear(action.id)')
    has(src, 'event.stopPropagation()')
    has(src, 'active ? \' ring-1 ring-accent\' : \'\'')
    has(src, 'Click to add')
    has(src, '↺')
    has(src, 'setSelected(active ? null : { id: action.id, index })')
  })

  it('saves immediately on each change with a serialized chain and rollback', () => {
    const src = editor()
    lacks(src, '>Save</button>')
    lacks(src, 'onClick={save}')
    lacks(src, 'shortcuts-saved')
    const persist = bodyOf(src, 'const persist = (actionId) =>')
    has(persist, 'saveChain.current = saveChain.current.then(')
    has(persist, 'window.electronAPI.getConfig()')
    has(persist, 'const next = bindingsRef.current')
    has(persist, '...config')
    has(persist, 'Shortcuts: { ...config.Shortcuts, bindings: writeBindings(next) }')
    has(persist, 'window.electronAPI.saveSettings(updated)')
    has(persist, 'result?.success === false')
    has(persist, 'bindingsRef.current = persistedRef.current')
    has(persist, 'setBindings(persistedRef.current)')
    has(persist, "showMessage(actionId, 'Could not save')")
    const written = persist.indexOf('writeBindings(next)')
    const failed = persist.indexOf('result?.success === false')
    expect(written).toBeLessThan(failed)
    expect(failed).toBeLessThan(persist.indexOf('setBindings(persistedRef.current)'))
  })

  it('recovers the save chain after a rejected IPC call', () => {
    const persist = bodyOf(editor(), 'const persist = (actionId) =>')
    has(persist, '}).catch(() =>')
    const caught = bodyOf(persist, '.catch(() =>')
    has(caught, 'bindingsRef.current = persistedRef.current')
    has(caught, 'setBindings(persistedRef.current)')
    has(caught, "showMessage(actionId, 'Could not save')")
  })

  it('has no group, prefix, privacy or restart machinery', () => {
    const src = editor()
    for (const id of [
      'openView', 'openSubCategory', 'openQuickCustomizations', 'togglePrivacy',
      'cyclePrivacyBlur', 'restart', 'reload', 'currentShortcutGame',
    ]) {
      lacks(src, `'${id}'`)
    }
    for (const name of [
      'GROUP_BINDINGS', 'prefixFromEvent', 'SHORTCUT_SCOPE_HINTS',
      'action.kind === \'group\'', 'useShortcutRecording', 'groupPrefix',
    ]) {
      lacks(src, name)
    }
    lacks(src, 'onClick={save}')
    lacks(src, '>Save</button>')
    lacks(src, 'shortcuts-')
  })

  it('derives collapsible category sections from the exported categories', () => {
    const src = editor()
    has(src, 'const CATEGORIES = SHORTCUT_CATEGORIES')
    has(src, '.map((name) => ({ name, actions: ACTIONS.filter((action) => action.category === name) }))')
    has(src, '.filter((category) => category.actions.length > 0)')
    has(src, 'CATEGORIES.map(({ name, actions }) => (')
    has(src, '<section key={name} className="category bg-primary rounded p-3 mb-3">')
    has(src, 'aria-expanded={!collapsed[name]}')
    has(src, 'setCollapsed((state) => ({ ...state, [name]: !state[name] }))')
    has(src, 'className="category-toggle w-3 text-center"')
    has(src, 'className="category-name pl-3"')
  })

  it('shows messages on the affected row only', () => {
    const src = editor()
    has(src, "const rowMessage = messages[action.id] || ''")
    has(src, '{rowMessage && <span role="alert" className="text-danger text-[11px]">{rowMessage}</span>}')
    lacks(src, '<p className="text-danger">{conflict}</p>')
  })

  it('removed the dead shortcuts CSS block', () => {
    const css = read('src/assets/css/main.css')
    expect(css.includes('.shortcuts-')).toBe(false)
    has(css, '.fab-morph.is-circle')
  })
})
