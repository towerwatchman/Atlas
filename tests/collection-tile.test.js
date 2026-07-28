import { test, expect } from 'vitest'
import { getGridShape, getGridSize, MAX_ART } from '../src/components/collections/CollectionTile.jsx'

const BANNER_ASPECT = 537 / 251
const TILE_ASPECT = 16 / 9
const ROTATION = 60
const BASE_CELL_WIDTH = 0.45

const counts = Array.from({ length: MAX_ART }, (_, i) => i + 1)

test('art is capped at 8, which caps the grid at 2x4', () => {
  expect(MAX_ART).toBe(8)
  expect(getGridShape(MAX_ART)).toEqual({ cols: 2, rows: 4 })
})

test('grid shape is as square as possible, biased to portrait', () => {
  expect(getGridShape(1)).toEqual({ cols: 1, rows: 1 })
  expect(getGridShape(4)).toEqual({ cols: 2, rows: 2 })
  expect(getGridShape(6)).toEqual({ cols: 2, rows: 3 })
  expect(getGridShape(7)).toEqual({ cols: 2, rows: 4 })
})

test('every shape has enough cells for its images', () => {
  for (const n of counts) {
    const { cols, rows } = getGridShape(n)
    expect(cols * rows).toBeGreaterThanOrEqual(n)
  }
})

// Width is a fraction of the tile's WIDTH and height a fraction of its HEIGHT,
// so both must be brought into one unit before they can be compared. Measuring
// them as if they shared a base is what once shipped 3.8:1 cells.
test('cell aspect is the default banner ratio in real geometry', () => {
  for (const n of counts) {
    const { cols, rows } = getGridShape(n)
    const { width, height } = getGridSize(cols, rows)
    const cellWidth = width / cols
    const cellHeight = (height / rows) / TILE_ASPECT
    expect(cellWidth / cellHeight).toBeCloseTo(BANNER_ASPECT, 6)
  }
})

test('cells are zoomed 40% over base, or 50% for a lone image', () => {
  const cellWidthFor = (n) => {
    const { cols, rows } = getGridShape(n)
    return getGridSize(cols, rows).width / cols
  }
  expect(cellWidthFor(1)).toBeCloseTo(BASE_CELL_WIDTH * 1.5, 6)
  for (const n of [2, 3, 4, 5, 6]) {
    expect(cellWidthFor(n)).toBeCloseTo(BASE_CELL_WIDTH * 1.4, 6)
  }
  // 7 and 8 reach full coverage before the zoom ceiling, so they stop there
  // rather than pushing art off the tile for nothing.
  for (const n of [7, 8]) {
    expect(cellWidthFor(n)).toBeLessThan(BASE_CELL_WIDTH * 1.4)
  }
})

test('the grid never overshoots what coverage requires', () => {
  const theta = (ROTATION * Math.PI) / 180
  const tileHeight = 1 / TILE_ASPECT
  const spanW = Math.cos(theta) + tileHeight * Math.sin(theta)
  const spanH = Math.sin(theta) + tileHeight * Math.cos(theta)
  for (const n of counts) {
    const { cols, rows } = getGridShape(n)
    const { width, height } = getGridSize(cols, rows)
    const overshootsBoth = width > spanW + 1e-9 && height / TILE_ASPECT > spanH + 1e-9
    expect(overshootsBoth).toBe(false)
  }
})

test('a full grid covers the tile completely', () => {
  const theta = (ROTATION * Math.PI) / 180
  const tileHeight = 1 / TILE_ASPECT
  const spanW = Math.cos(theta) + tileHeight * Math.sin(theta)
  const spanH = Math.sin(theta) + tileHeight * Math.cos(theta)
  const { cols, rows } = getGridShape(MAX_ART)
  const { width, height } = getGridSize(cols, rows)
  expect(width).toBeGreaterThanOrEqual(spanW - 1e-9)
  expect(height / TILE_ASPECT).toBeGreaterThanOrEqual(spanH - 1e-9)
})
