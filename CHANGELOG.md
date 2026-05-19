# Changelog

## 1.0.61 - 2026-05-20

### Added
- Added an opt-in `Show uninstalled games` library filter so metadata-only records can be viewed without treating them as installed.
- Added a Steam-style selected-game detail refresh action that re-downloads banner and all preview images for one game.
- Added play-session tracking for local launches, updating last played and accumulated playtime from existing version records.
- Added a manual database update action to the left sidebar Updates button with visible progress feedback.

### Changed
- Wired the top search bar and filter-sidebar search box to the same title/creator filter state.
- Changed preview downloads to fetch all available previews by default instead of stopping at five.
- Improved archive imports so structured archive extraction lands in the final version folder and avoids an extra extract-then-copy pass when possible.
- Muted and labeled uninstalled library entries in the sidebar, grid, and detail page while keeping repair actions available.

### Fixed
- Fixed archive imports leaving an extra archive-name wrapper folder between the version folder and executable.
- Fixed archive import performance by extracting to a temporary final-location folder and renaming when possible.
- Fixed Play/Open Folder/detail actions for uninstalled records so unavailable actions stay disabled.
- Fixed game detail refresh and Properties media refresh so updated previews/banners refresh live.
- Fixed missing playtime and last-played updates after launching games.
- Fixed the left sidebar Updates icon doing nothing when clicked.

## 1.0.60 - 2026-05-19

### Added
- Added local check tooling for JavaScript, JSX parsing, version-comparison checks, and CI gate preparation.
- Added Electron native dependency rebuild hooks so native modules are rebuilt consistently after install.

### Changed
- Upgraded Electron to 42 and refreshed the Electron packaging stack.
- Upgraded SQLite native bindings to `sqlite3` 6 and rebuilt native modules for the packaged Electron runtime.
- Removed unused direct dependencies and refreshed lower-risk runtime/build dependencies to reduce package weight.
- Updated README badges and GitHub links to point at the `SekhmetAnkh/Atlas` fork.
- Hardened Play, Open Folder, and recursive delete flows so trusted paths are resolved through stored game/version records.
- Hardened metadata update ingestion by validating update tables and columns before building SQL.

### Fixed
- Fixed false Atlas update notifications caused by comparing raw `v`-prefixed and non-prefixed version strings.
- Fixed local installer packaging after enabling Windows Developer Mode, confirming normal signed Windows builds now complete.
- Cleared npm audit findings across production and development dependencies.

## 1.0.59 - 2026-05-18

### Added
- Added a Steam-style game detail page in the main window with preview media, installed versions, update state, and quick actions for Play, Open Folder, Properties, and external links.
- Added separate import choices for unmatched games and archive extraction so matched folders can import without enabling broad override behavior.
- Added import cancellation with cleanup for the current unfinished item while preserving imports that already completed.
- Added GitHub Actions installer artifact builds for Windows and Linux.

### Changed
- Improved importer metadata parsing so folder and archive names populate cleaner titles and installed versions for Atlas/F95 matching.
- Updated import eligibility so archive rows, unmatched rows, already-imported rows, and missing-launchable rows are handled independently.
- Moved packaged data and launcher storage to the user data path in packaged builds, with one-time migration from legacy packaged resource folders.
- Updated packaging configuration so native runtime files, including Sharp dependencies, are included and unpacked correctly.
- Standardized update-available comparison around installed versions versus Atlas/F95 latest versions.
- Kept deleted or missing local installs hidden from the main library without deleting their database metadata.

### Fixed
- Fixed local folder scans reporting zero games when launchables were nested deeper inside extracted game folders.
- Fixed normal scans so root `.zip`, `.rar`, and `.7z` archives appear as archive candidates while extraction still happens only during import.
- Fixed archive import paths so extracted games are not copied from the parent download folder into every game entry.
- Fixed large `.zip` extraction failures caused by loading archives fully into memory.
- Fixed invalid Windows folder names during archive extraction/import, including titles with characters such as `:`.
- Fixed manually edited installed versions not refreshing update visuals until restart.
- Fixed a regression where installed games disappeared because path validation was using the wrong `fs` API object.
- Fixed deleted local folders still appearing as installed after restart.
- Fixed duplicate download dialogs by stopping destination selection when the archive picker is canceled.
- Fixed the Properties window fallback that could load `RecordID 1` when no selected game data was available.
- Fixed search to match titles or creators by default and guarded sorting/searching against missing fields.
- Fixed visible sidebar sort options for title, release date, likes, views, and rating.
