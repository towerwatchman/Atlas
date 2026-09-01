// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import PreviewLightbox from '../src/components/detail/page/PreviewLightbox.jsx'

afterEach(() => cleanup())

describe('PreviewLightbox keyboard navigation', () => {
  const openLightbox = () => {
    const onClose = vi.fn()
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(
      <PreviewLightbox
        previews={['a.png', 'b.png', 'c.png']}
        lightboxIndex={0}
        onClose={onClose}
        onPrev={onPrev}
        onNext={onNext}
      />,
    )
    return { onClose, onPrev, onNext }
  }

  it('renders nothing when closed', () => {
    render(
      <PreviewLightbox
        previews={['a.png']}
        lightboxIndex={null}
        onClose={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(screen.queryByTitle('Close (Esc)')).toBeNull()
  })

  it('calls onNext on ArrowRight while open', () => {
    const { onNext } = openLightbox()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('calls onPrev on ArrowLeft while open', () => {
    const { onPrev } = openLightbox()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Escape while open', () => {
    const { onClose } = openLightbox()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not respond to keys when closed', () => {
    const onClose = vi.fn()
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(
      <PreviewLightbox
        previews={['a.png']}
        lightboxIndex={null}
        onClose={onClose}
        onPrev={onPrev}
        onNext={onNext}
      />,
    )
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onNext).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('removes its window listener when unmounted while open', () => {
    // A listener surviving unmount calls setState on a dead component — the
    // window listener path here mirrors the document-listener assertion in
    // split-button-menu.test.jsx.
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(
      <PreviewLightbox
        previews={['a.png']}
        lightboxIndex={0}
        onClose={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    unmount()
    const removed = remove.mock.calls.map((call) => call[0])
    expect(removed).toContain('keydown')
    remove.mockRestore()
  })
})
