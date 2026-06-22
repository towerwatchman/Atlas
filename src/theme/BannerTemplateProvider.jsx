import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  CLASSIC_BANNER_LAYOUT_ID,
  CUSTOM_BANNER_LAYOUT_ID,
  getBannerLayoutById,
  normalizeBannerLayout,
  normalizeBannerPreset,
  normalizeBannerLayoutId,
} from '../components/library/bannerLayout/bannerLayoutSchema.js'
import { defaultBannerLayouts } from '../components/library/bannerLayout/defaultBannerLayouts.js'

const builtInLayoutIds = new Set(defaultBannerLayouts.map((layout) => layout.id))

const classicTemplate = {
  type: 'layout',
  value: getBannerLayoutById(defaultBannerLayouts, CLASSIC_BANNER_LAYOUT_ID),
}

const BannerTemplateContext = createContext(null)

/**
 * Resolves "which banner template/layout is currently selected" exactly
 * once per window, instead of once per <GameBanner> instance. Before this
 * provider existed, every single banner card in the Browse/Library grid
 * called getSelectedBannerTemplate() (and often getCustomBannerLayout()/
 * getUserBannerLayouts() too) on its own mount — with a 250-item Browse
 * page that meant hundreds of redundant main-process round trips firing
 * at once just to figure out which layout to draw, every time the grid
 * re-rendered.
 *
 * Wrap the window root that renders <GameBanner> (currently just App.jsx /
 * src/windows/main.jsx) in this provider, then have GameBanner read
 * useBannerTemplate() instead of resolving its own copy.
 */
export function BannerTemplateProvider({ children }) {
  const [selectedTemplate, setSelectedTemplate] = useState(classicTemplate)

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
        const templates = import.meta.glob('../assets/templates/banner/*.js', {
          eager: false,
        })
        const key = `../assets/templates/banner/${selected}.js`
        if (templates[key]) {
          const templateModule = await templates[key]()
          setSelectedTemplate({ type: 'legacy', value: templateModule.default })
        } else {
          console.warn(`Template not found: ${selected}`)
          setSelectedTemplate(classicTemplate)
        }
      } catch (importErr) {
        console.error(`Failed to import template ${selected}:`, importErr)
        window.electronAPI.log?.(`Failed to import template ${selected}: ${importErr.message}`)
        setSelectedTemplate(classicTemplate)
      }
    } catch (err) {
      console.error('Error loading banner template:', err)
      window.electronAPI.log?.(`Error loading banner template: ${err.message}`)
      setSelectedTemplate(classicTemplate)
    }
  }, [])

  useEffect(() => {
    loadSelectedTemplate()
  }, [loadSelectedTemplate])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) loadSelectedTemplate()
    }

    window.addEventListener('focus', loadSelectedTemplate)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const removeBannerLayoutListener = window.electronAPI.onBannerLayoutUpdated?.(loadSelectedTemplate)
    return () => {
      window.removeEventListener('focus', loadSelectedTemplate)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (typeof removeBannerLayoutListener === 'function') removeBannerLayoutListener()
    }
  }, [loadSelectedTemplate])

  return (
    <BannerTemplateContext.Provider value={selectedTemplate}>
      {children}
    </BannerTemplateContext.Provider>
  )
}

/**
 * Returns the currently selected banner template as { type, value } —
 * type is 'layout' (value is a normalized banner layout object, rendered
 * via <BannerLayoutRenderer>) or 'legacy' (value is a legacy banner
 * component, rendered directly). Falls back to the classic built-in
 * layout if called outside a <BannerTemplateProvider> so existing
 * consumers don't crash; in practice every window that renders
 * <GameBanner> should be wrapped in the provider.
 */
export function useBannerTemplate() {
  const ctx = useContext(BannerTemplateContext)
  return ctx || classicTemplate
}
