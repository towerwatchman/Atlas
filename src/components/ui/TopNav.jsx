import { useState } from 'react'
import { getNavItems, parseIconParts } from './navItems.js'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import ImporterSourceMenu from '../importer/ImporterSourceMenu.jsx'

// Visible text labels (used in 'iconsAndText' and 'text' display modes) /
// tooltip text (always, via title/aria-label regardless of display mode).
// "Import" rather than "Add Game" here specifically, matching the task's
// requested left-to-right order: Library, Browse, Import, Settings,
// Filters — "Add Game" is still used on the footer's separate button.
const LABELS = {
  Library: 'Library',
  Add: 'Import',
  List: 'List',
  Browse: 'Browse',
  Wishlist: 'Wishlist',
  Updates: 'Updates',
  Settings: 'Settings',
  Filters: 'Filters',
  Help: 'Help',
}

// Explicit left-to-right order for each group, independent of the order
// getNavItems() happens to return them in — see App.jsx's task notes:
// left = Library, Browse, Import, Settings, Filters; right = Updates,
// List, Wishlist, Help (icon-only by default, like the help/list/theme
// icon cluster in the reference design's top-right corner — but see
// navDisplayMode for how this can include text too).
const LEFT_ORDER = ['Library', 'Browse', 'Add', 'Settings', 'Filters']
const RIGHT_ORDER = ['Updates', 'List', 'Wishlist', 'Help']

const orderItems = (items, order) =>
  order.map((name) => items.find((item) => item.name === name)).filter(Boolean)

/**
 * Horizontal row of nav buttons for the topnav header layout — split into
 * a left-aligned primary group and a right-aligned secondary group
 * (rendered separately by App.jsx, with a flex spacer between them).
 * Embedded directly inside App.jsx's existing header bar (not a separate
 * fixed-position bar of its own — unlike Sidebar.jsx, which IS its own
 * fixed left rail). Rendered instead of Sidebar when
 * useTheme().layout === 'topnav'.
 *
 * Button presentation (icon-only / icon+text / text-only) follows the
 * active theme's nav.displayMode (see useTheme()/themes.js) rather than
 * being hardcoded — icon-only buttons stay a small fixed square, while
 * the other two modes need horizontal room for the label so they switch
 * to auto-width with padding instead. Pass forceIconsOnly to always render
 * icon-only regardless of the theme's setting — used for the right-hand
 * group in App.jsx, which sits right next to the version text and stays
 * icon-only for now even if the active theme prefers icons+text elsewhere.
 */
const TopNav = ({
  onToggleGameList, onCheckDbUpdates, onGoHome, onBrowseCatalog, onOpenWishlist,
  onToggleSearchSidebar, onOpenHelp, showGameList, libraryMode = 'local', group = 'left',
  forceIconsOnly = false, browseAvailable,
}) => {
  const { navDisplayMode } = useTheme()
  const [selected, setSelected] = useState(null)
  const items = getNavItems({
    onToggleGameList, onCheckDbUpdates, onBrowseCatalog, onOpenWishlist,
    onToggleSearchSidebar, onOpenHelp, browseModeAvailable: browseAvailable,
  })
  const groupItems = orderItems(items, group === 'right' ? RIGHT_ORDER : LEFT_ORDER)
  const effectiveDisplayMode = forceIconsOnly ? 'icons' : navDisplayMode
  const showIcon = effectiveDisplayMode !== 'text'
  const showText = effectiveDisplayMode !== 'icons'

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
    <div className="flex items-center gap-1 h-full -webkit-app-region-no-drag">
      {groupItems.map((item) => {
        const isActive =
          selected === item.name ||
          (item.name === 'Browse' && libraryMode === 'catalog') ||
          (item.name === 'Wishlist' && libraryMode === 'wishlist') ||
          (item.name === 'List' && showGameList)
        const buttonContent = (
          <>
            {showIcon && (
              <svg className="w-[18px] h-[18px] flex-shrink-0" viewBox={item.viewBox || '0 0 24 24'} fill="currentColor">
                {parseIconParts(item, { showGameList }).map((part, index) =>
                  part.tag === 'rect'
                    ? <rect key={index} {...part.props} />
                    : <path key={index} {...part.props} />
                )}
              </svg>
            )}
            {showText && (
              <span className={`text-shadow-fx text-glow-fx nav-labels text-sm font-medium whitespace-nowrap ${isActive ? 'selected' : ''}`}>
                {LABELS[item.name] || item.name}
              </span>
            )}
          </>
        )
        const buttonClassName = `btn-shadow btn-glow flex items-center justify-center gap-1.5 rounded-buttonTheme transition-colors ${
          showText ? 'h-8 px-2.5' : 'w-8 h-8'
        } ${isActive ? 'nav-glow bg-accent text-white active' : 'text-text hover:bg-tertiary'}`
        if (item.name === 'Add') {
          return (
            <ImporterSourceMenu key={item.name} placement="topnav" onSelect={openImporterSource}>
              {({ toggle, buttonProps }) => (
                <button
                  type="button"
                  onClick={toggle}
                  title={LABELS[item.name] || item.name}
                  className={buttonClassName}
                  {...buttonProps}
                >
                  {buttonContent}
                </button>
              )}
            </ImporterSourceMenu>
          )
        }
        return (
          <button
            key={item.name}
            type="button"
            onClick={() => handleClick(item)}
            title={LABELS[item.name] || item.name}
            aria-label={LABELS[item.name] || item.name}
            className={buttonClassName}
          >
            {buttonContent}
          </button>
        )
      })}
    </div>
  )
}

export default TopNav
