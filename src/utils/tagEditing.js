// Whether a game's tags can be edited.
//
// Tag overrides are stored in game_metadata_overrides, keyed on
// games.record_id. A Browse (catalog) row is not a local record — it has no
// record_id to hang an override off, nothing to reset to, and no tag_mappings
// rows — so its tags are read-only.
//
// This started as an inline condition in GameDetailPage and got it wrong:
// Browse rows fell through to the editor, which read an empty override state and
// rendered "No tags" over the top of catalog tags that were right there in the
// row. Pulled out here so the rule is stated once and can be tested.
export function canEditTags(game) {
  if (!game) return false
  // Metadata-only records exist for wishlist/browse entries with no local files.
  if (game.isMetadataOnly === true) return false
  if (game.isCatalogEntry === true) return false
  return Boolean(game.record_id)
}
