import { useState } from 'react'
import { getNavItems } from './navItems.js'

// Text-only labels for the top-bar buttons — per the reference design,
// this layout shows plain words, not icons (unlike Sidebar.jsx, which is
// icon-only). "Add Game" matches the wording already used on the
// existing footer "Add Game" button elsewhere in the app, rather than
// introducing a second, shorter label for the same action.
const LABELS = {
  Add: 'Add Game',
  List: 'List',
  Browse: 'Browse',
  Wishlist: 'Wishlist',
  Updates: 'Updates',
  Settings: 'Settings',
}

/**
 * Horizontal row of text-only nav buttons, styled after the reference
 * design's tab bar: the active tab gets a filled accent-colored pill
 * background, inactive tabs are plain text with a hover highlight. Meant
 * to be embedded directly inside App.jsx's existing header bar (not a
 * separate fixed-position bar of its own — unlike Sidebar.jsx, which IS
 * its own fixed left rail). Rendered instead of Sidebar when
 * useTheme().layout === 'topnav'. "Home" is intentionally omitted: in
 * topnav mode the existing Games/Browse label in the header already does
 * that job (see App.jsx), so a second "go home" button would be
 * redundant.
 */
const TopNav = ({ onToggleGameList, onCheckDbUpdates, onGoHome, onBrowseCatalog, onOpenWishlist, showGameList, libraryMode = 'local' }) => {
  const [selected, setSelected] = useState(null)
  const items = getNavItems({ onToggleGameList, onCheckDbUpdates, onBrowseCatalog, onOpenWishlist })
    .filter((item) => item.name !== 'Home')

  const handleClick = (item) => {
    setSelected(item.name)
    if (item.name === 'Settings') window.electronAPI.openSettings()
    if (item.name === 'Add') window.electronAPI.openImporter()
    if (item.onClick) item.onClick()
  }

  return (
    <div className="flex items-center gap-1 h-full -webkit-app-region-no-drag">
      {items.map((item) => {
        const isActive =
          selected === item.name ||
          (item.name === 'Browse' && libraryMode === 'catalog') ||
          (item.name === 'Wishlist' && libraryMode === 'wishlist') ||
          (item.name === 'List' && showGameList)
        return (
          <button
            key={item.name}
            type="button"
            onClick={() => handleClick(item)}
            className={`px-3 py-1.5 rounded-theme text-sm font-medium transition-colors ${
              isActive ? 'bg-accent text-white' : 'text-text hover:bg-tertiary'
            }`}
          >
            {LABELS[item.name] || item.name}
          </button>
        )
      })}
    </div>
  )
}

export default TopNav
