// LewdCorner threads are XenForo 2.3, the same forum software F95 runs, so the
// markup walk is shared (electron/downloads/xenforoThreadParser.js) rather than
// reimplemented. What differs is pinned in its SITES table: the origin, the
// forum's own domain, the first-post locator, and the masked form. These tests
// pin the LewdCorner side of that contract.
//
// The fixture is the real first post of thread 3272 (Divine Adventure Rebirth
// v2.1), captured logged in. It is valuable
// precisely because it is noisy: a
// ~40-entry changelog of <b>vX.Y</b> bolds sits above the download area, the
// v1.5 build hides inside a spoiler block, custom fields render their own
// bbWrapper (Developer Links / Patreon) above the post, and one build is
// labelled only by platform. A synthetic fixture would prove the parser reads
// what its author expected; this one proves it reads what posters write.

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { buildDownloadOptions, FULL_ARCHIVE } from '../src/components/downloads/linkSections.js'

const require_ = createRequire(import.meta.url)
const { parseLcThreadDownloads } = require_('../electron/downloads/lcThreadParser.js')
const { selectDownloadableLinks } = require_('../electron/downloads/groupClassifier.js')
const { supportedHostIds } = require_('../electron/downloads/hosts')

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const thread3272 = () => readFileSync(join(fixtureDir, 'lc-thread-3272.html'), 'utf8')

const page = (loggedIn, body, contentKey = 'thread-16582', title = '') =>
  `<html id="XF" data-xf="2.3" data-app="public" data-template="thread_view" ` +
  `data-content-key="${contentKey}" data-logged-in="${loggedIn}">` +
  `<head><title>${title}</title></head>` +
  `<div class="message-userContent">${body}</div></html>`

describe('thread title version', () => {
  const version = (title) => parseLcThreadDownloads(page('true', '', 'thread-94', title)).version

  it('reads the version the poster put in the thread title', () => {
    const out = parseLcThreadDownloads(page(
      'true',
      `<b>Win/Linux</b>: <a href="https://mega.nz/file/abc">MEGA</a>`,
      'thread-94',
      'Summertime Saga [v21.0.0 wip.7712] [Kompas Productions] | LewdCorner',
    ))
    expect(out.title).toBe('Summertime Saga [v21.0.0 wip.7712] [Kompas Productions] | LewdCorner')
    expect(out.version).toBe('v21.0.0 wip.7712')
  })

  it.each([
    // Two brackets Name [Version] [Creator]: the first one, verbatim.
    ['Ariel Academy [v1.0.1 + DLC] [CourregesTry] | F95zone', 'v1.0.1 + DLC'],
    ['A Debt Paid [Ch.1 v0.35] [CandySH] | F95zone', 'Ch.1 v0.35'],
    ['14 Days of Desire [Final] [Softlock Interactive] | F95zone', 'Final'],
    ['The Rest of Our Lives [v0.1.25.1b] [Giandalf The Tall] | LewdCorner', 'v0.1.25.1b'],
    // One bracket is the creator, never a version.
    ['Bazooka Cafe [Trabulance] | LewdCorner', 'Unknown'],
  ])('reads %s as %s', (title, expected) => {
    expect(version(title)).toBe(expected)
  })
})

describe('thread 3272 (real first post)', () => {
  it('reads the session and thread id off <html>', () => {
    const out = parseLcThreadDownloads(thread3272())
    expect(out.found).toBe(true)
    expect(out.loggedIn).toBe(true)
    expect(out.threadId).toBe('3272')
  })

  it('decodes every masked link to its plain destination', () => {
    const out = parseLcThreadDownloads(thread3272())
    expect(out.downloads).toHaveLength(21)
    expect(out.patches).toHaveLength(0)
    expect(out.extras).toHaveLength(0)
    expect(out.translations).toHaveLength(0)
    // Decoded offline from t=, so nothing needs the browser resolver.
    expect(out.downloads.every((d) => d.masked === false)).toBe(true)
    expect(out.downloads.every((d) => d.type === 'game')).toBe(true)
    expect(out.downloads.every((d) => /^https?:\/\//.test(d.url))).toBe(true)
  })

  it('matches the thread host census', () => {
    const out = parseLcThreadDownloads(thread3272())
    const count = (host) => out.downloads.filter((d) => d.host === host).length
    expect(count('mega.nz')).toBe(5)
    expect(count('pixeldrain.com')).toBe(5)
    expect(count('vikingfile.com')).toBe(6)
    expect(count('mixdrop.ag')).toBe(3)
    expect(count('datanodes.to')).toBe(1)
    expect(count('gofile.io')).toBe(1)
  })

  it('keeps the Mega fragment, which is the decryption key', () => {
    // A resolve that returns the URL minus "#key" looks successful and yields
    // a file nobody can decrypt (see maskedResolverUrls.js). The fragment
    // must survive the decode, not just the host and path.
    const out = parseLcThreadDownloads(thread3272())
    const mega = out.downloads.find((d) => d.host === 'mega.nz')
    expect(mega.url).toBe(
      'https://mega.nz/file/HAsE0DTI#copOrpDpLpaNblYB5kUolW8t6PDqStDPDYjqpyohpOA',
    )
  })

  it('separates the unlabeled current build from the named older one', () => {
    const out = parseLcThreadDownloads(thread3272())
    const groups = [...new Set(out.downloads.map((d) => d.group))]
    expect(groups).toEqual(['', 'Divine Adventure v1.5'])
    // The changelog bolds above the download area must not leak into labels.
    expect(out.downloads.every((d) => !/v\d+\.\d+/i.test(d.group) || d.group === 'Divine Adventure v1.5')).toBe(true)
  })

  it('reads platforms off each heading, including inside the spoiler', () => {
    const out = parseLcThreadDownloads(thread3272())
    const platforms = [...new Set(out.downloads.map((d) => d.platform))].sort()
    expect(platforms).toEqual(['Android', 'Linux', 'Mac', 'Win'])
    const v15 = out.downloads.filter((d) => d.group === 'Divine Adventure v1.5')
    expect(v15).toHaveLength(11)
  })

  it('leaves the custom-field Patreon link out', () => {
    // Developer Links renders its own bbWrapper above the post. Reading "the
    // first bbWrapper" (the F95 rule) would take the funding link and return
    // zero downloads; the LC locator skips straight to the post.
    const out = parseLcThreadDownloads(thread3272())
    expect(out.downloads.some((d) => /patreon/i.test(d.url + d.label))).toBe(false)
  })

  it('feeds the classifier and the modal unchanged', () => {
    const out = parseLcThreadDownloads(thread3272())
    const sel = selectDownloadableLinks(out.downloads, {
      supportedHosts: new Set(['mega', 'pixeldrain', 'gofile']),
      platform: 'win',
    })
    // Win mega + pixeldrain, current and v1.5. The vikingfile/mixdrop mirrors
    // and the Mac/Linux/Android builds are out, each for its own reason.
    expect(sel.singles).toHaveLength(4)
    expect(sel.singles.every((s) => ['mega.nz', 'pixeldrain.com'].includes(s.link.host))).toBe(true)

    const links = [
      ...sel.singles.map((s) => ({ ...s.link, platform: s.link.platform || '' })),
      ...sel.unsupportedHost.map((s) => ({ ...s.link, platform: s.link.platform || '', unsupported: true })),
    ]
    const options = buildDownloadOptions(links)
    expect(options.map((o) => o.title)).toEqual([FULL_ARCHIVE, 'Divine Adventure v1.5'])
    expect(options.every((o) => o.unsupported !== true)).toBe(true)
    expect(options.map((o) => o.links.length)).toEqual([2, 2])
  })
})

describe('LewdCorner link shapes the fixture does not cover', () => {
  it('reads a guest render as logged out rather than unknown', () => {
    const out = parseLcThreadDownloads(page('false', '<b>DOWNLOAD</b><br><b>Win</b>: <a href="https://mega.nz/a">MEGA</a>'))
    expect(out.loggedIn).toBe(false)
  })

  it('drops an in-thread pointer but keeps an attachment on the same domain', () => {
    // F95 denies its own domain outright and allows a separate attachments
    // subdomain. LC serves attachments at lewdcorner.com/attachments/..., on
    // the forum's own domain — deny the domain, allow that path.
    const out = parseLcThreadDownloads(page('true', `
      <b>DOWNLOAD<br>Win</b>:
      <a href="https://mega.nz/game">MEGA</a><br>
      Crack: <a href="https://lewdcorner.com/threads/16583/">here</a><br>
      Walkthrough: <a href="https://lewdcorner.com/attachments/1410346_Walkthrough.zip">zip</a><br>
    `))
    expect(out.downloads.map((d) => d.host)).toEqual(['mega.nz', 'lewdcorner.com'])
  })

  it('marks a link neither tier can read so it takes the resolver, not the queue', () => {
    // Unknown shape: emitted with masked:true and the forum as host, so the
    // modal sends it down downloads-resolve-masked (LC cookies) rather than
    // queueing a gate URL as if it were a file.
    const out = parseLcThreadDownloads(page('true',
      '<b>DOWNLOAD<br>Win</b>: ' +
      '<a href="https://lewdcorner.com/masked/out?bogus=1">MEGA</a><br>',
    ))
    expect(out.downloads).toHaveLength(1)
    expect(out.downloads[0].masked).toBe(true)
    expect(out.downloads[0].host).toBe('lewdcorner.com')
  })

})

// Some posts carry their mirrors ON the heading line, all inside one <b>:
// "DOWNLOADS<br>Win/Linux: MEGA - Pixeldrain - MediaFire<br>Mac: ...<br>
// Android: ...". Folding that bold whole treated every heading line as a
// build label (the link labels ride each line), so the last line's text named
// every mirror and the platform filter rejected the lot: links:0, no error.
// Real first post captured logged in, fixtures/lc-thread-19787.html.
describe('mirrors on the heading line (one bold wraps the whole block)', () => {
  const headingMirrorsPost = () => readFileSync(join(fixtureDir, 'lc-thread-19787.html'), 'utf8')

  it('gives each inline mirror the platform of its own line, not the bold\'s last line', () => {
    const out = parseLcThreadDownloads(headingMirrorsPost())
    expect(out.downloads).toHaveLength(10)
    expect(out.downloads.slice(0, 4).every((d) => d.platform === 'Win/Linux')).toBe(true)
    expect(out.downloads.slice(4, 7).every((d) => d.platform === 'Mac')).toBe(true)
    expect(out.downloads.slice(7).every((d) => d.platform === 'Android')).toBe(true)
  })

  it('leaves the build label empty, where the post wrote none', () => {
    const out = parseLcThreadDownloads(headingMirrorsPost())
    expect(out.downloads.every((d) => d.group === '')).toBe(true)
  })

  it('reaches the classifier offerable on Windows instead of dying in the filter', () => {
    const out = parseLcThreadDownloads(headingMirrorsPost())
    const sel = selectDownloadableLinks(out.downloads, {
      supportedHosts: new Set(supportedHostIds()),
    })
    // unsupportedHost carries the host rejections. hiddenPlatform must not:
    // those links passed the platform check, and counting them here named
    // win/linux in a summary that says the machine cannot run them.
    expect(sel.singles.map((s) => s.link.host)).toEqual(['mega.nz', 'pixeldrain.com'])
    expect(sel.unsupportedHost).toHaveLength(2)
    expect(sel.hiddenPlatform.links).toBe(6)
    expect(sel.hiddenPlatform.platforms).toEqual(['mac', 'android'])
  })

})

// The LC-only pre-pass that fixes the shape above: each <b> that CONTAINS an
// anchor is re-emitted as the shape F95 posters already write - heading bold,
// then bare mirrors, then <br><b>next heading</b>. Only bolds with inline
// <a> are touched, so the shared scan needs no edit at all.
const { separateInlineBolds } = require_('../electron/downloads/lcInlineBolds.js')

describe('lcInlineBolds pre-pass', () => {
  it('splits one inline bold into heading bolds and bare mirrors', () => {
    const before = '<b>DOWNLOADS<br>Win/Linux: ' +
      '<a href="https://mega.nz/a">MEGA</a> - <a href="https://pixeldrain.com/b">PD</a> -<br>' +
      'Mac: <a href="https://mega.nz/c">MEGA</a></b>'
    expect(separateInlineBolds(before)).toBe(
      // The trailing colons stay: splitHeadingLines already strips a trailing
      // ":" when folding a bold, so the emitted text stays verbatim.
      '<b>DOWNLOADS<br>Win/Linux: </b><br>' +
      '<a href="https://mega.nz/a">MEGA</a> - <a href="https://pixeldrain.com/b">PD</a> -<br>' +
      '<b>Mac: </b><br>' +
      '<a href="https://mega.nz/c">MEGA</a>',
    )
  })

  it('leaves anchorless bolds byte-for-byte alone', () => {
    const html = '<b>Win/Linux</b>: <a href="https://mega.nz/a">MEGA</a>' +
      '<b>v0.107</b><br><b>Part 8</b>'
    expect(separateInlineBolds(html)).toBe(html)
  })

  it('removes spoiler button chrome whole, wherever it sits', () => {
    // The title span is button chrome: it names the reveal, never a link.
    // A copy-pasted bold can wrap it, so the title text must not survive as
    // bare text the fold could read as a heading.
    const html =
      '<b><button type="button" class="button bbCodeSpoiler-button">' +
      '<span>Spoiler: <span class="bbCodeSpoiler-button-title">Overwrite</span></span>' +
      '</button>Win/Linux: <a href="https://mega.nz/a">MEGA</a></b>'
    const out = separateInlineBolds(html)
    expect(out).not.toMatch(/<button/i)
    expect(out).not.toContain('Overwrite')
    expect(out).toContain('<a href="https://mega.nz/a">MEGA</a>')
  })

  it('leaves pages without buttons byte-identical', () => {
    const html = '<b>Downloads</b><br><b>Win/Linux: </b>' +
      '<a href="https://mega.nz/a">MEGA</a><br><div>plain content</div>'
    expect(separateInlineBolds(html)).toBe(html)
  })

  it('promotes a heading glued after the last mirror of a row', () => {
    // On the real page a part section opens with no <br> after the previous
    // row's last mirror: the next heading rides glued to that mirror run and
    // comes out bare text, which the fold cannot promote. Its platform label
    // travels with it, so both belong on one bold line.
    //
    // The <span><div> above the first row exists to balance the closing tags
    // that row leaves inside the bold below: the scan bounds the post by div
    // depth, so an unmatched close would end the post before the second row.
    const out = parseLcThreadDownloads(page('true',
      '<span><div><b>Others: <a href="https://pixeldrain.com/a1">Compressed</a>*</span></div>' +
      '<div class="bbCodeBlock-content">Part 5<br>' +
      '<b><span style="font-size: 18px">Win/Linux:</span></b><span style="font-size: 18px"> ' +
      '<a href="https://mega.nz/a2">MEGA</a></b>',
    ))
    // The marker is a section now, not a build: no part name preceded it, so
    // the base stays empty and the section carries the poster's word.
    expect(out.downloads.map((d) => [d.group, d.section, d.platform])).toEqual([
      ['', 'Others', ''],
      ['Part 5', '', 'Win/Linux'],
    ])
  })

  it('opens a part section with its spoiler title', () => {
    // The mirror block under a part spoiler carries no heading of its own on
    // this site; the title is the poster's label for the content that follows.
    const out = parseLcThreadDownloads(page('true',
      '<div class="bbCodeSpoiler">' +
      '<button type="button" class="button bbCodeSpoiler-button"><span class="button-text">' +
      '<span>Spoiler: <span class="bbCodeSpoiler-button-title">Part 4</span></span>' +
      '</span></button>' +
      '<div class="bbCodeBlock-content"><b><span style="font-size: 18px">Win/Linux</span></b>' +
      '<span style="font-size: 18px">: <a href="https://mega.nz/p4">MEGA</a></div></div>',
    ))
    expect(out.downloads.map((d) => [d.group, d.platform])).toEqual([
      ['Part 4', 'Win/Linux'],
    ])
  })

  it('does not turn non-part spoiler titles into headings', () => {
    // "Changelog" and friends are chrome, not labels: gone, exactly as before.
    const html =
      '<button type="button" class="button bbCodeSpoiler-button"><span class="button-text">' +
      '<span>Spoiler: <span class="bbCodeSpoiler-button-title">Changelog</span></span>' +
      '</span></button>' +
      '<div class="bbCodeBlock-content"><b>Win/Linux</b>: <a href="https://mega.nz/c1">MEGA</a></div>'
    const out = parseLcThreadDownloads(page('true', html))
    expect(out.downloads.map((d) => d.group)).toEqual([''])
    const pre = separateInlineBolds(page('true', html))
    expect(pre).not.toContain('Changelog')
  })

  it('uses a versioned spoiler title as the build name', () => {
    // Thread 94: the older build is a spoiler titled "Before the Tech Update
    // (v0.20.16)" with no heading inside it. Dropping the title merges those
    // rows with the current build under the empty heading.
    const out = parseLcThreadDownloads(page('true',
      '<b>Win/Linux</b>: <a href="https://mega.nz/new1">MEGA</a>' +
      '<div class="bbCodeSpoiler">' +
      '<button type="button" class="button bbCodeSpoiler-button"><span class="button-text">' +
      '<span>Spoiler: <span class="bbCodeSpoiler-button-title">Before the Tech Update (v0.20.16)</span></span>' +
      '</span></button>' +
      '<div class="bbCodeBlock-content"><b>Win/Linux</b>: ' +
      '<a href="https://mega.nz/old1">MEGA</a></div></div>',
    ))
    expect(out.downloads.map((d) => [d.group, d.platform])).toEqual([
      ['', 'Win/Linux'],
      // The fold reads the trailing "(v0.20.16)" as a qualifier and joins it
      // back without the parentheses, same as "Season 1 (1080p)".
      ['Before the Tech Update v0.20.16', 'Win/Linux'],
    ])
    // The title names a build, so its rows stay out of the patches bucket.
    expect(out.patches).toHaveLength(0)
    expect(out.downloads[1].headingIsBuild).toBe(true)
  })
})

// Full-pack compressed rows write the OS inside a bold of its own and the file
// size in a bracket tail OUTSIDE that bold:
//
//   <b><u>Win/Linux</u></b><span> [1,09 GB] <a>MEGA</a>
//
// The fold reads bold + tail as one heading line, so the row came out named
// "Win/Linux [1,09 GB]" with no platform and the section heading above it was
// lost. The bracket states file size, never target OS, so it goes and the row
// is re-emitted in the per-row shape the fold already reads.
describe('size-bracket rows (OS inside the bold, size and mirrors outside)', () => {
  it('re-emits the row as an OS heading and bare mirrors', () => {
    const before = '<b><u><span style="font-size: 18px">Win/Linux</span></u></b>' +
      '<span style="font-size: 18px"> [1,09 GB] <a href="https://mega.nz/a">MEGA</a></span>'
    // The span stays open around the mirrors so the page's own nesting survives.
    expect(separateInlineBolds(before)).toBe(
      '<b>Win/Linux</b>: <span style="font-size: 18px">' +
        '<a href="https://mega.nz/a">MEGA</a></span>',
    )
  })

  it('files the row under the section heading with its own platform', () => {
    // The shape on the real page: one outer bold spans the poster's section
    // heading and both rows, so the fold reads the size bracket as part of the
    // OS line and the row inherits "Win/Linux [1,09 GB]" as its build name.
    const out = parseLcThreadDownloads(page('true',
      '<b>Others: COMPRESSED (V95)*<br>' +
      '<b><u>Win/Linux</u></b><span> [1,09 GB] <a href="https://mega.nz/c1">MEGA</a></span><br>' +
      '<b><u>Mac</u></b> [1,06 GB] <a href="https://mega.nz/c2">MEGA</a></b>',
    ))
    expect(out.downloads.map((d) => [d.group, d.section, d.platform])).toEqual([
      ['', 'COMPRESSED (V95)', 'Win/Linux'],
      ['', 'COMPRESSED (V95)', 'Mac'],
    ])
  })

  it('leaves a heading that merely mentions a platform alone', () => {
    // "Mac port by another modder" is a build name, not a platform token, so
    // the row must not be rewritten even though a size bracket follows it.
    const html = '<b>Mac port by another modder</b> [1,09 GB] <a href="https://mega.nz/x">MEGA</a>'
    expect(separateInlineBolds(html)).toBe(html)
  })
})

// One outer <b> spans a whole part section inside a spoiler: the part label,
// per-row platform bolds, and an "Update Patch (...)" section all ride inside
// it. The pre-pass flatlines that into the exact line structure the shared
// fold already reads, so part labels, per-row platforms and the patch bucket
// all keep working.
describe('part sections inside one inline bold', () => {
  const partSectionPost = (body) => parseLcThreadDownloads(page('true',
    `<div class="bbCodeSpoiler"><div class="bbCodeBlock-content">` +
    `<b><span style="font-size: 18px"><b>Part 7<br>` +
    `<b>Win/Linux</b>: <a href="https://mega.nz/p7-pc">DATANODES</a> - <a href="https://gofile.io/p7-pc">GOFILE</a><br>` +
    `<b>Mac</b>: <a href="https://mega.nz/p7-mac">MEGA</a><br>` +
    `Update Patch (<b>0.106&gt;0.107</b>)<br>` +
    `<b>Win/Linux</b>: <a href="https://mega.nz/p7-patch-pc">MEGA</a><br>` +
    `<b>Mac</b>: <a href="https://mega.nz/p7-patch-mac">MEGA</a>` +
    `</span></b></div></div>${body || ''}`,
  ))

  it('recovers the part label and the per-row platforms from the inline rows', () => {
    const out = partSectionPost()
    expect(out.downloads.map((d) => [d.group, d.platform])).toEqual([
      ['Part 7', 'Win/Linux'],
      ['Part 7', 'Win/Linux'],
      ['Part 7', 'Mac'],
    ])
  })

  it('sends the Update Patch rows to the patches bucket, not downloads', () => {
    const out = partSectionPost()
    expect(out.patches.map((d) => [d.group, d.platform])).toEqual([
      ['Update Patch 0.106>0.107', 'Win/Linux'],
      ['Update Patch 0.106>0.107', 'Mac'],
    ])
  })
})

// Real post with the whole family of blocks: part sections inside spoilers,
// a generic spoiler whose content has no heading of its own, per-row
// platform bolds, size-bracket rows and several patch build lines. The
// fixture keeps real ids; the assertions pin the F95-shaped outcome: no
// spoiler chrome in any label, parts carrying their own names, and every
// patch build in the patches bucket.
describe('real post with spoiler-wrapped part sections', () => {
  const multiSectionPost = () => readFileSync(join(fixtureDir, 'lc-thread-7.html'), 'utf8')

  it('reads the page and every patch build into the patches bucket', () => {
    const out = parseLcThreadDownloads(multiSectionPost())
    expect(out.found).toBe(true)
    expect(out.loggedIn).toBe(true)
    expect(out.threadId).toBe('7')
    // Both buckets together still hold every link on the page (195). The split
    // moved from 106/89 to 152/43 because rows that used to inherit a stale
    // patch heading - the older parts, the compressed rows - now land in
    // downloads where their own headings send them.
    expect(out.downloads.length + out.patches.length).toBe(195)
    expect(out.downloads).toHaveLength(152)
    expect(out.patches).toHaveLength(43)
    expect(out.extras).toHaveLength(0)
    expect(out.translations).toHaveLength(0)
    expect([...new Set(out.patches.map((d) => d.group))]).toEqual([
      'Update Patch 0.106>0.107',
      'UPDATE PATCH 0.79>0.80',
      'UPDATE PATCH 0.52>0.53',
      'UPDATE PATCH 0.36>0.37',
    ])
  })

  it('labels every part with its own name and platform rows, no spoiler chrome', () => {
    const out = parseLcThreadDownloads(multiSectionPost())
    const all = [...out.downloads, ...out.patches, ...out.extras, ...out.translations]
    expect(all.every((d) => !/spoiler/i.test(d.group))).toBe(true)
    for (const part of ['Part 6', 'Part 7', 'Part 8']) {
      const rows = out.downloads.filter((d) => d.group === part)
      expect(rows.length).toBeGreaterThan(0)
      expect(new Set(rows.map((d) => d.platform))).toEqual(new Set(['Win/Linux', 'Mac', 'Android']))
    }
  })

  it('parses parts 1 through 8 under their own groups', () => {
    // The older parts were the reported defect: a Windows machine could not
    // update them at all, because their mirrors inherited a stale heading or
    // a junk one. Part 1 keeps the version suffix its own spoiler title carries.
    const out = parseLcThreadDownloads(multiSectionPost())
    for (const part of ['Part 1 - v0.16', 'Part 2 - v0.37', 'Part 3', 'Part 4',
      'Part 5', 'Part 6', 'Part 7', 'Part 8']) {
      const rows = out.downloads.filter((d) => d.group === part)
      expect(rows.length).toBeGreaterThan(0)
      // Section rows are repacks listed under the part, and a bare hotfix
      // carries no platform at all. Only the part's own rows have one.
      expect(rows.filter((d) => !d.section).every((d) => d.platform)).toBe(true)
    }
    // The disclaimer bold that opens Part 2's content is prose, not a heading:
    // no mirror may file under it.
    expect(out.downloads.some((d) => /^Note2:/.test(d.group))).toBe(false)
  })

  it('files an Others marker as a section under the part, not as a build', () => {
    const out = parseLcThreadDownloads(multiSectionPost())
    // Part 6's compressed repack: its own platforms, still under Part 6.
    const compressed = out.downloads.filter((d) => d.section === 'COMPRESSED (V95)')
    expect(compressed.length).toBeGreaterThan(0)
    expect(new Set(compressed.map((d) => d.group))).toEqual(new Set(['Part 6']))
    expect(new Set(compressed.map((d) => d.platform))).toEqual(new Set(['Win/Linux', 'Mac']))
    // Part 1's repack marker is split across a bold and the text after it, so
    // the pre-pass hands the fold "Other: Compressed*".
    const partOne = out.downloads.filter((d) => d.section === 'Compressed')
    expect(partOne.length).toBeGreaterThan(0)
    expect(new Set(partOne.map((d) => d.group))).toEqual(new Set(['Part 1 - v0.16']))
    // The bare marker names its section, and its one mirror is the hotfix the
    // classifier refuses later.
    const hotfix = out.downloads.find((d) => d.label === 'HOTFIX (for v0.81)')
    expect(hotfix.group).toBe('Part 5')
    expect(hotfix.section).toBe('Others')
    // No row is grouped under a marker any more.
    expect(out.downloads.every((d) => !/^Others?\b/.test(d.group))).toBe(true)
  })

  it('reads the heading before a headingless spoiler as its label', () => {
    // The generic reveal under a walkthrough header carries bare mirror
    // links: no heading of its own, so the nearest preceding header names
    // the group instead of the button text.
    const out = parseLcThreadDownloads(multiSectionPost())
    const walkthrough = out.downloads.filter((d) => /walkthrough/i.test(d.group))
    expect(walkthrough).toHaveLength(2)
    expect(walkthrough.every((d) => ['mega.nz', 'pixeldrain.com'].includes(d.host))).toBe(true)
  })
})
