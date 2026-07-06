import React from 'react'
import SafeImage from '../../ui/SafeImage.jsx'
import { getGameTitle } from '../../../utils/gameDisplay.js'
import { normalizeBannerField, normalizeBannerLayout, getBannerTotalSize } from './bannerLayoutSchema.js'
import { getBannerFieldSources, resolveBannerField } from './bannerFieldResolvers.js'
import {
  getEngineBackgroundColor,
  getStatusBackgroundColor,
  normalizeFontSize,
  normalizeImageFit,
  normalizeOverlayOpacity,
} from './bannerStyleUtils.js'

const bannerStyles = `
  .banner-root {
    box-sizing: border-box;
    perspective: 1000px;
    transform-style: preserve-3d;
    transform-origin: center center;
    transform: skewX(0.001deg);
    backface-visibility: hidden;
    will-change: transform;
    box-shadow: var(--banner-shadow, none);
    transition: transform 0.35s ease-in-out, box-shadow 0.35s ease-in-out, filter 0.35s ease-in-out;
  }
  /* Classic 3D tilt (default). Scale amount is configurable via --hover-scale. */
  .banner-root[data-hover="classic-tilt"]:hover {
    transform: rotateX(7deg) translateY(-6px) scale(var(--hover-scale, 1.02));
    transition: transform 0.35s ease-in-out 0.1s;
    z-index: 10;
  }
  /* Steam-style: flat zoom + subtle brighten + outer glow/shadow, no tilt. */
  .banner-root[data-hover="zoom"]:hover {
    transform: scale(var(--hover-scale, 1.05));
    filter: brightness(1.08);
    box-shadow: 0 0 0 2px rgba(255,255,255,0.35), 0 10px 26px rgba(0,0,0,0.55);
    z-index: 10;
  }
  .banner-root[data-hover="none"]:hover {
    transform: none;
  }
  .banner-root::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: 5%;
    left: 5%;
    width: 90%;
    height: 90%;
    background: rgba(0,0,0,0.5);
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    transform-origin: top center;
    transform: skewX(0.001deg);
    transition: transform 0.35s ease-in-out 0.1s, opacity 0.5s ease-in-out 0.1s;
  }
  .banner-root[data-hover="classic-tilt"]:hover::before {
    opacity: 0.6;
    transform: rotateX(7deg) translateY(-6px) scale(var(--hover-scale, 1.02));
  }
`

const slotClasses = {
  'top-left': 'absolute top-0 left-0 h-[28px] ml-2.5 flex items-center justify-start gap-1 max-w-[70%]',
  'top-center': 'absolute top-0 left-1/2 -translate-x-1/2 h-[28px] flex items-center justify-center gap-1 max-w-[70%]',
  'top-right': 'absolute top-0 right-0 h-[28px] mr-2.5 flex items-center justify-end gap-1 max-w-[70%]',
  'center-left': 'absolute top-1/2 left-2.5 -translate-y-1/2 flex items-center justify-start gap-1 max-w-[70%]',
  center: 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center gap-1 text-center max-w-[80%]',
  'center-right': 'absolute top-1/2 right-2.5 -translate-y-1/2 flex items-center justify-end gap-1 max-w-[70%]',
  'bottom-left': 'absolute bottom-0 left-0 h-[28px] ml-2 flex items-center justify-start gap-1 max-w-[70%]',
  'bottom-center': 'absolute bottom-0 left-1/2 -translate-x-1/2 h-[28px] flex items-center justify-center gap-1 text-center max-w-[70%]',
  'bottom-right': 'absolute bottom-0 right-0 h-[28px] mr-2.5 flex items-center justify-end gap-0 max-w-[70%]',
  'top-left-floating': 'absolute top-2 left-2 flex items-center justify-start gap-1',
  'top-right-floating': 'absolute top-2 right-2 flex items-center justify-end gap-1',
}

const orderedSlots = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'top-left-floating',
  'top-right-floating',
]

const panelAlignJustify = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
  between: 'justify-between',
}

const objectPositionByImagePosition = {
  center: 'center',
  top: 'center top',
  bottom: 'center bottom',
  left: 'left center',
  right: 'right center',
}

const isValidHttpUrl = (url) => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Only still images can be cycled through an <img>; skip video previews so we
// don't try to render a .mp4/.webm as an image.
const IMAGE_PREVIEW_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif|bmp)$/i
const isImagePreview = (url) =>
  typeof url === 'string' && IMAGE_PREVIEW_EXTENSIONS.test(url.split(/[?#]/)[0])

const getBadgeStyle = (fieldId, value) => {
  if (fieldId === 'engine') return { backgroundColor: getEngineBackgroundColor(value) }
  if (fieldId === 'status') return { backgroundColor: getStatusBackgroundColor(value) }
  if (fieldId === 'version') return { backgroundColor: '#3F4043' }
  if (fieldId === 'sourceBadges' || fieldId === 'primarySource') return { backgroundColor: '#2563EB' }
  return { backgroundColor: '#3F4043' }
}

// Fixed, theme-independent badge palettes. Banners must look identical
// regardless of the active app theme (the only app-wide inheritance is the font
// family via --font-sans; font size and all colors come from the layout).
const badgeVariantClasses = {
  neutral: 'bg-black/60 text-white',
  source: 'bg-blue-700 text-white',
  success: 'bg-green-700 text-white',
  warning: 'bg-yellow-500/20 text-yellow-200',
  danger: 'bg-red-700 text-white',
  favorite: 'bg-black/60 text-white',
  wishlist: 'bg-black/60 text-white',
}

const isEmptyValue = (value) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

const fieldPassesConditions = (field, game) => {
  const conditions = field.conditions || {}
  const isCatalog = game.isCatalogEntry === true || game.isMetadataOnly === true
  const isWishlist = game.isWishlisted === true || game.isWishlistEntry === true
  const isInstalled = game.hasInstalledVersion !== false || game.isInstalled === true
  if (conditions.localOnly && isCatalog) return false
  if (conditions.browseOnly && !isCatalog) return false
  if (conditions.wishlistOnly && !isWishlist) return false
  if (conditions.installedOnly && !isInstalled) return false
  if (conditions.uninstalledOnly && isInstalled) return false
  if (conditions.updateOnly && game.isUpdateAvailable !== true) return false
  if (conditions.favoriteOnly && game.isFavorite !== true) return false
  if (Array.isArray(conditions.source) && conditions.source.length > 0) {
    const sources = getBannerFieldSources(game)
    if (!conditions.source.some((source) => sources.includes(source))) return false
  }
  return true
}

const renderMarkerIcon = (fieldId) => {
  if (fieldId !== 'favorite' && fieldId !== 'wishlist') return null
  return (
    <i
      className="fas fa-heart"
      style={{
        fontSize: 10,
        color: `var(--banner-icon-color, ${fieldId === 'favorite' ? '#f59e0b' : '#f9a8d4'})`,
        marginRight: 5,
      }}
    />
  )
}

const BannerField = ({ field, game, index, inPanel = false }) => {
  const resolved = resolveBannerField(field.id, game)
  if (!fieldPassesConditions(field, game)) return null
  if (!resolved.visible) return null
  if (field.hideWhenEmpty && isEmptyValue(resolved.value)) return null

  const fontSize = normalizeFontSize(field.fontSize, field.badge ? 10 : 12)
  // Per-field pixel nudge (offsetX/offsetY) applied as a transform so it shifts
  // the field visually without disturbing slot/row layout.
  const offsetX = Number(field.offsetX) || 0
  const offsetY = Number(field.offsetY) || 0
  const fieldBorder = field.border || {}
  const style = {
    fontSize,
    ...(offsetX || offsetY ? { transform: `translate(${offsetX}px, ${offsetY}px)` } : {}),
    ...(field.bold ? { fontWeight: 700 } : {}),
    ...(field.italic ? { fontStyle: 'italic' } : {}),
    ...(field.textShadow ? { textShadow: '0 1px 3px rgba(0,0,0,0.9)' } : {}),
    ...(fieldBorder.width > 0
      ? { border: `${fieldBorder.width}px solid ${fieldBorder.color || '#000000'}`, borderRadius: 4, padding: '0 4px' }
      : {}),
  }

  if (field.id === 'update') {
    return (
      <button
        key={`${field.id}-${index}`}
        className="min-w-[110px] h-[20px] bg-transparent border border-yellow-400 text-yellow-300 rounded-sm z-30 pointer-events-auto whitespace-nowrap px-2"
        style={style}
        onClick={(event) => {
          event.stopPropagation()
          if (isValidHttpUrl(game.siteUrl)) {
            window.electronAPI.openExternalUrl(game.siteUrl)
          } else {
            console.error(`Invalid siteUrl: ${game.siteUrl}`)
          }
        }}
      >
        {resolved.value}
      </button>
    )
  }

  if (field.id === 'favorite' || field.id === 'wishlist') {
    const borderClass = field.id === 'favorite' ? 'border-yellow-400' : 'border-sky-400'
    return (
      <div
        key={`${field.id}-${index}`}
        className={`bg-black/60 border ${borderClass} text-white text-[10px] px-2 py-1 pointer-events-none whitespace-nowrap`}
      >
        {renderMarkerIcon(field.id)}
        {resolved.value}
      </div>
    )
  }

  if (field.badge) {
    if (Array.isArray(resolved.value)) {
      return resolved.value.map((badge, badgeIndex) => (
        <div
          key={`${field.id}-${index}-${badgeIndex}`}
          className={`rounded-sm px-2 py-0.5 truncate max-w-[120px] ${badgeVariantClasses[badge.variant || resolved.variant || 'neutral']}`}
          style={style}
        >
          {badge.label}
        </div>
      ))
    }
    return (
      <div
        key={`${field.id}-${index}`}
        className={`rounded-sm px-2 py-0.5 truncate max-w-[180px] ${badgeVariantClasses[resolved.variant || 'neutral'] || 'text-white'}`}
        style={{ ...style, ...(resolved.variant ? {} : getBadgeStyle(field.id, resolved.value)) }}
      >
        {resolved.icon && <i className={resolved.icon} style={{ marginRight: 4, color: 'var(--banner-icon-color, currentColor)' }} aria-hidden="true" />}
        {resolved.value}
      </div>
    )
  }

  const isTitle = field.id === 'title'
  const baseClass = isTitle ? 'game-titles font-semibold truncate' : 'truncate'
  const maxWClass = inPanel ? 'max-w-full' : isTitle ? 'max-w-[360px]' : 'max-w-[300px]'
  const colorClass = inPanel ? '' : 'text-white drop-shadow'
  const shadowClass = isTitle && !inPanel ? 'text-shadow-fx text-glow-fx' : ''
  const displayValue = Array.isArray(resolved.value)
    ? resolved.value.map((item) => item.label || item).join(' ')
    : resolved.value

  return (
    <div
      key={`${field.id}-${index}`}
      className={`${colorClass} ${shadowClass} ${baseClass} ${maxWClass}`.trim()}
      style={inPanel ? { ...style, color: 'inherit' } : style}
    >
      {resolved.icon && <i className={resolved.icon} style={{ marginRight: 4, color: 'var(--banner-icon-color, currentColor)' }} aria-hidden="true" />}
      {displayValue}
    </div>
  )
}

const Overlay = ({ position, overlay }) => {
  if (!overlay?.visible) return null
  return (
    <div
      className={`absolute ${position}-0 left-0 w-full h-[28px] bg-black z-10 pointer-events-none`}
      style={{ opacity: normalizeOverlayOpacity(overlay.opacity) }}
    />
  )
}

const BannerLayoutRenderer = ({ game, layout, onSelect, onContextMenu }) => {
  const normalizedLayout = normalizeBannerLayout(layout)
  const displayTitle = getGameTitle(game)
  const imageConfig = normalizedLayout?.image || {}
  const backgroundMode = imageConfig.backgroundMode || 'image'
  const isBlurredFill = backgroundMode === 'blurred-fill'
  const imageFit = normalizeImageFit(imageConfig.fit || normalizedLayout?.imageFit)
  const foregroundFit = normalizeImageFit(imageConfig.foregroundFit || (isBlurredFill ? 'contain' : imageFit))
  const imageFitClass = imageFit === 'cover' ? 'object-cover' : 'object-contain'
  const foregroundFitClass = foregroundFit === 'cover' ? 'object-cover' : 'object-contain'
  const fallbackClass = imageConfig.fallbackBackground === 'theme' ? 'bg-secondary' : 'bg-[#1F2937]'
  const imageVisible = imageConfig.visible !== false
  const blurBackground = imageConfig.blurBackground || {}

  // Hover-to-cycle-previews. When enabled in the banner layout, hovering the
  // card fetches the game's previews once and cycles the banner image through
  // them on a timer; leaving the card reverts to the banner.
  const previewCycle = normalizedLayout?.previewCycle || {}
  const cycleEnabled =
    previewCycle.enabled === true &&
    !!game?.record_id &&
    typeof window !== 'undefined' &&
    (typeof window.electronAPI?.getPreviews === 'function' ||
      typeof window.electronAPI?.getBrowsePreviewUrls === 'function')
  const cycleIntervalMs = Math.max(250, Number(previewCycle.intervalMs) || 2000)

  const [isHovering, setIsHovering] = React.useState(false)
  const [cyclePreviews, setCyclePreviews] = React.useState([])
  const [cycleIndex, setCycleIndex] = React.useState(0)
  const [manualMode, setManualMode] = React.useState(false)
  // Previews don't start the instant you hover — we wait one interval first
  // (so a quick pass-over doesn't flicker), then show the first preview and
  // continue cycling. cycleActive gates that "after the delay" state.
  const [cycleActive, setCycleActive] = React.useState(false)
  const previewsFetchedRef = React.useRef(false)
  const hoverDelayRef = React.useRef(null)

  const handleBannerMouseEnter = React.useCallback(() => {
    if (!cycleEnabled) return
    setIsHovering(true)
    if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current)
    hoverDelayRef.current = setTimeout(() => setCycleActive(true), cycleIntervalMs)
    if (previewsFetchedRef.current) return
    previewsFetchedRef.current = true
    // Catalog/browse entries resolve their preview URLs differently from local
    // library records.
    const fetchPreviewUrls =
      isCatalog && typeof window.electronAPI?.getBrowsePreviewUrls === 'function'
        ? window.electronAPI.getBrowsePreviewUrls(game)
        : window.electronAPI.getPreviews(game.record_id)
    Promise.resolve(fetchPreviewUrls)
      .then((urls) => {
        const images = (Array.isArray(urls) ? urls : []).filter(isImagePreview)
        setCyclePreviews(images)
      })
      .catch(() => setCyclePreviews([]))
  }, [cycleEnabled, game?.record_id, cycleIntervalMs])

  const handleBannerMouseLeave = React.useCallback(() => {
    if (hoverDelayRef.current) {
      clearTimeout(hoverDelayRef.current)
      hoverDelayRef.current = null
    }
    setIsHovering(false)
    setCycleActive(false)
    setCycleIndex(0)
    setManualMode(false)
  }, [])

  // Manual navigation via the arrows. Clicking an arrow stops the auto-cycle
  // (manualMode) and steps the image; stopPropagation keeps the click from
  // also opening/selecting the game.
  const goToPreview = React.useCallback(
    (event, delta) => {
      event.stopPropagation()
      event.preventDefault()
      setManualMode(true)
      setCycleIndex((prev) => {
        const len = cyclePreviews.length
        if (len === 0) return 0
        return (prev + delta + len) % len
      })
    },
    [cyclePreviews.length],
  )

  React.useEffect(() => {
    if (!cycleEnabled || !isHovering || !cycleActive || manualMode || cyclePreviews.length <= 1) return undefined
    const timer = setInterval(() => {
      setCycleIndex((prev) => (prev + 1) % cyclePreviews.length)
    }, cycleIntervalMs)
    return () => clearInterval(timer)
  }, [cycleEnabled, isHovering, cycleActive, manualMode, cyclePreviews, cycleIntervalMs])

  const showCycleArrows = cycleEnabled && isHovering && cycleActive && cyclePreviews.length > 1

  const cyclingSrc =
    cycleEnabled && isHovering && cycleActive && cyclePreviews.length > 0
      ? cyclePreviews[cycleIndex % cyclePreviews.length]
      : null
  const displaySrc = cyclingSrc || game.banner_url

  // Split fields into those overlaid on the image (region 'image', placed by
  // corner slot) and those living in a side panel (region top/right/bottom/
  // left, placed by row/align). Panels let the banner be larger than the art.
  const fieldsBySlot = new Map()
  const panelFieldsBySide = { top: [], right: [], bottom: [], left: [] }

  for (const rawField of normalizedLayout?.fields || []) {
    const field = normalizeBannerField(rawField)
    if (!field) continue
    if (field.region && field.region !== 'image') {
      if (panelFieldsBySide[field.region]) panelFieldsBySide[field.region].push(field)
      continue
    }
    const fields = fieldsBySlot.get(field.slot) || []
    fields.push(field)
    fieldsBySlot.set(field.slot, fields)
  }

  // Which panels are actually active, and how far they inset the image.
  const panels = normalizedLayout?.panels || {}
  const activePanel = (sideKey) => {
    const panel = panels[sideKey]
    return panel && panel.enabled && panel.size > 0 ? panel : null
  }
  const topP = activePanel('top')
  const bottomP = activePanel('bottom')
  const leftP = activePanel('left')
  const rightP = activePanel('right')
  const topSize = topP ? topP.size : 0
  const bottomSize = bottomP ? bottomP.size : 0
  const leftSize = leftP ? leftP.size : 0
  const rightSize = rightP ? rightP.size : 0
  const imageRegionStyle = { top: topSize, bottom: bottomSize, left: leftSize, right: rightSize }
  // Outer banner box = image size + panels (panels grow outward; the image
  // stays exactly width x height inside the inset region above).
  const totalSize = getBannerTotalSize(normalizedLayout)
  const bannerBorder = normalizedLayout?.border || {}
  const hoverEffect = normalizedLayout?.hoverEffect || 'classic-tilt'
  const hoverScale = normalizedLayout?.hoverScale || 1.02
  const bannerShadow = normalizedLayout?.shadow || {}
  const iconColor = normalizedLayout?.iconColor || ''
  const rootBorderStyle = {
    ...(bannerBorder.width > 0
      ? { borderStyle: 'solid', borderWidth: bannerBorder.width, borderColor: bannerBorder.color || '#000000' }
      : {}),
    ...(bannerBorder.radius > 0 ? { borderRadius: bannerBorder.radius } : {}),
  }

  const renderPanel = (sideKey, panel, positionStyle) => {
    if (!panel) return null
    const rowMap = new Map()
    for (const field of panelFieldsBySide[sideKey] || []) {
      const arr = rowMap.get(field.row) || []
      arr.push(field)
      rowMap.set(field.row, arr)
    }
    const rows = [...rowMap.entries()].sort((a, b) => a[0] - b[0])
    const b = panel.border || {}
    const panelBorderStyle = b.width > 0
      ? {
          borderStyle: 'solid',
          borderColor: b.color || '#000000',
          borderTopWidth: b.top ? b.width : 0,
          borderRightWidth: b.right ? b.width : 0,
          borderBottomWidth: b.bottom ? b.width : 0,
          borderLeftWidth: b.left ? b.width : 0,
        }
      : {}
    return (
      <div
        className="absolute overflow-hidden flex flex-col z-20 box-border"
        style={{
          ...positionStyle,
          background: panel.background,
          color: panel.textColor,
          padding: panel.padding,
          gap: panel.gap,
          ...panelBorderStyle,
        }}
      >
        {rows.map(([row, rowFields]) => {
          const ordered = [...rowFields].sort((a, b) => a.order - b.order)
          const align = ordered[0]?.align || 'left'
          return (
            <div
              key={row}
              className={`flex items-center flex-wrap ${panelAlignJustify[align] || 'justify-start'}`}
              style={{ gap: panel.gap }}
            >
              {ordered.map((field, index) => (
                <BannerField key={`${field.id}-${index}`} field={field} game={game} index={index} inPanel />
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={`relative cursor-pointer overflow-hidden box-border ${fallbackClass} banner-root`}
      data-hover={hoverEffect}
      style={{
        width: totalSize.width,
        height: totalSize.height,
        ...rootBorderStyle,
        '--hover-scale': hoverScale,
        ...(bannerShadow.enabled ? { '--banner-shadow': `0 8px 20px 0 ${bannerShadow.color || 'rgba(0,0,0,0.5)'}` } : {}),
        ...(iconColor ? { '--banner-icon-color': iconColor } : {}),
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={handleBannerMouseEnter}
      onMouseLeave={handleBannerMouseLeave}
    >
      <style>{bannerStyles}</style>
      <div className={`absolute overflow-hidden ${fallbackClass}`} style={imageRegionStyle}>
      <div className={`absolute inset-0 w-full h-full z-0 ${fallbackClass}`}>
        {imageVisible && displaySrc && isBlurredFill ? (
          <>
            <SafeImage
              src={displaySrc}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 block w-full h-full object-cover pointer-events-none"
              style={{
                objectPosition: objectPositionByImagePosition[imageConfig.position] || 'center',
                filter: `blur(${blurBackground.blur ?? 20}px)`,
                transform: `scale(${blurBackground.scale ?? 1.1})`,
                opacity: blurBackground.opacity ?? 0.6,
                zIndex: 0,
              }}
              fallbackMode="transparent"
              fallbackContent={false}
            />
            <SafeImage
              src={displaySrc}
              alt={displayTitle}
              className={`absolute inset-0 block w-full h-full pointer-events-none ${foregroundFitClass}`}
              style={{
                objectPosition: objectPositionByImagePosition[imageConfig.position] || 'center',
                zIndex: 1,
              }}
              fallbackMode="transparent"
              fallbackContent={false}
              onError={() =>
                console.error(
                  `Failed to load banner image for recordId ${game.record_id}: ${displaySrc}`,
                )
              }
            />
          </>
        ) : imageVisible && displaySrc ? (
          <SafeImage
            src={displaySrc}
            alt={displayTitle}
            className={`block w-full h-full ${imageFitClass}`}
            style={{ objectPosition: objectPositionByImagePosition[imageConfig.position] || 'center' }}
            fallbackMode="transparent"
            fallbackContent={false}
            onError={() =>
              console.error(
                `Failed to load banner image for recordId ${game.record_id}: ${displaySrc}`,
              )
            }
          />
        ) : null}
      </div>
      <Overlay position="top" overlay={normalizedLayout?.overlays?.top} />
      <Overlay position="bottom" overlay={normalizedLayout?.overlays?.bottom} />
      {showCycleArrows && (
        <>
          <button
            type="button"
            aria-label="Previous preview"
            className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-7 h-14 flex items-center justify-center rounded-r-lg bg-black/40 hover:bg-black/60 text-gray-200 hover:text-white pointer-events-auto transition-colors"
            onClick={(event) => goToPreview(event, -1)}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <i className="fas fa-chevron-left" style={{ fontSize: 18 }} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next preview"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-30 w-7 h-14 flex items-center justify-center rounded-l-lg bg-black/40 hover:bg-black/60 text-gray-200 hover:text-white pointer-events-auto transition-colors"
            onClick={(event) => goToPreview(event, 1)}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <i className="fas fa-chevron-right" style={{ fontSize: 18 }} aria-hidden="true" />
          </button>
        </>
      )}
      </div>
      {renderPanel('top', topP, { top: 0, left: 0, width: '100%', height: topSize })}
      {renderPanel('bottom', bottomP, { bottom: 0, left: 0, width: '100%', height: bottomSize })}
      {renderPanel('left', leftP, { top: topSize, bottom: bottomSize, left: 0, width: leftSize })}
      {/* Image-region fields/badges live in their own top overlay (z-30, not
          clipped) positioned over the image area, so they render on top of the
          panels too — not just the image — and never get cut at the seam. */}
      <div className="absolute z-30" style={imageRegionStyle}>
        {orderedSlots.map((slot) => {
          const fields = fieldsBySlot.get(slot) || []
          if (fields.length === 0) return null
          return (
            <div key={slot} className={slotClasses[slot] || slotClasses['bottom-left']}>
              {fields.map((field, index) => (
                <BannerField key={`${field.id}-${index}`} field={field} game={game} index={index} />
              ))}
            </div>
          )
        })}
      </div>
      {renderPanel('right', rightP, { top: topSize, bottom: bottomSize, right: 0, width: rightSize })}
    </div>
  )
}

export default BannerLayoutRenderer
