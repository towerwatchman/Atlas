import { getGameTitle } from '../../utils/gameDisplay.js'
import { groupGamesByCollection, UNCATEGORIZED_ID } from '../../hooks/useCollections.js'

// The 200px library side panel. Was a flat list of titles inline in App.jsx;
// now groups by collection with expand/collapse and per-group counts.
//
// Collections only apply to the local library, so in catalog/wishlist mode this
// renders the original ungrouped list (see `grouped`).
export default function GameTree({
  games = [],
  collections = [],
  collectionIdsByRecord,
  grouped = true,
  expandedIds,
  onToggleExpanded,
  selectedRecordId,
  onSelectGame,
  onGameContextMenu,
  emptyMessage = 'No games found',
}) {
  const renderGame = (game) => {
    const isSelected = selectedRecordId === game.record_id
    const isMissing = game.hasInstalledVersion === false && !game.isCatalogEntry
    return (
      <div
        key={`${game.record_id}`}
        className={`text-shadow-fx text-glow-fx game-titles cursor-pointer p-2 hover:bg-selected ${
          isSelected ? 'bg-selected selected' : ''
        } ${isMissing ? 'italic text-muted' : ''} ${grouped ? 'pl-5' : ''}`}
        onClick={() => onSelectGame?.(game)}
        onContextMenu={(event) => {
          event.preventDefault()
          onGameContextMenu?.(game, event)
        }}
        title={getGameTitle(game)}
      >
        <span className="block truncate">{getGameTitle(game)}</span>
      </div>
    )
  }

  if (games.length === 0) {
    return <div className="p-2 text-center text-text">{emptyMessage}</div>
  }

  if (!grouped) {
    return <>{games.filter(Boolean).map(renderGame)}</>
  }

  const groups = groupGamesByCollection(games, collections, collectionIdsByRecord)

  // Every collection gets a row even when empty under the current filters, so
  // the tree doesn't appear to lose collections as you search. Uncategorized is
  // the exception — groupGamesByCollection only emits it when non-empty.
  return (
    <>
      {groups.map((group) => {
        const isExpanded = expandedIds?.has(String(group.id))
        return (
          <div key={String(group.id)}>
            <div
              className="flex cursor-pointer select-none items-center gap-1 px-2 py-1.5 hover:bg-selected"
              onClick={() => onToggleExpanded?.(String(group.id))}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onToggleExpanded?.(String(group.id))
                }
              }}
            >
              <i
                className={`fas ${isExpanded ? 'fa-minus' : 'fa-plus'} w-3 shrink-0 text-[9px] text-muted`}
                aria-hidden="true"
              />
              <span
                className={`min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide ${
                  group.id === UNCATEGORIZED_ID ? 'text-muted' : 'text-text'
                }`}
                title={group.name}
              >
                {group.name}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted">
                {group.games.length}
              </span>
            </div>
            {isExpanded && group.games.map(renderGame)}
          </div>
        )
      })}
    </>
  )
}
