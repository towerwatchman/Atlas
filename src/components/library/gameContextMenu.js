import { buildCollectionMenuItems } from '../collections/collectionMenu.js'

// Item tree for a game's context menu.
//
// Consolidated from twelve flat entries down to five rows. Play, Favorites and
// Properties stay at the top level because they are the common actions;
// everything else groups under "Add to" or "Manage" so the menu is short enough
// to scan without reading it.
//
// `data` payloads are exactly the ones the native menu templates used, so they
// route through the same handleContextAction in the main process. Reusing that
// keeps the confirmation dialogs and delete safeguards in one place.

/**
 * @param {object} game
 * @param {Array}  collections            All collections, for "Add to".
 * @param {Map}    collectionIdsByRecord   record_id -> [collectionId].
 */
export function buildGameContextMenu({ game, collections = [], collectionIdsByRecord = null }) {
  if (!game) return []
  const recordId = game.record_id
  const isLocal = game.isCatalogEntry !== true && game.isMetadataOnly !== true && Boolean(recordId)

  const installedVersions = (game.versions || []).filter(
    (version) => version?.exec_path && version?.hasExecutable !== false,
  )
  const selectedVersion =
    installedVersions.find((version) => version.version_id === game.selected_version_id)
    || installedVersions[0]

  const items = []

  // ── Play ────────────────────────────────────────────────────────────────
  if (installedVersions.length === 1) {
    items.push({
      label: 'Play',
      icon: 'fa-play',
      variant: 'play',
      data: { action: 'launch', recordId, version: installedVersions[0].version },
    })
  } else if (installedVersions.length > 1) {
    // One row that both launches the default version AND lists the others. A
    // native menu cannot do this — it ignores clicks on items with a submenu —
    // which is why this used to be two separate entries.
    items.push({
      label: 'Play',
      icon: 'fa-play',
      variant: 'play',
      hint: selectedVersion?.version,
      data: selectedVersion
        ? { action: 'launch', recordId, version: selectedVersion.version }
        : undefined,
      submenu: installedVersions.map((version) => ({
        label: version.version || 'Unknown version',
        icon: version.version_id === selectedVersion?.version_id ? 'fa-check' : undefined,
        data: { action: 'launch', recordId, version: version.version },
      })),
    })
  }

  if (!isLocal) {
    // Browse and wishlist rows have no local record, so nothing below applies.
    return items
  }

  // ── Add to ──────────────────────────────────────────────────────────────
  // Favorites lives in here rather than at the top level: it is the same kind of
  // action as adding to a collection, and grouping it keeps the top level to
  // four rows. Marked with a tick when already a favorite, matching how the
  // version submenu shows the current selection, so one entry serves as both add
  // and remove.
  const collectionItems = buildCollectionMenuItems({
    recordId,
    collections,
    memberOf: collectionIdsByRecord?.get(Number(recordId)) || [],
  })
  const addTo = collectionItems.find((item) => item.label === 'Add to')
  const removeFrom = collectionItems.find((item) => item.label === 'Remove from')

  const addToSubmenu = [
    {
      label: 'Favorites',
      icon: game.isFavorite ? 'fa-check' : 'fa-heart',
      data: { action: 'favorite', recordId, isFavorite: !game.isFavorite },
    },
    { type: 'separator' },
    ...(addTo?.submenu || []),
  ]
  items.push({ label: 'Add to', icon: 'fa-plus', submenu: addToSubmenu })

  // ── Manage ──────────────────────────────────────────────────────────────
  const manage = []
  manage.push({ label: 'Rate Game…', icon: 'fa-star', data: { action: 'rateTitleRequested', recordId, title: game.title } })
  if (removeFrom) {
    manage.push({ label: 'Remove from Collection', icon: 'fa-layer-group', submenu: removeFrom.submenu })
  }

  if (installedVersions.length === 1) {
    manage.push({
      label: 'Open Game Folder',
      icon: 'fa-folder-open',
      data: { action: 'openFolder', recordId, version: installedVersions[0].version },
    })
  } else if (installedVersions.length > 1) {
    manage.push({
      label: 'Open Game Folder',
      icon: 'fa-folder-open',
      data: selectedVersion
        ? { action: 'openFolder', recordId, version: selectedVersion.version }
        : undefined,
      submenu: installedVersions.map((version) => ({
        label: version.version || 'Unknown version',
        data: { action: 'openFolder', recordId, version: version.version },
      })),
    })
  }

  if (game.url || game.f95_url || game.lewdcorner_url) {
    manage.push({ label: 'Open Web Link', icon: 'fa-link', data: { action: 'openLink', recordId } })
  }

  manage.push({ type: 'separator' })
  manage.push({
    label: 'Remove from Library',
    icon: 'fa-eject',
    danger: true,
    data: { action: 'removeTitleFromLibrary', recordId, title: game.title },
  })
  manage.push({
    label: 'Delete Title and Files',
    icon: 'fa-trash',
    danger: true,
    data: { action: 'deleteTitleAndFiles', recordId, title: game.title },
  })

  items.push({ label: 'Manage', icon: 'fa-sliders', submenu: manage })

  items.push({ type: 'separator' })
  items.push({ label: 'Properties…', icon: 'fa-circle-info', data: { action: 'properties', recordId } })

  return items
}
