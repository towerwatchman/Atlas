import { toMediaSrc } from '../../utils/mediaSrc.js'

// Steam-style collection tile: a mosaic of member art, rotated so the seams run
// diagonally, with a color wash over it and the name in large caps.
//
// The grid is rotated as one piece rather than each image individually — that
// keeps the gaps straight and parallel, which is what produces the diagonal
// lattice. Rotating each image separately would leave wedge-shaped holes where
// the squares no longer tile.

// Cell aspect is pinned to the DEFAULT banner dimensions (537x251) and is
// deliberately NOT read from the active banner theme: tiles should look the
// same no matter which banner layout the user has picked, so switching themes
// can't reshape the collections screen.
const BANNER_ASPECT = 537 / 251

// Rotation of the whole mosaic. Negative = counter-clockwise ("to the left").
const ROTATION_DEG = -60

// Tile shape, needed by the sizing maths below because CSS width/height
// percentages resolve against DIFFERENT bases (tile width vs tile height).
const TILE_ASPECT = 16 / 9

// Ceiling on how much art a tile draws. Past roughly this many the cells are
// too small to read as game art, and every extra image costs a decode. Must not
// exceed TILE_ART_LIMIT in electron/ipc/collections.js, which decides how many
// record ids are fetched per collection.
const MAX_ART = 24

/**
 * Grid shape for `n` images: as square as possible, biased to portrait so the
 * extra row lands below rather than beside (10 -> 3 columns x 4 rows, 9 -> 3x3).
 * Using floor rather than round also minimises empty trailing cells.
 */
export function getGridShape(n) {
  const cols = Math.max(1, Math.floor(Math.sqrt(n)))
  return { cols, rows: Math.ceil(n / cols) }
}

/**
 * Grid dimensions as fractions of the tile's width and height respectively
 * (1 = 100%), solved under two constraints:
 *
 *  1. Every cell keeps BANNER_ASPECT. Note this has to be worked in a single
 *     unit — tile widths — because a CSS `height: 200%` is 200% of the tile
 *     HEIGHT, not its width. Treating both axes as unit-length (the earlier
 *     bug) stretched cells to ~3.8:1 on a 16:9 tile.
 *  2. The rotated grid fully covers the tile, so no band of flat color is left
 *     above or below the art.
 *
 * Rotating the tile back into the grid's own frame gives the span the grid must
 * cover; because constraint 1 pins the grid's own aspect, the grid is then
 * scaled up until whichever axis is short reaches that span.
 */
export function getGridSize(cols, rows, tileAspect = TILE_ASPECT, rotationDeg = ROTATION_DEG) {
  const theta = (Math.abs(rotationDeg) * Math.PI) / 180
  const cos = Math.abs(Math.cos(theta))
  const sin = Math.abs(Math.sin(theta))
  const tileHeight = 1 / tileAspect // in tile widths

  const spanW = cos + tileHeight * sin
  const spanH = sin + tileHeight * cos

  const ratio = (BANNER_ASPECT * cols) / rows // grid width / grid height
  const root = Math.sqrt(ratio)
  const scale = Math.max(spanW / root, spanH * root)

  const gridWidth = scale * root // tile widths
  const gridHeight = scale / root // tile widths

  // Convert the height back into a fraction of the tile's HEIGHT for CSS.
  return { width: gridWidth, height: gridHeight * tileAspect }
}

export default function CollectionTile({
  collection,
  artGames = [],
  onOpen,
  onContextMenu,
}) {
  const color = collection.color || 'var(--color-accent)'
  const art = artGames.slice(0, MAX_ART)
  const { cols, rows } = getGridShape(Math.max(1, art.length))
  const { width, height } = getGridSize(cols, rows)

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
        {art.length > 0 && (
          <div
            // Centered on the tile: the translate cancels the 50%/50% offset so
            // the grid's midpoint is the tile's midpoint, and rotation happens
            // about that same point.
            className="absolute left-1/2 top-1/2 grid"
            style={{
              width: `${width * 100}%`,
              height: `${height * 100}%`,
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
              gap: '6px',
              transform: `translate(-50%, -50%) rotate(${ROTATION_DEG}deg)`,
            }}
          >
            {/* Only real art is rendered. Any trailing cells in the last row are
                left empty so the color wash shows through, rather than drawing
                blank placeholder blocks. */}
            {art.map((game, index) => (
              <div key={game?.record_id ?? index} className="overflow-hidden rounded-sm">
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
