import { test, expect } from 'vitest'
import { getGridShape, getGridSize } from '../src/components/collections/CollectionTile.jsx'

const BANNER_ASPECT = 537 / 251
const TILE_ASPECT = 16 / 9
const ROTATION = 60

test('grid shape matches the spec', () => {
  expect(getGridShape(9)).toEqual({ cols: 3, rows: 3 })    // 3x3
  expect(getGridShape(10)).toEqual({ cols: 3, rows: 4 })   // 3 cols, 4 rows
  expect(getGridShape(1)).toEqual({ cols: 1, rows: 1 })
  expect(getGridShape(4)).toEqual({ cols: 2, rows: 2 })
  expect(getGridShape(16)).toEqual({ cols: 4, rows: 4 })
})

test('every shape has enough cells for its images', () => {
  for (let n = 1; n <= 24; n++) {
    const { cols, rows } = getGridShape(n)
    expect(cols * rows).toBeGreaterThanOrEqual(n)
  }
})

// The previous version of this test measured aspect with both axes treated as
// unit-length, which is the exact mistake that shipped 3.8:1 cells. Width is a
// fraction of the tile's WIDTH and height a fraction of its HEIGHT, so the two
// have to be brought into one unit before they can be compared.
test('cell aspect is the default banner ratio in real geometry', () => {
  for (let n = 1; n <= 24; n++) {
    const { cols, rows } = getGridShape(n)
    const { width, height } = getGridSize(cols, rows)
    const cellWidth = width / cols                          // tile widths
    const cellHeight = (height / rows) / TILE_ASPECT         // tile widths
    expect(cellWidth / cellHeight).toBeCloseTo(BANNER_ASPECT, 6)
  }
})

test('rotated grid fully covers the tile, leaving no flat bands', () => {
  const theta = (ROTATION * Math.PI) / 180
  const tileHeight = 1 / TILE_ASPECT
  const spanW = Math.cos(theta) + tileHeight * Math.sin(theta)
  const spanH = Math.sin(theta) + tileHeight * Math.cos(theta)
  for (let n = 1; n <= 24; n++) {
    const { cols, rows } = getGridShape(n)
    const { width, height } = getGridSize(cols, rows)
    expect(width).toBeGreaterThanOrEqual(spanW - 1e-9)
    expect(height / TILE_ASPECT).toBeGreaterThanOrEqual(spanH - 1e-9)
  }
})

test('a bigger collection never uses bigger cells', () => {
  let previousArea = Infinity
  for (const n of [1, 4, 9, 16]) {
    const { cols, rows } = getGridShape(n)
    const { width, height } = getGridSize(cols, rows)
    const area = (width / cols) * ((height / rows) / TILE_ASPECT)
    expect(area).toBeLessThanOrEqual(previousArea + 1e-9)
    previousArea = area
  }
})
