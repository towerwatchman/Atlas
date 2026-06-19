import React, { useState, useEffect, useCallback } from 'react'
import useImageFallback from '../../hooks/useImageFallback.js'
import { getGameTitle } from '../../utils/gameDisplay.js'
import BannerLayoutRenderer from './bannerLayout/BannerLayoutRenderer.jsx'
import { defaultBannerLayouts } from './bannerLayout/defaultBannerLayouts.js'
import {
  CLASSIC_BANNER_LAYOUT_ID,
  CUSTOM_BANNER_LAYOUT_ID,
  getBannerLayoutById,
  normalizeBannerLayout,
  normalizeBannerPreset,
  normalizeBannerLayoutId,
} from './bannerLayout/bannerLayoutSchema.js'

const builtInLayoutIds = new Set(defaultBannerLayouts.map((layout) => layout.id))

const GameBanner = ({ game, onSelect }) => {
  const [selectedTemplate, setSelectedTemplate] = useState({
    type: 'layout',
    value: getBannerLayoutById(defaultBannerLayouts, CLASSIC_BANNER_LAYOUT_ID),
  })

  const bannerChain = game.banner_candidates || (game.banner_url ? [game.banner_url] : [])
  const { src: resolvedBannerUrl } = useImageFallback(bannerChain)
  const resolvedGame =
    resolvedBannerUrl === game.banner_url
      ? game
      : { ...game, banner_url: resolvedBannerUrl }
  const displayTitle = getGameTitle(resolvedGame)

  const loadSelectedTemplate = useCallback(async () => {
    try {
      const selected = await window.electronAPI.getSelectedBannerTemplate()
      const normalized = normalizeBannerLayoutId(selected)

      if (normalized === CUSTOM_BANNER_LAYOUT_ID) {
        const customLayout = await window.electronAPI.getCustomBannerLayout?.()
        const classicLayout = getBannerLayoutById(defaultBannerLayouts, CLASSIC_BANNER_LAYOUT_ID)
        const normalizedLayout = normalizeBannerLayout(customLayout, classicLayout)
        setSelectedTemplate({
          type: 'layout',
          value: normalizedLayout || classicLayout,
        })
        return
      }

      if (builtInLayoutIds.has(normalized)) {
        setSelectedTemplate({
          type: 'layout',
          value: getBannerLayoutById(defaultBannerLayouts, normalized),
        })
        return
      }

      const userPresets = await window.electronAPI.getUserBannerLayouts?.()
      const selectedUserPreset = (Array.isArray(userPresets) ? userPresets : [])
        .find((preset) => preset?.id === normalized)
      if (selectedUserPreset) {
        const classicLayout = getBannerLayoutById(defaultBannerLayouts, CLASSIC_BANNER_LAYOUT_ID)
        const normalizedPreset = normalizeBannerPreset(selectedUserPreset, classicLayout)
        setSelectedTemplate({
          type: 'layout',
          value: normalizedPreset?.layout || classicLayout,
        })
        return
      }

      try {
        const templates = import.meta.glob('../../assets/templates/banner/*.js', {
          eager: false,
        })
        const key = `../../assets/templates/banner/${selected}.js`
        if (templates[key]) {
          const templateModule = await templates[key]()
          setSelectedTemplate({ type: 'legacy', value: templateModule.default })
        } else {
          console.warn(`Template not found: ${selected}`)
          setSelectedTemplate({
            type: 'layout',
            value: getBannerLayoutById(defaultBannerLayouts, CLASSIC_BANNER_LAYOUT_ID),
          })
        }
      } catch (importErr) {
        console.error(`Failed to import template ${selected}:`, importErr)
        window.electronAPI.log(
          `Failed to import template ${selected}: ${importErr.message}`,
        )
        setSelectedTemplate({
          type: 'layout',
          value: getBannerLayoutById(defaultBannerLayouts, CLASSIC_BANNER_LAYOUT_ID),
        })
      }
    } catch (err) {
      console.error('Error loading banner template:', err)
      window.electronAPI.log(`Error loading banner template: ${err.message}`)
      setSelectedTemplate({
        type: 'layout',
        value: getBannerLayoutById(defaultBannerLayouts, CLASSIC_BANNER_LAYOUT_ID),
      })
    }
  }, [])

  useEffect(() => {
    console.log(
      `GameBanner rendering for recordId: ${game.record_id}, banner_url: ${game.banner_url}`,
    )

    loadSelectedTemplate()
  }, [game.banner_url, game.record_id, loadSelectedTemplate])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) loadSelectedTemplate()
    }

    window.addEventListener('focus', loadSelectedTemplate)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', loadSelectedTemplate)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadSelectedTemplate])

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
