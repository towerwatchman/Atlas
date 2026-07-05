import { useState } from 'react'
import { getNavItems, parseIconParts } from './navItems.js'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import ImporterSourceMenu from '../importer/ImporterSourceMenu.jsx'

const Sidebar = ({
  onToggleGameList, onCheckDbUpdates, onGoHome, onBrowseCatalog, onOpenWishlist,
  onToggleSearchSidebar, onOpenAbout, showGameList, libraryMode = 'local',
  browseAvailable, favoritesActive = false,
}) => {
  const { navDisplayMode } = useTheme()
  const [selected, setSelected] = useState('Library')
  // Filters is a topnav-only shared nav item (see TopNav.jsx) — the left
  // rail already has its own inline SearchBox with a built-in filter
  // toggle, so it's left out here. About IS shown in the rail, pinned to
  // the very bottom so it sits directly below Settings (which getNavItems
  // returns last), per the requested layout.
  const rawItems = getNavItems({
    onToggleGameList, onCheckDbUpdates, onBrowseCatalog, onOpenWishlist,
    onToggleSearchSidebar, onOpenAbout, browseModeAvailable: browseAvailable,
  }).filter((item) => item.name !== 'Filters')
  const aboutItem = rawItems.find((item) => item.name === 'About')
  const items = [
    ...rawItems.filter((item) => item.name !== 'About'),
    aboutItem,
  ].filter(Boolean)
  const showIcon = navDisplayMode !== 'text'
  const showText = navDisplayMode !== 'icons'

  const openImporterSource = (source) => {
    setSelected('Add')
    window.electronAPI.openImporter(source)
  }

  const handleClick = (item) => {
    setSelected(item.name)
    if (item.name === 'Library' && onGoHome) onGoHome()
    if (item.name === 'Settings') window.electronAPI.openSettings()
    if (item.onClick) item.onClick()
  }

  return (
    <div className="w-navSize bg-primary flex flex-col items-center min-w-[60px] py-[1px] fixed top-[70px] bottom-[40px] z-50">
      {items.map((item) => {
        const isActive =
          item.name === 'Favorites'
            ? favoritesActive
            : item.name === 'Library'
              ? (libraryMode === 'local' && !favoritesActive)
              : item.name === 'List'
                ? false
                : (
                    selected === item.name ||
                    (item.name === 'Browse' && libraryMode === 'catalog')
                  )
        const buttonContent = (
          <>
            <div className="absolute left-0 w-[3px] h-full bg-accent transition-opacity opacity-0 group-hover:opacity-100" />

            {showIcon && (
              <svg
                className={`w-5 h-5 flex-shrink-0 nav-icon-fx ${isActive ? 'text-accent selected' : 'text-accentMuted group-hover:text-accentHover'}`}
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
              <span className={`text-shadow-fx text-glow-fx nav-labels text-[10px] leading-none font-medium ${isActive ? 'text-accent selected' : 'text-accentMuted group-hover:text-accentHover'}`}>
                {item.name}
              </span>
            )}
          </>
        )
        const buttonClassName = `btn-shadow btn-glow w-full flex flex-col items-center justify-center gap-1 relative cursor-pointer group ${
          showText ? 'h-[56px] py-1.5' : 'h-[56px]'
        } ${isActive ? 'active' : ''}`
        if (item.name === 'Add') {
          return (
            <ImporterSourceMenu key={item.name} placement="sidebar" onSelect={openImporterSource}>
              {({ toggle, buttonProps }) => (
                <button
                  type="button"
                  className={buttonClassName}
                  title={item.name}
                  data-tour={item.name}
                  {...buttonProps}
                  onClick={toggle}
                >
                  {buttonContent}
                </button>
              )}
            </ImporterSourceMenu>
          )
        }
        return (
          <div
            key={item.name}
            className={buttonClassName}
            title={item.name}
            aria-label={item.name}
            data-tour={item.name}
            onClick={() => handleClick(item)}
          >
            {buttonContent}
          </div>
        )
      })}
    </div>
  )
}

export default Sidebar
