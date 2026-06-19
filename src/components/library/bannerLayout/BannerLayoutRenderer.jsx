import React from 'react'
import SafeImage from '../../ui/SafeImage.jsx'
import { getGameTitle } from '../../../utils/gameDisplay.js'
import { normalizeBannerField } from './bannerLayoutSchema.js'
import { resolveBannerField } from './bannerFieldResolvers.js'
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
  'top-left': 'absolute top-0 left-0 h-[28px] ml-2.5 flex items-center justify-start gap-1',
  'top-center': 'absolute top-0 left-1/2 -translate-x-1/2 h-[28px] flex items-center justify-center gap-1',
  'top-right': 'absolute top-0 right-0 h-[28px] mr-2.5 flex items-center justify-end gap-1',
  'center-left': 'absolute top-1/2 left-2.5 -translate-y-1/2 flex items-center justify-start gap-1',
  center: 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center gap-1 text-center',
  'center-right': 'absolute top-1/2 right-2.5 -translate-y-1/2 flex items-center justify-end gap-1',
  'bottom-left': 'absolute bottom-0 left-0 h-[28px] ml-2 flex items-center justify-start gap-1',
  'bottom-center': 'absolute bottom-0 left-1/2 -translate-x-1/2 h-[28px] flex items-center justify-center gap-1 text-center',
  'bottom-right': 'absolute bottom-0 right-0 h-[28px] mr-2.5 flex items-center justify-end gap-0',
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

const isValidHttpUrl = (url) => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const getBadgeStyle = (fieldId, value) => {
  if (fieldId === 'engine') return { backgroundColor: getEngineBackgroundColor(value) }
  if (fieldId === 'status') return { backgroundColor: getStatusBackgroundColor(value) }
  if (fieldId === 'version') return { backgroundColor: '#3F4043' }
  return { backgroundColor: '#3F4043' }
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
  if (!resolved.visible) return null

  const fontSize = normalizeFontSize(field.fontSize, field.badge ? 10 : 12)
  const style = { fontSize }

  if (field.id === 'update') {
    return (
      <button
        key={`${field.id}-${index}`}
        className="w-[90px] h-[20px] bg-transparent border border-warning text-warning rounded-sm z-30 pointer-events-auto"
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
        className={`bg-primary border ${borderClass} text-text text-[10px] px-2 py-1 pointer-events-none`}
      >
        {renderMarkerIcon(field.id)}
        {resolved.value}
      </div>
    )
  }

  if (field.badge) {
    return (
      <div
        key={`${field.id}-${index}`}
        className="text-white rounded-sm px-2 py-0.5"
        style={{ ...style, ...getBadgeStyle(field.id, resolved.value) }}
      >
        {resolved.value}
      </div>
    )
  }

  const titleClass =
    field.id === 'title'
      ? 'text-shadow-fx text-glow-fx game-titles font-semibold max-w-[360px] truncate'
      : 'max-w-[300px] truncate'

  return (
    <div key={`${field.id}-${index}`} className={`text-white ${titleClass}`} style={style}>
      {resolved.value}
    </div>
  )
}

const Overlay = ({ position, overlay }) => {
  if (!overlay?.visible) return null
  return (
    <div
      className={`absolute ${position}-0 left-0 w-full h-[28px] bg-black z-10`}
      style={{ opacity: normalizeOverlayOpacity(overlay.opacity) }}
    />
  )
}

const BannerLayoutRenderer = ({ game, layout, onSelect, onContextMenu }) => {
  const displayTitle = getGameTitle(game)
  const imageFit = normalizeImageFit(layout?.imageFit)
  const imageFitClass = imageFit === 'cover' ? 'object-cover' : 'object-contain'
  const fieldsBySlot = new Map()

  for (const rawField of layout?.fields || []) {
    const field = normalizeBannerField(rawField)
    if (!field) continue
    const fields = fieldsBySlot.get(field.slot) || []
    fields.push(field)
    fieldsBySlot.set(field.slot, fields)
  }

  return (
    <div
      className="relative w-[537px] h-[251px] border border-black cursor-pointer overflow-hidden box-border bg-[#1F2937] banner-root"
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <style>{bannerStyles}</style>
      <div className="absolute inset-0 w-full h-full z-0 bg-[#1F2937]">
        {game.banner_url ? (
          <SafeImage
            src={game.banner_url}
            alt={displayTitle}
            className={`block w-full h-full ${imageFitClass}`}
            fallbackMode="transparent"
            fallbackContent={false}
            onError={() =>
              console.error(
                `Failed to load banner image for recordId ${game.record_id}: ${game.banner_url}`,
              )
            }
          />
        ) : null}
      </div>
      <Overlay position="top" overlay={layout?.overlays?.top} />
      <Overlay position="bottom" overlay={layout?.overlays?.bottom} />
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
    </div>
  )
}

export default BannerLayoutRenderer
