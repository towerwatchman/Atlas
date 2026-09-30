// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MediaTab from '../src/components/detail/window/MediaTab.jsx'

// Exercise the badge *rendering* logic regardless of the current config toggle:
// drive every flag on so the assertions below test the markup, not the flag.
vi.mock('../src/assets/icons/sourceIcons', async () => {
  const actual = await vi.importActual('../src/assets/icons/sourceIcons')
  return { ...actual, SHOW_LOCATION_BADGES: { remote: true, local: true, custom: true } }
})

const noop = () => {}

const baseProps = {
  game: { record_id: 1 },
  bannerUrl: '',
  bannerMediaStatus: false,
  validPreviewUrls: [],
  previewMediaStatus: false,
  importProgress: { text: '', progress: 0, total: 1 },
  onDownloadBanner: noop,
  onSelectCustomBanner: noop,
  onDeleteBanner: noop,
  onDownloadPreviews: noop,
  onDeletePreviews: noop,
  onDeleteCustomPreviews: noop,
  onRefreshMetadata: noop,
  onResetSortOrder: noop,
  onSaveSortOrder: noop,
  onMediaChanged: noop,
}

beforeAll(() => {
  // MediaTab subscribes to custom-media progress on mount; guard it like the app does.
  window.electronAPI = { onCustomMediaProgress: noop, removeCustomMediaProgressListener: noop }
})
afterAll(() => {
  delete window.electronAPI
})
afterEach(cleanup)

const renderWith = (previews) =>
  render(<MediaTab {...baseProps} validPreviewUrls={previews} />)

describe('MediaTab preview badges', () => {
  it('shows a remote (cloud) badge for streaming previews', () => {
    renderWith([{ url: 'https://f95zone.to/a.jpg', source: 'f95', location: 'remote' }])
    expect(screen.getByTitle('Streaming from web')).toBeTruthy()
  })

  it('shows a downloaded (green check) badge for local previews', () => {
    renderWith([{ url: 'https://gog.com/b.jpg', source: 'gog', location: 'local' }])
    expect(screen.getByTitle('Downloaded')).toBeTruthy()
  })

  it('shows an uploaded (person) badge for custom previews', () => {
    renderWith([{ url: 'https://x.com/c.jpg', source: 'custom', location: 'custom' }])
    expect(screen.getByTitle('Uploaded')).toBeTruthy()
  })

  it('shows the source logo badge for a known source', () => {
    renderWith([{ url: 'https://f95zone.to/a.jpg', source: 'f95', location: 'remote' }])
    // SourceIcon renders <img title="f95"> and the wrapper span also carries title="f95"
    expect(screen.getAllByTitle('f95').length).toBeGreaterThan(0)
  })
})
