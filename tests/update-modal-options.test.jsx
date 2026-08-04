// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

import UpdateModal from '../src/components/downloads/UpdateModal.jsx'

// Nothing mounted this modal before, which is how the flat mirror list survived
// as long as it did: linkSections was unit tested, the modal that renders it was
// not, and the two disagreed about what a "section" was.
//
// The case that matters is the one observed on FreshWomen: two DLCs posted under
// separate headings but the same "<b>Win/Linux/Mac</b>" platform bold. They must
// render as TWO named builds, not one option called Win/Linux/Mac.

const link = (host, group, platform = '') => ({
  url: `https://${host}/f/${group.replace(/\W+/g, '')}`,
  host,
  group,
  platform,
  label: 'Download',
  masked: true,
  compressed: false,
  platforms: [],
})

const mount = (links) => {
  window.electronAPI = {
    updateLinksGet: vi.fn().mockResolvedValue({ ok: true, threadId: '95982', links }),
    openExternalUrl: vi.fn(),
    downloadsResolveMasked: vi.fn(),
    downloadsEnqueue: vi.fn(),
  }
  return render(
    <UpdateModal
      game={{ title: 'FreshWomen', f95_id: '95982', latestVersion: 'Season 2 Final' }}
      open
      onClose={() => {}}
      onQueued={() => {}}
    />,
  )
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup(); delete window.electronAPI })

describe('UpdateModal build options', () => {
  it('shows two builds that share a platform as two options', async () => {
    mount([
      link('mega.nz', "Chloe's: Desire Express DLC", 'Win/Linux/Mac'),
      link('mega.nz', 'Julia in Japan DLC', 'Win/Linux/Mac'),
    ])
    await waitFor(() => {
      expect(screen.getByText("Chloe's: Desire Express DLC")).toBeTruthy()
    })
    expect(screen.getByText('Julia in Japan DLC')).toBeTruthy()
    // The platform is a badge on each build, never the build's name.
    expect(screen.queryByText('Win/Linux/Mac', { selector: 'span.text-xs' })).toBeNull()
    expect(screen.getAllByText('Win/Linux/Mac').length).toBe(2)
  })

  it('labels the mirror chips with the bare host, which is what the thread shows', async () => {
    mount([
      link('mega.nz', 'Season 2 Final 4K', 'Win/Linux'),
      link('buzzheavier.com', 'Season 2 Final 4K', 'Win/Linux'),
    ])
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    // The longest host name in the data, and the one the chip width was sized to.
    expect(screen.getByText('buzzheavier.com')).toBeTruthy()
  })

  it('counts the mirrors of each build', async () => {
    mount([
      link('mega.nz', 'Season 2', 'Win'),
      link('pixeldrain.com', 'Season 2', 'Win'),
      link('mega.nz', 'Season 1', 'Win'),
    ])
    await waitFor(() => { expect(screen.getByText('Season 2')).toBeTruthy() })
    expect(screen.getByText(/2 mirrors/)).toBeTruthy()
    expect(screen.getByText(/1 mirror$/)).toBeTruthy()
  })

  it('hides the build heading when there is only one, and still lists its mirrors', async () => {
    // A label on a list with no alternative is noise.
    mount([
      link('mega.nz', 'Season 2 Final', 'Win'),
      link('pixeldrain.com', 'Season 2 Final', 'Win'),
    ])
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    expect(screen.queryByText('Season 2 Final')).toBeNull()
    expect(screen.getByText('pixeldrain.com')).toBeTruthy()
  })

  it('tells the user to pick a build first only when there is more than one', async () => {
    mount([link('mega.nz', 'A', 'Win'), link('mega.nz', 'B', 'Win')])
    await waitFor(() => {
      expect(screen.getByText(/Pick the build first, then a mirror/)).toBeTruthy()
    })
  })

  it('names the unlabeled block instead of showing a blank heading', async () => {
    mount([link('mega.nz', '', 'Win'), link('mega.nz', 'Season 1', 'Win')])
    await waitFor(() => { expect(screen.getByText('Full Archive')).toBeTruthy() })
  })
})
