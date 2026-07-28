// Builds the "Add to" / "Remove from" context-menu entries shared by the
// library grid banners (GameBanner.jsx) and the library tree (GameTree.jsx),
// so both menus stay identical as collections change.
//
// These are native Electron menu templates — the renderer sends a plain
// serializable template over `show-context-menu` and the main process attaches
// the click handlers (see electron/ipc/windows.js processTemplate).

/**
 * @param {object}   options
 * @param {number}   options.recordId     Title the menu was opened on.
 * @param {Array}    options.collections  All collections: [{ id, name }].
 * @param {number[]} options.memberOf     Collection ids this title belongs to.
 * @returns {Array} Menu template items, ready to concat into a larger menu.
 */
export function buildCollectionMenuItems({ recordId, collections = [], memberOf = [] }) {
  const memberSet = new Set(memberOf.map(Number))
  const sorted = [...collections].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }),
  )

  // "Add to" lists every collection the title is NOT already in, so choosing
  // one always does something. "+ New Collection" is always available.
  const addTargets = sorted.filter((collection) => !memberSet.has(Number(collection.id)))
  const addSubmenu = addTargets.map((collection) => ({
    label: collection.name,
    data: { action: 'addToCollection', collectionId: collection.id, recordId },
  }))
  if (addSubmenu.length > 0) addSubmenu.push({ type: 'separator' })
  addSubmenu.push({
    label: '+ New Collection',
    data: { action: 'newCollectionWithGame', recordId },
  })

  const items = [{ label: 'Add to', submenu: addSubmenu }]

  // "Remove from" only appears when the title is actually in something, and
  // lists only those collections.
  const removeTargets = sorted.filter((collection) => memberSet.has(Number(collection.id)))
  if (removeTargets.length > 0) {
    items.push({
      label: 'Remove from',
      submenu: removeTargets.map((collection) => ({
        label: collection.name,
        data: { action: 'removeFromCollection', collectionId: collection.id, recordId },
      })),
    })
  }

  return items
}
