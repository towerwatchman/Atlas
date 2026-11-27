import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ── Downloads section header styling ─────────────────────────────────────────
// Sticky positioning and the fill above a stuck header are visual details a
// jsdom assertion cannot see, so pin the source directly.

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'downloads', 'DownloadsPage.jsx'),
  'utf8',
)

describe('Downloads section headers', () => {
  it('pins an opaque, full-bleed header with a tall fill only while stuck', () => {
    expect(source).toContain(
      'sticky top-0 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 bg-secondary pt-2 flex items-center gap-3 relative before:absolute before:inset-x-0 before:bottom-full ',
    )
    expect(source).toContain("stuck ? 'before:h-16' : 'before:h-2'")
    expect(source).toContain("before:bg-secondary before:content-['']")
    expect(source).not.toContain('before:bottom-full before:h-16')
    expect(source).not.toContain('<section className="mt-6 first:mt-0">')
    expect(source).toContain('className="mt-[13px]"')
  })

  it('marks all three section headers and flags the stuck one', () => {
    for (const id of ['inProgress', 'upNext', 'completed']) {
      expect(source).toContain(`sectionId="${id}"`)
      expect(source).toContain(`stuck={stuckHeader === '${id}'}`)
    }
    expect(source).toContain('data-section-header={sectionId}')
  })
})
