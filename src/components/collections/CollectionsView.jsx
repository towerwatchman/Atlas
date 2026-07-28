import CollectionTile from './CollectionTile.jsx'

// The collections screen shown inside the library window. Uncategorized has no
// tile here by design — it is a derived bucket, only surfaced in the tree.
export default function CollectionsView({
  collections = [],
  artRecordIds = {},
  gamesByRecordId,
  loading = false,
  onOpenCollection,
  onCreateCollection,
  onCollectionContextMenu,
}) {
  const resolveArt = (collectionId) =>
    (artRecordIds[collectionId] || [])
      .map((recordId) => gamesByRecordId?.get(Number(recordId)))
      .filter(Boolean)

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">Collections</h2>
          <p className="text-xs text-muted">
            Group titles however you like. A title can be in more than one collection.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        <button
          type="button"
          onClick={onCreateCollection}
          className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-border bg-secondary/40 text-muted transition-colors hover:border-accent hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent"
          style={{ aspectRatio: '16 / 9' }}
        >
          <i className="fas fa-plus text-xl" aria-hidden="true"></i>
          <span className="text-sm font-medium">Create a New Collection</span>
        </button>

        {collections.map((collection) => (
          <CollectionTile
            key={collection.id}
            collection={collection}
            artGames={resolveArt(collection.id)}
            onOpen={onOpenCollection}
            onContextMenu={onCollectionContextMenu}
          />
        ))}
      </div>

      {!loading && collections.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          No collections yet. Create one above, or right-click any game and choose
          {' '}<span className="text-text">Add to → + New Collection</span>.
        </p>
      )}
    </div>
  )
}
