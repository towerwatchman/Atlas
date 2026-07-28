// Keeps recently shown library banners decoded in memory.
//
// Leaving Browse and returning to the library replaces every grid cell, so the
// <img> elements are torn down and rebuilt. Even with the file cached on disk,
// the browser has to re-decode, and that decode is what shows as a flash.
//
// Holding a reference to an Image object for a URL keeps the decoded bitmap
// alive, so the rebuilt <img> paints from memory on the first frame instead.
//
// LIBRARY ONLY, and capped. Retaining art for a 6k-title library would be
// hundreds of MB of decoded bitmaps; Browse is worse still because scrolling it
// walks the entire catalog. The cap keeps roughly a screenful plus a margin,
// which is all that has to survive a mode switch, and evicts least-recently-used
// beyond that.
const MAX_RETAINED = 250

// Map preserves insertion order, which gives LRU for free: re-retaining moves an
// entry to the end, and eviction takes from the front.
const retained = new Map()

/** Retain one image URL. Safe to call on every render; repeats are cheap. */
export function retainImage(url) {
  if (!url) return
  if (retained.has(url)) {
    // Touch it so it moves to the most-recent end.
    const existing = retained.get(url)
    retained.delete(url)
    retained.set(url, existing)
    return
  }
  const image = new Image()
  // Decode off the main thread where supported, so retaining never janks a
  // scroll. Failures are ignored: a missing banner is handled by SafeImage.
  image.decoding = 'async'
  image.src = url
  retained.set(url, image)

  while (retained.size > MAX_RETAINED) {
    const oldest = retained.keys().next().value
    const evicted = retained.get(oldest)
    retained.delete(oldest)
    // Dropping src lets the decoded bitmap go even if something else still
    // holds the element.
    if (evicted) evicted.src = ''
  }
}

/** Retain several at once, e.g. the rows a grid is about to show. */
export function retainImages(urls = []) {
  for (const url of urls) retainImage(url)
}

/** Test/diagnostic hooks. */
export function retainedCount() {
  return retained.size
}

export function clearRetained() {
  for (const image of retained.values()) image.src = ''
  retained.clear()
}

export const RETENTION_LIMIT = MAX_RETAINED
