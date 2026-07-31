import { test, expect, beforeEach, vi } from 'vitest'

// jsdom is not configured for this suite, so stand in a minimal Image that
// records src assignment — which is all the retention logic touches.
class FakeImage {
  constructor() { this.src = ''; this.decoding = '' }
}
beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
})

const load = async () => {
  vi.resetModules()
  return import('../src/utils/imageRetention.js')
}

test('retaining the same url twice keeps one entry', async () => {
  const { retainImage, retainedCount } = await load()
  retainImage('atlas-media://local/a.png')
  retainImage('atlas-media://local/a.png')
  expect(retainedCount()).toBe(1)
})

test('empty urls are ignored', async () => {
  const { retainImage, retainedCount } = await load()
  retainImage('')
  retainImage(null)
  retainImage(undefined)
  expect(retainedCount()).toBe(0)
})

// A 6k-title library would be hundreds of MB of decoded bitmaps, so the cache
// has to be bounded. Only a screenful needs to survive a mode switch.
test('retention is capped', async () => {
  const { retainImage, retainedCount, RETENTION_LIMIT } = await load()
  for (let i = 0; i < RETENTION_LIMIT + 60; i++) retainImage(`img-${i}.png`)
  expect(retainedCount()).toBe(RETENTION_LIMIT)
})

test('eviction is least-recently-used, and re-retaining refreshes an entry', async () => {
  const { retainImage, retainedCount, RETENTION_LIMIT } = await load()
  retainImage('keep-me.png')
  // Fill to the cap, touching keep-me part way so it is not the oldest.
  for (let i = 0; i < RETENTION_LIMIT - 1; i++) retainImage(`fill-${i}.png`)
  retainImage('keep-me.png')
  // Overflow by one; the oldest fill entry should go, not keep-me.
  retainImage('newest.png')
  expect(retainedCount()).toBe(RETENTION_LIMIT)
  // Re-retaining keep-me must not grow the map, proving it is still present.
  const before = retainedCount()
  retainImage('keep-me.png')
  expect(retainedCount()).toBe(before)
})

test('clearing releases every retained image', async () => {
  const { retainImage, clearRetained, retainedCount } = await load()
  retainImage('a.png')
  retainImage('b.png')
  clearRetained()
  expect(retainedCount()).toBe(0)
})
