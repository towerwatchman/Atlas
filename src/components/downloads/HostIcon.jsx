import { memo } from 'react'

// One flat colour for every host mark, matching how the Steam glyph is treated
// elsewhere: a constant that does not shift with the theme. Brand palettes are
// deliberately not used - a red Mega disc beside a blue Pixeldrain ring in a
// list reads as noise rather than information.
const BRAND_COLOR = '#c6d4df'

// ── File host icons ──────────────────────────────────────────────────────────
//
// Bundled rather than fetched. The previous version pulled
// https://{host}/favicon.ico at render time, which cost a request per row,
// showed a broken image whenever the host id was not a real domain, and only
// worked online.
//
// Generated from the supplied SVGs with inline `style` attributes stripped:
// JSX requires an object for `style` and throws on a string, which crashed the
// downloads view. Fills are rewritten to currentColor so the marks take the
// surrounding theme colour instead of carrying a brand palette into a themed
// UI. Geometry is otherwise untouched.

function PixeldrainMark(props) {
  return (
    // fillRule="evenodd" matters here. The mark is concentric rings drawn as
    // nested subpaths; with the default nonzero rule every ring fills solid and
    // the logo renders as a plain disc. Even-odd knocks the inner shapes out so
    // the rings read properly.
    //
    // A fixed fill rather than currentColor, so the logo keeps one constant
    // colour across themes the way the Steam mark does.
    <svg
      viewBox="111 110.5 278 279"
      xmlns="http://www.w3.org/2000/svg"
      fill={BRAND_COLOR}
      fillRule="evenodd"
      clipRule="evenodd"
      {...props}
    >
      <path d="M 250 110.5 C 173 110.5 111 173 111 250.5 C 111 327.5 173.5 389.5 250 389.5 C 327 389.5 389 327 389 250.5 C 389 173.5 326.5 110.5 250 110.5 Z M 250 368.5 C 184.3 368.5 131 315.3 131 249.5 C 131 183.7 184.2 130.5 250 130.5 C 315.7 130.5 369 183.7 369 249.5 C 369 315.2 315.8 368.5 250 368.5 Z M 250 149.5 C 194.9 149.5 150.2 194.2 150.2 249.3 C 150.2 304.4 194.9 349.1 250 349.1 C 305.1 349.1 349.8 304.4 349.8 249.3 C 349.8 194.2 305.1 149.5 250 149.5 Z M 299.3 185.5 C 307.99 185.5 315 192.54 315 201.2 C 315 209.89 307.96 216.9 299.3 216.9 C 290.64 216.9 283.6 209.86 283.6 201.2 C 283.6 192.51 290.64 185.5 299.3 185.5 Z M 250 165.5 C 258.69 165.5 265.7 172.54 265.7 181.2 C 265.7 189.89 258.66 196.9 250 196.9 C 241.34 196.9 234.3 189.86 234.3 181.2 C 234.3 172.51 241.34 165.5 250 165.5 Z M 201.3 185.5 C 209.99 185.5 217 192.54 217 201.2 C 217 209.89 209.96 216.9 201.3 216.9 C 192.64 216.9 185.6 209.86 185.6 201.2 C 185.6 192.51 192.64 185.5 201.3 185.5 Z M 166.3 249.3 C 166.3 240.61 173.34 233.6 182 233.6 C 190.66 233.6 197.7 240.64 197.7 249.3 C 197.7 257.99 190.66 265 182 265 C 173.31 265 166.3 257.96 166.3 249.3 Z M 201.3 314.9 C 192.61 314.9 185.6 307.86 185.6 299.2 C 185.6 290.54 192.64 283.5 201.3 283.5 C 209.96 283.5 217 290.54 217 299.2 C 217 307.86 209.96 314.9 201.3 314.9 Z M 250 335.6 C 241.31 335.6 234.3 328.56 234.3 319.9 C 234.3 311.21 241.34 304.2 250 304.2 C 258.69 304.2 265.7 311.24 265.7 319.9 C 265.7 328.58 258.66 335.6 250 335.6 Z M 250 288.6 C 228.8 288.6 211.5 271.4 211.5 250.1 C 211.5 228.9 228.7 211.6 250 211.6 C 271.2 211.6 288.5 228.8 288.5 250.1 C 288.5 271.3 271.3 288.6 250 288.6 Z M 299.3 314.9 C 290.61 314.9 283.6 307.86 283.6 299.2 C 283.6 290.54 290.64 283.5 299.3 283.5 C 307.96 283.5 315 290.54 315 299.2 C 315 307.86 307.96 314.9 299.3 314.9 Z M 317.9 265 C 309.21 265 302.2 257.96 302.2 249.3 C 302.2 240.61 309.24 233.6 317.9 233.6 C 326.56 233.6 333.6 240.64 333.6 249.3 C 333.6 257.99 326.56 265 317.9 265 Z" transform="matrix(1, 0, 0, 1, 7.105427357601002e-15, 0)"/>
    </svg>
  )
}

function MegaMark(props) {
  return (
    <svg
      viewBox="119.5 239.5 721 721"
      xmlns="http://www.w3.org/2000/svg"
      fill={BRAND_COLOR}
      {...props}
    >
      {/* Disc omitted: the M is knocked out of it in the original, so
          filling both with currentColor would hide the glyph entirely. */}<path d="M267 454h85l128 130 129-130h82v293h-86V577.25L500.334 682h-40.668L355 577.25V747h-88z"/>
    </svg>
  )
}

// Keyed by plugin id AND domain, since a queue row may carry either depending
// on where it came from.
const MARKS = {
  pixeldrain: PixeldrainMark,
  'pixeldrain.com': PixeldrainMark,
  mega: MegaMark,
  'mega.nz': MegaMark,
  'mega.co.nz': MegaMark,
}

/**
 * Icon for a file host, falling back to a neutral glyph for hosts without
 * artwork so an unsupported host still lines up with the others.
 */
const HostIcon = memo(function HostIcon({ host, className = 'w-3.5 h-3.5' }) {
  const key = String(host || '').toLowerCase().replace(/^www\./, '')
  const Mark = MARKS[key] || MARKS[key.split('.')[0]]
  if (!Mark) {
    return <i className={`fas fa-link text-[10px] text-muted ${className}`} aria-hidden="true" />
  }
  return <Mark className={`${className} shrink-0`} aria-hidden="true" focusable="false" />
})

export default HostIcon
export { PixeldrainMark, MegaMark }
