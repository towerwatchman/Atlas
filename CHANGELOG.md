# Changelog

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
