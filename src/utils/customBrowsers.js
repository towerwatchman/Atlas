// Custom browser id is `custom:<index>`.
export function parseCustomBrowserId(value) {
  const match = /^custom:(\d+)$/.exec(String(value ?? ''))
  return match ? Number(match[1]) : -1
}

// Append a validated path and select the new entry.
export function addCustomBrowserPath(paths, picked) {
  const updated = [...(Array.isArray(paths) ? paths : []), picked]
  return { paths: updated, browserId: `custom:${updated.length - 1}` }
}

// Remove one entry: the removed selection resets to default, a selected later
// index shifts down with the list, an earlier selection is untouched.
export function removeCustomBrowserPath(paths, browserId, removeIndex) {
  const list = Array.isArray(paths) ? paths : []
  const updated = list.filter((_, i) => i !== removeIndex)
  const selected = parseCustomBrowserId(browserId)
  if (selected >= 0 && selected < removeIndex) return { paths: updated, browserId }
  if (selected > removeIndex) return { paths: updated, browserId: `custom:${selected - 1}` }
  return { paths: updated, browserId: 'default' }
}
