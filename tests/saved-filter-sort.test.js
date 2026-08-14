'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test: nodeTest } = require('node:test')
const { normalizeSavedBrowseSort } = require('../electron/ipc/savedFilterSort')

const runTest = globalThis.test || nodeTest

// Anchor fixture reads to the repository rather than the caller's working directory.
const projectFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

// Parse the renderer's real whitelist so a future UI sort addition cannot drift
// from saved-filter persistence without failing this cross-process contract.
const rendererBrowseSortValues = () => {
  const filters = projectFile('src', 'hooks', 'useFilters.js')
  const start = filters.indexOf('merged.browseSort = [')
  const end = filters.indexOf('].includes(merged.browseSort)', start)
  assert.notEqual(start, -1, 'renderer browse sort whitelist is present')
  assert.notEqual(end, -1, 'renderer browse sort whitelist has a closing boundary')
  const values = [...filters.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.ok(values.length > 0, 'renderer browse sort whitelist is not empty')
  return values
}

runTest('saved filters preserve every browse sort emitted by the renderer', () => {
  for (const value of rendererBrowseSortValues()) {
    assert.equal(normalizeSavedBrowseSort(value), value)
  }
})

runTest('legacy browse sort values remain compatible', () => {
  assert.equal(normalizeSavedBrowseSort('name'), 'titleAsc')
  assert.equal(normalizeSavedBrowseSort('nameAsc'), 'titleAsc')
  assert.equal(normalizeSavedBrowseSort('nameDesc'), 'titleDesc')
  assert.equal(normalizeSavedBrowseSort('newest'), 'threadUpdatedDesc')
  assert.equal(normalizeSavedBrowseSort('oldest'), 'threadUpdatedAsc')
})

runTest('unknown browse sort values use the current browse default', () => {
  assert.equal(normalizeSavedBrowseSort('not-a-sort'), 'threadUpdatedDesc')
})
