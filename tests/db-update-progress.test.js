import { describe, it, expect } from 'vitest'

const {
  PHASE_STARTS,
  packageProgress,
  formatUpdateBytes,
  downloadText,
  currentPackageNumber,
} = require('../electron/db/updateProgress')

// ── Database update progress ─────────────────────────────────────────────────
//
// The bar used to be handed `processed` — a count of packages that had finished
// EVERYTHING — so it moved once per package and froze in between. The longest
// freeze was the network transfer, where the text said "Downloading Database
// Update 3/25" and nothing moved until the whole package landed. On a slow link
// that is indistinguishable from a hang, which is the bug these cover.

describe('packageProgress', () => {
  it('advances with the bytes during a download instead of sitting still', () => {
    // The regression. All four of these used to be exactly 2.
    expect(packageProgress(2, 'download', 0)).toBe(2)
    expect(packageProgress(2, 'download', 0.5)).toBeCloseTo(2.25)
    expect(packageProgress(2, 'download', 1)).toBeCloseTo(2.5)
  })

  it('keeps each phase inside its own package', () => {
    // A phase that spilled past processed + 1 would show the bar overtaking a
    // package that has not been inserted yet.
    for (const phase of Object.keys(PHASE_STARTS)) {
      const value = packageProgress(3, phase, 1)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(4)
    }
  })

  it('moves through the insert phases rather than freezing until the package ends', () => {
    // The three "Processing…" sends all reported the same number, so the bar was
    // frozen through the whole insert half too.
    const atlas = packageProgress(1, 'atlas')
    const f95 = packageProgress(1, 'f95')
    const lewd = packageProgress(1, 'lewdcorner')
    expect(f95).toBeGreaterThan(atlas)
    expect(lewd).toBeGreaterThan(f95)
  })

  it('never goes backwards from a full download into the first insert phase', () => {
    expect(packageProgress(1, 'atlas')).toBeGreaterThanOrEqual(packageProgress(1, 'download', 1))
  })

  it('treats a missing Content-Length as no fraction rather than blanking the bar', () => {
    // axios reports `total` as undefined when the server omits the header, and
    // loaded/undefined is NaN. A NaN reaches the DOM as width: NaN%, which is an
    // invisible progress bar — worse than a stationary one.
    expect(packageProgress(2, 'download', NaN)).toBe(2)
    expect(packageProgress(2, 'download', undefined)).toBe(2)
    expect(packageProgress(2, 'download', Infinity)).toBe(2)
  })

  it('clamps a fraction that overshoots', () => {
    // Content-Length can under-report against a re-encoded body.
    expect(packageProgress(2, 'download', 1.4)).toBeCloseTo(2.5)
  })

  it('falls back to the start of the package for an unknown phase', () => {
    expect(packageProgress(4, 'not-a-phase')).toBe(4)
  })
})

describe('downloadText', () => {
  it('shows how much of the package has arrived', () => {
    expect(downloadText(3, 25, 4.2 * 1024 * 1024, 7.1 * 1024 * 1024))
      .toBe('Downloading Database Update 3/25 (4.2 / 7.1 MB)')
  })

  it('drops the size entirely when the server did not send one', () => {
    // "4.2 MB of 0 MB" would be worse than saying nothing.
    expect(downloadText(3, 25, 0, 0)).toBe('Downloading Database Update 3/25')
    expect(downloadText(3, 25, 1024, undefined)).toBe('Downloading Database Update 3/25')
  })

  it('reads 0.0 rather than hiding a transfer that has not started', () => {
    expect(downloadText(1, 5, 0, 2 * 1024 * 1024)).toContain('(0.0 / 2.0 MB)')
  })
})

describe('formatUpdateBytes', () => {
  it('uses MB above a megabyte and KB below it', () => {
    expect(formatUpdateBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatUpdateBytes(300 * 1024)).toBe('300 KB')
  })

  it('reports nothing for a size it cannot use', () => {
    expect(formatUpdateBytes(0)).toBeNull()
    expect(formatUpdateBytes(undefined)).toBeNull()
    expect(formatUpdateBytes(-5)).toBeNull()
  })
})

describe('currentPackageNumber', () => {
  it('names the package being worked on, not the count completed', () => {
    // The old label opened on "Update 0/25" because it printed completed
    // packages before anything had finished.
    expect(currentPackageNumber(0, 25)).toBe(1)
    expect(currentPackageNumber(3.4, 25)).toBe(4)
  })

  it('does not run past the total on the last package', () => {
    expect(currentPackageNumber(24.9, 25)).toBe(25)
    expect(currentPackageNumber(25, 25)).toBe(25)
    expect(currentPackageNumber(99, 25)).toBe(25)
  })

  it('reports zero when there is nothing to count', () => {
    expect(currentPackageNumber(0, 0)).toBe(0)
    expect(currentPackageNumber(NaN, 25)).toBe(0)
  })
})
