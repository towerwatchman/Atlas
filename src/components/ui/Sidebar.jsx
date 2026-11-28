import { startTransition, useState } from 'react'
import { getNavItems, parseIconParts, navItemIsActive } from './navItems.js'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import ImporterSourceMenu from '../importer/ImporterSourceMenu.jsx'

// Only view-switching destinations keep the accent bar after the pointer leaves.
const VIEW_TABS = ['Library', 'Browse', 'Favorites', 'Collections', 'Downloads']

const Sidebar = ({
  onToggleGameList, onCheckDbUpdates, onGoHome, onBrowseCatalog, onOpenWishlist,
  onToggleSearchSidebar, onOpenAbout, onOpenCollections, showGameList, libraryMode = 'local',
  browseAvailable, favoritesActive = false, collectionsActive = false,
  onOpenDownloads, downloadsActive = false,
}) => {
  const { navDisplayMode } = useTheme()
  const [selected, setSelected] = useState('Library')
  const [hoveredItem, setHoveredItem] = useState(null)
  // Filters is a topnav-only shared nav item (see TopNav.jsx) — the left
  // rail already has its own inline SearchBox with a built-in filter
  // toggle, so it's left out here. About is NOT shown in the rail: it's
  // pinned to the header's top-right corner in both layouts (see App.jsx),
  // so the About button always lives in the same place regardless of
  // whether the nav is a top bar or this left rail.
  const items = getNavItems({
    onToggleGameList, onCheckDbUpdates, onBrowseCatalog, onOpenWishlist,
    onToggleSearchSidebar, onOpenAbout, onOpenCollections, onOpenDownloads,
    browseModeAvailable: browseAvailable,
  }).filter((item) => item.name !== 'Filters' && item.name !== 'About')
  // Destinations stay together at the top; the List toggle and utilities sit below a gap.
  const mainItems = items.filter((item) => item.group === 'main')
  const listItem = items.find((item) => item.name === 'List')
  const utilityItems = items.filter((item) => item.group === 'utility')
  const railItems = [
    ...mainItems,
    { name: 'Spacer', spacer: true },
    ...(listItem ? [listItem] : []),
    ...utilityItems,
  ]
  const showIcon = navDisplayMode !== 'text'
  const showText = navDisplayMode !== 'icons'

  const openImporterSource = (source) => {
    setSelected('Add')
    window.electronAPI.openImporter(source)
  }

  const handleClick = (item) => {
    setSelected(item.name)
    // Defer the view swap so the rail can repaint its highlight before the
    // heavier library rerender commits.
    startTransition(() => {
      if (item.name === 'Library' && onGoHome) onGoHome()
      if (item.name === 'Settings') window.electronAPI.openSettings()
      if (item.onClick) item.onClick()
    })
  }

  return (
    <div className="w-navSize bg-primary flex flex-col items-center min-w-[60px] py-[1px] fixed top-[70px] bottom-[40px] z-50">
      {railItems.map((item) => {
        if (item.spacer) return <div key="spacer" className="flex-1" />
        const isActive = navItemIsActive(item.name, { libraryMode, favoritesActive, collectionsActive, downloadsActive, selected })
        const isViewTab = VIEW_TABS.includes(item.name)
        const buttonContent = (
          <>
            <div className={`absolute left-0 w-[3px] h-full bg-accent transition-opacity ${hoveredItem === item.name || (isActive && isViewTab && (hoveredItem === null || !VIEW_TABS.includes(hoveredItem))) ? 'opacity-100' : 'opacity-0'}`} />

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
                  onMouseEnter={() => setHoveredItem(item.name)}
                  onMouseLeave={() => setHoveredItem(null)}
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
            onMouseEnter={() => setHoveredItem(item.name)}
            onMouseLeave={() => setHoveredItem(null)}
          >
            {buttonContent}
          </div>
        )
      })}
    </div>
  )
}

export default Sidebar
