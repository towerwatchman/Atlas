import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'settings', 'Interface.jsx'),
  'utf8',
)

// The debug-console toggle applies live via save-settings (main opens/closes
// DevTools on all open windows), so it must not show a restart popup or hint.
describe('Interface debug console (no restart)', () => {
  test('toggling never pops a restart alert', () => {
    expect(src).not.toMatch(/debug console setting requires a restart/i)
  })

  test('no restart hint remains next to the toggle', () => {
    expect(src).not.toMatch(/debug console will require a restart/i)
  })

  test('toggle still saves the setting (guard against over-deletion)', () => {
    expect(src).toMatch(/saveSettings\(\{\s*showDebugConsole:/)
  })

  test('language restart note is untouched', () => {
    expect(src).toMatch(/system language will require a restart/i)
  })
})
