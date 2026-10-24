import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'settings', 'Interface.jsx'),
  'utf8',
)

// A stored id whose browser vanished displays as default without erasing
// the stored value. The fallback is display-only until the user picks again.
describe('Interface browser fallback display', () => {
  test('a stored id missing from the detected list selects Use Default Browser', () => {
    expect(src).toMatch(/browsers\.some\(\(b\) => b\.id === browserId\) \? browserId : "default"/)
  })

  test('Use Default Browser is still the first option', () => {
    expect(src).toMatch(/<option value="default">Use Default Browser<\/option>/)
  })
})
