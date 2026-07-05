import { useEffect, useRef, useState } from 'react'
import BannerLayoutRenderer from '../library/bannerLayout/BannerLayoutRenderer.jsx'
import {
  defaultBannerLayouts,
  getBuiltInBannerLayoutOptions,
} from '../library/bannerLayout/defaultBannerLayouts.js'
import {
  getBannerLayoutById,
  normalizeBannerLayout,
  normalizeBannerPreset,
} from '../library/bannerLayout/bannerLayoutSchema.js'

// Selectable preview cards for the Appearance tab — a shrunk-down render of
// each banner layout (the same BannerLayoutRenderer the library grid and the
// Banner Editor use), so users can see what a layout looks like before
// choosing it rather than picking a name from a dropdown blind.
//
// Each card measures its own width and scales the full 537x251 banner down
// to fit, so the grid stays responsive at any settings-window size.

// A representative sample game so every field slot has something to show.
// Mirrors the Banner Editor's previewGame; kept local so this grid is
// self-contained.
const SAMPLE_GAME = {
  record_id: 'banner-preview',
  title: 'Example Game Title',
  creator: 'Studio Example',
  engine: "Ren'Py",
  status: 'Completed',
  latestVersion: 'v1.3.0',
  versions: [
    { version: 'v1.2.0', isInstalled: true },
    { version: 'v1.0.0', isInstalled: true },
  ],
  isUpdateAvailable: false,
  isFavorite: false,
  isWishlisted: false,
  hasInstalledVersion: true,
  atlas_id: 123,
  f95_id: 456,
  steam_id: 789,
  sourceRating: 4.4,
  personalRatingOverall: 4.8,
  totalPlaytime: 9280,
  lastPlayed: Date.now() - 86400000,
  tags: 'Female Protagonist, Romance, Mystery',
  category: 'Game',
  language: 'English',
  siteUrl: 'https://example.com',
}

const classicLayout = getBannerLayoutById(defaultBannerLayouts, 'classic')

// Resolve a full, renderable layout object for a built-in id or user preset.
const resolveLayout = (option) => {
  if (option.preset) {
    return normalizeBannerPreset(option.preset, classicLayout)?.layout || classicLayout
  }
  return normalizeBannerLayout(getBannerLayoutById(defaultBannerLayouts, option.id), classicLayout)
}

const BannerPreviewCard = ({ option, isActive, onSelect }) => {
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(0.45)
  const layout = resolveLayout(option)
  const baseW = layout.width || 537
  const baseH = layout.height || 251

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w) setScale(w / baseW)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [baseW])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(option.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(option.id)
        }
      }}
      title={option.name}
      className={`group text-left rounded-cardTheme border-2 overflow-hidden bg-primary cursor-pointer transition-colors focus:outline-none focus:border-accent ${
        isActive ? 'border-accent' : 'border-border hover:border-muted'
      }`}
    >
      {/* Scaled banner preview. pointer-events-none so clicks/hover fall
          through to the card and the inner banner stays static. */}
      <div
        ref={wrapRef}
        className="w-full overflow-hidden bg-canvas"
        style={{ height: baseH * scale }}
      >
        <div
          className="pointer-events-none"
          style={{
            width: baseW,
            height: baseH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <BannerLayoutRenderer
            game={SAMPLE_GAME}
            layout={layout}
            onSelect={() => {}}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-2.5 py-2">
        <span className="text-sm font-medium truncate">{option.name}</span>
        {isActive ? (
          <span className="text-xs text-accent font-medium flex-shrink-0 ml-2">Active</span>
        ) : (
          option.preset && (
            <span className="text-[10px] text-muted flex-shrink-0 ml-2 uppercase tracking-wide">User</span>
          )
        )}
      </div>
    </div>
  )
}

const BannerPresetGrid = ({ userPresets = [], selectedId, onSelect }) => {
  const builtIn = getBuiltInBannerLayoutOptions().map((layout) => ({
    id: layout.id,
    name: layout.name,
  }))
  const userOptions = userPresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    preset,
  }))
  const options = [...builtIn, ...userOptions]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {options.map((option) => (
        <BannerPreviewCard
          key={option.id}
          option={option}
          isActive={option.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export default BannerPresetGrid
