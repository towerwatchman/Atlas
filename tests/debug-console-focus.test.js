import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'settings.js'), 'utf8')

// The live toggle must not pull other windows in front of Settings.
describe('Debug console toggle keeps Settings on top', () => {
  test('live-toggle opens DevTools without activating', () => {
    expect(src).toMatch(/openDevTools\(\{\s*activate:\s*false\s*\}\)/)
  })

  test('sender window is refocused after the toggle', () => {
    expect(src).toMatch(/BrowserWindow\.fromWebContents\(event\.sender\)/)
  })
})
