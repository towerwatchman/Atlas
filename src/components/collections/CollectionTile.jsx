import { toMediaSrc } from '../../utils/mediaSrc.js'

// Steam-style collection tile: a mosaic of member art with a color wash over
// it. The mosaic is deliberately TALLER than the tile and vertically centered,
// so the top and bottom rows are cropped rather than fitted — that overflow is
// what stops it reading as a neat 4-up grid and makes it look like a stack.
const ART_COLUMNS = 4
const ART_ROWS = 2
const MAX_ART = ART_COLUMNS * ART_ROWS // 8

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
      {/* Mosaic — 130% height, pulled up by 15%, so both edges bleed out. */}
      <div className="absolute inset-0 overflow-hidden">
        {art.length > 0 ? (
          <div
            className="absolute left-0 w-full grid"
            style={{
              top: '-15%',
              height: '130%',
              gridTemplateColumns: `repeat(${ART_COLUMNS}, 1fr)`,
              gridTemplateRows: `repeat(${ART_ROWS}, 1fr)`,
            }}
          >
            {art.map((game, index) => (
              <div key={game?.record_id ?? index} className="overflow-hidden bg-primary">
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

      {/* Color wash. Sits above the art, below the label. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, color-mix(in srgb, ${color} 55%, transparent), color-mix(in srgb, ${color} 88%, transparent))`,
        }}
      />
      {/* Extra darkening at the bottom so the name stays legible over bright art. */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}
      />

      <div className="relative mt-auto flex items-end justify-between gap-2 p-3">
        <span className="truncate text-sm font-semibold text-white drop-shadow">
          {collection.name}
        </span>
        <span className="shrink-0 rounded bg-black/45 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {collection.gameCount}
        </span>
      </div>
    </button>
  )
}
