// ── Download link sections ───────────────────────────────────────────────────
//
// A thread's links are not one flat list. F95 posts group them under bold
// headings, and the parser carries that heading through as each link's `group`.
// Presenting them flat means "Season 1", "Old Version" and the current build all
// look like interchangeable mirrors of the same thing — so someone updating a
// game can pick a link that installs an older build over their newer one.
//
// The rule, from how the posts are actually written:
//
//   * A plain "DOWNLOAD" heading carries no group. Those links ARE the current
//     version, so they lead, under a heading that says so.
//   * Any other heading text is its own section, kept verbatim. "Season 1",
//     "Old Version", "Win/Linux", "Patch" — the parser cannot tell a version
//     label from a platform label reliably, and neither can this, so it does not
//     pretend to: the poster's own words are shown and the user decides.
//
// Sections keep the order the links arrived in, which is the order of the post.
// A poster puts the current build first, so arrival order is meaningful and
// sorting alphabetically would destroy it.

export const LATEST_SECTION = 'Latest version'

/**
 * Group links by their section heading.
 *
 * @param {Array} links from update-links-get
 * @returns {Array<{title:string, isLatest:boolean, links:Array}>}
 */
export function groupLinksBySection(links = []) {
  const list = Array.isArray(links) ? links : []
  const order = []
  const byTitle = new Map()

  for (const link of list) {
    if (!link) continue
    const heading = String(link.group || '').trim()
    // No heading means the link sat under a plain "DOWNLOAD", which is the
    // current build.
    const title = heading || LATEST_SECTION
    if (!byTitle.has(title)) {
      byTitle.set(title, { title, isLatest: title === LATEST_SECTION, links: [] })
      order.push(title)
    }
    byTitle.get(title).links.push(link)
  }

  const sections = order.map((title) => byTitle.get(title))
  // The current build leads regardless of where it appeared in the post: it is
  // what someone opening this is looking for, and a thread that lists "Season 1"
  // above its latest download should not bury it.
  sections.sort((a, b) => Number(b.isLatest) - Number(a.isLatest))
  return sections
}

/**
 * Whether grouping is worth showing at all.
 *
 * One section is just the list again with a heading on top, which is noise. The
 * headings only earn their space when there is a choice to make between them.
 *
 * The modal applies this rule inline as `sections.length > 1`; this is exported
 * so any other caller reaches the same conclusion the same way rather than
 * re-deriving it.
 */
export function hasMultipleSections(links = []) {
  return groupLinksBySection(links).length > 1
}

export default groupLinksBySection
