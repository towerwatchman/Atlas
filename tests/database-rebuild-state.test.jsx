// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import Database from '../src/components/settings/Database.jsx'

// Each test gets its own progressListener so the mock can fire it on demand.
let progressListener

beforeEach(() => {
  cleanup()
  progressListener = null
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      getCatalogIndexStatus: async () => ({ ready: true, rowCount: 100, builtAt: '2025-01-01' }),
      rebuildCatalogIndex: async () => ({ success: true, totalRows: 100, durationMs: 200 }),
      onCatalogIndexProgress: (cb) => { progressListener = cb; return () => { progressListener = null } },
      runDbAudit: async () => ({ success: true, items: [], summary: { removed: 0, orphaned: 0, unmapped: 0 }, total: 0 }),
      runClientAudit: async () => ({ success: true, totalIssues: 0, sections: [], durationMs: 50 }),
      repairClientAuditSection: async () => ({ success: true, changes: [] }),
      searchAtlas: async () => [],
      addAtlasMapping: async () => ({ success: true }),
      auditSeasonMerges: async () => ({ success: true, items: [] }),
      applySeasonMerge: async () => ({ success: true }),
      applyAllSeasonMerges: async () => ({ success: true }),
    },
  }))
})

const renderSettled = async (ui) => {
  let result
  await act(async () => { result = render(ui) })
  return result
}

// ── 1. Mount with a background build already running → busy UI visible ───────
// inFlight is the only signal a build that started before this screen mounted
// gives the UI; it missed the start event, so a not-ready status alone must not
// disable the button (see the stale-index case below).
test('shows busy UI when a rebuild is in flight on mount', async () => {
  window.electronAPI.getCatalogIndexStatus = async () => ({ ready: false, inFlight: true, rowCount: 0 })
  await renderSettled(<Database />)
  expect(screen.getByText('Rebuilding…')).toBeTruthy()
  const btn = screen.getByText('Rebuilding…')
  expect(btn.disabled).toBe(true)
  expect(screen.getByLabelText('Rebuilding browse catalog index')).toBeTruthy()
})

// ── 2. Mount with ready: true → no busy UI ────────────────────────────────
test('no busy UI when the index is ready on mount', async () => {
  window.electronAPI.getCatalogIndexStatus = async () => ({ ready: true, inFlight: false, rowCount: 500, builtAt: '2025-01-01' })
  await renderSettled(<Database />)
  expect(screen.queryByText('Rebuilding…')).toBeNull()
  const btn = screen.getByText('Rebuild index')
  expect(btn.disabled).toBe(false)
  expect(screen.queryByLabelText('Rebuilding browse catalog index')).toBeNull()
})

// ── 2b. Stale index with nothing running → button stays usable ──────────────
// Finding 1: gating the button on `ready === false` disabled it on a merely
// stale index, so the user could not fix it from this screen at all.
test('stale index with no build in flight leaves the button enabled', async () => {
  window.electronAPI.getCatalogIndexStatus = async () => ({ ready: false, inFlight: false, rowCount: 120 })
  await renderSettled(<Database />)
  expect(screen.queryByText('Rebuilding…')).toBeNull()
  const btn = screen.getByText('Rebuild index')
  expect(btn.disabled).toBe(false)
  expect(screen.queryByLabelText('Rebuilding browse catalog index')).toBeNull()
})

// ── 3. Live events while mounted ──────────────────────────────────────────
test('start and done events toggle busy UI while mounted', async () => {
  window.electronAPI.getCatalogIndexStatus = async () => ({ ready: true, rowCount: 300, builtAt: '2025-01-01' })
  await renderSettled(<Database />)
  expect(screen.queryByText('Rebuilding…')).toBeNull()
  expect(screen.getByText('Rebuild index')).toBeTruthy()

  await act(async () => {
    progressListener({ phase: 'start', processed: 0, total: 100, message: 'Indexing…' })
  })
  // Button is disabled and reads Rebuilding…; the progress line shows the payload message.
  const busyBtn = screen.getByText('Rebuilding…')
  expect(busyBtn.tagName).toBe('BUTTON')
  expect(busyBtn.disabled).toBe(true)
  expect(screen.getByText('Indexing…')).toBeTruthy()
  expect(screen.getByLabelText('Rebuilding browse catalog index')).toBeTruthy()

  await act(async () => {
    progressListener({ phase: 'done', processed: 100, total: 100, message: 'Done' })
  })
  expect(screen.queryByText('Rebuilding…')).toBeNull()
  expect(screen.getByText('Rebuild index')).toBeTruthy()
  expect(screen.getByText('Rebuild index').disabled).toBe(false)
  expect(screen.queryByLabelText('Rebuilding browse catalog index')).toBeNull()
})

// ── 4. Error event clears busy UI ─────────────────────────────────────────
test('error event clears busy UI', async () => {
  window.electronAPI.getCatalogIndexStatus = async () => ({ ready: true, rowCount: 300, builtAt: '2025-01-01' })
  await renderSettled(<Database />)
  expect(screen.queryByText('Rebuilding…')).toBeNull()

  await act(async () => {
    progressListener({ phase: 'start', processed: 0, total: 100, message: 'Indexing…' })
  })
  expect(screen.getByText('Rebuilding…')).toBeTruthy()

  await act(async () => {
    progressListener({ phase: 'error', message: 'Disk full' })
  })
  expect(screen.queryByText('Rebuilding…')).toBeNull()
  expect(screen.getByText('Rebuild index').disabled).toBe(false)
  // The failure reason is surfaced, not just swallowed into the cleared busy UI.
  expect(screen.getByText('Disk full')).toBeTruthy()
})

// ── 5. done event re-reads the status line ──────────────────────────────────
// The build's completion must refresh what the screen reports about the index;
// loadIndexStatus is what picks up the new rowCount / ready after the rebuild.
test('done event re-reads the index status', async () => {
  let status = { ready: true, inFlight: false, rowCount: 300, builtAt: '2025-01-01' }
  window.electronAPI.getCatalogIndexStatus = async () => status
  await renderSettled(<Database />)
  expect(screen.getByText(/300 entries indexed/)).toBeTruthy()

  // The rebuild lands 300 more rows; done triggers the re-read that surfaces it.
  status = { ready: true, inFlight: false, rowCount: 600, builtAt: '2025-02-01' }
  await act(async () => {
    progressListener({ phase: 'done', processed: 600, total: 600, message: 'Catalog index ready' })
  })
  expect(screen.getByText(/600 entries indexed/)).toBeTruthy()
})
