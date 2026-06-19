// Shared nav item definitions for Sidebar.jsx and TopNav.jsx — the two
// layout-specific renderings of the exact same set of navigation actions
// (see LAYOUT_OPTIONS in src/theme/themes.js). Keeping the icon paths and
// click behavior in one place means a future icon tweak or new nav item
// only needs to happen once, instead of being kept in sync across two
// components that render this list in different directions.
//
// onToggleGameList / onCheckDbUpdates / onBrowseCatalog / onOpenWishlist /
// onToggleSearchSidebar / onOpenHelp are passed in by the caller (App.jsx,
// same as before) rather than baked in here, since they close over
// App.jsx's own state.
import { BROWSE_MODE_ENABLED } from '../../features.js'

export function getNavItems({
  onToggleGameList, onCheckDbUpdates, onBrowseCatalog, onOpenWishlist,
  onToggleSearchSidebar, onOpenHelp,
}) {
  return [
    {
      // Was "Home" — renamed to "Library" everywhere (Sidebar's icon rail
      // and TopNav's left-hand group both use this same entry) since it's
      // the button that opens/returns to the game library, not literally a
      // "home" screen. Icon swapped from a house to a books/library glyph
      // to match.
      name: 'Library',
      icon: 'library.svg',
      path: [
        // Three upright books side-by-side (simple "library" glyph: a row
        // of vertical spines of slightly different widths/heights, plus a
        // horizontal shelf/base line underneath).
        '<path d="M3 4C3 3.447715 3.447715 3 4 3H6C6.552285 3 7 3.447715 7 4V19C7 19.552285 6.552285 20 6 20H4C3.447715 20 3 19.552285 3 19V4Z"/>',
        '<path d="M9.5 5C9.5 4.447715 9.947715 4 10.5 4H12.5C13.052285 4 13.5 4.447715 13.5 5V19C13.5 19.552285 13.052285 20 12.5 20H10.5C9.947715 20 9.5 19.552285 9.5 19V5Z"/>',
        '<path d="M16.182 4.115C16.314 3.581 16.854 3.252 17.387 3.385L19.327 3.866C19.860 3.998 20.189 4.538 20.057 5.072L16.318 19.885C16.186 20.419 15.646 20.748 15.113 20.615L13.173 20.134C12.640 20.002 12.311 19.462 12.443 18.928L16.182 4.115Z"/>',
        '<path d="M2 20.5C2 19.947715 2.447715 19.5 3 19.5H21C21.552285 19.5 22 19.947715 22 20.5C22 21.052285 21.552285 21.5 21 21.5H3C2.447715 21.5 2 21.052285 2 20.5Z"/>',
      ],
      viewBox: '0 0 24 22',
    },
    {
      name: 'Add',
      icon: 'add.svg',
      path: [
        '<path d="M11 8C11 7.44772 11.4477 7 12 7C12.5523 7 13 7.44771 13 8V11H16C16.5523 11 17 11.4477 17 12C17 12.5523 16.5523 13 16 13H13V16C13 16.5523 12.5523 17 12 17C11.4477 17 11 16.5523 11 16V13H8C7.44772 13 7 12.5523 7 12C7 11.4477 7.44771 11 8 11H11V8Z"/>',
        '<rect x="1" y="1" width="22" height="22" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>',
      ],
      viewBox: '0 0 24 24',
    },
    {
      name: 'List',
      // No static path here — List's icon depends on showGameList and is
      // handled specially wherever items are rendered (see Sidebar.jsx /
      // TopNav.jsx renderNavIcon).
      viewBox: '0 0 28 28',
      onClick: () => {
        if (onToggleGameList) onToggleGameList()
      },
    },
    BROWSE_MODE_ENABLED ? {
      name: 'Browse',
      path: [
        '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 2c4.42 0 8 3.58 8 8s-3.58 8-8 8-8-3.58-8-8 3.58-8 8-8zm3.94 4.06-2.12 5.66a1 1 0 0 1-.59.59l-5.66 2.12 2.12-5.66a1 1 0 0 1 .59-.59l5.66-2.12zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>',
      ],
      viewBox: '0 0 24 24',
      onClick: () => {
        if (onBrowseCatalog) onBrowseCatalog()
      },
    } : null,
    {
      name: 'Wishlist',
      path: [
        '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
      ],
      viewBox: '0 0 24 24',
      onClick: () => {
        if (onOpenWishlist) onOpenWishlist()
      },
    },
    {
      name: 'Updates',
      icon: 'updates.svg',
      path: [
        '<path d="M5,12A7,7,0,0,1,16.89,7H14a1,1,0,0,0,0,2h5.08A1,1,0,0,0,20,8V3a1,1,0,0,0-2,0V5.32A9,9,0,0,0,3,12a1,1,0,0,0,2,0Z M20,11a1,1,0,0,0-1,1A7,7,0,0,1,7.11,17H10a1,1,0,0,0,0-2H4.92A1,1,0,0,0,4,16v5a1,1,0,0,0,2,0V18.68A9,9,0,0,0,21,12,1,1,0,0,0,20,11Z"/>',
      ],
      viewBox: '0 0 24 24',
      onClick: () => {
        if (onCheckDbUpdates) onCheckDbUpdates()
      },
    },
    {
      // Opens/closes the SearchSidebar (filter panel). Lives as a proper
      // nav item now (rather than only the separate floating SearchButton
      // used in topnav mode) so it can take a fixed position in the
      // Library/Browse/Add/Settings/Filters ordering on the left side of
      // the top bar. TopNav still renders SearchButton too today for the
      // magnifying-glass search field trigger — see TopNav.jsx for how the
      // two relate.
      name: 'Filters',
      path: [
        '<path d="M3 4C3 3.447715 3.447715 3 4 3H20C20.552285 3 21 3.447715 21 4V5.585C21 5.850715 20.894643 6.105357 20.707107 6.292893L14.292893 12.707107C14.105357 12.894643 14 13.149285 14 13.415V18L10 20V13.415C10 13.149285 9.894643 12.894643 9.707107 12.707107L3.292893 6.292893C3.105357 6.105357 3 5.850715 3 5.585V4Z"/>',
      ],
      viewBox: '0 0 24 24',
      onClick: () => {
        if (onToggleSearchSidebar) onToggleSearchSidebar()
      },
    },
    {
      // Stub for now — no help destination wired up yet (no docs site /
      // in-app help content exists today). Keeping this as a real nav item
      // with a no-op-ish default click means the rest of the UI (ordering,
      // icon-only rendering on the right side of TopNav, etc.) is already
      // correct once a real destination (e.g. open Discord/GitHub/docs
      // link) is decided later — only this one onClick will need to change.
      name: 'Help',
      path: [
        '<path d="M12 2C6.477 2 2 6.477 2 12C2 17.523 6.477 22 12 22C17.523 22 22 17.523 22 12C22 6.477 17.523 2 12 2Z M 12 4C16.418 4 20 7.582 20 12C20 16.418 16.418 20 12 20C7.582 20 4 16.418 4 12C4 7.582 7.582 4 12 4Z"/>',
        '<path d="M12 7C10.343 7 9 8.343 9 10C9 10.552 9.447 11 10 11C10.553 11 11 10.552 11 10C11 9.448 11.448 9 12 9C12.552 9 13 9.448 13 10C13 10.395 12.863 10.591 12.469 10.93C12.281 11.090 12.060 11.260 11.832 11.479C11.314 11.973 11 12.611 11 13.5C11 14.052 11.447 14.5 12 14.5C12.553 14.5 13 14.052 13 13.5C13 13.166 13.097 13.018 13.207 12.914C13.36 12.769 13.555 12.622 13.781 12.422C14.227 12.034 15 11.336 15 10C15 8.343 13.657 7 12 7Z"/>',
        '<path d="M12 16C11.448 16 11 16.448 11 17C11 17.552 11.448 18 12 18C12.552 18 13 17.552 13 17C13 16.448 12.552 16 12 16Z"/>',
      ],
      viewBox: '0 0 24 24',
      onClick: () => {
        if (onOpenHelp) onOpenHelp()
      },
    },
    {
      name: 'Settings',
      icon: 'settings.svg',
      path: [
        '<path d="M10.490234 2C10.011234 2 9.6017656 2.3385938 9.5097656 2.8085938L9.1757812 4.5234375C8.3550224 4.8338012 7.5961042 5.2674041 6.9296875 5.8144531L5.2851562 5.2480469C4.8321563 5.0920469 4.33375 5.2793594 4.09375 5.6933594L2.5859375 8.3066406C2.3469375 8.7216406 2.4339219 9.2485 2.7949219 9.5625L4.1132812 10.708984C4.0447181 11.130337 4 11.559284 4 12C4 12.440716 4.0447181 12.869663 4.1132812 13.291016L2.7949219 14.4375C2.4339219 14.7515 2.3469375 15.278359 2.5859375 15.693359L4.09375 18.306641C4.33275 18.721641 4.8321562 18.908906 5.2851562 18.753906L6.9296875 18.1875C7.5958842 18.734206 8.3553934 19.166339 9.1757812 19.476562L9.5097656 21.191406C9.6017656 21.661406 10.011234 22 10.490234 22L13.509766 22C13.988766 22 14.398234 21.661406 14.490234 21.191406L14.824219 19.476562C15.644978 19.166199 16.403896 18.732596 17.070312 18.185547L18.714844 18.751953C19.167844 18.907953 19.66625 18.721641 19.90625 18.306641L21.414062 15.691406C21.653063 15.276406 21.566078 14.7515 21.205078 14.4375L19.886719 13.291016C19.955282 12.869663 20 12.440716 20 12C20 11.559284 19.955282 11.130337 19.886719 10.708984L21.205078 9.5625C21.566078 9.2485 21.653063 8.7216406 21.414062 8.3066406L19.90625 5.6933594C19.66725 5.2783594 19.167844 5.0910937 18.714844 5.2460938L17.070312 5.8125C16.404116 5.2657937 15.644607 4.8336609 14.824219 4.5234375L14.490234 2.8085938C14.398234 2.3385937 13.988766 2 13.509766 2L10.490234 2 z M 12 8C14.209 8 16 9.791 16 12C16 14.209 14.209 16 12 16C9.791 16 8 14.209 8 12C8 9.791 9.791 8 12 8 z"/>',
      ],
      viewBox: '0 0 24 22',
    },
  ].filter(Boolean)
}

// Parses the raw path/rect strings above into actual SVG element specs.
// Shared so both Sidebar and TopNav render icons identically. Returns an
// array of { tag: 'path' | 'rect', props: {...} } for the caller to map
// into real JSX elements (kept tag-agnostic here so this module stays
// plain JS with no JSX/React dependency).
export function parseIconParts(item, { showGameList }) {
  if (item.name === 'List') {
    return [{
      tag: 'path',
      props: {
        fill: 'currentColor',
        d: showGameList
          // List is visible -> show list icon
          ? 'M6 5C4.894531 5 4 5.894531 4 7C4 8.105469 4.894531 9 6 9C7.105469 9 8 8.105469 8 7C8 5.894531 7.105469 5 6 5 Z M 11 6L11 8L28 8L28 6 Z M 6 14C4.894531 14 4 14.894531 4 16C4 17.105469 4.894531 18 6 18C7.105469 18 8 17.105469 8 16C8 14.894531 7.105469 14 6 14 Z M 11 15L11 17L28 17L28 15 Z M 6 23C4.894531 23 4 23.894531 4 25C4 26.105469 4.894531 27 6 27C7.105469 27 8 26.105469 8 25C8 23.894531 7.105469 23 6 23 Z M 11 24L11 26L28 26L28 24Z'
          // List is hidden -> show grid icon
          : 'M5 5h6v6H5zM13 5h6v6h-6zM21 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6zM21 13h6v6h-6zM5 21h6v6H5zM13 21h6v6h-6zM21 21h6v6h-6z',
      },
    }]
  }

  return (item.path || []).map((pathStr, index) => {
    if (item.name === 'Add' && index === 1) {
      const rectMatch = pathStr.match(
        /<rect\s+x="([^"]*)"\s+y="([^"]*)"\s+width="([^"]*)"\s+height="([^"]*)"\s+rx="([^"]*)"\s+ry="([^"]*)"\s+fill="([^"]*)"\s+stroke="([^"]*)"\s+stroke-width="([^"]*)"/,
      )
      if (rectMatch) {
        return {
          tag: 'rect',
          props: {
            x: rectMatch[1], y: rectMatch[2], width: rectMatch[3], height: rectMatch[4],
            rx: rectMatch[5], ry: rectMatch[6], fill: rectMatch[7], stroke: rectMatch[8],
            strokeWidth: rectMatch[9],
          },
        }
      }
      return null
    }

    const dMatch = pathStr.match(/d="([^"]*)"/)
    if (dMatch) {
      return { tag: 'path', props: { fill: 'currentColor', d: dMatch[1] } }
    }
    return null
  }).filter(Boolean)
}
