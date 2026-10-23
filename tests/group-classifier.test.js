import { describe, it, expect } from 'vitest'
const { classifyGroup, selectDownloadableLinks } = require('../electron/downloads/groupClassifier.js')

// A Linux machine can run Windows builds too — electron/ipc/games.js routes an
// .exe launcher through Wine via resolveLinuxLaunch. So the classifier must
// offer BOTH the poster's "Linux"/"Win" builds to a Linux user, instead of
// hiding the Windows one behind the old reverse-filter.
//
// Kept deliberately small and isolated to this behaviour; the whole classifier
// vocabulary is still exercised by the procedural suite in scripts/.

describe('groupClassifier: a Linux machine offers win and linux builds', () => {
  it('accepts both a Win build and a Linux build on Linux', () => {
    expect(classifyGroup('Win', null, { platform: 'linux' }).accepted).toBe(true)
    expect(classifyGroup('Linux', null, { platform: 'linux' }).accepted).toBe(true)
  })

  it('accepts a combined Win/Linux heading on Linux', () => {
    expect(classifyGroup('Win/Linux', null, { platform: 'linux' }).accepted).toBe(true)
  })

  it('still rejects a Mac build on Linux', () => {
    expect(classifyGroup('Mac', null, { platform: 'linux' }).accepted).toBe(false)
  })

  it('offers both the Win and Linux links through selectDownloadableLinks', () => {
    const result = selectDownloadableLinks(
      [
        { host: 'mega.nz', group: 'Win', type: 'game' },
        { host: 'mega.nz', group: 'Linux', type: 'game' },
        { host: 'mega.nz', group: 'Mac', type: 'game' },
      ],
      { platform: 'linux' },
    )
    // Both usable builds survive; only the Mac one is rejected.
    const offered = result.singles.map((e) => e.link.group)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].link.group).toBe('Mac')
  })
})

describe('groupClassifier: sections and labels', () => {
  it('flags a compressed section even when the part name says nothing about it', () => {
    // "Part 6" alone reads as a plain build; the repack is named in the section
    // above the rows. Without reading it the compressed chip disappears.
    const verdict = classifyGroup('Part 6', {
      host: 'mega.nz',
      group: 'Part 6',
      section: 'COMPRESSED (V95)',
      platform: 'Win/Linux',
      part: null,
    })
    expect(verdict.compressed).toBe(true)
    expect(verdict.accepted).toBe(true)
  })

  it('rejects a mirror the poster labelled HOTFIX, even under a part', () => {
    // Atlas queues and installs a file; it does not apply patches. Offering the
    // hotfix as a build would extract it as if it were the game.
    const verdict = classifyGroup('Part 5', {
      host: 'pixeldrain.com',
      group: 'Part 5',
      section: 'Others',
      platform: '',
      part: null,
      label: 'HOTFIX (for v0.81)',
    })
    expect(verdict.kind).toBe('hotfix')
    expect(verdict.accepted).toBe(false)
  })

  it('keeps two split sets apart when only their section differs', () => {
    const part = (section, index) => ({
      host: 'mega.nz',
      group: 'Part 6',
      section,
      platform: 'Win/Linux',
      part: { index, total: 2, whole: false },
      label: 'MEGA',
      url: `https://mega.nz/${section || 'base'}-${index}`,
    })
    const result = selectDownloadableLinks([
      part('', 1), part('', 2),
      part('COMPRESSED (V95)', 1), part('COMPRESSED (V95)', 2),
    ])
    expect(result.offerableSets).toHaveLength(2)
    expect(result.offerableSets.map((set) => set.section).sort())
      .toEqual(['', 'COMPRESSED (V95)'])
  })

  it('trusts a spoiler title as a build name, not an update', () => {
    // "Before the Tech Update (v0.20.16)" contains the word update. Without the
    // marker the kind check reads it as an update payload and drops the build.
    const link = {
      host: 'mega.nz',
      group: 'Before the Tech Update v0.20.16',
      label: 'MEGA',
      type: 'game',
      headingIsBuild: true,
    }
    const verdict = classifyGroup(link.group, link)
    expect(verdict.kind).toBe('game')
    expect(verdict.accepted).toBe(true)
    // The same heading without the marker stays an update, so the marker is
    // what carries the claim, not the text.
    expect(classifyGroup(link.group, { ...link, headingIsBuild: false }).accepted)
      .toBe(false)
  })
})

describe('groupClassifier: hidden platform notice', () => {
  it('leaves unsupported hosts out of the platform rejection count', () => {
    // Thread 94: the Win/Linux row has hosts Atlas has no plugin for. Those
    // rejections keep the accepted verdict, so counting them as "this machine
    // can't run" put win and linux in the notice beside mac and android.
    const result = selectDownloadableLinks(
      [
        { host: 'mega.nz', group: 'Win/Linux', platform: 'Win/Linux', type: 'game' },
        { host: 'datanodes.to', group: 'Win/Linux', platform: 'Win/Linux', type: 'game' },
        { host: 'mega.nz', group: 'Mac', platform: 'Mac', type: 'game' },
      ],
      { platform: 'win32', supportedHosts: new Set(['mega']) },
    )
    expect(result.unsupportedHost).toHaveLength(1)
    expect(result.hiddenPlatform.links).toBe(1)
    expect(result.hiddenPlatform.platforms).toEqual(['mac'])
  })
})