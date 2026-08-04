// ── Download build options ───────────────────────────────────────────────────
//
// A thread's links are not one flat list, and they are not a list of mirrors
// either. F95 posters stack BUILDS under bold headings and then list the mirrors
// for each build beneath it:
//
//   Season 2 Final / 4K / Win-Linux-Mac    → MEGA, Pixeldrain
//   Season 1 / 1080p / Win-Linux           → MEGA
//   Chloe's: Desire Express DLC            → MEGA
//
// So the choice the user is making is WHICH BUILD, and only then which mirror of
// it. Presenting one flat list made "Season 1", "Old Version" and the current
// build look interchangeable, so someone updating a game could install an older
// build over a newer one.
//
// This module used to hedge: "the parser cannot tell a version label from a
// platform label reliably, and neither can this, so it does not pretend to". The
// parser can now, because headingLines.js splits the bold on <br> and gives the
// build label and the platform separate fields. Platform is a FILTER (and a
// badge), not part of the option's name - which is why two DLCs that both said
// "Win/Linux/Mac" no longer collapse into a single option called Win/Linux/Mac.
//
// Options keep the order the links arrived in, which is the order of the post. A
// poster puts the current build first, so arrival order is meaningful and sorting
// alphabetically would destroy it.

// What to call the links a poster listed under a plain "DOWNLOAD" with no build
// heading of their own. Named HERE and nowhere else: the parser deliberately
// emits an empty group for that case rather than a label, so that the display
// name exists in exactly one place and the two cannot drift apart. That is the
// same failure the catalog identity module was built to prevent.
export const FULL_ARCHIVE = 'Full Archive'

/**
 * Group links into the builds the poster offered.
 *
 * @param {Array} links from update-links-get, already filtered to supported hosts
 * @returns {Array<{title:string, isUnlabeled:boolean, platforms:string[], links:Array}>}
 */
export function buildDownloadOptions(links = []) {
  const list = Array.isArray(links) ? links : []
  const order = []
  const byTitle = new Map()

  for (const link of list) {
    if (!link) continue
    const heading = String(link.group || '').trim()
    // No heading means the link sat under a plain "DOWNLOAD" with nothing
    // further said about it: the whole game, current build.
    const title = heading || FULL_ARCHIVE
    if (!byTitle.has(title)) {
      byTitle.set(title, {
        title,
        isUnlabeled: !heading,
        platforms: [],
        links: [],
      })
      order.push(title)
    }
    const option = byTitle.get(title)
    option.links.push(link)
    // Distinct platform strings, raw as the poster wrote them. Shown as a badge
    // rather than folded into the title, because the same build is routinely
    // posted for several platforms and each is a separate mirror, not a
    // separate build.
    const platform = String(link.platform || '').trim()
    if (platform && !option.platforms.includes(platform)) {
      option.platforms.push(platform)
    }
  }

  // Built from links, so an option can never be empty - an option whose every
  // mirror was on an unsupported host simply never appears, which is the
  // "skipped entirely" rule. Asserted in the tests so it stays true if this ever
  // starts from headings instead.
  const options = order.map((title) => byTitle.get(title))
  // The unlabeled block leads regardless of where it appeared in the post: it is
  // what someone opening this is looking for, and a thread that lists "Season 1"
  // above its plain DOWNLOAD should not bury it.
  options.sort((a, b) => Number(b.isUnlabeled) - Number(a.isUnlabeled))
  return options
}

/**
 * Whether the build headings are worth showing at all.
 *
 * One option is just the mirror list again with a label on top, which is noise.
 * The headings only earn their space when there is a build to choose between.
 */
export function hasMultipleOptions(links = []) {
  return buildDownloadOptions(links).length > 1
}

export default buildDownloadOptions
