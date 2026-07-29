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

// Ceiling on how wide one cell may be, as a fraction of the tile's width.
//
// A cap is needed because covering the tile and keeping cells small are in
// direct conflict when the grid is sized from the game count: covering a 16:9
// tile at 60 degrees with a single cell forces that cell to 245% of the tile's
// width. Under the cap, small collections leave some flat color top and bottom
// instead of scaling art up to fill.
//
// Cells are free to run past the tile edge and be clipped — an image does not
// have to be visible in full — which is what lets these sit as high as they do.
const BASE_CELL_WIDTH = 0.45
const CELL_ZOOM = 1.4 // every count
const SINGLE_CELL_ZOOM = 1.5 // a lone image gets a little more

const maxCellWidth = (cols, rows) =>
  BASE_CELL_WIDTH * (cols === 1 && rows === 1 ? SINGLE_CELL_ZOOM : CELL_ZOOM)

// Ceiling on how much art a tile draws, which also caps the grid at 2x4. Must
// match TILE_ART_LIMIT in electron/ipc/collections.js, which decides how many
// record ids are fetched per collection.
export const MAX_ART = 8

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
 *  2. Size is the smaller of two things: the size that would exactly cover the
 *     tile once rotated, and maxCellWidth(). Rotating the tile back into the
 *     grid's own frame gives the span needed to cover, but with few cells that
 *     span implies an absurdly large cell, so the cap wins and the tile is
 *     left partly uncovered.
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
  const coverScale = Math.max(spanW / root, spanH * root)

  // With few cells, covering would demand a cell wider than the tile itself.
  const coveringCellWidth = (coverScale * root) / cols
  // Never exceed the covering size: past that, extra width only pushes art off
  // the tile with nothing gained on screen.
  const cellWidth = Math.min(coveringCellWidth, maxCellWidth(cols, rows))

  const gridWidth = cellWidth * cols // tile widths
  const gridHeight = (cellWidth / BANNER_ASPECT) * rows // tile widths

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
                    className="atlas-smooth-image h-full w-full object-cover"
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
