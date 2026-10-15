// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

// The Tags panel must default to read-only (whole chip is a search link) and
// only show the destructive × / input behind an explicit pencil toggle, so a
// search click can never delete a tag by accident.
import DetailTagsPanel from '../src/components/detail/page/DetailTagsPanel.jsx'

const baseProps = {
  editable: true,
  tags: ['Action', 'mine'],
  catalogTags: ['Action'],
  overridden: true,
  busy: false,
  loading: false,
  error: '',
  onApplyTags: () => {},
  onResetTags: () => {},
  readOnlyTags: [],
  onSearchTag: () => {},
}

beforeEach(() => {
  cleanup()
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: { getKnownTags: async () => [] },
  }))
})

test('read-only by default: pencil shown, no remove buttons or input', async () => {
  let result
  await act(async () => { result = render(<DetailTagsPanel {...baseProps} />) })
  expect(screen.getByTitle('Edit tags')).toBeTruthy()
  expect(screen.queryByPlaceholderText(/add a tag/i)).toBeNull()
  expect(screen.queryByLabelText(/remove action/i)).toBeNull()
  result.unmount()
})

test('pencil toggles the editor with remove buttons and input', async () => {
  let result
  await act(async () => { result = render(<DetailTagsPanel {...baseProps} />) })
  await act(async () => { fireEvent.click(screen.getByTitle('Edit tags')) })
  expect(screen.getByPlaceholderText(/add a tag/i)).toBeTruthy()
  expect(screen.getByLabelText(/remove action/i)).toBeTruthy()
  result.unmount()
})

test('read-only chip click reports a search, not an edit', async () => {
  let searched = null
  let result
  await act(async () => {
    result = render(<DetailTagsPanel {...baseProps} onSearchTag={(tag) => { searched = tag }} />)
  })
  await act(async () => { fireEvent.click(screen.getByText('Action')) })
  expect(searched).toBe('Action')
  result.unmount()
})

test('non-editable rows show chips with no pencil', async () => {
  let result
  await act(async () => {
    result = render(<DetailTagsPanel {...baseProps} editable={false} readOnlyTags={['RPG']} />)
  })
  expect(screen.queryByTitle('Edit tags')).toBeNull()
  expect(screen.getByText('RPG')).toBeTruthy()
  result.unmount()
})

test('large tag lists show every chip, none silently dropped', async () => {
  const tags = Array.from({ length: 33 }, (_, i) => `Tag${i}`)
  let result
  await act(async () => {
    result = render(<DetailTagsPanel {...baseProps} editable={false} readOnlyTags={tags} />)
  })
  expect(screen.getAllByRole('button').length).toBe(33)
  result.unmount()
})
