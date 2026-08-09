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

    it('does NOT match F95Zone thread 3207 for a game whose F95 ID is 5691 and LewdCorner ID is 3207', () => {
      const dualSiteGame = [
        {
          id: 5691,
          title: 'Example Game X',
          f95Id: '5691',
          lcId: '3207',
          installed: true,
          installedVersion: 'v0.26EX',
        },
      ]

      // Visiting https://f95zone.to/threads/3207/ must NOT match Example Game X (whose F95 ID is 5691)
      const f95Thread3207 = { site: 'f95', id: 3207 }
      expect(findGameForThread(f95Thread3207, dualSiteGame)).toBeNull()

      // Visiting https://lewdcorner.com/threads/3207/ MUST match Example Game X
      const lcThread3207 = { site: 'lewdcorner', id: 3207 }
      expect(findGameForThread(lcThread3207, dualSiteGame)).not.toBeNull()
      expect(findGameForThread(lcThread3207, dualSiteGame).title).toBe('Example Game X')

      // Visiting https://f95zone.to/threads/5691/ MUST match Example Game X
      const f95Thread5691 = { site: 'f95', id: 5691 }
      expect(findGameForThread(f95Thread5691, dualSiteGame)).not.toBeNull()
      expect(findGameForThread(f95Thread5691, dualSiteGame).title).toBe('Example Game X')
    })
  })
})
