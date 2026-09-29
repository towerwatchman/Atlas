// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import HeroBanner from '../src/components/detail/page/HeroBanner.jsx'
import ActionBar from '../src/components/detail/page/ActionBar.jsx'

afterEach(cleanup)

// Detail back closes the overlay; header Home resets to the library grid.
const heroSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'detail', 'page', 'HeroBanner.jsx'), 'utf8')
const barSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'detail', 'page', 'ActionBar.jsx'), 'utf8')
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')

describe('navigation labels', () => {
  it('HeroBanner back button says Back', () => {
    expect(heroSrc).toContain('>Back')
  })

  it('ActionBar back button says Back', () => {
    expect(barSrc).toContain('title="Back"')
    expect(barSrc).toContain('<span>Back</span>')
  })

  it('header home buttons say Home', () => {
    const count = (appSrc.match(/title="Home"/g) || []).length
    expect(count).toBe(2)
  })
})

describe('HeroBanner renders Back', () => {
  const game = { title: 'Test', banner_url: null, hero_url: null }

  it('shows Back and calls onBack', () => {
    const onBack = vi.fn()
    render(<HeroBanner game={game} onBack={onBack} showBack bannerRef={{ current: null }} bannerDimsRef={{ current: null }} bannerMask={{ image: 'none' }} onLoad={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Back' })
    btn.click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('ActionBar renders Back', () => {
  const game = { record_id: 1, title: 'Test', isUpdateAvailable: false }

  it('shows Back with title Back', () => {
    const onBack = vi.fn()
    render(<ActionBar game={game} onBack={onBack} showBack launchState="idle" />)
    const btn = screen.getByTitle('Back')
    btn.click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('hides Back when showBack is false', () => {
    render(<ActionBar game={game} showBack={false} launchState="idle" />)
    expect(screen.queryByTitle('Back')).toBeNull()
  })
})
