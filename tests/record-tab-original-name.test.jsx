// @vitest-environment jsdom
// Contract for issue #365 in the Edit Game Details window: the Record tab
// shows a read-only "Original Name" row fed by game.original_name, and the
// disabled "Mappings" summary row is gone (it duplicated the Mappings tab).

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import RecordTab from '../src/components/detail/window/RecordTab.jsx'
import { gameToFormData, buildChangedPayload } from '../src/components/detail/GameDetailsWindow.jsx'

afterEach(cleanup)

const formData = (over = {}) => ({
  title: 'Paper Hearts',
  platform: '',
  engine: "Ren'Py",
  developer: 'Bite The Rose Studio',
  publisher: '',
  release_date: '',
  status: '',
  description: '',
  category: '',
  latest_version: '',
  censored: '',
  language: '',
  translations: '',
  genre: '',
  voice: '',
  rating: '',
  notes: '',
  original_name: 'Ourlifexq',
  ...over,
})

describe('Record tab original name', () => {
  it('shows the original name value under an "Original Name" label', () => {
    render(<RecordTab formData={formData()} onChange={() => {}} />)
    const input = screen.getByLabelText('Original Name')
    expect(input.value).toBe('Ourlifexq')
  })

  it('no longer shows the Mappings summary row', () => {
    render(<RecordTab formData={formData()} onChange={() => {}} />)
    expect(screen.queryByLabelText('Mappings')).toBeNull()
    expect(screen.queryByText('Mappings')).toBeNull()
  })
})

describe('Record tab form wiring', () => {
  it('gameToFormData carries original_name and drops the mappings summary', () => {
    const data = gameToFormData({
      title: 'Paper Hearts',
      original_name: 'Ourlifexq',
      f95_id: 123,
      atlas_id: 456,
    })
    expect(data.original_name).toBe('Ourlifexq')
    expect(data).not.toHaveProperty('mappings')
  })

  // Read-only contract: there is no override column for original_name, so a
  // save must never ship it — it can only ever come from the source data.
  it('buildChangedPayload never sends original_name', () => {
    const baseline = formData()
    const payload = buildChangedPayload(
      { ...baseline, original_name: 'Something Else' },
      baseline,
    )
    expect(payload).not.toHaveProperty('original_name')
  })
})
