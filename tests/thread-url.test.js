import { describe, it, expect } from 'vitest'
import { buildThreadUrl } from '../src/components/downloads/threadUrl.js'

// The bug: the inline version interpolated an id that might not exist, so with
// nothing linked it produced `https://f95zone.to/threads//` behind a button that
// looked fine, and it hardcoded the F95 domain, so a LewdCorner title went to the
// wrong site.

describe('buildThreadUrl', () => {
  it('returns nothing when the record has no link at all', () => {
    // The whole point: no URL means no button, rather than a dead one.
    expect(buildThreadUrl({})).toBe('')
    expect(buildThreadUrl()).toBe('')
    expect(buildThreadUrl({ f95Id: null, lcId: null, siteUrl: '' })).toBe('')
  })

  it('never emits a URL with an empty id segment', () => {
    // The exact old failure, asserted directly.
    for (const value of ['', null, undefined, '  ', 'not-a-number', 0, NaN]) {
      const url = buildThreadUrl({ f95Id: value, lcId: value })
      expect(url).not.toContain('threads//')
      expect(url).toBe('')
    }
  })

  it('prefers the stored site URL over anything it would assemble', () => {
    expect(buildThreadUrl({
      siteUrl: 'https://f95zone.to/threads/some-slug.63437/',
      f95Id: '99999',
    })).toBe('https://f95zone.to/threads/some-slug.63437/')
  })

  it('sends a LewdCorner title to LewdCorner, not to F95', () => {
    expect(buildThreadUrl({ lcId: '4242' })).toBe('https://lewdcorner.com/threads/4242/')
    expect(buildThreadUrl({ lewdCornerSiteUrl: 'https://lewdcorner.com/threads/x.4242/' }))
      .toBe('https://lewdcorner.com/threads/x.4242/')
  })

  it('builds an F95 URL from a real numeric id', () => {
    expect(buildThreadUrl({ f95Id: 63437 })).toBe('https://f95zone.to/threads/63437/')
    expect(buildThreadUrl({ f95Id: ' 63437 ' })).toBe('https://f95zone.to/threads/63437/')
  })

  it('prefers F95 over LewdCorner when a game carries both ids', () => {
    // Arbitrary but has to be stable: the update flow is F95-driven, so the F95
    // thread is the one whose links the modal was trying to list.
    expect(buildThreadUrl({ f95Id: '111', lcId: '222' }))
      .toBe('https://f95zone.to/threads/111/')
  })

  it('ignores a stored value that is not an http URL', () => {
    // A relative or junk value must not be handed to openExternal.
    expect(buildThreadUrl({ siteUrl: '/threads/123', f95Id: '456' }))
      .toBe('https://f95zone.to/threads/456/')
    expect(buildThreadUrl({ siteUrl: 'javascript:alert(1)', f95Id: '456' }))
      .toBe('https://f95zone.to/threads/456/')
    expect(buildThreadUrl({ siteUrl: 'javascript:alert(1)' })).toBe('')
  })
})
