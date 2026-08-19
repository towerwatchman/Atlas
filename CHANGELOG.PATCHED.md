# Changelog - PATCHED

## Fork's Nightly Changes
- Remove the 'has Steam mapping' quick filter. [PR#360](https://github.com/towerwatchman/Atlas/pull/360)
- Fix and remove the redundant isWishlistEntry memory flag which was set but never unset and cause unexpected behavior on entry display regarding wishlist. The isWishlisted logic will check the data from wishlist_entries instead. Note: the IPC behavior is not related and not updated. [PR#366](https://github.com/towerwatchman/Atlas/pull/366)
- Fixed slow "wishlist only" filtering in Browse and Library by 1. Adding indexes on columns used in query and 2. Splitting a single multi-OR subquery into separate EXISTS clauses. [PR#367](https://github.com/towerwatchman/Atlas/pull/367)
- Implement add/remove wishlist in Browse mode context menu that trigger `toggleWishlist` action for non-local rows, Using optimistc UI approach to dispatch the db update, and the success broadcast triggers the renderer so grid view without triggering full refresh. The `wishlist-updated` broadcast is now source-tagged: context-menu toggles skip the catalog refetch (optimistic UI already flipped the row), while the extension path keeps it (no optimistic UI exists there). [PR#368](https://github.com/towerwatchman/Atlas/pull/368)
