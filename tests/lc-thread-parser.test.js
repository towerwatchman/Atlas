// LewdCorner threads are XenForo 2.3, the same forum software F95 runs, so the
// markup walk is shared (electron/downloads/xenforoThreadParser.js) rather than
// reimplemented. What differs is pinned in its SITES table: the origin, the
// forum's own domain, the first-post locator, and the masked form. These tests
// pin the LewdCorner side of that contract.
//
// The fixture is the real first post of thread 3272 (Divine Adventure Rebirth
// v2.1), captured logged in. It is valuable precisely because it is noisy: a
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

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const thread3272 = () => readFileSync(join(fixtureDir, 'lc-thread-3272.html'), 'utf8')

const page = (loggedIn, body, contentKey = 'thread-16582') =>
  `<html id="XF" data-xf="2.3" data-app="public" data-template="thread_view" ` +
  `data-content-key="${contentKey}" data-logged-in="${loggedIn}">` +
  `<div class="message-userContent">${body}</div></html>`

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
