import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8')

// showDebugConsole is the sole gate for DevTools (no auto-open in dev mode).
describe('DevTools gating (Dev-Only)', () => {
  test('no DevTools open is gated by process.defaultApp', () => {
    expect(src).not.toMatch(/process\.defaultApp\s*\|\|\s*appConfig\?\.Interface\?\.showDebugConsole/)
  })

  test('every openDevTools call is gated only by showDebugConsole', () => {
    const guards = [...src.matchAll(/if\s*\(appConfig\?\.Interface\?\.showDebugConsole\)\s*\{\s*\n\s*.*openDevTools\(\)/g)]
    // main, settings, theme builder, banner editor, importer, game details
    expect(guards.length).toBe(6)
  })

  test('openDevTools count has not been reduced', () => {
    const count = (src.match(/\.openDevTools\(\)/g) || []).length
    expect(count).toBe(6)
  })
})
