import React from 'react'
import useImageFallback from '../../hooks/useImageFallback.js'
import { getGameTitle } from '../../utils/gameDisplay.js'
import BannerLayoutRenderer from './bannerLayout/BannerLayoutRenderer.jsx'
import { useBannerTemplate } from '../../theme/BannerTemplateProvider.jsx'

const GameBanner = ({ game, onSelect, onContextMenu }) => {
  // Resolved once per window by BannerTemplateProvider (see src/theme/
  // BannerTemplateProvider.jsx) instead of once per card — previously every
  // <GameBanner> instance fetched this itself via getSelectedBannerTemplate()
  // (and sometimes getCustomBannerLayout()/getUserBannerLayouts() too) on
  // mount, which meant hundreds of redundant IPC round trips firing at once
  // on a 250-item Browse page.
  const selectedTemplate = useBannerTemplate()

  const bannerChain = game.banner_candidates || (game.banner_url ? [game.banner_url] : [])
  const { src: resolvedBannerUrl } = useImageFallback(bannerChain)
  const resolvedGame =
    resolvedBannerUrl === game.banner_url
      ? game
      : { ...game, banner_url: resolvedBannerUrl }
  const displayTitle = getGameTitle(resolvedGame)

  // The menu itself is built and rendered by App.jsx (see gameContextMenu.js), so
  // the grid and the library tree present exactly the same menu. This used to
  // assemble a native Electron template here, which could not be styled and
  // ignored clicks on any row that had a submenu.
  const handleContextMenu = (event) => {
    event.preventDefault()
    onContextMenu?.(game, event)
  }

  const isCatalogEntry = game.isCatalogEntry === true
  const hasInstalledVersion = isCatalogEntry || game.hasInstalledVersion !== false
  const renderedBanner =
    selectedTemplate.type === 'legacy'
      ? React.createElement(selectedTemplate.value, { game: resolvedGame, onSelect })
      : (
          <BannerLayoutRenderer
            game={resolvedGame}
            layout={selectedTemplate.value}
            onSelect={onSelect}
            onContextMenu={handleContextMenu}
          />
        )

  if (hasInstalledVersion) return renderedBanner

  return (
    <div className="relative" title="Uninstalled">
      {renderedBanner}
      <div className="absolute top-2 left-2 z-40 bg-primary border border-border text-text text-[10px] px-2 py-1 pointer-events-none">
        Uninstalled
      </div>
    </div>
  )
}

export default GameBanner
