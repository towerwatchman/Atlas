import { describe, it, expect } from 'vitest'
import { releaseUrlFor } from '../src/utils/releaseUrl.js'

describe('releaseUrlFor', () => {
  it('points at the tagged release for the given version', () => {
    expect(releaseUrlFor('0.9.9')).toBe(
      'https://github.com/towerwatchman/Atlas/releases/tag/v0.9.9'
    )
  })

  it('keeps the version string untouched in the tag', () => {
    expect(releaseUrlFor('0.9.9-nightly.459')).toBe(
      'https://github.com/towerwatchman/Atlas/releases/tag/v0.9.9-nightly.459'
    )
  })

  it('does not add a leading v prefix beyond the hard-coded one', () => {
    expect(releaseUrlFor('v1.2.3')).toBe(
      'https://github.com/towerwatchman/Atlas/releases/tag/vv1.2.3'
    )
  })
})
