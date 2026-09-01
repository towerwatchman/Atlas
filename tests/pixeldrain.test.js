import { describe, it, expect } from 'vitest'

const pd = require('../electron/downloads/hosts/pixeldrain.js')

// ── Pixeldrain URL shapes ────────────────────────────────────────────────────
//
// A real report: https://pixeldrain.com/d/SnRizccJ failed with "This link is no
// longer available" while the file was perfectly alive.
//
// Two faults stacked, and neither is visible from the message:
//
//   1. matches() claims EVERY pixeldrain.com URL, but fileIdFrom() only
//      understood /u/ and /api/file/. A /d/ link was therefore claimed by the
//      plugin and then rejected by it as unrecognisable.
//   2. That rejection is kind:"fatal", and downloadManager mapped every fatal to
//      the same sentence, discarding what the plugin actually said. A parsing
//      gap in Atlas was reported to the user as a dead link on Pixeldrain.
//
// The id charset is the same bug waiting to happen: [a-zA-Z0-9]+ stops at the
// first character outside it, so an id containing - or _ is silently TRUNCATED
// into a shorter id that is still well formed. That produces a genuine 404 for a
// file that exists, which is indistinguishable from deletion. Failing to parse is
// recoverable; parsing into the wrong answer is not.

describe('fileIdFrom', () => {
  it('does NOT treat a /d/ link as a file id', () => {
    // /d/ is the filesystem, a separate API. Mapping it onto the file id space
    // made /api/file/SnRizccJ/info answer "The entity you requested could not be
    // found" for a file that existed. See pixeldrain-fs.test.js.
    expect(pd.fileIdFrom('https://pixeldrain.com/d/SnRizccJ')).toBeNull()
    expect(pd.filesystemPathFrom('https://pixeldrain.com/d/SnRizccJ')).toBe('SnRizccJ')
  })

  it('still reads the shapes it already handled', () => {
    expect(pd.fileIdFrom('https://pixeldrain.com/u/UPND8Ncr')).toBe('UPND8Ncr')
    expect(pd.fileIdFrom('https://pixeldrain.com/api/file/UPND8Ncr')).toBe('UPND8Ncr')
  })

  it('does not truncate an id at a hyphen or underscore', () => {
    // Whole-or-nothing. A partial id is worse than none: it produces a valid
    // request for the wrong file and a 404 that reads as deletion.
    expect(pd.fileIdFrom('https://pixeldrain.com/u/abc-123def')).toBe('abc-123def')
    expect(pd.fileIdFrom('https://pixeldrain.com/u/abc_123def')).toBe('abc_123def')
  })

  it('does not mistake a list for a file', () => {
    expect(pd.fileIdFrom('https://pixeldrain.com/l/aBcD1234')).toBeNull()
    expect(pd.listIdFrom('https://pixeldrain.com/l/aBcD1234')).toBe('aBcD1234')
  })
})

describe('probe on an unsupported shape', () => {
  it('says the shape is unsupported rather than implying the file is gone', async () => {
    const result = await pd.probe('https://pixeldrain.com/wat/SnRizccJ')
    expect(result.ok).toBe(false)
    // Must name Atlas as the limitation. The user cannot act on "not
    // recognisable", and it reads as though they pasted something wrong.
    expect(result.error).toMatch(/atlas/i)
    expect(result.error).not.toMatch(/no longer available|deleted|expired/i)
  })
})

// ── Transport errors are not verdicts about the file ─────────────────────────
//
// Found while making downloadManager prefer the plugin's message: a DNS failure
// classified as "fatal". `getaddrinfo ENOTFOUND pixeldrain.com` lowercases to
// contain "notfound", and the /not_?found/ test ran BEFORE the network test, so
// it matched there and never reached it.
//
// The consequence was worse than a bad message. "fatal" is terminal, so a laptop
// that lost wifi for a moment permanently failed the download AND reset
// receivedBytes to 0, discarding the partial file. The retry that exists for
// exactly this case was never reached.
//
// An exception from fetch describes the CONNECTION. Only a response body
// describes the file, so transport signatures have to be tested first.
describe('classifyError on transport failures', () => {
  const transport = [
    'getaddrinfo ENOTFOUND pixeldrain.com',
    'connect ECONNREFUSED 1.2.3.4:443',
    'read ECONNRESET',
    'fetch failed',
    'socket hang up',
    'The operation was aborted due to timeout',
  ]

  for (const message of transport) {
    it(`treats "${message}" as transient`, () => {
      expect(pd.classifyError(new Error(message))).toBe('transient')
    })
  }

  it('still calls a real 404 fatal', () => {
    expect(pd.classifyError(null, { status: 404 })).toBe('fatal')
    expect(pd.classifyError(null, { status: 200, body: { value: 'file_not_found' } })).toBe('fatal')
  })

  it('does not let a transport error mask a rate limit in the body', () => {
    expect(pd.classifyError(null, { status: 429 })).toBe('quota')
  })
})

// ── Diagnostics ──────────────────────────────────────────────────────────────
//
// The /d/ fix shipped on an unverified assumption: that /d/ ids live in the same
// space as /u/ ids. Pixeldrain answered "The entity you requested could not be
// found", so it does not -- and the only reason that was learnable is that the
// manager now shows the plugin's message instead of a generic one.
//
// These assert the evidence a failed run has to leave behind, because the next
// unknown shape should be identifiable from one log line rather than a round trip.
describe('probe diagnostics', () => {
  const okInfo = { success: true, name: 'game.zip', size: 1234, mime_type: 'application/zip' }

  function stubFetch(status, body) {
    globalThis.fetch = async (requested) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Map(),
      requested,
    })
  }



  it('still reports a genuinely missing /u/ file using Pixeldrain\'s own words', async () => {
    stubFetch(404, { success: false, value: 'not_found', message: 'The entity you requested could not be found' })
    const result = await pd.probe('https://pixeldrain.com/u/UPND8Ncr')
    expect(result.error).toMatch(/entity you requested/i)
    expect(result.diagnostic.shape).toBe('u')
  })

  it('leaves evidence on a successful probe too', async () => {
    stubFetch(200, okInfo)
    const result = await pd.probe('https://pixeldrain.com/u/UPND8Ncr')
    expect(result.ok).toBe(true)
    expect(result.fileName).toBe('game.zip')
    expect(result.diagnostic.requested).toBe('https://pixeldrain.com/api/file/UPND8Ncr/info')
  })
})
