// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, cleanup } from '@testing-library/react'
import ConfirmModal from '../src/components/ui/ConfirmModal.jsx'
import UpdateModal from '../src/components/downloads/UpdateModal.jsx'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')
const has = (src, needle) => expect(src.includes(needle), needle).toBe(true)

afterEach(() => cleanup())

describe('Escape popup priority', () => {
  it('the popup consumes Escape and closes itself', () => {
    const onCancel = vi.fn()
    render(<ConfirmModal open title="Confirm" body="Body" onCancel={onCancel} />)

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('the install modal consumes Escape before the detail page closes', () => {
    const onClose = vi.fn()
    render(<UpdateModal open game={{ title: 'Test Game' }} onClose={onClose} />)

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('registers the popup handler in the capture phase', () => {
    const hook = read('src/hooks/useEscapeKey.js')
    has(hook, "if (event.key !== 'Escape') return")
    has(hook, 'event.preventDefault()')
    has(hook, "window.addEventListener('keydown', onKey, true)")
  })

  it('lets the detail-close rule see that Escape was consumed', () => {
    const app = read('src/App.jsx')
    const start = app.indexOf('const handleShortcutKeyDown = (event) =>')
    const open = app.indexOf('{', start)
    let depth = 0
    let body = ''
    for (let i = open; i < app.length; i += 1) {
      if (app[i] === '{') depth += 1
      else if (app[i] === '}' && --depth === 0) { body = app.slice(open, i + 1); break }
    }
    has(body, 'if (event.defaultPrevented) return')
  })
})
