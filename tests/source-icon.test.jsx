// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import SourceIcon from '../src/components/ui/SourceIcon.jsx'

afterEach(cleanup)

describe('SourceIcon', () => {
  it('renders the mapped logo asset for a configured source', () => {
    const { container } = render(<SourceIcon source="f95" size={14} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.getAttribute('title')).toBe('f95')
    expect(img.getAttribute('alt')).toBe('f95')
  })

  it('renders the custom logo for the custom source', () => {
    const { container } = render(<SourceIcon source="custom" size={14} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.getAttribute('title')).toBe('custom')
  })

  it('falls back to a font-awesome icon for an unmapped source', () => {
    const { container } = render(<SourceIcon source="totally-unknown" size={14} />)
    const icon = container.querySelector('i')
    expect(icon).not.toBeNull()
    expect(icon.getAttribute('title')).toBe('totally-unknown')
    expect(icon.className).toContain('fa-circle')
  })

  it('renders nothing when source is missing', () => {
    const { container } = render(<SourceIcon source={null} />)
    expect(container.querySelector('img, i')).toBeNull()
  })
})
