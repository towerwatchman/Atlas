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

  // A version that already carries the prefix is normalized, not doubled.
  // app.getVersion() returns package.json's version, which has no prefix, so
  // this cannot fire today -- but `vv1.2.3` is not a tag either release
  // workflow creates, so building it would only produce a 404.
  it('does not double a leading v prefix', () => {
    expect(releaseUrlFor('v1.2.3')).toBe(
      'https://github.com/towerwatchman/Atlas/releases/tag/v1.2.3'
    )
  })

  // The tag format is not arbitrary: main.yml tags v$(package.json version)
  // and nightly.yml tags v${base}-nightly.${run_number}. These two cases are
  // the shapes those workflows actually publish.
  it('matches the tag the release workflows publish', () => {
    expect(releaseUrlFor('0.9.9')).toBe(
      'https://github.com/towerwatchman/Atlas/releases/tag/v0.9.9'
    )
    expect(releaseUrlFor('0.9.9-nightly.459')).toBe(
      'https://github.com/towerwatchman/Atlas/releases/tag/v0.9.9-nightly.459'
    )
  })

  it('survives a missing version rather than building "undefined"', () => {
    expect(releaseUrlFor(undefined)).toBe(
      'https://github.com/towerwatchman/Atlas/releases/tag/v'
    )
  })
})
