import { describe, it, expect } from 'vitest'
import { extractThreadInfo, findGameForThread } from '../extension/content.js'

describe('Browser Extension Thread & Site Matching', () => {
  describe('extractThreadInfo', () => {
    // Verified against F95Zone and LewdCorner URL patterns to isolate thread IDs by host
    it('extracts F95Zone thread site and numeric ID', () => {
      const info = extractThreadInfo('https://f95zone.to/threads/playing-on-linux.19523/')
      expect(info).not.toBeNull()
      expect(info.site).toBe('f95')
      expect(info.id).toBe(19523)
    })

    it('extracts LewdCorner thread site and numeric ID', () => {
      const info = extractThreadInfo('https://lewdcorner.com/threads/law-school-season-1.19523/')
      expect(info).not.toBeNull()
      expect(info.site).toBe('lewdcorner')
      expect(info.id).toBe(19523)
    })

    it('infers site from window location for relative thread URLs', () => {
      // Mock window location to simulate content script context on F95Zone
      const origWindow = global.window
      global.window = { location: { hostname: 'f95zone.to' } }

      try {
        const info = extractThreadInfo('/threads/some-game.12345/')
        expect(info).not.toBeNull()
        expect(info.site).toBe('f95')
        expect(info.id).toBe(12345)
      } finally {
        global.window = origWindow
      }
    })
  })

  describe('findGameForThread', () => {
    const gamesList = [
      {
        id: 1,
        title: 'Law School - Season 1',
        f95Id: '184252',
        lcId: '19523',
        installed: true,
      },
      {
        id: 2,
        title: 'F95 Only Game',
        f95Id: '19523',
        lcId: null,
        installed: false,
      },
    ]

    // Ensures F95Zone thread IDs do not falsely match LewdCorner IDs when threads happen to share numeric IDs
    it('does NOT match a game on F95Zone when only its lcId matches', () => {
      const f95Thread19523 = { site: 'f95', id: 19523 }
      const matched = findGameForThread(f95Thread19523, gamesList)

      // Thread 19523 on F95Zone belongs to "F95 Only Game", NOT "Law School - Season 1" (which has lcId 19523)
      expect(matched).not.toBeNull()
      expect(matched.title).toBe('F95 Only Game')
      expect(matched.title).not.toBe('Law School - Season 1')
    })

    it('does NOT match a LewdCorner-only game ID on an F95Zone thread with no F95 match', () => {
      const gamesListLcOnly = [
        {
          id: 1,
          title: 'Law School - Season 1',
          f95Id: '184252',
          lcId: '19523',
        },
      ]

      const f95Thread19523 = { site: 'f95', id: 19523 }
      const matched = findGameForThread(f95Thread19523, gamesListLcOnly)

      // On F95Zone, thread 19523 must NOT match Law School because Law School's F95 thread ID is 184252
      expect(matched).toBeNull()
    })

    it('correctly matches a dual-site game on its corresponding thread ID for each site', () => {
      const f95Thread = { site: 'f95', id: 184252 }
      const lcThread = { site: 'lewdcorner', id: 19523 }

      const f95Match = findGameForThread(f95Thread, gamesList)
      const lcMatch = findGameForThread(lcThread, gamesList)

      expect(f95Match).not.toBeNull()
      expect(f95Match.title).toBe('Law School - Season 1')

      expect(lcMatch).not.toBeNull()
      expect(lcMatch.title).toBe('Law School - Season 1')
    })
  })
})
