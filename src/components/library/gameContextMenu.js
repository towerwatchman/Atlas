import { buildCollectionMenuItems } from '../collections/collectionMenu.js'
import { sortVersionsDesc } from '../detail/page/gameDetailUtils.js'
import { linkableGameLinks } from '../detail/gameLinks.js'
import { buildWishlistPayload } from '../../utils/wishlistPayload.js'

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

  // Newest first. Uses the same comparator as the detail page's version list, so
  // the two orders cannot disagree — a menu ordered differently from the page it
  // opens would be worse than either order on its own.
  const allVersions = sortVersionsDesc(game.versions || [])

  // ── Two lists, not one ──────────────────────────────────────────────────────
  //
  // Play and Open Game Folder used to share a single list built as
  // `filter(v => v.exec_path && v.hasExecutable !== false)`, and that filter was
  // wrong for both of them.
  //
  // Steam and GOG versions are stored with an EMPTY exec_path -- they launch via
  // steam://run and goggalaxy://openGameView, see the upsertVersion calls in
  // electron/ipc/importer.js -- so every Steam or GOG title was filtered out
  // before either row was built, losing Play as well as the folder. (The
  // `hasExecutable` half never did anything at all: that name is a local inside
  // launchGame and has never been on a version object here.)
  //
  // They are separate now because they answer to different rules, and one list
  // could only ever satisfy one of them:
  //
  //   Play    an executable, or an external launcher that resolves the install
  //           itself. Missing versions are excluded -- launching one cannot work.
  //   Folder  a path recorded, whether or not it is currently there. Missing ones
  //           are listed and disabled, because a row that silently vanishes tells
  //           the user nothing.
  const launchableVersions = allVersions.filter(
    (version) =>
      version?.isInstalled !== false &&
      (version?.exec_path || version?.source === 'steam' || version?.source === 'gog'),
  )
  const folderVersions = allVersions.filter((version) => Boolean(version?.game_path))

  // An explicit selection still wins; otherwise the default is now the newest
  // version rather than whichever happened to come first out of the database.
  const selectedVersion =
    launchableVersions.find((version) => version.version_id === game.selected_version_id)
    || launchableVersions[0]

  // version_id rather than the version string. versions has
  // UNIQUE(record_id, version) so the string is usually unambiguous, but
  // clientAudit reports duplicate version rows on legacy databases as
  // "not auto-repaired", and SQLite treats NULLs as distinct under UNIQUE so
  // blank labels slip past it entirely. The id is exact in both cases.
  //
  // source/sourceAppId ride along on launch so handleContextAction can pass them
  // to launchGame, which picks steam:// over goggalaxy:// from `source` and
  // prefers the VERSION's appid over the title-level mapping.
  const launchData = (version) => ({
    action: 'launch',
    recordId,
    versionId: version.version_id,
    version: version.version,
    source: version.source || null,
    sourceAppId: version.source_app_id ?? version.sourceAppId ?? null,
  })
  const folderData = (version) => ({
    action: 'openFolder',
    recordId,
    versionId: version.version_id,
    version: version.version,
  })

  const items = []

  // ── Play ────────────────────────────────────────────────────────────────
  if (launchableVersions.length === 1) {
    items.push({
      label: 'Play',
      icon: 'fa-play',
      variant: 'play',
      data: launchData(launchableVersions[0]),
    })
  } else if (launchableVersions.length > 1) {
    // One row that both launches the default version AND lists the others. A
    // native menu cannot do this — it ignores clicks on items with a submenu —
    // which is why this used to be two separate entries.
    items.push({
      label: 'Play',
      icon: 'fa-play',
      variant: 'play',
      hint: selectedVersion?.version,
      data: selectedVersion ? launchData(selectedVersion) : undefined,
      submenu: launchableVersions.map((version) => ({
        label: version.version || 'Unknown version',
        icon: version.version_id === selectedVersion?.version_id ? 'fa-check' : undefined,
        data: launchData(version),
      })),
    })
  }

  // ── Links ───────────────────────────────────────────────────────────────
  // Sits above the isLocal gate on purpose: browse and wishlist rows carry
  // external_ids and siteUrl even though they have no local record, and the
  // store link is arguably most useful for a title that isn't in the library yet.
  //
  // Same builder as the details page, so the two lists cannot disagree. Store
  // links are public store pages, never account-scoped library pages — a title
  // can be listed without being owned, so an account URL would break for exactly
  // the games most likely to need the link.
  const links = linkableGameLinks(game)
  if (links.length > 0) {
    items.push({
      label: 'Links',
      icon: 'fa-link',
      submenu: links.map((link) => ({
        label: link.label,
        icon: link.icon,
        hint: link.value && link.value !== link.url ? String(link.value) : undefined,
        // openUrl (not openLink) — it already exists in handleContextAction and
        // takes a resolved url, which is why the url is resolved here rather
        // than looked up again in the main process.
        data: { action: 'openUrl', url: link.url },
      })),
    })
  }

  // Sits above the isLocal gate for the same reason Links does. Catalog and
  // wishlist rows carry the identity fields a toggle needs despite having no
  // local record, so "Add to Wishlist" belongs to them.
  //
  // A local row gets the entry only when it is ALREADY wishlisted, so an
  // installed title that is still flagged can be cleared from the grid rather
  // than only from the detail panel. Adding a local title is deliberately not
  // offered: addWishlistEntry refuses a record that exists in the library
  // (it returns { success: false, inLibrary: true }), so the menu would present
  // an action that cannot succeed.
  const isWishlisted = game.isWishlisted === true
  if (!isLocal || isWishlisted) {
    items.push({
      label: isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist',
      icon: 'fa-bookmark',
      // Only the identity/metadata fields the main process reads are sent, not
      // the whole row. `action` is written after the spread so a game carrying
      // an `action` key of its own cannot hijack the dispatch.
      data: {
        ...buildWishlistPayload(game),
        action: 'toggleWishlist',
      },
    })
  }

  if (!isLocal) {
    // Browse and wishlist rows have no local record, so library-management
    // actions (collections, open folder, remove/delete) do not apply.
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
      // Action name must match the case in handleContextAction
      // (electron/ipc/windows.js). It was 'favorite' here but 'setFavorite'
      // there, so every click fell through to the default branch and logged
      // "Unknown action" instead of toggling anything.
      data: { action: 'setFavorite', recordId, isFavorite: !game.isFavorite },
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

  // One version needs no submenu: a list of one is a step, not a choice.
  if (folderVersions.length === 1) {
    const only = folderVersions[0]
    manage.push({
      label: 'Open Game Folder',
      icon: 'fa-folder-open',
      disabled: only.isInstalled === false,
      hint: only.isInstalled === false ? 'missing' : undefined,
      data: folderData(only),
    })
  } else if (folderVersions.length > 1) {
    // The parent stays clickable and opens the default version, the way Play
    // does. The custom menu allows that; a native one would ignore the click.
    const folderDefault = folderVersions.find(
      (version) => version.version_id === selectedVersion?.version_id,
    ) || folderVersions.find((version) => version.isInstalled !== false)
    manage.push({
      label: 'Open Game Folder',
      icon: 'fa-folder-open',
      hint: folderDefault?.version,
      data: folderDefault ? folderData(folderDefault) : undefined,
      submenu: folderVersions.map((version) => ({
        label: version.version || 'Unknown version',
        // Listed but not clickable. Hiding it would make the row disappear with
        // no explanation; the hint says which state it is in.
        disabled: version.isInstalled === false,
        hint: version.isInstalled === false ? 'missing' : undefined,
        icon: version.version_id === folderDefault?.version_id ? 'fa-check' : undefined,
        data: folderData(version),
      })),
    })
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
