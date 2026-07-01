import React from 'react'
import SafeImage from '../../ui/SafeImage.jsx'
import { getGameTitle } from '../../../utils/gameDisplay.js'
import { normalizeBannerField, normalizeBannerLayout } from './bannerLayoutSchema.js'
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
    transition: transform 0.35s ease-in-out;
  }
  .banner-root:hover {
    transform: rotateX(7deg) translateY(-6px) scale(1.02);
    transition: transform 0.35s ease-in-out 0.1s;
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
  .banner-root:hover::before {
    opacity: 0.6;
    transform: rotateX(7deg) translateY(-6px) scale(1.02);
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

const badgeVariantClasses = {
  neutral: 'bg-primary border-border text-text',
  source: 'bg-blue-700 border-blue-400 text-white',
  success: 'bg-green-700 border-green-400 text-white',
  warning: 'bg-warning/20 border-warning text-warning',
  danger: 'bg-danger border-dangerHover text-white',
  favorite: 'bg-primary border-warning text-text',
  wishlist: 'bg-primary border-accent text-text',
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
        color: fieldId === 'favorite' ? '#f59e0b' : '#f9a8d4',
        marginRight: 5,
      }}
    />
  )
}

const BannerField = ({ field, game, index }) => {
  const resolved = resolveBannerField(field.id, game)
  if (!fieldPassesConditions(field, game)) return null
  if (!resolved.visible) return null
  if (field.hideWhenEmpty && isEmptyValue(resolved.value)) return null

  const fontSize = normalizeFontSize(field.fontSize, field.badge ? 10 : 12)
  const style = { fontSize }

  if (field.id === 'update') {
    return (
      <button
        key={`${field.id}-${index}`}
        className="min-w-[110px] h-[20px] bg-transparent border border-warning text-warning rounded-sm z-30 pointer-events-auto whitespace-nowrap px-2"
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
    const borderClass = field.id === 'favorite' ? 'border-warning' : 'border-accent'
    return (
      <div
        key={`${field.id}-${index}`}
        className={`bg-primary border ${borderClass} text-text text-[10px] px-2 py-1 pointer-events-none whitespace-nowrap`}
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
          className={`border rounded-sm px-2 py-0.5 truncate max-w-[120px] ${badgeVariantClasses[badge.variant || resolved.variant || 'neutral']}`}
          style={style}
        >
          {badge.label}
        </div>
      ))
    }
    return (
      <div
        key={`${field.id}-${index}`}
        className={`border rounded-sm px-2 py-0.5 truncate max-w-[180px] ${badgeVariantClasses[resolved.variant || 'neutral'] || 'text-white'}`}
        style={{ ...style, ...(resolved.variant ? {} : getBadgeStyle(field.id, resolved.value)) }}
      >
        {resolved.value}
      </div>
    )
  }

  const titleClass =
    field.id === 'title'
      ? 'text-shadow-fx text-glow-fx game-titles font-semibold max-w-[360px] truncate'
      : 'max-w-[300px] truncate'
  const displayValue = Array.isArray(resolved.value)
    ? resolved.value.map((item) => item.label || item).join(' ')
    : resolved.value

  return (
    <div key={`${field.id}-${index}`} className={`text-white drop-shadow ${titleClass}`} style={style}>
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
    typeof window.electronAPI?.getPreviews === 'function'
  const cycleIntervalMs = Math.max(250, Number(previewCycle.intervalMs) || 2000)

  const [isHovering, setIsHovering] = React.useState(false)
  const [cyclePreviews, setCyclePreviews] = React.useState([])
  const [cycleIndex, setCycleIndex] = React.useState(0)
  const [manualMode, setManualMode] = React.useState(false)
  const previewsFetchedRef = React.useRef(false)

  const handleBannerMouseEnter = React.useCallback(() => {
    if (!cycleEnabled) return
    setIsHovering(true)
    if (previewsFetchedRef.current) return
    previewsFetchedRef.current = true
    Promise.resolve(window.electronAPI.getPreviews(game.record_id))
      .then((urls) => {
        const images = (Array.isArray(urls) ? urls : []).filter(isImagePreview)
        setCyclePreviews(images)
      })
      .catch(() => setCyclePreviews([]))
  }, [cycleEnabled, game?.record_id])

  const handleBannerMouseLeave = React.useCallback(() => {
    setIsHovering(false)
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
    if (!cycleEnabled || !isHovering || manualMode || cyclePreviews.length <= 1) return undefined
    const timer = setInterval(() => {
      setCycleIndex((prev) => (prev + 1) % cyclePreviews.length)
    }, cycleIntervalMs)
    return () => clearInterval(timer)
  }, [cycleEnabled, isHovering, manualMode, cyclePreviews, cycleIntervalMs])

  const showCycleArrows = cycleEnabled && isHovering && cyclePreviews.length > 1

  const cyclingSrc =
    cycleEnabled && isHovering && cyclePreviews.length > 0
      ? cyclePreviews[cycleIndex % cyclePreviews.length]
      : null
  const displaySrc = cyclingSrc || game.banner_url

  const fieldsBySlot = new Map()

  for (const rawField of normalizedLayout?.fields || []) {
    const field = normalizeBannerField(rawField)
    if (!field) continue
    const fields = fieldsBySlot.get(field.slot) || []
    fields.push(field)
    fieldsBySlot.set(field.slot, fields)
  }

  return (
    <div
      className={`relative border border-black cursor-pointer overflow-hidden box-border ${fallbackClass} banner-root`}
      style={{ width: normalizedLayout?.width || 537, height: normalizedLayout?.height || 251 }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={handleBannerMouseEnter}
      onMouseLeave={handleBannerMouseLeave}
    >
      <style>{bannerStyles}</style>
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
      <div className="absolute inset-0 z-20">
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
  )
}

export default BannerLayoutRenderer
