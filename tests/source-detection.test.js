const { sourceFromRemoteUrl, orderPreviewsBySource } = require('../electron/db/mediaSources.js')

describe('sourceFromRemoteUrl', () => {
  it('returns null for local paths and empty input', () => {
    expect(sourceFromRemoteUrl('data/images/1/p.webp')).toBeNull()
    expect(sourceFromRemoteUrl('')).toBeNull()
    expect(sourceFromRemoteUrl(null)).toBeNull()
  })

  it('maps f95zone URLs to f95', () => {
    expect(sourceFromRemoteUrl('https://f95zone.to/thread/1')).toBe('f95')
  })

  it('maps any lewdcorner host (not just .com) to lewdcorner', () => {
    expect(sourceFromRemoteUrl('https://lewdcorner.com/x')).toBe('lewdcorner')
    expect(sourceFromRemoteUrl('https://lewdcorner.to/x')).toBe('lewdcorner')
  })

  it('maps steam CDN URLs to steam', () => {
    expect(sourceFromRemoteUrl('https://shared.fastly.steamstatic.com/x.jpg')).toBe('steam')
    expect(sourceFromRemoteUrl('https://steamcdn.com/x')).toBe('steam')
    expect(sourceFromRemoteUrl('https://a.akamaihd.net/x')).toBe('steam')
    expect(sourceFromRemoteUrl('https://example.com/steam/x')).toBe('steam')
  })

  it('maps gog and youtube URLs to gog', () => {
    expect(sourceFromRemoteUrl('https://gog-statics.com/x')).toBe('gog')
    expect(sourceFromRemoteUrl('https://www.gog.com/game/x')).toBe('gog')
    expect(sourceFromRemoteUrl('https://www.youtube.com/watch?v=1')).toBe('gog')
    expect(sourceFromRemoteUrl('https://youtu.be/1')).toBe('gog')
    expect(sourceFromRemoteUrl('https://i.ytimg.com/x.jpg')).toBe('gog')
  })

  it('falls back to atlas for unknown http hosts', () => {
    expect(sourceFromRemoteUrl('https://example.com/x.jpg')).toBe('atlas')
  })
})

describe('orderPreviewsBySource uses the same matcher as the badge', () => {
  it('buckets a lewdcorner.to preview under lewdcorner, not atlas', () => {
    // lewdcorner.to is not a .com host; before the matcher was consolidated the
    // ordering path fell through to 'atlas' (ranked last), so a gog item would
    // sort AHEAD of it. The badge path already resolved it to 'lewdcorner'.
    const ordered = orderPreviewsBySource(
      ['https://gog.com/x', 'https://lewdcorner.to/y'],
      ['f95', 'lewdcorner', 'steam', 'gog'],
    )
    expect(ordered[0]).toBe('https://lewdcorner.to/y')
    expect(ordered[1]).toBe('https://gog.com/x')
  })
})
