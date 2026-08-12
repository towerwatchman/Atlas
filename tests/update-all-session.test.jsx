// @vitest-environment jsdom
import { test, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

import LibraryUpdateModal from '../src/components/ui/LibraryUpdateModal.jsx'
import UpdateAllSession from '../src/components/downloads/UpdateAllSession.jsx'

// ── The frame around the run, asserted where it is actually built ────────────
//
// updateAllQueue.js is unit tested next door and is NOT the whole story: the
// counters are computed there but PRINTED here, the skip button is what calls
// advanceQueue, and "the run keeps its own list" is a property of this
// component's effect rather than of any function. A pure test cannot see any of
// that.

afterEach(cleanup)

const game = (id, title) => ({
  record_id: id,
  title,
  isUpdateAvailable: true,
  f95_id: 1000 + id,
})

beforeEach(() => {
  // updateLinksGet is called twice per game here: once by the modal for the
  // game on screen, once by the session warming the next one. Both resolve to a
  // thread with no usable mirrors, which is a real outcome and keeps these
  // tests on the frame rather than on the mirror list.
  window.electronAPI = {
    updateLinksGet: vi.fn().mockResolvedValue({ ok: true, links: [], threadId: 1 }),
    openExternalUrl: vi.fn(),
  }
})

test('the chooser disables the run when nothing has an update', () => {
  const onChoose = vi.fn()
  render(<LibraryUpdateModal open updateCount={0} onChoose={onChoose} onClose={() => {}} />)

  const card = screen.getByText('Update all games').closest('button')
  expect(card.disabled).toBe(true)
  fireEvent.click(card)
  expect(onChoose).not.toHaveBeenCalled()
})

test('the chooser reports each choice by id', () => {
  const onChoose = vi.fn()
  render(<LibraryUpdateModal open updateCount={4} onChoose={onChoose} onClose={() => {}} />)

  fireEvent.click(screen.getByText('Check for client updates').closest('button'))
  expect(onChoose).toHaveBeenCalledWith('client')

  fireEvent.click(screen.getByText('Update all games').closest('button'))
  expect(onChoose).toHaveBeenCalledWith('games')

  fireEvent.click(screen.getByText('Refresh library metadata').closest('button'))
  expect(onChoose).toHaveBeenCalledWith('metadata')
})

test('the run prints its position and how many are left', async () => {
  render(<UpdateAllSession open games={[game(1, 'Alpha'), game(2, 'Beta'), game(3, 'Gamma')]} onClose={() => {}} />)

  await screen.findByText('Update Alpha')
  expect(screen.getByText(/Game 1 of 3/)).toBeTruthy()
  expect(screen.getByText(/3 left/)).toBeTruthy()
})

test('Skip advances to the next game without queueing a download', async () => {
  const onQueued = vi.fn()
  render(
    <UpdateAllSession
      open
      games={[game(1, 'Alpha'), game(2, 'Beta')]}
      onClose={() => {}}
      onQueued={onQueued}
    />,
  )

  await screen.findByText('Update Alpha')
  fireEvent.click(screen.getByText('Skip'))

  await screen.findByText('Update Beta')
  expect(screen.getByText(/Game 2 of 2/)).toBeTruthy()
  expect(screen.getByText(/1 left/)).toBeTruthy()
  expect(onQueued).not.toHaveBeenCalled()
})

test('stopping ends the run and says the queued downloads keep going', async () => {
  const onClose = vi.fn()
  render(<UpdateAllSession open games={[game(1, 'Alpha'), game(2, 'Beta')]} onClose={onClose} />)

  await screen.findByText('Update Alpha')
  fireEvent.click(screen.getByText('Stop checking'))

  await screen.findByText('Stopped checking for updates')
  // The whole reason this sentence exists: "Stop" reasonably reads as stopping
  // everything, including the transfers the user just spent ten minutes
  // starting.
  expect(screen.getByText(/Downloads already queued keep going/)).toBeTruthy()
  // Two, not one. The game on screen when Stop was pressed was not dealt with
  // either, and counting it as checked would overstate what the run did.
  expect(screen.getByText(/2/)).toBeTruthy()
  expect(screen.getByText(/games were/)).toBeTruthy()
  // Ending the run is not the same as dismissing the summary — the summary is
  // the only place the user finds out what the run did.
  expect(onClose).not.toHaveBeenCalled()

  fireEvent.click(screen.getByText('Done'))
  expect(onClose).toHaveBeenCalled()
})

test('working through every game reports finished rather than stopped', async () => {
  render(<UpdateAllSession open games={[game(1, 'Alpha')]} onClose={() => {}} />)

  await screen.findByText('Update Alpha')
  fireEvent.click(screen.getByText('Skip'))

  await screen.findByText('Finished checking for updates')
})

test('the run keeps its own list when the library refetches under it', async () => {
  // The library refetches after every queued download, and isUpdateAvailable
  // flips off for the game just dealt with. A reactive queue would renumber
  // itself mid-run: the counter would go backwards and games already handled
  // would reappear.
  const { rerender } = render(
    <UpdateAllSession open games={[game(1, 'Alpha'), game(2, 'Beta')]} onClose={() => {}} />,
  )

  await screen.findByText('Update Alpha')
  rerender(<UpdateAllSession open games={[game(2, 'Beta')]} onClose={() => {}} />)

  await waitFor(() => expect(screen.getByText(/Game 1 of 2/)).toBeTruthy())
  expect(screen.getByText('Update Alpha')).toBeTruthy()
})

test('the next game is warmed while the user works on the current one', async () => {
  render(<UpdateAllSession open games={[game(1, 'Alpha'), game(2, 'Beta')]} onClose={() => {}} />)

  await screen.findByText('Update Alpha')
  await waitFor(() =>
    expect(window.electronAPI.updateLinksGet).toHaveBeenCalledWith({ threadId: 1002, force: false }),
  )
})
