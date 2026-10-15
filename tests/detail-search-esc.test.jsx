// @vitest-environment jsdom
import { test, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { escClosesDetail } from '../src/utils/metadataSearch.js'
import SearchBox from '../src/components/search/SearchBox.jsx'
import SplitButtonMenu from '../src/components/detail/page/SplitButtonMenu.jsx'
import PlaystatePicker from '../src/components/ui/PlaystatePicker.jsx'

// Escape closes the detail page only when nothing else owns it: the lightbox
// closes itself, open modals keep focus, and text inputs keep the keystroke so
// the first Escape never navigates away from typing.
test('escape closes detail only when nothing else owns it', () => {
  expect(escClosesDetail({})).toBe(true)
  expect(escClosesDetail({ lightboxOpen: true })).toBe(false)
  expect(escClosesDetail({ modalOpen: true })).toBe(false)
  expect(escClosesDetail({ inTextInput: true })).toBe(false)
  expect(escClosesDetail({ consumed: true })).toBe(false)
})

beforeEach(() => { cleanup() })

test('escape in the search box releases focus instead of bubbling', async () => {
  let result
  await act(async () => {
    result = render(<SearchBox value="" onSearchChange={() => {}} onToggleSidebar={() => {}} />)
  })
  const input = screen.getByPlaceholderText('Search Atlas')
  await act(async () => { input.focus() })
  expect(document.activeElement).toBe(input)
  await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }) })
  expect(document.activeElement).not.toBe(input)
  result.unmount()
})

test('a focus signal puts the cursor in the search box', async () => {
  let result
  await act(async () => {
    result = render(<SearchBox value="Foo" onSearchChange={() => {}} onToggleSidebar={() => {}} focusSignal={0} />)
  })
  const input = screen.getByPlaceholderText('Search Atlas')
  expect(document.activeElement).not.toBe(input)
  await act(async () => {
    result.rerender(<SearchBox value="Foo" onSearchChange={() => {}} onToggleSidebar={() => {}} focusSignal={1} />)
  })
  expect(document.activeElement).toBe(input)
  result.unmount()
})

// An open menu owns Escape: it must consume the keystroke so the detail
// page's own Escape handler (which reads defaultPrevented as "consumed")
// does not navigate back on top of the closing menu.
test('escape in an open split-button menu is consumed', async () => {
  let result
  await act(async () => {
    result = render(
      <SplitButtonMenu items={[{ label: 'Manual Install', onSelect: () => {} }]}>
        <button type="button">Install</button>
      </SplitButtonMenu>,
    )
  })
  await act(async () => { fireEvent.click(screen.getByTitle('More options')) })
  expect(screen.getByRole('menu')).toBeTruthy()
  let consumed = false
  await act(async () => { consumed = !fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(consumed).toBe(true)
  result.unmount()
})

test('escape in an open playstate picker is consumed', async () => {
  let result
  await act(async () => {
    result = render(<PlaystatePicker value={null} onChange={() => {}} />)
  })
  await act(async () => { fireEvent.click(screen.getByTitle('Set playstate')) })
  expect(screen.getByRole('listbox')).toBeTruthy()
  let consumed = false
  await act(async () => { consumed = !fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(consumed).toBe(true)
  result.unmount()
})
