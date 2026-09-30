import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ── Downloads page scroll region ─────────────────────────────────────────────
//
// The full Downloads view is mounted under App.jsx's shared library pane, which
// is `overflow-hidden` for every non-detail view. So the Downloads list cannot
// rely on an ancestor to scroll it (the old comment claimed #gameGrid did) -- it
// must be its own scroll container. Before this fix the list was clipped to a
// screenful and only the top entries were reachable.
//
// The scrollbar is hidden until scroll/right-edge proximity (see main.css
// `.downloads-scroll`) and is styled ONLY through the ::-webkit-scrollbar
// pseudo-elements -- never `scrollbar-width`/`scrollbar-color`, which would
// switch every pseudo-element scrollbar rule off (see
// tests/scrollbar-styling.test.js). Visibility is toggled by a JS-driven
// `scrollbar-visible` class (scroll events + right-edge mouse proximity) and is
// never driven by a CSS `:hover` rule.

const DIRECTORY = path.join(__dirname, '..', 'src', 'components', 'downloads')
const pageSource = fs.readFileSync(path.join(DIRECTORY, 'DownloadsPage.jsx'), 'utf8')

// The first element after the component's top-level `return (` is the view root.
// Other components (e.g. `Cover`) have their own `return (` earlier in the file,
// so the LAST one is the Downloads view root.
const returnIndex = pageSource.lastIndexOf('  return (')
const rootDecl = pageSource.slice(returnIndex, pageSource.indexOf('>', returnIndex))

describe('the Downloads page scrolls its own list', () => {
  it('the view root fills the pane but does not itself scroll', () => {
    expect(rootDecl).toContain('h-full flex flex-col')
    expect(rootDecl).toContain('overflow-hidden')
    expect(rootDecl).not.toMatch(/overflow-y-auto/)
  })

  it('the header is a pinned flex sibling, not part of the scrolling list', () => {
    expect(pageSource).toContain(
      '<div className="shrink-0 bg-selected border-b border-border">',
    )
  })

  it('the list is wrapped in the single scroll container', () => {
    expect(pageSource).toMatch(
      /overflow-y-auto downloads-scroll px-4 sm:px-6 py-4 pb-10/,
    )
    expect(pageSource).toContain('onScroll={handleScroll}')
  })

  it('there is only one scrolling region in the view', () => {
    const matches = pageSource.match(/overflow-y-auto/g) || []
    expect(matches.length).toBe(1)
  })
})

// The hidden-but-present scrollbar utility lives in main.css. Asserts the class
// exists, keeps the scrollbar invisible until the JS-driven `scrollbar-visible`
// class is toggled, and does not introduce the standard properties that would
// disable the whole pseudo-element block. The class is toggled by scroll events
// and right-edge mouse proximity in DownloadsPage.jsx; visibility is driven
// solely by that class, never by a CSS `:hover` rule.
describe('.downloads-scroll hides its scrollbar until JS shows it', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'css', 'main.css'), 'utf8')
  // Declarations only; the comments around these rules explain how they work.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const block = withoutComments.slice(withoutComments.indexOf('.downloads-scroll'))

  it('styles the scrollbar only through the pseudo-elements', () => {
    expect(block).toMatch(/\.downloads-scroll::-webkit-scrollbar-thumb\s*\{/)
    expect(block.slice(0, block.indexOf('::-webkit-scrollbar')))
      .not.toMatch(/scrollbar-(width|color)/)
  })

  it('is invisible at rest and only revealed by the scrollbar-visible class', () => {
    expect(block).toMatch(
      /\.downloads-scroll::-webkit-scrollbar-thumb\s*\{\s*background-color:\s*transparent/,
    )
    expect(block).toMatch(
      /\.downloads-scroll\.scrollbar-visible::-webkit-scrollbar-thumb\s*\{\s*background-color:\s*var\(--scrollbar-thumb\)/,
    )
    // No `:hover` rule -- visibility must be driven solely by JS.
    expect(block).not.toMatch(/\.downloads-scroll:hover/)
  })
})
