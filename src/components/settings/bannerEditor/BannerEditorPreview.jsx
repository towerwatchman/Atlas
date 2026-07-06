import BannerLayoutRenderer from '../../library/bannerLayout/BannerLayoutRenderer.jsx'
import { getBannerTotalSize } from '../../library/bannerLayout/bannerLayoutSchema.js'

// The preview area is capped at this height. Banners taller than this are
// scaled down to fit; smaller banners render at their natural size (never
// scaled up past 1).
const MAX_PREVIEW_HEIGHT = 400

const BannerEditorPreview = ({ game, layout }) => {
  const total = getBannerTotalSize(layout || {})
  const width = total.width || 1
  const height = total.height || 1
  const scale = Math.min(1, MAX_PREVIEW_HEIGHT / height)

  return (
    // Outer box reserves the SCALED footprint so surrounding layout stays
    // correct (no negative-margin hacks); inner box is the full-size banner
    // scaled from its top-left corner.
    <div style={{ width: width * scale, height: height * scale }}>
      <div
        className="origin-top-left"
        style={{ transform: `scale(${scale})`, width, height }}
      >
        <BannerLayoutRenderer
          game={game}
          layout={layout}
          onSelect={() => {}}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>
    </div>
  )
}

export default BannerEditorPreview
