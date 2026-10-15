import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolveSearchTarget } from '../src/utils/metadataSearch.js'

// The GameDetails-only setting names the plain-click target; Shift-click
// always goes to the secondary. 'catalog' is Browse, 'local' is Library.
test('plain click follows the setting', () => {
  expect(resolveSearchTarget('browse', false)).toBe('catalog')
  expect(resolveSearchTarget('library', false)).toBe('local')
})

test('shift-click goes to the other mode', () => {
  expect(resolveSearchTarget('browse', true)).toBe('local')
  expect(resolveSearchTarget('library', true)).toBe('catalog')
})

test('unknown setting values fall back to Browse', () => {
  expect(resolveSearchTarget('nonsense', false)).toBe('catalog')
  expect(resolveSearchTarget(undefined, false)).toBe('catalog')
})

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
const iface = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'settings', 'Interface.jsx'), 'utf8')

test('App jumps to the grid with the payload applied', () => {
  expect(app).toContain('handleMetadataSearch')
  expect(app).toContain('onMetadataSearch={handleMetadataSearch}')
})

test('a catalog jump lands the side panel with it, like rail Browse', () => {
  const jump = app.slice(app.indexOf('const handleMetadataSearch'), app.indexOf('const resetFilters'))
  expect(jump).toContain('SIDE_PANEL_MODES.CATALOG')
})

test('the mode lives in a GameDetails setting, not hardcoded', () => {
  expect(iface).toContain('detailClickSearchMode')
  expect(app).toContain('detailClickSearchMode')
})

test('the schema declares the setting default so the audit recognises it', () => {
  const { buildDefaultConfig } = require('../electron/config/configSchema.js')
  expect(buildDefaultConfig().Interface.detailClickSearchMode).toBe('browse')
})
