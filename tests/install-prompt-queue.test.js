import { describe, it, expect } from 'vitest'
import {
  canPresentInstall,
  dropInstallPrompt,
  enqueueInstallPrompt,
  takeNextInstall,
} from '../src/components/downloads/installPromptQueue.js'

// ── Install prompt queue ─────────────────────────────────────────────────────
//
// Two failure modes drive these, and both are the kind that make a feature look
// broken rather than merely imperfect:
//
//   1. A dialog that cannot be dismissed, because download-updated fires again
//      for the same row and re-raises the prompt the user just declined.
//   2. A dialog that lands on top of the update-all run and steals the click
//      meant for the mirror underneath it.

const item = (id, extra = {}) => ({ id, title: `Item ${id}`, installable: true, ...extra })

describe('enqueueInstallPrompt', () => {
  it('takes a finished, uninstalled download', () => {
    expect(enqueueInstallPrompt([], item(1))).toHaveLength(1)
  })

  it('refuses a row the main process does not call installable', () => {
    // installable is the main process's own answer (file on disk, never
    // installed, finished state). Recomputing that rule here would be a second
    // copy free to disagree with electron/db/downloads.js.
    expect(enqueueInstallPrompt([], item(1, { installable: false }))).toHaveLength(0)
    expect(enqueueInstallPrompt([], { id: 1, state: 'done' })).toHaveLength(0)
  })

  it('does not re-raise a prompt that was already shown for that id', () => {
    // The undismissable-dialog case. download-updated fires repeatedly for one
    // row — a completed_at write, an install failure — and every one of those
    // arrives with installable still true.
    const prompted = new Set([1])
    expect(enqueueInstallPrompt([], item(1), prompted)).toHaveLength(0)
  })

  it('does not queue the same id twice', () => {
    const queue = enqueueInstallPrompt([], item(1))
    expect(enqueueInstallPrompt(queue, item(1))).toHaveLength(1)
  })

  it('ignores an event with no id rather than queueing an unopenable dialog', () => {
    expect(enqueueInstallPrompt([], { installable: true })).toHaveLength(0)
    expect(enqueueInstallPrompt([], null)).toHaveLength(0)
  })
})

describe('canPresentInstall', () => {
  const base = { queue: [item(1)], blocked: false, installing: false, activeTarget: null, pendingPrompt: false }

  it('presents when nothing is in the way', () => {
    expect(canPresentInstall(base)).toBe(true)
  })

  it('waits while another modal owns the screen', () => {
    // The update-all run is the case this exists for: a prompt dropped over it
    // takes the click meant for a mirror chip underneath.
    expect(canPresentInstall({ ...base, blocked: true })).toBe(false)
  })

  it('waits while an install is already unpacking', () => {
    // downloads-install refuses a second concurrent install, so a prompt raised
    // now could only be answered with "another install is already running".
    expect(canPresentInstall({ ...base, installing: true })).toBe(false)
  })

  it('waits while its own dialog is still open', () => {
    expect(canPresentInstall({ ...base, activeTarget: { item: item(2) } })).toBe(false)
  })

  it('waits while a flow is mid-way through opening', () => {
    // Without this the effect fires again on the next download event while the
    // config read is still in flight and starts a second flow.
    expect(canPresentInstall({ ...base, pendingPrompt: true })).toBe(false)
  })

  it('presents nothing when the line is empty', () => {
    expect(canPresentInstall({ ...base, queue: [] })).toBe(false)
  })
})

describe('takeNextInstall', () => {
  it('pops the head and returns the rest', () => {
    const { item: head, rest } = takeNextInstall([item(1), item(2)])
    expect(head.id).toBe(1)
    expect(rest.map((entry) => entry.id)).toEqual([2])
  })

  it('returns null for an empty queue rather than undefined', () => {
    expect(takeNextInstall([]).item).toBeNull()
  })
})

describe('dropInstallPrompt', () => {
  it('removes a row that stopped being installable while it waited', () => {
    // A queue entry is a snapshot taken when the download finished. Without this
    // the host can raise a dialog for an archive that has since been installed
    // or cleared.
    expect(dropInstallPrompt([item(1), item(2)], 1).map((entry) => entry.id)).toEqual([2])
  })

  it('leaves the queue alone for an id it does not hold', () => {
    expect(dropInstallPrompt([item(1)], 9)).toHaveLength(1)
    expect(dropInstallPrompt([item(1)], null)).toHaveLength(1)
  })
})
