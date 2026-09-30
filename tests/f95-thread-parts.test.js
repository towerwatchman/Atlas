// Two bugs found on the Thief of Hearts thread, which lists Part 3 in the open
// and Parts 1 & 2 inside a spoiler:
//
//   1. An "Extras" bold inside the Part 2 block latched `divider = 'extras'`
//      for the rest of the post. Only a literal DOWNLOAD bold cleared it, and
//      Part 1's section opens with "Part 1", so all fifteen of its links --
//      MEGA and Pixeldrain included -- were filed as extras. getUpdateLinks
//      only forwards `downloads` to the modal, so Part 1 vanished from the UI.
//
//   2. "Part 3" classified as an archive FRAGMENT, and a fragment marker is
//      cleared by the platform line that follows it. The build name was gone
//      before any link was reached, so Part 3 came out unlabeled and Part 2's
//      rows inherited "Part 1 & 2" from the spoiler header above them.
//
// The line alone cannot distinguish the two readings -- "Part 1" is written the
// same way in both -- so the parser decides by what follows it. A PLATFORM with
// no link in between means it was naming a build; a LINK first means it was a
// fragment marker.

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)
const { parseThreadDownloads } = require_('../electron/downloads/f95ThreadParser.js')

const wrap = (body) =>
  `<html data-logged-in="true" data-content-key="thread-214581"><div class="bbWrapper">${body}</div></html>`

const mirrors = (prefix) =>
  `<a href="https://mega.nz/${prefix}">MEGA</a> - <a href="https://pixeldrain.com/${prefix}">PIXELDRAIN</a>`

describe('story parts vs archive fragments', () => {
  it('reads "Part N" followed by a platform as a build name', () => {
    const out = parseThreadDownloads(wrap(`
      <b>DOWNLOAD</b><br>
      <b>Part 3<br>Win/Linux</b>: ${mirrors('p3win')}<br>
      <b>Mac</b>: ${mirrors('p3mac')}<br>
    `))
    const groups = [...new Set(out.downloads.map((d) => d.group))]
    expect(groups).toEqual(['Part 3'])
    // The part axis is for fragments; a build name must not land there.
    expect(out.downloads.every((d) => d.part === null)).toBe(true)
    expect(out.downloads.map((d) => d.platform)).toEqual(
      ['Win/Linux', 'Win/Linux', 'Mac', 'Mac'],
    )
  })

  it('still reads "Part N" after a platform as a fragment', () => {
    // Being a DIK: SPLIT-S3-Int+Ep12 / Win/Linux / Part 1 -> link -> Part 2.
    // A link sits between the marker and anything else, which is what makes it
    // a fragment rather than a build.
    const out = parseThreadDownloads(wrap(`
      <b>DOWNLOAD</b><br>
      <b>SPLIT-S3-Int+Ep12<br>Win/Linux</b><br>
      <b>Part 1</b>: <a href="https://mega.nz/a1">MEGA</a><br>
      <b>Part 2</b>: <a href="https://mega.nz/a2">MEGA</a><br>
      <b>Mac</b><br>
      <b>Part 1</b>: <a href="https://mega.nz/b1">MEGA</a><br>
    `))
    expect(out.downloads.map((d) => d.group)).toEqual(
      ['SPLIT-S3-Int+Ep12', 'SPLIT-S3-Int+Ep12', 'SPLIT-S3-Int+Ep12'],
    )
    expect(out.downloads.map((d) => d.part?.index)).toEqual([1, 2, 1])
    expect(out.downloads.map((d) => d.platform)).toEqual(
      ['Win/Linux', 'Win/Linux', 'Mac'],
    )
  })
})

describe('the extras divider does not latch across builds', () => {
  it('returns to downloads when a new part begins after an Extras section', () => {
    const out = parseThreadDownloads(wrap(`
      <b>DOWNLOAD</b><br>
      <b>Part 2<br>Win/Linux</b>: ${mirrors('p2win')}<br>
      <b>Extras</b><br>
      <a href="https://mega.nz/walkthrough">Walkthrough</a><br>
      <b>Part 1<br>Win/Linux</b>: ${mirrors('p1win')}<br>
    `))

    const groups = out.downloads.map((d) => d.group)
    expect(groups).toContain('Part 2')
    // The regression: Part 1 used to land in extras and never reach the modal.
    expect(groups).toContain('Part 1')

    const partOne = out.downloads.filter((d) => d.group === 'Part 1')
    expect(partOne.map((d) => d.host).sort()).toEqual(['mega.nz', 'pixeldrain.com'])

    // The genuine extra stays an extra.
    expect(out.extras.map((e) => e.label)).toEqual(['Walkthrough'])
  })

  it('leaves an ordinary build heading inside an Extras section alone', () => {
    // A mod's name is not the end of the section. Only a promoted part line
    // resets the divider, so this stays in extras where the poster put it.
    const out = parseThreadDownloads(wrap(`
      <b>DOWNLOAD</b><br>
      <b>Win/Linux</b>: <a href="https://mega.nz/game">MEGA</a><br>
      <b>Extras</b><br>
      <b>Multi Mod</b>: <a href="https://mega.nz/mod">MEGA</a><br>
      <b>Gallery Unlocker</b>: <a href="https://mega.nz/gallery">MEGA</a><br>
    `))
    expect(out.downloads).toHaveLength(1)
    expect(out.extras.map((e) => e.label)).toEqual(['MEGA', 'MEGA'])
  })
})

// The parser is not the only place that reads "Part N" out of a heading.
// classifyGroup ran its own PART regex over the group text, so even after the
// parser correctly labelled the three builds "Part 1/2/3", the classifier read
// those names back as fragments of one split archive and assembled them into a
// single set requiring all three. No part was offerable alone, so the current
// build could not be downloaded at all -- the modal reported no MEGA or
// Pixeldrain downloads despite both being listed for every part.
describe('classifyGroup respects the parser reading of a part heading', () => {
  const { classifyGroup, selectDownloadableLinks } =
    require_('../electron/downloads/groupClassifier.js')

  it('believes an explicit null part even when the build is NAMED "Part 3"', () => {
    const verdict = classifyGroup('Part 3', { host: 'mega.nz', group: 'Part 3', part: null })
    expect(verdict.part).toBeNull()
    expect(verdict.requiresAllParts).toBeFalsy()
  })

  it('still groups a genuine fragment the parser reported', () => {
    const verdict = classifyGroup('SPLIT-S3', {
      host: 'mega.nz', group: 'SPLIT-S3', part: { index: 1, total: null, whole: false },
    })
    expect(verdict.part).toEqual({ index: 1, total: null })
    expect(verdict.requiresAllParts).toBe(true)
  })

  it('keeps the regex fallback for a caller with no part field at all', () => {
    // A flat heading out of the db never went through the parser, so the regex
    // is still the only reading available.
    expect(classifyGroup('Win Part 1', { host: 'mega.nz', group: 'Win Part 1' }).part)
      .toEqual({ index: 1, total: null })
  })

  it('offers each named part as its own download', () => {
    const links = ['Part 1', 'Part 2', 'Part 3'].flatMap((group) => ([
      { group, platform: 'Win/Linux', part: null, host: 'mega.nz', url: `https://mega.nz/${group}`, type: 'game' },
      { group, platform: 'Win/Linux', part: null, host: 'pixeldrain.com', url: `https://pixeldrain.com/${group}`, type: 'game' },
    ]))
    const sel = selectDownloadableLinks(links, {
      supportedHosts: new Set(['mega', 'pixeldrain']),
      platform: 'win',
    })
    // Six independent options, not two all-parts-required sets.
    expect(sel.singles).toHaveLength(6)
    expect(sel.multiPart).toHaveLength(0)
  })
})
