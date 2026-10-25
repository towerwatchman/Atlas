# Changelog

Nightly builds. Stable releases are tracked in [CHANGELOG.md](./CHANGELOG.md).
Sections run back to 0.9.0-nightly.325; the 0.1.0 nightlies before that are kept
in [LEGACY.CHANGELOG.md](./LEGACY.CHANGELOG.md). From 0.9.14 a build is named for
the release it heads to; earlier labels mix the cycle and the candidate, as
[legacy-tag-history.md](./legacy-tag-history.md) records.

## 0.9.12-nightly.517

- **changed**: Cloudflare handling (part 4): the download resolve window no longer appears while the page is still making progress. It stays hidden through a Cloudflare challenge that clears on its own and through the `/dl/` countdown, and appears only after about 4 seconds with no progress.
  - The hidden window is no longer throttled like a background tab, which could freeze F95's own scripts.
  - A funding or social page opened from a shown window is no longer accepted as the resolved link.
- **changed**: Update dialog: a game linked to only one site now shows its source tab, which carries the fetched version.

## 0.9.12-nightly.516

- **fix**: Serve banner previews in the order custom, downloaded, remote, and probe the image path so an invalid one is skipped.
- **feat**: Add a Metadata setting that clears the web image cache, for images cached from a transient 404.

## 0.9.12-nightly.515

- **chore**: Add debug logs for Cloudflare and masked-resolve handling in the downloader popup, sent to the devtools console.

## 0.9.12-nightly.514

- **changed**: When both sources hit a challenge, the F95 and LewdCorner fallback windows now run in parallel, and each tab fetches its own version instead of sharing the single latest version.
  - LewdCorner parsing: handle LC entries where a `<b></b>` wraps the entire Downloads section.
  - F95 and LewdCorner parsing: add base plus fixture handling for the known templates.
- **fix**: Restore LewdCorner's Plus member check so eligible Plus titles are available again.
- **fix**: Cloudflare handling (part 3): LewdCorner thread links now open the real-browser window on a 403 or challenge page instead of failing outright, and a grant solved during account login carries over to downloads while it is still valid.

## 0.9.12-nightly.513

- **fix**: Update F95 parsing and link fetching for the site's current structure.

## 0.9.12-nightly.512

- **fix**: Follow-up fix for F95 Cloudflare challenges on the non-challenge fetch path, so solved cookies are reused there too.

## 0.9.10-nightly.511

- **changed**: Solved F95 Cloudflare checks are remembered and reused for thread fetches, through the real browser stack instead of a faked user agent.
  - F95 tightened its Cloudflare settings, so this shipped as a hotfix and may be revisited.

## 0.9.10-nightly.510

- **feat**: Version source chips (Steam, GOG, Itch) appear in the Edit Game Details version list for remote games (#345).
- **feat**: Game detail metadata is clickable (#130). Tags, categories, engines and statuses jump to filtered searches, while developers and languages run text searches.
  - A plain click follows the Browse or Library mode set in Settings > Interface; Shift-click switches modes.
- **feat**: Esc exits the game entry page and unfocuses the search bar, filter sidebar search and tag search (#130).
- **fix**: Filter sidebar badge counts reflect all results, including exclusive filters for tags, categories, engines and statuses (#130).
- **fix**: Switching between Browse and Library without the sidebar buttons no longer double-highlights a mode (#130).

## 0.9.10-nightly.509

- **feat**: Original Name is exposed in Edit Game Details and is searchable in library and Browse search (#365).

## 0.9.10-nightly.508

- **fix**: Added a rate limit to the install-time image download, which was hammering the image service, broken in 0.9.10-nightly.507.

## 0.9.10-nightly.507

- **fix**: Installing a game with download mode on now fetches the title's media assets in the background once the install finishes (#421).

## 0.9.10-nightly.506

- **feat**: Choose which browser Atlas opens external links with (#420). Windows and macOS are supported; Linux still needs live testing.

## 0.9.10-nightly.505

- **fix**: Steam-version previews no longer render twice in download mode, and Steam previews, banners, trailers and logos stay inside their own season (#301).

## 0.9.10-nightly.504

- **feat**: LewdCorner is now a download source beside F95, including when the entry does not exist on F95 (#414).
  - Requires an eligible LewdCorner account.

## 0.9.10-nightly.503

- **fix**: Buzzheavier and Mega downloads broke after the Gofile support landed; fixed.

## 0.9.9-nightly.501

- **feat**: Added a Browse blacklist. Titles can be blacklisted from the right-click menu or the detail page, stay hidden across restarts, and are listed in Settings > Blacklist with a Remove button.
- **feat**: Added Gofile as a download host. One-file folders queue directly, multi-file folders show a picker, and free usage needs no login; the rotating token salt is re-fetched automatically.
- **feat**: Atlas detects your LewdCorner membership tier (Standard, Plus or logged out) and filters Browse to what the account allows, rechecking periodically and on re-link.
- **feat**: Importer and Library folder schemes accept `{atlasId}`, so installs can be matched back to AtlasDB on re-import or rebuild.
- **feat**: Clicking a cover in Downloads opens the game entry, and clicking the build label opens the source thread in the browser.
- **changed**: Search in Catalog Browse and Library waits for a pause before filtering, so typing on a large library no longer lags.
- **changed**: Removed the restart popup from the Show debug console toggle; the setting applies to open windows immediately.
- **chore**: DevTools no longer opens automatically in dev mode unless it is enabled in config.

## 0.9.9-nightly.494

- **feat**: Added Date Added sorting and a date filter (last 7, 30, 90 days or a custom range) to the filter sidebar for library and wishlist entries.
- **fix**: Wishlist entries now use `flagged_at` as their Date Added, so uninstalled and wishlisted titles sort and filter correctly.

## 0.9.9-nightly.493

- **fix**: Catalog tag filtering now matches Library exactly: same token rule, and an indexed tag table instead of a substring scan on every click.

## 0.9.9-nightly.492

- **chore**: Raised the MEGA v1 test timeout; legacy key derivation is intentionally slow.

## 0.9.9-nightly.491

- **feat**: Folder and program locations accept a typed or pasted path, with the path highlighted red or green as it validates.
- **fix**: The executable chooser lists its candidates again; the renderer listened on a different event name than the main process sent.
- **fix**: `.bat` and `.cmd` launchers run on Windows again; the shell spawn split the path at the first space.

## 0.9.9-nightly.488

- **changed**: Windows download links are offered on Linux alongside the native builds, since Wine can run them.

## 0.9.9-nightly.487

- **feat**: Custom preview images can be added from a file, drag-and-drop or an image URL, with live progress. Previews reorder by drag and the order survives re-downloads and metadata refreshes.
- **fix**: Custom previews accept images only; the picker, drop zone and main process each reject other files.
- **fix**: A missing-only media refresh no longer re-downloads previews and banners already on disk.

## 0.9.9-nightly.486

- **fix**: Downloads and Collections scroll past the first screen again; neither had a scroll container of its own in the shared overflow-hidden pane.

## 0.9.9-nightly.485

- **feat**: Added Buzzheavier (`buzzheavier.com`, `bzzhr.to`, `bzzhr.co`). The Cloudflare challenge is solved in a persistent browser window, one resolve at a time, and only challenge cookies are kept.

## 0.9.9-nightly.484

- **feat**: The version readout in the topnav and sidebar opens that version's GitHub release page.

## 0.9.9-nightly.483

- **feat**: The game detail split-button offers Download Version beside Manual Install, opening the downloads modal for titles with an F95zone thread.
- **fix**: Download lists no longer drop whole sections or mislabel builds. An Extras heading no longer swallows the rest of a post, and Part 1/2/3 read as build names instead of archive fragments.

## 0.9.9-nightly.481

- **fix**: The Banner Editor's colour pickers stay open while you drag the slider or shade square.

## 0.9.9-nightly.480

- **fix**: Playtime is minutes everywhere with ceiling rounding, so the detail page and banner badge no longer show `1h 60m` or 0.4 minutes as Not played.

## 0.9.9-nightly.479

- **feat**: Browse rows can be added to or removed from the wishlist from the right-click menu, with the row updating immediately.

## 0.9.9-nightly.478

- **perf**: Wishlist-only filtering is faster, through indexes on the filtered columns and separate EXISTS clauses.

## 0.9.9-nightly.477

- **fix**: Wishlist state is read from the wishlist table, so a title no longer shows a stale flag that was never cleared.

## 0.9.9-nightly.476

- **changed**: Removed the Has Steam mapping quick filter.

## 0.9.9-nightly.475

- **fix**: A season label no longer outranks a bare semver. A game holding `0.11.1` is offered `v0.12.0` even with a `Season 1 & 2 - 0.8.3` folder present.

## 0.9.9-nightly.474

- **fix**: Entering Browse fetches the catalog once. Results no longer render, blank into a spinner and render again.

## 0.9.9-nightly.473

- **fix**: The F95 thread parser reads OS tags that wrap the label in a different `<b>` element, so those downloads are listed again (#326).

## 0.9.9-nightly.472

- **fix**: Removed the second scroll container from the library grid, so one scrollbar sits at the right edge and status banners stay pinned.
- **fix**: Settings > Database no longer nests a second scroll container inside the Settings shell.
- **fix**: Scrollbars are visible again at 4K and fractional Windows scaling; Chromium ignored the themed scrollbar once `scrollbar-width` was also set.

## 0.9.9-nightly.471

- **fix**: A pasted Steam, store or thread URL searches by the id extracted from it, including several DLC ids. The indexed URL is no longer the search term (#358).

## 0.9.9-nightly.470

- **chore**: Restored extension comments removed by the previous commit.

## 0.9.9-nightly.469

- **feat**: AtlasDB admins can queue the current thread from the extension in one click, behind a new checkbox (#363).

## 0.9.9-nightly.468

- **fix**: Saved Browse filters keep their sort order; twelve of the sixteen sorts were rewritten to Name A-Z on save, including the default Last Thread Update.

## 0.9.9-nightly.467

- **fix**: The Personal Rating on the game detail page no longer counts unrated categories as zero, so it matches the rating modal.

## 0.9.9-nightly.466

- **fix**: Installing no longer re-validates every library path on the main process. That pass locked the app on a large library on a mechanical drive.

## 0.9.9-nightly.465

- **fix**: Executable scans run async, and windows no longer freeze during an install. MEGA's alternate error shape is read.

## 0.9.9-nightly.464

- **feat**: The Updates button opens a chooser with Update all games, and install prompts become optional.

## 0.9.9-nightly.463

- **chore**: README logo switched to SVG.

## 0.9.9-nightly.461

- **fix**: README logo resource path.

## 0.9.9-nightly.460

- **changed**: The media lightbox is a global control, so images opened anywhere use the same viewer.

## 0.9.9-nightly.459

- **chore**: `runner.test` path updated.

## 0.9.8-nightly.456

- **fix**: Extension thread matching is isolated per site, so F95 and LewdCorner ids can no longer cross-match.
- **chore**: Added `.gitattributes` to hold CRLF line endings.

## 0.9.8-nightly.454

- **fix**: Download card captions and banner links work for rows with no library record.

## 0.9.8-nightly.453

- **feat**: Pixeldrain `/d/` links are parsed as a filesystem path (#328).

## 0.9.8-nightly.452

- **fix**: Open Game Folder opens the selected version's folder rather than its parent, and it appears for Steam and GOG titles again.
- **feat**: Each version card gets its own folder button, and missing versions are listed disabled instead of hidden.
- **fix**: Play and Open Game Folder are built from separate version lists, so one rule no longer hides the other.

## 0.9.8-nightly.451

- **fix**: A MEGA hashcash retry reuses its request id. A fresh challenge no longer makes the proof fail.

## 0.9.8-nightly.450

- **fix**: The MEGA hashcash worker loads from `app.asar.unpacked`. Sign-in works in packaged builds now, where it timed out before.

## 0.9.8-nightly.449

- **fix**: The library count is re-read after changes. The grid no longer treats a non-empty library as empty because the count was cached from mount.

## 0.9.8-nightly.448

- **fix**: `{engine}` and `{f95Id}` are filled during downloads-install, not only during a normal import.

## 0.9.8-nightly.447

- **feat**: Emulator mappings can match an exact file name as well as an extension (#324).
- **fix**: Download card text is no longer muted (#313).

## 0.9.8-nightly.446

- **chore**: ESLint ignores gitignored paths. The generated extension copy is no longer linted as main-process code.

## 0.9.8-nightly.445

- **chore**: The generated `electron/data/extension` copy is excluded from lint.

## 0.9.8-nightly.444

- **chore**: CONTRIBUTING and the PR template ask for AI assistance, the tool and model, and what the author verified.

## 0.9.8-nightly.443

- **fix**: The rating modal keeps its draft through background metadata updates and library refreshes.

## 0.9.8-nightly.442

- **feat**: A queued download records the build it came from and shows it as a chip. Rows no longer repeat the latest version for every build.

## 0.9.8-nightly.441

- **fix**: Rating displays on library and catalog cards use the `/10` scale consistently.

## 0.9.8-nightly.440

- **fix**: The extension copy targets `data/extension`; the previous target sat in the install directory and failed with EPERM.
- **changed**: Extension functions return the failure reason, and Settings shows it instead of "directory does not exist".

## 0.9.8-nightly.439

- **feat**: The INSTALL button opens a source picker when more than one source can install a title.
- **fix**: The browser extension reaches disk: unpacked from the asar and copied to a writable directory.
- **fix**: Installing from the wishlist now removes the entry, and download art no longer depends on the loaded library list.
- **feat**: The first install asks for the library folder layout, and an empty library folder is set inline instead of ending at a settings pointer.
- **fix**: The install dialog says when a download can never install, instead of leaving it to be discovered by pressing the button.

## 0.9.8-nightly.438

- **chore**: Nightly publishing creates one draft release before the matrix builds. The legs no longer race to create it.

## 0.9.8-nightly.431 - 0.9.8-nightly.437

- **feat**: MEGA is a download host. Public-link downloads, AES-CBC decryption, resumable transfers, and no account needed.
- **feat**: MEGA accounts can be signed in, with quota in Settings, 2FA, and hashcash proof of work on worker threads.
- **perf**: MEGA's chunk MAC runs one AES-CBC pass per chunk, measured at 5 MB/s to 188 MB/s.
- **fix**: MEGA keeps the response body on non-2xx, names the failing call, and never reports a 402 as a wrong password.
- **fix**: Version replace had never succeeded: `replaceInstalledVersionAfterImport` was shadowed by a ctx destructure, so every outcome was silent.
- **fix**: A replace picks the version that is actually installed, refuses to guess between several, and shows the choice in the install dialog.
- **feat**: The game detail caret carries Manual Install, portalled so it paints above the sidebar.
- **feat**: A download started from Browse creates its library record at install, using catalog refs that survive the enqueue boundary.
- **fix**: Browse downloads no longer fail as "game no longer in your library"; synthetic `catalog:` ids are normalised and a download without a record is queued as add.
- **fix**: Install failures name their step, run one at a time, and report a promotion that landed on a title match.
- **feat**: External library import for XLibrary, with playtime, ratings, playstate and journal notes.
- **fix**: External library imports send every row to exactly one destination, and show the plan before importing.
- **perf**: Import matching resolves ID-bearing rows first in chunks of 50, and Import is disabled while matching runs.
- **fix**: External library rows no longer stay in "matching" forever; rows key off the source tool's own id.
- **feat**: Download links are grouped by the post's own headings, so builds are not offered as mirrors of each other.
- **fix**: `Update Only`, `Split` and patch sections are no longer offered as full games.
- **changed**: Buzzheavier is disabled behind the plugin flag.
- **fix**: The Open thread button uses a real thread id and the stored URL instead of building `threads//`.
- **fix**: The install prompt pre-fills the library version, not the filename guess.
- **refactor**: Removed nine unreachable functions from the importer and made `no-undef` an error.
- **fix**: A context submenu no longer closes when the import progress ticks.

## 0.9.8-nightly.415 - 0.9.8-nightly.429

- **feat**: Tag lists union every catalog tag source instead of ranking them.
- **feat**: Read-only catalog tags on Browse rows.
- **feat**: Editable tag lists in the properties window and the detail page.
- **feat**: User tag edits are stored as a resettable override.
- **feat**: Bulk tag every game in a collection.
- **feat**: Tag filtering, bulk edits and autocomplete, with tag helpers imported directly.
- **fix**: Installer adopts an existing install path from `customInit`, not `preInit`.
- **fix**: Linux keeps data in the per-user directory, not the install tree.
- **fix**: Startup table-rebuild migrations take the write lock.
- **feat**: Linux launches games correctly from deb, pacman and AppImage.
- **fix**: The installer honours an existing install location; the library grid stops flashing and showing blank rows.
- **feat**: The emulator and wrapper path works for Wine and friends.
- **feat**: Rating card reworked into Online and Personal ratings.
- **fix**: Context menu submenus are visible and nestable.
- **feat**: Custom React context menu for game rows.
- **fix**: Context menu versions are ordered newest first.
- **fix**: Linux uses the Atlas icon instead of the Electron default.
- **fix**: Compound tarballs extract fully.
- **fix**: Pacman depends sit at the top level of the build config, with the stale default list overridden.
- **chore**: Smooth downscaling for game artwork.
- **feat**: Configurable search scope, shared across all three search paths.
- **feat**: Browse shows only Free-tier LewdCorner entries.
- **feat**: Links submenu in the context menu, with nested submenu clipping fixed.
- **fix**: Favorites in the context menu is wired to the `setFavorite` dispatch case.
- **fix**: The updater no longer passes `/S`, so the installer window shows and the app relaunches afterwards.

## 0.9.7-nightly.398 - 0.9.7-nightly.414

- **fix**: Native programs run on Linux again.

## 0.9.7-nightly.394

- **feat**: Steam-style collections for the local library: collections and collection_games tables, a derived Uncategorized bucket, a tile screen, a grouped library tree with persisted expand state, and a collection filter chip.
- **feat**: Collection tiles use a cropped art mosaic. Cells zoom 40% (50% for one image) and art is capped at 8.
- **feat**: The importer adds a game by store ID or Steam/GOG search, with a local folder option, cover art, and support for delisted titles.
- **feat**: Installed Steam games missing from GetOwnedGames appear in the wizard with a Local only badge.
- **fix**: The import wizard closes once a run commits, per-game failures raise an import-failed toast, and extraction shows the title with its percentage.
- **fix**: The games folder is read live during an import, so setting it mid-run no longer errors, and deleteLinkedGameFolders no longer throws a ReferenceError.
- **fix**: PLAY stays on RUNNING for the process lifetime through explicit run-state broadcasts, with a fast-exit guard and a get-running-games call for late windows.
- **fix**: Hover-to-cycle banner previews works again: the isCatalog test is a shared helper, and a failed preview fetch no longer latches no-preview for the card.
- **perf**: The stale-executable repair runs 4s after the window opens, probes each drive root once, and uses an async folder walk with bounds.
- **chore**: dateFilter and versionCompare are real vitest suites.

## 0.9.6-nightly.385

- **fix**: updateGame writes only the keys in the payload, so one edited field no longer blanked every other field through COALESCE, and the importer no longer wiped tags.
- **perf**: Override repair uses one transaction and set-based UPDATEs per column; 3,000 rows drop from 7.2s to 86ms, and slow startup work gets a lazily created progress window.
- **feat**: A startup metadata repair surfaces as a sticky toast naming fields, titles, and the blank versus duplicate split, through get-startup-repair-summary.
- **feat**: Overridden fields show a pencil with an sr-only label instead of a Custom pill, and a single-field reset confirms through ConfirmModal before it runs.
- **feat**: Title, Engine and Developer show the same marker and reset control, and Reset all fields is always present, disabled with a tooltip when there is nothing to reset.
- **fix**: Base-field edits are tracked in game_metadata_overrides.base_field_originals, so an edited Engine with no source value is marked and can be reverted.
- **perf**: Browse excludes Steam appids through atlas_external_steam instead of five correlated LIKE patterns; the first tile drops from over 120s to 870ms on a 32k catalog.
- **feat**: The local catalog index backs Browse, alongside a config sanitizer and the full client check; the first tile reaches 10.7ms with all three fixes.
- **fix**: Browse renders catalogLoadingMore as a sibling of the grid, polls index status, and says Preparing Browse... with progress while the index builds.
- **fix**: SQLite transactions serialize through writeLock.js, so a catalog sync no longer rolls back a chunked index build.
- **fix**: Config cleanup drops only the two verified-unused Interface keys and reports unknown keys with their size; banner layout moves to its own file.
- **fix**: The catalog index build selects steam release_state rather than the missing status column, drops the nonexistent rating columns, and matches the date index collation to the ORDER BY.
- **fix**: The library grid gets a loading state from get-library-stats and distinguishes loading, empty, filtered-empty, and a failed load with Reload.

## 0.9.5-nightly.379

- **feat**: Nightly builds update on their own channel instead of pulling stable, set through autoUpdater.channel rather than only the feed URL, with allowDowngrade reset.
- **fix**: A mid-session channel switch clears the cached release provider, so the next check resolves against the new channel without a restart.
- **fix**: A manifest 404 (no release on this channel) is separated from a download-asset 404, reported as an up-to-date notice, and kept out of the startup check.
- **fix**: Updater errors are normalized by electron-updater's real codes, with a raw-error log line in the main process.
- **fix**: The per-channel baseline is assigned as a SemVer object, not a string, so checks no longer fail before the network with "format is not a function".
- **fix**: The baseline is built from autoUpdater.currentVersion.constructor, because electron-updater rejects SemVer instances from another module.
- **chore**: Packaged builds write updater diagnostics to atlas-updater.log.

## 0.9.4-nightly.378

- **feat**: Multi-appid Steam games merge into one record through an audit-then-apply migration; versions move with their playtime, steam_mappings repoint to the survivor, and selected_version_id is repaired.
- **feat**: The catalog tile takes its Steam banner assets from the first appid, and previews and movie thumbnails accept a sourceAppId so each season shows its own media.
- **feat**: A newly imported appid attaches as a version under the record for its atlas, labeled with its own Steam season title, instead of creating a duplicate tile.
- **fix**: External links stored in external_ids show on the detail page in Browse mode, including every appid in steam_appids[], with exact duplicate URLs filtered.
- **fix**: Catalog seasons list every appid in steam_appids[] before its metadata is fetched, and installing any season attaches to the correct record.
- **fix**: Steam import resolves the atlas through external_ids and reuses its title; preview URLs that failed to load are excluded from the media tab.
- **fix**: The Browse Steam filter reads steam_appids[] and steam_ids[] as well as the scalar ids, so manual links and uninstalled titles count as Steam.
- **fix**: The detail page fetches previews and trailers for the selected Steam season and merges movie thumbnails instead of replacing them.
- **fix**: Atlas sync uses a coalescing upsert, so an empty incoming field keeps the local value, and unknown columns are dropped with a warning instead of aborting the ingest.
- **fix**: normalized_title is computed by the same JS normalizer as import matching, with an idempotent recompute at startup, so accented and non-Latin titles link to their atlas row.
- **feat**: Settings, Theme Builder, Banner Editor, Importer, Importer Help and Game Details move to native OS chrome, and the decorative border and theme window radius are removed.
- **chore**: Take the tour moves to the bottom of the Settings sidebar.
- **fix**: Update channel switching compares each channel against the version last installed from it instead of forcing allowDowngrade.

## 0.9.3-nightly.361

- **feat**: GOG is a first-class metadata and import source, using the v2 API for full metadata and art, with a store-page link, info-panel art and description, and manual mapping.
- **fix**: GOG import visibility, executable resolution, the store button, the main-process source normalizer, and release-date parsing.
- **feat**: Steam OpenID sign-in and owned-library browsing.
- **feat**: Steam install handoff with a post-action refresh.
- **feat**: Bulk Steam import for all, installed, or not-installed titles.
- **feat**: Versions carry Steam source identity through source and source_app_id.
- **fix**: Steam artwork comes from GetItems; the transparent logo resolves under library_logo, and duplicate screenshots are deduped by content hash.
- **fix**: Steam trailers refresh for real, URLs are read from any mp4/webm quality key, and the movies row is no longer dropped.
- **feat**: A horizontal video strip with shorter tiles and Steam thumbnail posters.
- **feat**: Steam games get an automatic image source, a videos section, and a hero logo placement; Uninstall is hidden when the game is not installed.
- **feat**: Per-version and per-title playstates, and the playstate filter applies to the local library (#245).
- **feat**: Uninstalled games show by default, banners and hero art stay saturated, and the library refreshes when a Steam title is added.
- **feat**: The importer takes a configurable library folder structure.
- **perf**: The import wizard closes on commit, and image conversion is faster.
- **feat**: A toast system replaces the update bar, with rate-limit handling and non-blocking refresh.
- **fix**: Real GOG logos replace the fa-gg glyph, and f95/steam/lc links show ids only.
- **perf**: Media refresh is id-gated, compressed images are not re-encoded, and fetches are conditional.
- **chore**: CI scans release artifacts with ClamAV.
- **chore**: Vitest regression suites cover importer, game properties and game editing, wired into CI.
- **fix**: The date filter keeps compact YYYYMMDD dates, and version update detection is consistent.
- **fix**: Stable to nightly switching no longer refuses the semver-prerelease downgrade.

## 0.9.2-nightly.343

- **fix**: The extract worker guards null stdout and stderr, wraps the 7-Zip spawn in try/catch, treats exit code 1 as a warning, and tolerates ERAR_END_ARCHIVE when files were already extracted.
- **feat**: extractArchiveWithFallback offers to locate 7-Zip on a bundled RAR failure, persists Library.sevenZipPath, and routes single, local and batch imports through it.
- **fix**: The layout editor's drag element wraps panel content in normal flow, with the edit outline on the wrapper and content inert while editing.
- **fix**: Database migration adds the floating and edited flags to existing tables.
- **chore**: README adds the F95Zone thread link.

## 0.9.1-nightly.340 - 0.9.1-nightly.342

- **chore**: The remove-file-attachments workflow gets the permissions it needs to delete files.

## 0.9.1-nightly.338 - 0.9.1-nightly.339

- **feat**: The detail layout editor moves to full-width rows and 1-5 column bands, with per-column auto, flex or fixed widths, spans for right-column panels, and migration from the old items/columns layout.
- **feat**: Panels get 4-wide previews, column stacking, a Steam-style About, a styled Back button, and reset to defaults.
- **fix**: Drop handling derives its target from the panel, duplicate keys no longer break drag identity, and an end-of-column drop indicator appears.
- **fix**: Large drag handles and drop targets for 4K, tighter panel spacing, a 600px cap on single-column panels, a 2-column default, and a px width input.
- **fix**: userData, session data, cache and logs move under dataDir/chrome, with a portable.txt marker and a configurable image cache size.
- **chore**: Remove-file-attachments workflow added, and the Discord invite link updated.

## 0.9.0-nightly.330 - 0.9.0-nightly.337

- **feat**: A settings tour covers emulators, sources, media mode and accounts, with an onboarding note and a larger About that drops the catalog-update note.
- **fix**: The importer always requires a games folder before an import.

## 0.9.0-nightly.326

- **feat**: The importer gets a help window with a live preview, a fixed footer, and background sizing.

## 0.9.0-nightly.325

- **chore**: package.json moves to 0.9.0, the first build under the 0.9 line; the same commit is the v0.9.0 tag.
