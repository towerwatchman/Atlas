/**
 * Draws the theme's window border (see windowBorderEnabled / colors.windowBorder
 * in src/theme/themes.js) as a fixed overlay above everything else in the
 * window, rather than as a regular CSS `border` on some content div.
 *
 * Why an overlay and not just `border border-windowBorder` on the window's
 * root element: several windows have a full-width `position: fixed` header
 * and/or footer bar (e.g. App.jsx's top header, bottom status bar), and
 * scrollable content can render its native scrollbar flush against the
 * window's right edge. Both of those paint *on top of* a regular border
 * drawn on an ancestor — the border is still there in the DOM, it's just
 * visually covered along most of its length, which is exactly the "only
 * shows on the left side" symptom this fixes. A `position: fixed`,
 * `pointer-events-none`, very-high-z-index overlay with nothing in it but
 * a border can't be covered by anything else in the window, since nothing
 * else renders above it.
 *
 * Render this once, anywhere, in each window's root component (it doesn't
 * matter where in the tree — it's fixed to the viewport regardless).
 */
const WindowBorderFrame = () => (
  <div
    className="pointer-events-none fixed inset-0 z-[9999] rounded-md border border-windowBorder"
    aria-hidden="true"
  />
)

export default WindowBorderFrame
