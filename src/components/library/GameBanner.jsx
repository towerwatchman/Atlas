import React from 'react'
import useImageFallback from '../../hooks/useImageFallback.js'
import { getGameTitle } from '../../utils/gameDisplay.js'
import BannerLayoutRenderer from './bannerLayout/BannerLayoutRenderer.jsx'
import { useBannerTemplate } from '../../theme/BannerTemplateProvider.jsx'

const GameBanner = ({ game, onSelect }) => {
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

  const handleContextMenu = (event) => {
    event.preventDefault()
    if (!game) {
      console.log('No game available for context menu')
      return
    }

    const installedVersions = (game.versions || []).filter(
      (version) => version.isInstalled !== false,
    )
    const isMetadataOnly = game.isMetadataOnly === true
    const template = []

    if (installedVersions.length === 1) {
      const version = installedVersions[0]
      template.push({
        label: 'Play',
        data: { action: 'launch', recordId: game.record_id, version: version.version },
      })
    } else if (installedVersions.length > 1) {
      template.push({
        label: 'Play',
        submenu: installedVersions.map((version) => ({
          label: version.version,
          data: { action: 'launch', recordId: game.record_id, version: version.version },
        })),
      })
    }

    if (installedVersions.length === 1) {
      const version = installedVersions[0]
      template.push({
        label: 'Open Game Folder',
        data: { action: 'openFolder', recordId: game.record_id, version: version.version },
      })
    } else if (installedVersions.length > 1) {
      template.push({
        label: 'Open Game Folder',
        submenu: installedVersions.map((version) => ({
          label: version.version,
          data: { action: 'openFolder', recordId: game.record_id, version: version.version },
        })),
      })
    }

    if (game.siteUrl) {
      template.push({
        label: 'Open Web Link',
        data: { action: 'openUrl', url: game.siteUrl },
      })
    }

    if (!isMetadataOnly) {
      template.push({
        label: game.isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
        data: {
          action: 'setFavorite',
          recordId: game.record_id,
          isFavorite: !game.isFavorite,
        },
      })

      template.push({
        label: 'Properties',
        data: { action: 'properties', recordId: game.record_id },
      })

      template.push({ type: 'separator' })

      template.push({
        label: 'Remove Title from Library',
        data: {
          action: 'removeTitleFromLibrary',
          recordId: game.record_id,
          title: displayTitle,
        },
      })

      template.push({
        label: 'Delete Title and Files',
        data: {
          action: 'deleteTitleAndFiles',
          recordId: game.record_id,
          title: displayTitle,
        },
      })
    }

    console.log('Context menu template:', JSON.stringify(template, null, 2))
    window.electronAPI.showContextMenu(template)
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
    <div className="relative grayscale opacity-60" title="Uninstalled">
      {renderedBanner}
      <div className="absolute top-2 left-2 z-40 bg-primary border border-border text-text text-[10px] px-2 py-1 pointer-events-none">
        Uninstalled
      </div>
    </div>
  )
}

export default GameBanner
