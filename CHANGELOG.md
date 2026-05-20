# Changelog

## 1.0.62 - 2026-05-20

### Added
- `src/core/importer/importer.jsx`: added `Scan Existing Library` and `Import Game-List Data` importer entry points for migration and repair workflows.
- `src/core/importer/importer.jsx`: added `Force re-import existing games` so users can explicitly repair existing rows or refresh selected media without default duplicate imports.
- `src/main.js` and `src/renderer.js`: added IPC support for Game-List scans, default library folder selection, import-status rechecks, and selected-game media refresh.
- `src/main.js`: added bundled RAR5 extraction through `node-unrar-js` so RAR archives import without requiring system WinRAR, 7-Zip, or `unrar`.
- `src/database.js`: added startup-safe repair passes for doubled-apostrophe DB text/path corruption and stale executable paths.

### Changed
- `package.json` and `package-lock.json`: added direct runtime dependencies for `7zip-bin` and `node-unrar-js`, removed the old `unrar` dependency, and updated Electron Builder packaging/unpack rules for extractor/native assets.
- `src/core/scanners/f95scanner.js`: expanded importer scanning to support library resync, metadata-only Game-List rows, archive visibility, nested launchable discovery, exact-path repair statuses, and cleaner folder/archive title-version parsing.
- `src/core/importer/importer.jsx`: wired scan-result eligibility around separate unmatched/archive/force options and recalculates install status after `Update Matches` or manual match changes.
- `src/main.js`: changed archive import layout to normalize single wrapper folders and move extracted contents directly into the final version folder when possible.
- `src/database.js`: made import dedupe prefer exact `game_path` before Atlas/title matches and compare archive candidates by Atlas mapping plus installed version.
- `src/App.jsx`: replaced imported or updated games in existing React state instead of appending duplicate cards.

### Fixed
- `src/main.js`: fixed RAR5 imports failing because bundled `7za.exe` cannot open RAR archives.
- `src/main.js`: fixed post-extraction executable selection so runtime helper files such as `python.exe` and `zsync.exe` are ignored.
- `src/core/importer/importer.jsx` and `src/database.js`: fixed archives remaining importable after `Update Matches` selected an already-installed Atlas/F95 record.
- `src/database.js`: fixed installed games disappearing when `game_path` existed but `exec_path` still pointed at an old archive-wrapper folder.
- `src/core/importer/importer.jsx`: fixed library resync media refresh so already-imported matched rows can download or refresh media when media options are checked.
- `src/main.js`: fixed already-imported and repair rows creating duplicate records instead of updating existing version paths.

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
