import { toMediaSrc } from '../../utils/mediaSrc.js'

// Steam-style collection tile: a mosaic of member art, rotated so the seams run
// diagonally, with a color wash over it and the name in large caps.
//
// The whole grid is rotated as one piece rather than each image individually —
// that keeps the gaps between cells straight and parallel, which is what
// produces the diagonal lattice. Rotating each image on its own would leave
// wedge-shaped holes at the corners instead.
const ART_COLUMNS = 4
const ART_ROWS = 2
const MAX_ART = ART_COLUMNS * ART_ROWS // 8
const ROTATION_DEG = -60 // negative = counter-clockwise ("to the left")

// How large the art grid is relative to the tile. This is really a zoom
// control: cells visible ≈ (cols × rows) ÷ OVERSCAN², so bigger = fewer, larger
// images. At 2.2 only ~1.7 cells' worth of area landed in view, which read as
// about four images. 1.08 puts ~7 of the 8 on screen.
//
// Note this is deliberately BELOW the 1.37 (= |cos 60°| + |sin 60°|) a rotated
// rect would need to cover the tile completely, so the corners fall back to the
// color wash — which is what Steam's own tiles do, rather than a gap to fix.
const OVERSCAN = 1.08

export default function CollectionTile({
  collection,
  artGames = [],
  onOpen,
  onContextMenu,
}) {
  const color = collection.color || 'var(--color-accent)'
  const art = artGames.slice(0, MAX_ART)

  return (
    <button
      type="button"
      onClick={() => onOpen?.(collection)}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu?.(collection, event)
      }}
      title={`${collection.name} — ${collection.gameCount} ${collection.gameCount === 1 ? 'game' : 'games'}`}
      className="group relative flex flex-col overflow-hidden rounded border border-border bg-secondary text-left transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent"
      style={{ aspectRatio: '16 / 9' }}
    >
      <div className="absolute inset-0 overflow-hidden">
        {art.length > 0 ? (
          <div
            className="absolute left-1/2 top-1/2 grid gap-2"
            style={{
              width: `${OVERSCAN * 100}%`,
              height: `${OVERSCAN * 100}%`,
              gridTemplateColumns: `repeat(${ART_COLUMNS}, 1fr)`,
              gridTemplateRows: `repeat(${ART_ROWS}, 1fr)`,
              transform: `translate(-50%, -50%) rotate(${ROTATION_DEG}deg)`,
            }}
          >
            {art.map((game, index) => (
              <div key={game?.record_id ?? index} className="overflow-hidden rounded-sm bg-primary">
                {game?.banner_url ? (
                  <img
                    src={toMediaSrc(game.banner_url)}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover"
                    onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 bg-primary" />
        )}
      </div>

      {/* Color wash over the art. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, color-mix(in srgb, ${color} 55%, transparent), color-mix(in srgb, ${color} 88%, transparent))`,
        }}
      />
      {/* Keeps the label legible over bright art. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.45), rgba(0,0,0,0.15))' }}
      />

      <div className="relative flex h-full flex-col items-center justify-center gap-1 p-3">
        <span className="w-full truncate text-center text-lg font-bold uppercase tracking-wide text-white drop-shadow-lg">
          {collection.name}
        </span>
        <span className="text-sm font-semibold tracking-widest text-white/90 drop-shadow">
          ( {collection.gameCount} )
        </span>
      </div>
    </button>
  )
}
