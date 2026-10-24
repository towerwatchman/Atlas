import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const settings = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'ipc', 'settings.js'),
  'utf8',
)
const preload = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'preload.js'),
  'utf8',
)
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')

// Changing Click-to-search in the Settings window must reach the already-open
// Library window; saving to disk alone leaves App's mount-time state stale.
test('the main process broadcasts click-to-search changes', () => {
  expect(settings).toContain('detail-click-search-mode-changed')
})

test('the preload bridge exposes the broadcast', () => {
  expect(preload).toContain('detail-click-search-mode-changed')
  expect(preload).toContain('onDetailClickSearchModeChanged')
})

test('App applies the broadcast to its jump state', () => {
  expect(app).toContain('onDetailClickSearchModeChanged')
  expect(app).toContain('setDetailClickSearchMode')
})
