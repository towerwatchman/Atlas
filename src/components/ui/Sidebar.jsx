import { useState } from 'react'
import { getNavItems, parseIconParts } from './navItems.js'

const Sidebar = ({ onToggleGameList, onCheckDbUpdates, onGoHome, onBrowseCatalog, onOpenWishlist, showGameList, libraryMode = 'local' }) => {
  const [selected, setSelected] = useState('Home')
  const items = getNavItems({ onToggleGameList, onCheckDbUpdates, onBrowseCatalog, onOpenWishlist })

  const handleClick = (item) => {
    setSelected(item.name)
    if (item.name === 'Home' && onGoHome) onGoHome()
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
            className="w-full h-[60px] flex items-center justify-center relative cursor-pointer group"
            title={item.name}
            aria-label={item.name}
            onClick={() => handleClick(item)}
          >
            {/* Left accent bar on hover */}
            <div className="absolute left-0 w-[3px] h-full bg-accent transition-opacity opacity-0 group-hover:opacity-100" />

            <svg
              className={`w-6 h-6 ${isActive ? 'text-accent' : 'text-border'}`}
              viewBox={item.viewBox || '0 0 24 24'}
              fill="currentColor"
            >
              {parseIconParts(item, { showGameList }).map((part, index) =>
                part.tag === 'rect'
                  ? <rect key={index} {...part.props} />
                  : <path key={index} {...part.props} />
              )}
            </svg>
          </div>
        )
      })}
    </div>
  )
}

export default Sidebar
