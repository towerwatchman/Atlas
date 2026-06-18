import { useState } from 'react'
import { getNavItems, parseIconParts } from './navItems.js'
import { useTheme } from '../../theme/ThemeProvider.jsx'

const Sidebar = ({
  onToggleGameList, onCheckDbUpdates, onGoHome, onBrowseCatalog, onOpenWishlist,
  onToggleSearchSidebar, onOpenHelp, showGameList, libraryMode = 'local',
}) => {
  const { navDisplayMode } = useTheme()
  const [selected, setSelected] = useState('Library')
  // Filters and Help are new shared nav items added for the topnav layout's
  // right-hand icon group (see TopNav.jsx). The left rail already has its
  // own inline SearchBox with a built-in filter toggle and has no Help
  // destination yet, so those two are left out here rather than adding two
  // unrequested icons to the existing vertical icon list.
  const items = getNavItems({
    onToggleGameList, onCheckDbUpdates, onBrowseCatalog, onOpenWishlist,
    onToggleSearchSidebar, onOpenHelp,
  }).filter((item) => item.name !== 'Filters' && item.name !== 'Help')
  const showIcon = navDisplayMode !== 'text'
  const showText = navDisplayMode !== 'icons'

  const handleClick = (item) => {
    setSelected(item.name)
    if (item.name === 'Library' && onGoHome) onGoHome()
    if (item.name === 'Settings') window.electronAPI.openSettings()
    if (item.name === 'Add') window.electronAPI.openImporter()
    if (item.onClick) item.onClick()
  }

  return (
    <div className="w-navSize bg-primary flex flex-col items-center min-w-[60px] py-[1px] fixed h-full z-50">
      {items.map((item) => {
        const isActive =
          selected === item.name ||
          (item.name === 'Browse' && libraryMode === 'catalog') ||
          (item.name === 'Wishlist' && libraryMode === 'wishlist')
        return (
          <div
            key={item.name}
            className={`btn-shadow btn-glow w-full flex flex-col items-center justify-center gap-1 relative cursor-pointer group ${
              showText ? 'h-[56px] py-1.5' : 'h-[56px]'
            } ${isActive ? 'active' : ''}`}
            title={item.name}
            aria-label={item.name}
            onClick={() => handleClick(item)}
          >
            {/* Left accent bar on hover */}
            <div className="absolute left-0 w-[3px] h-full bg-accent transition-opacity opacity-0 group-hover:opacity-100" />

            {showIcon && (
              <svg
                className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-accent' : 'text-border'}`}
                viewBox={item.viewBox || '0 0 24 24'}
                fill="currentColor"
              >
                {parseIconParts(item, { showGameList }).map((part, index) =>
                  part.tag === 'rect'
                    ? <rect key={index} {...part.props} />
                    : <path key={index} {...part.props} />
                )}
              </svg>
            )}
            {showText && (
              <span className={`text-shadow-fx text-glow-fx nav-labels text-[10px] leading-none font-medium ${isActive ? 'text-accent selected' : 'text-border'}`}>
                {item.name}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default Sidebar
