import { describe, it, expect } from 'vitest'

import {
  splitHeadingLines,
  classifyHeadingLine,
  applyHeadingLines,
  emptyHeading,
  headingLabel,
  stripTags,
} from '../electron/downloads/headingLines.js'

// The bug this module exists to prevent: stripTags DELETES <br> and collapses
// whitespace, so anything that stripped a bold heading before splitting it had
// already lost the line structure it needed. Every case below is taken from the
// markup actually observed on real threads, recorded in the session handoff.

describe('splitHeadingLines', () => {
  it('splits on <br> before the tags are stripped', () => {
    expect(splitHeadingLines('Season 1<br>1080p<br>Win/Linux')).toEqual([
      'Season 1', '1080p', 'Win/Linux',
    ])
  })

  it('accepts every <br> spelling posters use', () => {
    expect(splitHeadingLines('a<br>b<br/>c<br />d<BR>e')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('treats <p> as a line break too, since posters use it the same way', () => {
    expect(splitHeadingLines('<p>Season 2</p><p>Win</p>')).toEqual(['Season 2', 'Win'])
  })

  it('strips inline markup within a line without splitting on it', () => {
    expect(splitHeadingLines('<i>Season</i> <u>2</u> Final<br><span>Win</span>')).toEqual([
      'Season 2 Final', 'Win',
    ])
  })

  it('drops empty lines rather than emitting blanks', () => {
    // A trailing <br> before </b> is extremely common and must not produce a
    // build line that clears the label.
    expect(splitHeadingLines('Season 1<br><br>Win<br>')).toEqual(['Season 1', 'Win'])
  })

  it('drops the trailing colon posters put on headings', () => {
    expect(splitHeadingLines('DOWNLOAD:<br>Win/Linux')).toEqual(['DOWNLOAD', 'Win/Linux'])
  })

  it('survives empty and malformed input', () => {
    expect(splitHeadingLines('')).toEqual([])
    expect(splitHeadingLines(null)).toEqual([])
    expect(splitHeadingLines(undefined)).toEqual([])
    expect(splitHeadingLines('<br><br>')).toEqual([])
  })
})

describe('classifyHeadingLine', () => {
  it('reads a line of only platform tokens as a platform', () => {
    for (const line of ['Win', 'Win/Linux', 'Win/Linux/Mac', 'Win x64', 'Win, Linux',
      'Android', 'Mac', 'PC', 'All', 'Win/Lin']) {
      expect(classifyHeadingLine(line)).toBe('platform')
    }
  })

  it('reads exactly 4K / 1080p / 720p as quality', () => {
    expect(classifyHeadingLine('4K')).toBe('quality')
    expect(classifyHeadingLine('4k')).toBe('quality')
    expect(classifyHeadingLine('1080p')).toBe('quality')
    expect(classifyHeadingLine('720p')).toBe('quality')
  })

  it('does not read a quality token as quality when it is part of a longer line', () => {
    // "exact tokens only". "1080p Win" is a build heading that mentions a
    // resolution; appending it to the previous label would lose the platform and
    // keep a build label that was never written.
    expect(classifyHeadingLine('1080p Win')).toBe('build')
    expect(classifyHeadingLine('Season 1 4K')).toBe('build')
  })

  it('reads everything else as a build label', () => {
    for (const line of ['Season 2 Final', "Chloe's: Desire Express DLC",
      'Julia in Japan DLC', 'Update Only', 'Split', 'v0.9.5', 'Season 3 - 64%']) {
      expect(classifyHeadingLine(line)).toBe('build')
    }
  })

  it('does not read a line that tokenizes to nothing as a platform', () => {
    // The bare value "-" appears in the data. Treating it as "platform: none"
    // would wipe the platform of the build above it for no reason.
    expect(classifyHeadingLine('-')).toBe('build')
    expect(classifyHeadingLine('()')).toBe('build')
    expect(classifyHeadingLine('')).toBe('build')
  })
})

describe('applyHeadingLines', () => {
  const fold = (...bolds) => {
    let state = emptyHeading()
    for (const bold of bolds) state = applyHeadingLines(state, splitHeadingLines(bold))
    return state
  }

  it('leaves the build label alone when a bold is platform-only', () => {
    // This is the whole point. "<b>Win/Linux/Mac</b>" used to REPLACE the group,
    // so two DLCs under separate headings collapsed into one entry named after a
    // platform.
    const state = fold("Chloe's: Desire Express DLC", 'Win/Linux/Mac')
    expect(headingLabel(state)).toBe("Chloe's: Desire Express DLC")
    expect(state.platform).toBe('Win/Linux/Mac')
  })

  it('appends a quality line to the build it follows', () => {
    // FreshWomen: "<b>Season 2 Final</b>" then "<b>4K<br>Win/Linux/Mac</b>".
    const state = fold('Season 2 Final', '4K<br>Win/Linux/Mac')
    expect(headingLabel(state)).toBe('Season 2 Final 4K')
    expect(state.platform).toBe('Win/Linux/Mac')
  })

  it('REPLACES a previous quality rather than accumulating them', () => {
    // "Season 1 / 1080p / Win-Linux" followed by a bare "720p / Win-Linux" means
    // "Season 1 720p". Appending would give "Season 1 1080p 720p", which names a
    // build that does not exist.
    const state = fold('Season 1<br>1080p<br>Win/Linux', '720p<br>Win/Linux')
    expect(headingLabel(state)).toBe('Season 1 720p')
  })

  it('clears the quality when a new build arrives', () => {
    // Season 2 after "Season 1 / 1080p" is Season 2, not Season 2 at 1080p.
    expect(headingLabel(fold('Season 1<br>1080p', 'Season 2'))).toBe('Season 2')
  })

  it('clears the platform when a new build arrives', () => {
    // Deliberately the safe direction: an empty platform reads as "unlabeled" to
    // groupClassifier and is ACCEPTED, so at worst the user sees a build they
    // cannot use. An inherited platform can filter an option out of the list
    // entirely, which they cannot see and so cannot report.
    const state = fold('Season 1<br>Win/Linux', 'Season 2')
    expect(state.platform).toBe('')
  })

  it('does not mutate the state it was given', () => {
    const start = emptyHeading()
    applyHeadingLines(start, ['Season 1', 'Win'])
    expect(start).toEqual({ base: '', quality: '', platform: '' })
  })

  it('tolerates a missing or malformed state and line list', () => {
    expect(applyHeadingLines(null, null)).toEqual({ base: '', quality: '', platform: '' })
    expect(applyHeadingLines(undefined, ['Win'])).toEqual({
      base: '', quality: '', platform: 'Win',
    })
  })

  it('handles all three lines arriving in one bold, in order', () => {
    const state = applyHeadingLines(emptyHeading(), ['Season 1', '1080p', 'Win/Linux'])
    expect(state).toEqual({ base: 'Season 1', quality: '1080p', platform: 'Win/Linux' })
    expect(headingLabel(state)).toBe('Season 1 1080p')
  })
})

describe('headingLabel', () => {
  it('is empty when the post gave no build heading', () => {
    // NOT synthesised here. The display layer names the unlabeled case so that
    // the string exists in exactly one place.
    expect(headingLabel(emptyHeading())).toBe('')
    expect(headingLabel({ base: '', quality: '', platform: 'Win' })).toBe('')
    expect(headingLabel(null)).toBe('')
  })
})

describe('stripTags', () => {
  it('collapses the entities that appear in headings', () => {
    expect(stripTags('Season&nbsp;1 &amp; DLCs')).toBe('Season 1 & DLCs')
  })

  it('destroys <br>, which is why splitting has to happen first', () => {
    // Pinned deliberately: this is the behaviour that caused the bug, and a
    // future "fix" that makes stripTags preserve breaks would silently change
    // how every heading in the parser reads.
    expect(stripTags('a<br>b')).toBe('ab')
  })
})
