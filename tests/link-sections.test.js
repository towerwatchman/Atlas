import { describe, it, expect } from 'vitest'
import { groupLinksBySection, hasMultipleSections, LATEST_SECTION } from '../src/components/downloads/linkSections.js'

// Flat presentation let "Season 1" and "Old Version" look like mirrors of the
// current build, so someone updating a game could install an older one over a
// newer one. These assert the grouping and, importantly, the ordering.

const link = (host, group = '') => ({ url: `https://${host}/f/${group || 'latest'}`, host, group, label: 'Download' })

describe('groupLinksBySection', () => {
  it('puts ungrouped links under a heading that says they are current', () => {
    const sections = groupLinksBySection([link('pixeldrain.com'), link('bzzhr.to')])
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe(LATEST_SECTION)
    expect(sections[0].isLatest).toBe(true)
    expect(sections[0].links).toHaveLength(2)
  })

  it('keeps each other heading verbatim as its own section', () => {
    const sections = groupLinksBySection([
      link('pixeldrain.com'),
      link('bzzhr.to', 'Season 1'),
      link('pixeldrain.com', 'Old Version'),
      link('bzzhr.to', 'Season 1'),
    ])
    expect(sections.map((s) => s.title)).toEqual([LATEST_SECTION, 'Season 1', 'Old Version'])
    expect(sections[1].links).toHaveLength(2)
    expect(sections[1].isLatest).toBe(false)
  })

  it('leads with the current build even when the post lists it last', () => {
    // A thread that puts "Season 1" above its current download must not bury the
    // thing the user came for.
    const sections = groupLinksBySection([
      link('pixeldrain.com', 'Season 1'),
      link('bzzhr.to', 'Old Version'),
      link('pixeldrain.com'),
    ])
    expect(sections[0].title).toBe(LATEST_SECTION)
    // Everything else keeps the post's order, which is meaningful.
    expect(sections.slice(1).map((s) => s.title)).toEqual(['Season 1', 'Old Version'])
  })

  it('preserves the order links arrived in within a section', () => {
    const sections = groupLinksBySection([
      link('pixeldrain.com', 'Season 2'),
      link('bzzhr.to', 'Season 2'),
      link('datanodes.to', 'Season 2'),
    ])
    expect(sections[0].links.map((l) => l.host)).toEqual([
      'pixeldrain.com', 'bzzhr.to', 'datanodes.to',
    ])
  })

  it('treats whitespace-only and missing headings as current', () => {
    const sections = groupLinksBySection([
      { url: 'a', host: 'h', group: '   ' },
      { url: 'b', host: 'h' },
      { url: 'c', host: 'h', group: null },
    ])
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe(LATEST_SECTION)
    expect(sections[0].links).toHaveLength(3)
  })

  it('survives empty and malformed input', () => {
    expect(groupLinksBySection([])).toEqual([])
    expect(groupLinksBySection()).toEqual([])
    expect(groupLinksBySection(null)).toEqual([])
    expect(groupLinksBySection([null, undefined])).toEqual([])
  })

  it('does not merge headings that differ only in case or spacing', () => {
    // Deliberate: these are the poster's words and Atlas cannot tell whether
    // "season 1" and "Season 1" are the same section in a given post. Showing
    // both is honest; merging them would be a guess.
    const sections = groupLinksBySection([link('h', 'Season 1'), link('h', 'season 1')])
    expect(sections.map((s) => s.title)).toEqual(['Season 1', 'season 1'])
  })
})

describe('hasMultipleSections', () => {
  it('is false when the headings would add nothing', () => {
    expect(hasMultipleSections([link('a'), link('b')])).toBe(false)
    expect(hasMultipleSections([])).toBe(false)
  })

  it('is true as soon as there is a choice to make', () => {
    expect(hasMultipleSections([link('a'), link('b', 'Old Version')])).toBe(true)
  })
})
