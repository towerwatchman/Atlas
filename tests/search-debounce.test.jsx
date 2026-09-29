// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'

import SearchBox from '../src/components/search/SearchBox.jsx'
import { useDebouncedSearch } from '../src/hooks/useDebouncedSearch.js'

// ── Search debounce ──────────────────────────────────────────────────────────
//
// Catalog Browse and Library both share the same text filter. Before this
// change SearchBox/SearchSidebar called onSearchChange per keystroke, so
// Library paid a full filterGamesWithState pass and Browse paid a catalog
// fetch schedule per character — visible as input lag and a flicker when the
// debounced catalog refetch cleared the grid.
//
// The fix keeps the input visually instant (localValue) while the expensive
// parent update waits 300ms after the last keystroke; clear bypasses the
// delay.

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SearchBox debounces typing', () => {
  it('does not call onSearchChange per keystroke, only after the delay with the final value', async () => {
    const onSearchChange = vi.fn()
    render(<SearchBox value="" onSearchChange={onSearchChange} onToggleSidebar={() => {}} />)
    const input = screen.getByPlaceholderText('Search Atlas')

    // Simulate fast typing: "ab" with <300ms between keystrokes.
    fireEvent.change(input, { target: { value: 'a' } })
    expect(input.value).toBe('a')
    expect(onSearchChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'ab' } })
    expect(input.value).toBe('ab')
    expect(onSearchChange).not.toHaveBeenCalled()

    // Still within debounce window (300ms).
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(onSearchChange).not.toHaveBeenCalled()

    // Trailing edge fires once with coalesced value.
    await act(async () => { vi.advanceTimersByTime(150) })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('ab')
  })

  it('coalesces rapid typing into a single call', async () => {
    const onSearchChange = vi.fn()
    render(<SearchBox value="" onSearchChange={onSearchChange} onToggleSidebar={() => {}} />)
    const input = screen.getByPlaceholderText('Search Atlas')

    fireEvent.change(input, { target: { value: 'm' } })
    await act(async () => { vi.advanceTimersByTime(50) })
    fireEvent.change(input, { target: { value: 'mi' } })
    await act(async () => { vi.advanceTimersByTime(50) })
    fireEvent.change(input, { target: { value: 'min' } })
    await act(async () => { vi.advanceTimersByTime(50) })
    fireEvent.change(input, { target: { value: 'mine' } })

    expect(onSearchChange).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('mine')
  })

  it('clear button bypasses debounce and fires immediately', async () => {
    const onSearchChange = vi.fn()
    const { rerender } = render(<SearchBox value="hello" onSearchChange={onSearchChange} onToggleSidebar={() => {}} />)
    // Need localValue to reflect prop for clear button to show; SearchBox syncs from props.
    // The initial prop "hello" seeds localValue, so clear button is visible.
    const clear = screen.getByTitle('Clear search')
    fireEvent.click(clear)
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('')
    // Pending typing must not overwrite the clear.
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
  })

  it('input echoes keystrokes instantly while parent lags', async () => {
    const onSearchChange = vi.fn()
    render(<SearchBox value="" onSearchChange={onSearchChange} onToggleSidebar={() => {}} />)
    const input = screen.getByPlaceholderText('Search Atlas')
    fireEvent.change(input, { target: { value: 'x' } })
    expect(input.value).toBe('x')
    expect(onSearchChange).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(onSearchChange).toHaveBeenCalledWith('x')
  })
})

describe('useDebouncedSearch hook', () => {
  it('adopts external value and cancels pending debounce (e.g. resetFilters)', async () => {
    const onSearchChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedSearch({ value, onSearchChange, delay: 300 }),
      { initialProps: { value: 'initial' } }
    )

    act(() => { result.current.handleChange('typed') })
    expect(result.current.localValue).toBe('typed')
    expect(onSearchChange).not.toHaveBeenCalled()

    // Parent resets (e.g. applySavedFilter, resetFilters) before debounce fires.
    await act(async () => { rerender({ value: '' }) })
    expect(result.current.localValue).toBe('')

    await act(async () => { vi.advanceTimersByTime(400) })
    // Stale "typed" must not fire after the reset adopted ''.
    expect(onSearchChange).not.toHaveBeenCalled()
  })

  it('handleClear fires immediately and cancels pending typing', async () => {
    const onSearchChange = vi.fn()
    const { result } = renderHook(() => useDebouncedSearch({ value: 'hello', onSearchChange, delay: 300 }))
    expect(result.current.localValue).toBe('hello')

    act(() => { result.current.handleChange('hello world') })
    act(() => { result.current.handleClear() })
    expect(result.current.localValue).toBe('')
    expect(onSearchChange).toHaveBeenCalledWith('')
    expect(onSearchChange).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(400) })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
  })

  it('unmount cancels pending timer (no call after unmount)', async () => {
    const onSearchChange = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedSearch({ value: '', onSearchChange, delay: 300 }))
    act(() => { result.current.handleChange('a') })
    unmount()
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(onSearchChange).not.toHaveBeenCalled()
  })

  it('resetInputSignal cancels pending even when value unchanged (fresh-load reset edge case)', async () => {
    const onSearchChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ value, resetInputSignal }) => useDebouncedSearch({ value, onSearchChange, delay: 300, resetInputSignal }),
      { initialProps: { value: '', resetInputSignal: 0 } }
    )

    // User types while committed text is still '' (fresh load).
    act(() => { result.current.handleChange('typed') })
    expect(result.current.localValue).toBe('typed')
    expect(onSearchChange).not.toHaveBeenCalled()

    // Parent hits Reset filters within debounce window: value stays '' but
    // resetInputSignal bumps. Without the signal the pending timer would survive
    // and re-apply 'typed' after the grid was already reset.
    await act(async () => { rerender({ value: '', resetInputSignal: 1 }) })
    expect(result.current.localValue).toBe('')

    await act(async () => { vi.advanceTimersByTime(400) })
    expect(onSearchChange).not.toHaveBeenCalled()
  })

  it('resetInputSignal clears pending even when lastSent is empty string (post-clear reset)', async () => {
    const onSearchChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ value, resetInputSignal }) => useDebouncedSearch({ value, onSearchChange, delay: 300, resetInputSignal }),
      { initialProps: { value: '', resetInputSignal: 0 } }
    )

    // Establish lastSent = '' via a clear, then type again.
    act(() => { result.current.handleChange('first') })
    act(() => { result.current.handleClear() })
    expect(result.current.localValue).toBe('')
    expect(onSearchChange).toHaveBeenCalledWith('')
    onSearchChange.mockClear()

    act(() => { result.current.handleChange('typed-again') })
    expect(result.current.localValue).toBe('typed-again')

    // Reset while value is still '' and lastSent is '' — the old echo
    // heuristic (value === lastSent) would have kept the pending timer.
    await act(async () => { rerender({ value: '', resetInputSignal: 1 }) })
    expect(result.current.localValue).toBe('')

    await act(async () => { vi.advanceTimersByTime(400) })
    expect(onSearchChange).not.toHaveBeenCalled()
  })
})
