import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8')

// DevTools previously opened automatically when running under `process.defaultApp`
// (electron . / npm start). The `Interface.showDebugConsole` setting already
// exists for this — it should be the sole gate.
describe('DevTools gating (Dev-Only)', () => {
  test('no DevTools open is gated by process.defaultApp', () => {
    expect(src).not.toMatch(/process\.defaultApp\s*\|\|\s*appConfig\?\.Interface\?\.showDebugConsole/)
  })

  test('every openDevTools call is gated only by showDebugConsole', () => {
    const guards = [...src.matchAll(/if\s*\(appConfig\?\.Interface\?\.showDebugConsole\)\s*\{\s*\n\s*.*openDevTools\(\)/g)]
    // createWindow, createSettingsWindow, createThemeBuilderWindow,
    // createBannerEditorWindow, createImporterWindow, createGameDetailsWindow
    expect(guards.length).toBe(6)
  })

  test('openDevTools count has not been reduced', () => {
    const count = (src.match(/\.openDevTools\(\)/g) || []).length
    expect(count).toBe(6)
  })
})
