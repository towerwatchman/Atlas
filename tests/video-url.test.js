// Contract for video detection. Steam moved trailers to DASH (.mpd); these
// functions decide whether a preview URL is a video and whether it needs the
// dash.js player. If .mpd stops being recognised, trailers silently vanish from
// the Videos section — this guards against that.

import { describe, it, expect } from 'vitest'
import { isVideoUrl, isDashUrl } from '../src/components/detail/page/gameDetailUtils.js'

describe('isVideoUrl', () => {
  it('recognises direct video files', () => {
    expect(isVideoUrl('https://x/movie.mp4')).toBe(true)
    expect(isVideoUrl('https://x/movie.webm')).toBe(true)
    expect(isVideoUrl('https://x/movie.m4v')).toBe(true)
  })

  it('recognises DASH manifests (.mpd)', () => {
    expect(isVideoUrl('https://video.akamai.steamstatic.com/store_trailers/1/dash_h264.mpd')).toBe(true)
    expect(isVideoUrl('https://x/dash_av1.mpd?t=123')).toBe(true)
  })

  it('handles query strings and fragments', () => {
    expect(isVideoUrl('https://x/movie.mp4?t=999')).toBe(true)
    expect(isVideoUrl('https://x/movie.mpd#frag')).toBe(true)
  })

  it('rejects images', () => {
    expect(isVideoUrl('https://x/ss_abc.1920x1080.jpg?t=1')).toBe(false)
    expect(isVideoUrl('https://x/header.jpg')).toBe(false)
    expect(isVideoUrl('https://x/logo.png')).toBe(false)
  })

  it('is safe on empty/garbage input', () => {
    expect(isVideoUrl('')).toBe(false)
    expect(isVideoUrl(null)).toBe(false)
    expect(isVideoUrl(undefined)).toBe(false)
  })
})

describe('isDashUrl', () => {
  it('is true only for .mpd', () => {
    expect(isDashUrl('https://x/dash_h264.mpd')).toBe(true)
    expect(isDashUrl('https://x/dash_av1.mpd?t=1')).toBe(true)
    expect(isDashUrl('https://x/movie.mp4')).toBe(false)
    expect(isDashUrl('https://x/movie.webm')).toBe(false)
  })

  it('is safe on empty input', () => {
    expect(isDashUrl('')).toBe(false)
    expect(isDashUrl(null)).toBe(false)
  })
})
