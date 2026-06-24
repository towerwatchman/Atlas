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
 *
 * rounded-windowTheme (not a hardcoded rounded-md) so this always matches
 * --radius-window-active — the same variable every window's own root
 * content div is clipped to (see App.jsx, Settings.jsx, etc.). The two
 * must never drift apart: a content corner clipped to a smaller radius
 * than this border draws would leave a square sliver of that content
 * visible just outside the border's curve.
 */
const WindowBorderFrame = () => (
  <div
    className="pointer-events-none fixed inset-0 z-[9999] rounded-windowTheme border border-windowBorder"
    style={{ transform: 'translateZ(0)' }}
    aria-hidden="true"
  />
)

export default WindowBorderFrame
