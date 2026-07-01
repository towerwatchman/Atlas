// Converts a media source into something the renderer can actually load.
//
// Remote/stream URLs (http/https/data/blob) and already-converted
// atlas-media:// URLs are returned unchanged. Local filesystem paths (the
// absolute paths returned for downloaded art, e.g. "C:/…/data/images/…"
// or "/home/…/data/images/…") are rewritten to the atlas-media:// scheme so
// they load in both the dev server (http origin) and packaged (file origin)
// renderers, where raw file:// URLs are blocked.
const WEB_SCHEME = /^(https?|data|blob|atlas-media):/i

export function toMediaSrc(src) {
  if (!src || typeof src !== 'string') return src
  const value = src.trim()
  if (!value) return value
  if (WEB_SCHEME.test(value)) return value
  // Anything else is treated as a local filesystem path (including Windows
  // drive paths like C:\… / C:/…, which look like a "c:" scheme but aren't).
  const normalized = value.replace(/\\/g, '/')
  return `atlas-media://local/${encodeURIComponent(normalized)}`
}
