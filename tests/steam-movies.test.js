// Contract for Steam trailer parsing. Steam replaced the old mp4/webm movie
// objects with DASH manifests (dash_h264/dash_av1 .mpd). getSteamGameData must
// extract a playable URL from whichever format is present. This mocks the three
// upstream fetches (appdetails, steamspy, GetItems) by URL and asserts the movie
// output — so a future format change surfaces here instead of in production.

import { describe, it, expect, vi, afterEach } from 'vitest'

const { getSteamGameData } = require('../electron/scanners/steamscanner')

function routeFetch({ movies = [], screenshots = [] } = {}) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('/api/appdetails')) {
      return {
        status: 200,
        json: async () => ({
          '999': {
            success: true,
            data: {
              name: 'Test Game',
              steam_appid: 999,
              short_description: 'x',
              supported_languages: 'English',
              platforms: { windows: true, mac: false, linux: false },
              developers: ['Dev'],
              publishers: ['Pub'],
              release_date: { date: 'Jan 1, 2024' },
              header_image: 'https://x/header.jpg',
              screenshots,
              movies,
            },
          },
        }),
      }
    }
    if (u.includes('steamspy.com')) {
      return { status: 200, json: async () => ({ tags: {} }) }
    }
    if (u.includes('IStoreBrowseService')) {
      return { status: 200, json: async () => ({ response: { store_items: [{ assets: { asset_url_format: 'steam/apps/999/${FILENAME}', library_capsule: 'h/cap.jpg' } }] } }) }
    }
    return { status: 200, json: async () => ({}) }
  })
}

afterEach(() => vi.restoreAllMocks())

describe('getSteamGameData — trailer extraction', () => {
  it('extracts a URL from DASH manifests (current format)', async () => {
    routeFetch({
      movies: [{
        id: 257269491,
        name: 'Trailer',
        thumbnail: 'https://x/movie_600x337.jpg',
        dash_av1: 'https://video.akamai.steamstatic.com/store_trailers/999/a/dash_av1.mpd?t=1',
        dash_h264: 'https://video.akamai.steamstatic.com/store_trailers/999/a/dash_h264.mpd?t=1',
        hls_h264: 'https://x/hls_264_master.m3u8?t=1',
      }],
    })
    const res = await getSteamGameData(999)
    expect(res).toBeTruthy()
    expect(res.movies.length).toBe(1)
    // Prefers H.264 DASH for broad decoder support.
    expect(res.movies[0].url).toContain('dash_h264.mpd')
    expect(res.movies[0].thumbnail).toContain('movie_600x337.jpg')
  })

  it('still handles legacy mp4/webm movie objects', async () => {
    routeFetch({
      movies: [{
        id: 1,
        name: 'Legacy',
        thumbnail: 'https://x/t.jpg',
        mp4: { max: 'https://x/movie_max.mp4', 480: 'https://x/movie480.mp4' },
        webm: { max: 'https://x/movie_max.webm' },
      }],
    })
    const res = await getSteamGameData(999)
    expect(res.movies.length).toBe(1)
    expect(res.movies[0].url).toContain('.mp4')
  })

  it('returns no movies when none are present (not a crash)', async () => {
    routeFetch({ movies: [] })
    const res = await getSteamGameData(999)
    expect(res.movies).toEqual([])
  })

  it('parses screenshots into full-size URLs', async () => {
    routeFetch({
      screenshots: [
        { id: 0, path_thumbnail: 'https://x/ss_a.600x338.jpg', path_full: 'https://x/ss_a.1920x1080.jpg' },
      ],
    })
    const res = await getSteamGameData(999)
    expect(res.screenshots).toContain('https://x/ss_a.1920x1080.jpg')
  })
})
