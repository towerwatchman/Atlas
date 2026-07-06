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
// choosing it.
//
// Cards are a FIXED size (they do not scale with the settings window) —
// CARD_W matches roughly what a card measured at the default 900px settings
// window, frozen so resizing the window only changes how many cards fit per
// row, never their dimensions. The preset name sits on top of the card so
// it's clearly readable rather than blending into the banner art.

// Fixed preview width in px. The 537x251 banner is scaled uniformly to fit.
const CARD_W = 312

// A representative sample game so every field slot has something to show.
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
  views: '2.5M',
  likes: '888',
  downloads: '12K',
  comments: '42',
  platforms: 'Windows, Mac, Linux',
  personalRatingOverall: 4.8,
  totalPlaytime: 9280,
  lastPlayed: Date.now() - 86400000,
  tags: 'Female Protagonist, Romance, Mystery',
  category: 'Game',
  language: 'English',
  siteUrl: 'https://example.com',
}

const classicLayout = getBannerLayoutById(defaultBannerLayouts, 'classic')

const resolveLayout = (option) => {
  if (option.preset) {
    return normalizeBannerPreset(option.preset, classicLayout)?.layout || classicLayout
  }
  return normalizeBannerLayout(getBannerLayoutById(defaultBannerLayouts, option.id), classicLayout)
}

// Breathing room around the banner inside its card, on all sides, so the
// banner appears to float on the card surface rather than sitting flush
// against its edges.
const PREVIEW_PAD = 5
const CARD_BORDER = 2 // border-2 on the card, on each side

const BannerPreviewCard = ({ option, isActive, onSelect }) => {
  const layout = resolveLayout(option)
  const baseW = layout.width || 537
  const baseH = layout.height || 251
  // Interior width = card width minus its border on both sides, then minus
  // the padding on both sides. Computing from the true interior keeps the
  // left/right gaps symmetric (setting the preview to the full CARD_W made
  // the border clip the right edge).
  const innerW = CARD_W - CARD_BORDER * 2 - PREVIEW_PAD * 2
  const scale = innerW / baseW
  const previewH = Math.round(baseH * scale)

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
      style={{ width: CARD_W }}
      className={`group flex-none rounded-cardTheme border-2 overflow-hidden bg-secondary cursor-pointer transition-colors focus:outline-none focus:border-accent ${
        isActive ? 'border-accent' : 'border-border hover:border-muted'
      }`}
    >
      {/* Name on top so it stays readable and doesn't blend into the art. */}
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

      {/* Scaled banner preview. pointer-events-none so clicks/hover fall
          through to the card and the inner banner stays static. Inset evenly
          on all sides over the card's own background so the banner floats. */}
      <div
        className="w-full overflow-hidden bg-secondary box-border"
        style={{ height: previewH + PREVIEW_PAD * 2, padding: PREVIEW_PAD }}
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
    <div className="flex flex-wrap gap-3">
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
