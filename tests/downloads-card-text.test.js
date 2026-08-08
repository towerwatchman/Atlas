import { test, expect } from 'vitest'
const fs = require('fs')
const path = require('path')

// ── Download card body text ──────────────────────────────────────────────────
//
// The card next to the banner art carried its whole detail block in `text-muted`
// — version, build chip, state, sizes, host, ETA — which made the row's actual
// content read as secondary chrome. Only the deliberate exceptions (errors,
// warnings, the accent link) keep their own colour.
//
// Asserted against the source rather than a render because the failure is a
// class name and a mounted component would only tell us the class is present,
// not that it is the right one.

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'downloads', 'DownloadsPage.jsx'),
  'utf8',
)

// Everything between the card's opening div and its action column.
const cardBody = source.slice(
  source.indexOf('<div className="flex-1 min-w-0">'),
  source.indexOf('<div className="flex items-center shrink-0">'),
)

test('the card body is real text, not muted text', () => {
  expect(cardBody.length).toBeGreaterThan(0)
  expect(cardBody).not.toContain('text-muted')
})

test('the states that carry their own colour are left alone', () => {
  expect(cardBody).toContain('text-danger')
  expect(cardBody).toContain('text-amber-400')
  expect(cardBody).toContain('text-accent')
})
