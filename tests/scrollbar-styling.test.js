import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Scrollbars vanished from the app because main.css set BOTH the standard
// scrollbar properties and the ::-webkit-scrollbar pseudo-elements.
//
// Since Chromium 121 -- this app ships Electron 42, long past it -- setting
// `scrollbar-width` or `scrollbar-color` to a non-auto value makes Chromium
// ignore EVERY ::-webkit-scrollbar rule and draw its own scrollbar instead.
// So the carefully themed 12px scrollbar was dead code and what actually
// rendered was `scrollbar-width: thin`: a hairline that is hard to see at 100%
// and effectively invisible on a 4K panel or under fractional Windows display
// scaling, where "thin" rounds down to nearly nothing.
//
// The two mechanisms are mutually exclusive. These tests fail if anyone
// reintroduces the standard properties, because doing so silently turns the
// whole pseudo-element block off again -- with no error, no warning, and
// nothing visibly wrong until someone looks at a scrollbar on a high-DPI
// screen.

const CSS_PATH = ['src', 'assets', 'css', 'main.css']
const css = fs.readFileSync(path.join(__dirname, '..', ...CSS_PATH), 'utf8')

// Comments carry these words on purpose (explaining why they are absent), so
// they must be stripped before asserting on declarations.
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

// Declarations only: `prop: value`, not a word inside a selector or at-rule.
const declaredValues = (property) => {
  const found = []
  const re = new RegExp(`(^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g')
  let match
  while ((match = re.exec(withoutComments)) !== null) found.push(match[2].trim())
  return found
}

describe('scrollbar styling', () => {
  it('does not set scrollbar-width, which disables the pseudo-elements', () => {
    expect(declaredValues('scrollbar-width')).toEqual([])
  })

  it('does not set scrollbar-color, which disables them the same way', () => {
    expect(declaredValues('scrollbar-color')).toEqual([])
  })

  // The reason the above matter: this is the styling they would switch off.
  it('still styles the scrollbar through the pseudo-elements', () => {
    expect(withoutComments).toMatch(/\*::-webkit-scrollbar\s*\{/)
    expect(withoutComments).toMatch(/::-webkit-scrollbar-thumb\s*\{/)
    expect(withoutComments).toMatch(/::-webkit-scrollbar-track\s*\{/)
  })

  // An explicit width is what makes the scrollbar a predictable size at any
  // DPI, and what scrollbar-gutter: stable reserves exactly. Chromium's own
  // scrollbar is whatever the platform says, which is the 4K/scaling problem.
  it('gives the scrollbar an explicit non-zero width', () => {
    const block = withoutComments.slice(withoutComments.indexOf('*::-webkit-scrollbar {'))
    const width = block.match(/width:\s*(\d+)px/)
    expect(width).not.toBeNull()
    expect(Number(width[1])).toBeGreaterThan(0)
  })

  // Removing this brings back the horizontal shift when a filter narrows the
  // results enough for the scrollbar to disappear.
  it('keeps the grid gutter reserved so the layout cannot shift', () => {
    expect(declaredValues('scrollbar-gutter')).toContain('stable')
  })

  // The utility class exists for surfaces that opt in outside the base layer.
  // It had the same conflict and needs the same treatment.
  it('applies the same rule to the .atlas-scrollbar utility', () => {
    const utility = withoutComments.slice(withoutComments.indexOf('.atlas-scrollbar'))
    expect(utility).toMatch(/\.atlas-scrollbar::-webkit-scrollbar\s*\{/)
    expect(utility.slice(0, utility.indexOf('::-webkit-scrollbar')))
      .not.toMatch(/scrollbar-(width|color)/)
  })
})

// The parser itself must not pass by accident: if the property matching were
// broken, every test above would pass on any file at all.
describe('the guard actually detects the pattern', () => {
  const detect = (source, property) => {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')
    const re = new RegExp(`(^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g')
    const out = []
    let m
    while ((m = re.exec(stripped)) !== null) out.push(m[2].trim())
    return out
  }

  it('finds a reintroduced declaration', () => {
    expect(detect('* { scrollbar-width: thin; }', 'scrollbar-width')).toEqual(['thin'])
    expect(detect('.x{scrollbar-color:red blue}', 'scrollbar-color')).toEqual(['red blue'])
    expect(detect('*{\n  scrollbar-width : auto ;\n}', 'scrollbar-width')).toEqual(['auto'])
  })

  it('ignores the word inside a comment', () => {
    expect(detect('/* scrollbar-width: thin; */ * { color: red; }', 'scrollbar-width')).toEqual([])
  })

  it('does not confuse scrollbar-gutter for scrollbar-width', () => {
    expect(detect('#g { scrollbar-gutter: stable; }', 'scrollbar-width')).toEqual([])
  })
})

// A scroll container nested directly inside another one produces TWO
// scrollbars: the inner one does the scrolling and the outer one's track sits
// beside it, so the working scrollbar appears pushed in from the edge with an
// empty strip to its right. It was always there; a 12px scrollbar just makes
// it obvious where a hairline hid it.
//
// The Settings shell (Settings.jsx) scrolls the panel it renders tabs into, so
// a tab must not scroll its own root as well.
describe('settings tabs do not nest a second scroller', () => {
  const dir = path.join(__dirname, '..', 'src', 'components', 'settings')
  // Rendered into the scrolling panel by Settings.jsx.
  const TABS = [
    'Accounts.jsx', 'Appearance.jsx', 'Database.jsx', 'EmulatorLauncher.jsx',
    'ExtensionSettings.jsx', 'ImportSources.jsx', 'Interface.jsx',
    'Library.jsx', 'Metadata.jsx',
  ]

  it('the shell is the scroller', () => {
    const shell = fs.readFileSync(path.join(dir, 'Settings.jsx'), 'utf8')
    expect(shell).toContain('flex-1 min-h-0 overflow-y-auto px-4 pb-4')
  })

  // The tab ROOT only. Inner scrollers -- a bordered list box with its own
  // box, for instance -- are deliberate and are left alone.
  it.each(TABS)('%s does not scroll its own root element', (file) => {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    const returnIndex = source.indexOf('  return (\r\n') >= 0
      ? source.indexOf('  return (\r\n')
      : source.indexOf('  return (')
    expect(returnIndex, `${file}: no top-level return found`).toBeGreaterThan(-1)
    // The first element after `return (` is the root.
    const root = source.slice(returnIndex, source.indexOf('>', returnIndex))
    expect(root, `${file}: the Settings shell already scrolls this panel`)
      .not.toMatch(/overflow-y-auto|overflow-y-scroll|overflow-auto/)
  })
})
