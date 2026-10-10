import { describe, it, expect, vi } from 'vitest'
import Module from 'module'

const originalLoad = Module._load
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') {
    return { ipcMain: { handle: () => {} }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, app: {} }
  }
  return originalLoad.call(this, request, parent, isMain)
}
const { __testables } = require('../electron/ipc/importer.js')
Module._load = originalLoad
const { downloadMediaForInstalledGame } = __testables

const baseDeps = (overrides = {}) => ({
  recordId: 7,
  atlasId: 9,
  dataDir: '/tmp/atlas-install-media',
  sourceOrder: null,
  getRemoteBannerUrl: async () => 'https://example.com/banner.jpg',
  getRemotePreviewUrls: async () => [
    'https://example.com/a.jpg',
    'https://example.com/b.jpg',
    'https://example.com/c.jpg',
  ],
  getStoredBannerUrls: async () => ['https://example.com/banner.jpg'],
  getStoredPreviewUrls: async () => ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
  updateBanners: async () => {},
  updatePreviews: async () => {},
  inferSource: () => 'remote',
  isVideoUrl: () => false,
  downloadImagesFn: vi.fn(async () => ({ success: true, downloaded: 1 })),
  onProgress: null,
  onDone: null,
  ...overrides,
})

describe('downloadMediaForInstalledGame (421)', () => {
  it('downloads only C when stored is [A, B] and fresh is [A, B, C]', async () => {
    const downloadImagesFn = vi.fn(async () => ({ success: true }))
    await downloadMediaForInstalledGame(baseDeps({ downloadImagesFn }))

    expect(downloadImagesFn).toHaveBeenCalledTimes(1)
    const args = downloadImagesFn.mock.calls[0]
    expect(args[0]).toBe(7)
    expect(args[3]).toBe(false)
    expect(args[4]).toBe(true)
    expect(await args[9]()).toEqual([{ url: 'https://example.com/c.jpg', source: 'remote' }])
    expect(args[12].appendPreviews).toBe(true)
  })

  it('downloads nothing when stored covers the fresh list', async () => {
    const downloadImagesFn = vi.fn(async () => ({ success: true }))
    const out = await downloadMediaForInstalledGame(baseDeps({
      downloadImagesFn,
      getRemotePreviewUrls: async () => ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    }))

    expect(downloadImagesFn).not.toHaveBeenCalled()
    expect(out.skipped).toBe(true)
  })

  it('downloads the banner alone when only the banner changed', async () => {
    const downloadImagesFn = vi.fn(async () => ({ success: true }))
    await downloadMediaForInstalledGame(baseDeps({
      downloadImagesFn,
      getRemoteBannerUrl: async () => 'https://example.com/banner-new.jpg',
      getRemotePreviewUrls: async () => ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    }))

    expect(downloadImagesFn).toHaveBeenCalledTimes(1)
    const args = downloadImagesFn.mock.calls[0]
    expect(args[3]).toBe(true)
    expect(args[4]).toBe(false)
    expect(await args[8]()).toBe('https://example.com/banner-new.jpg')
  })

  it('downloads the whole fresh list for a blank record', async () => {
    const downloadImagesFn = vi.fn(async () => ({ success: true }))
    await downloadMediaForInstalledGame(baseDeps({
      downloadImagesFn,
      getRemoteBannerUrl: async () => null,
      getStoredBannerUrls: async () => [],
      getStoredPreviewUrls: async () => [],
    }))

    expect(downloadImagesFn).toHaveBeenCalledTimes(1)
    const args = downloadImagesFn.mock.calls[0]
    expect(args[3]).toBe(false)
    expect(await args[9]()).toHaveLength(3)
  })

  it('keeps video URLs out of the download', async () => {
    const downloadImagesFn = vi.fn(async () => ({ success: true }))
    await downloadMediaForInstalledGame(baseDeps({
      downloadImagesFn,
      getRemotePreviewUrls: async () => ['https://example.com/a.jpg', 'https://example.com/trailer.mp4'],
      getStoredPreviewUrls: async () => [],
      isVideoUrl: (url) => String(url || '').endsWith('.mp4'),
    }))

    const args = downloadImagesFn.mock.calls[0]
    expect(await args[9]()).toEqual([{ url: 'https://example.com/a.jpg', source: 'remote' }])
  })

  it('reports progress and completion through the injected callbacks', async () => {
    const seen = []
    let done = null
    await downloadMediaForInstalledGame(baseDeps({
      onProgress: (current, total) => seen.push([current, total]),
      onDone: (result) => { done = result },
      downloadImagesFn: async (
        _recordId, _atlasId, onImageProgress,
        _dlBanner, _dlPreviews, _limit, _dlVideos, _dataDir,
        _getBannerUrl, _getScreens, _updateBanners, _updatePreviews, _options,
      ) => {
        onImageProgress(1, 2)
        return { success: true, downloaded: 1 }
      },
    }))

    expect(seen).toEqual([[1, 2]])
    expect(done).toEqual({ success: true, downloaded: 1 })
  })

  it('421: a failed download still reports completion instead of going silent', async () => {
    let done = null
    const out = await downloadMediaForInstalledGame(baseDeps({
      onDone: (result) => { done = result },
      downloadImagesFn: async () => { throw new Error('disk gone') },
    }))

    expect(out.success).toBe(false)
    expect(done).toEqual(out)
  })

  it('421: forwards pacing and rate-limit wiring to downloadImages', async () => {
    const downloadImagesFn = vi.fn(async () => ({ success: true }))
    const blockedSources = new Set()
    const onRateLimited = vi.fn()
    await downloadMediaForInstalledGame(baseDeps({
      downloadImagesFn,
      requestDelayMs: 250,
      blockedSources,
      onRateLimited,
    }))

    const args = downloadImagesFn.mock.calls[0]
    expect(args[12].requestDelayMs).toBe(250)
    expect(args[12].blockedSources).toBe(blockedSources)
    expect(args[12].onRateLimited).toBe(onRateLimited)
  })

  it('421: pacing wiring defaults to unpaced with no shared block list', async () => {
    const downloadImagesFn = vi.fn(async () => ({ success: true }))
    await downloadMediaForInstalledGame(baseDeps({ downloadImagesFn }))

    const args = downloadImagesFn.mock.calls[0]
    expect(args[12].requestDelayMs).toBe(0)
    expect(args[12].blockedSources).toBeNull()
    expect(args[12].onRateLimited).toBeNull()
  })
})
