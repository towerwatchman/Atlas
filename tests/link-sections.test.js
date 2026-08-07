import { describe, it, expect } from 'vitest'
import {
  buildDownloadOptions,
  hasMultipleOptions,
  describeBuild,
  FULL_ARCHIVE,
} from '../src/components/downloads/linkSections.js'

// The choice the user is making is WHICH BUILD, then which mirror of it. A flat
// list let "Season 1" and the current build look interchangeable, so an update
// could install an older build over a newer one. These assert the grouping and,
// importantly, the ordering.

const link = (host, group = '', platform = '') => ({
  url: `https://${host}/f/${group || 'latest'}${platform}`,
  host,
  group,
  platform,
  label: 'Download',
})

describe('buildDownloadOptions', () => {
  it('names the unlabeled block rather than leaving it blank', () => {
    const options = buildDownloadOptions([link('pixeldrain.com'), link('bzzhr.to')])
    expect(options).toHaveLength(1)
    expect(options[0].title).toBe(FULL_ARCHIVE)
    expect(options[0].isUnlabeled).toBe(true)
    expect(options[0].links).toHaveLength(2)
  })

  it('keeps each build heading verbatim as its own option', () => {
    const options = buildDownloadOptions([
      link('pixeldrain.com'),
      link('bzzhr.to', 'Season 1 720p'),
      link('pixeldrain.com', 'Season 2 Final 4K'),
      link('bzzhr.to', 'Season 1 720p'),
    ])
    expect(options.map((o) => o.title)).toEqual([
      FULL_ARCHIVE, 'Season 1 720p', 'Season 2 Final 4K',
    ])
    expect(options[1].links).toHaveLength(2)
    expect(options[1].isUnlabeled).toBe(false)
  })

  it('does NOT collapse two builds that share a platform', () => {
    // The FreshWomen bug, at this layer. Both DLCs were posted under
    // "<b>Win/Linux/Mac</b>", and while platform was part of `group` they became
    // one option named after the platform. Now platform is its own field and the
    // two builds stay two builds.
    const options = buildDownloadOptions([
      link('mega.nz', "Chloe's: Desire Express DLC", 'Win/Linux/Mac'),
      link('mega.nz', 'Julia in Japan DLC', 'Win/Linux/Mac'),
    ])
    expect(options.map((o) => o.title)).toEqual([
      "Chloe's: Desire Express DLC", 'Julia in Japan DLC',
    ])
  })

  it('collects the distinct platforms of an option for its badge', () => {
    const options = buildDownloadOptions([
      link('mega.nz', 'Season 2', 'Win/Linux'),
      link('pixeldrain.com', 'Season 2', 'Win/Linux'),
      link('bzzhr.to', 'Season 2', 'Mac'),
    ])
    expect(options).toHaveLength(1)
    expect(options[0].platforms).toEqual(['Win/Linux', 'Mac'])
  })

  it('has no platforms when the poster gave none', () => {
    expect(buildDownloadOptions([link('mega.nz', 'Season 2')])[0].platforms).toEqual([])
  })

  it('leads with the unlabeled block even when the post lists it last', () => {
    const options = buildDownloadOptions([
      link('pixeldrain.com', 'Season 1'),
      link('bzzhr.to', 'Old Version'),
      link('pixeldrain.com'),
    ])
    expect(options[0].title).toBe(FULL_ARCHIVE)
    // Everything else keeps the post's order, which is meaningful.
    expect(options.slice(1).map((o) => o.title)).toEqual(['Season 1', 'Old Version'])
  })

  it('preserves the order mirrors arrived in within an option', () => {
    const options = buildDownloadOptions([
      link('pixeldrain.com', 'Season 2'),
      link('bzzhr.to', 'Season 2'),
      link('datanodes.to', 'Season 2'),
    ])
    expect(options[0].links.map((l) => l.host)).toEqual([
      'pixeldrain.com', 'bzzhr.to', 'datanodes.to',
    ])
  })

  it('never produces an option with no mirrors', () => {
    // "Options with no supported-host mirrors are skipped entirely" is satisfied
    // by construction: options are built FROM the already-filtered link list, so
    // a build whose every mirror was on an unsupported host never appears. Pinned
    // so that starting from headings instead would fail here rather than ship an
    // empty option the user can click.
    for (const option of buildDownloadOptions([link('mega.nz', 'A'), link('mega.nz', 'B')])) {
      expect(option.links.length).toBeGreaterThan(0)
    }
  })

  it('treats whitespace-only and missing headings as unlabeled', () => {
    const options = buildDownloadOptions([
      { url: 'a', host: 'h', group: '   ' },
      { url: 'b', host: 'h' },
      { url: 'c', host: 'h', group: null },
    ])
    expect(options).toHaveLength(1)
    expect(options[0].title).toBe(FULL_ARCHIVE)
    expect(options[0].links).toHaveLength(3)
  })

  it('survives empty and malformed input', () => {
    expect(buildDownloadOptions([])).toEqual([])
    expect(buildDownloadOptions()).toEqual([])
    expect(buildDownloadOptions(null)).toEqual([])
    expect(buildDownloadOptions([null, undefined])).toEqual([])
  })

  it('does not merge headings that differ only in case or spacing', () => {
    // Deliberate: these are the poster's words and Atlas cannot tell whether
    // "season 1" and "Season 1" are the same build in a given post. Showing both
    // is honest; merging them would be a guess.
    const options = buildDownloadOptions([link('h', 'Season 1'), link('h', 'season 1')])
    expect(options.map((o) => o.title)).toEqual(['Season 1', 'season 1'])
  })

  // ── Builds with no host plugin ────────────────────────────────────────────
  //
  // These used to be dropped by selectDownloadableLinks and never arrive here,
  // so the option was never created. With two plugins live that meant Being a
  // DIK's CURRENT build - posted to nine mirrors, none of them mega or
  // pixeldrain - was absent while three older builds remained, and someone
  // opening the modal to update saw only older builds.

  const dead = (host, group = '', platform = '') => ({
    ...link(host, group, platform), unsupported: true,
  })

  it('shows a build whose every mirror lacks a plugin, rather than omitting it', () => {
    const options = buildDownloadOptions([
      dead('vikingfile.com', 'Episode 12'),
      dead('akirabox.com', 'Episode 12'),
    ])
    expect(options).toHaveLength(1)
    expect(options[0].unsupported).toBe(true)
    expect(options[0].hosts).toEqual(['vikingfile.com', 'akirabox.com'])
  })

  it('hides the dead mirrors when the same build has a working one', () => {
    // A dead chip beside a live one is noise: the user has no use for it.
    const options = buildDownloadOptions([
      link('pixeldrain.com', 'Episode 12'),
      dead('vikingfile.com', 'Episode 12'),
    ])
    expect(options).toHaveLength(1)
    expect(options[0].unsupported).toBe(false)
    expect(options[0].links).toHaveLength(1)
    expect(options[0].hosts).toEqual([])
  })

  it('keeps an unsupported build in post order rather than sorting it last', () => {
    // The poster lists the current build FIRST. Rendering it below the older
    // builds that happen to have a working mirror is the same hazard as hiding
    // it: the user picks the one at the top.
    const options = buildDownloadOptions([
      dead('vikingfile.com', 'Episode 12'),
      link('mega.nz', 'Season 1 - 2'),
    ])
    expect(options.map((o) => o.title)).toEqual(['Episode 12', 'Season 1 - 2'])
  })

  it('still floats the unlabeled block above an unsupported build', () => {
    const options = buildDownloadOptions([
      dead('vikingfile.com', 'Episode 12'),
      link('mega.nz'),
    ])
    expect(options.map((o) => o.title)).toEqual([FULL_ARCHIVE, 'Episode 12'])
  })
})

describe('describeBuild', () => {
  it('shows the poster\u2019s heading verbatim', () => {
    expect(describeBuild('Season 1')).toBe('Season 1')
    expect(describeBuild('Compressed')).toBe('Compressed')
    expect(describeBuild('SPLIT-S3-Int+Ep12')).toBe('SPLIT-S3-Int+Ep12')
    expect(describeBuild('  Season 2  ')).toBe('Season 2')
  })

  it('names the unlabeled build, using the same string the modal does', () => {
    // Applied here rather than written into the database, so the display name
    // for that case still exists in exactly one place.
    expect(describeBuild('')).toBe(FULL_ARCHIVE)
    expect(describeBuild('   ')).toBe(FULL_ARCHIVE)
  })

  it('says NOTHING for a row that never recorded a build', () => {
    // A row queued before the column existed, or by a caller that did not know
    // which build it was fetching. Printing "Full Archive" over those would be a
    // guess dressed as a fact - the confusion this column exists to remove.
    expect(describeBuild(null)).toBe(null)
    expect(describeBuild(undefined)).toBe(null)
  })
})

describe('hasMultipleOptions', () => {
  it('is false when the build headings would add nothing', () => {
    expect(hasMultipleOptions([link('a'), link('b')])).toBe(false)
    expect(hasMultipleOptions([])).toBe(false)
  })

  it('is true as soon as there is a build to choose between', () => {
    expect(hasMultipleOptions([link('a'), link('b', 'Old Version')])).toBe(true)
  })
})
