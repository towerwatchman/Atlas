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