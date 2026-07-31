import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const css = read('src/assets/css/main.css')
const safeImage = read('src/components/ui/SafeImage.jsx')
const picker = read('src/components/settings/bannerEditor/ScreenColorPicker.jsx')

test('the smooth-scaling rule exists', () => {
  expect(css).toContain('.atlas-smooth-image')
  expect(css).toMatch(/image-rendering:\s*high-quality/)
})

// `smooth` is declared first as the fallback: a browser that does not recognise
// high-quality drops that declaration and smooth still applies.
test('smooth is declared before high-quality', () => {
  const start = css.indexOf('.atlas-smooth-image')
  const block = css.slice(start, start + 200)
  expect(block.indexOf('image-rendering: smooth')).toBeLessThan(
    block.indexOf('image-rendering: high-quality'),
  )
})

test('SafeImage applies it by default and can opt out', () => {
  expect(safeImage).toContain('smoothScaling = true')
  expect(safeImage).toContain("smoothScaling && 'atlas-smooth-image'")
  // Must not clobber a caller's own className.
  expect(safeImage).toMatch(/\.filter\(Boolean\)/)
})

// Sampling exact pixels needs image-rendering: pixelated, so this must never
// pick up smoothing. It uses a raw <img> with an inline style, which beats a
// class — asserted so a later refactor onto SafeImage does not silently blur it.
test('the banner colour picker still samples exact pixels', () => {
  expect(picker).toContain("imageRendering: 'pixelated'")
  expect(picker).not.toContain('SafeImage')
})
