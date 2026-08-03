# Changelog

## Unreleased

### Fixed
- `src/components/importer/scanRowKey.js`: rows from an external library import with nothing installed never left the "matching" state, however long you waited. `getScanGameKey()` fell through to a composite of `title|creator|version|f95Id|…|atlasId` for any row without a folder, and match resolution overwrites `title`, `creator` and `atlasId` with the catalog's values. `resolvePendingMatches` builds a Map of resolved rows keyed by that function and then looks each row up by computing the key on the *original* row, so the key it searched for no longer existed, the `|| game` fallback kept the unresolved row, and the row stayed in `pendingMatch` permanently with nothing logged. Folder-scanned rows key off their path, which resolution never touches, which is why this only affected external library imports — and within those, only rows with no launch path, which on a tracking-heavy library is most of the table (2,098 of 2,348 in the reference export). Rows now key off the source tool's own primary key, which nothing about matching or editing can change. Extracted to its own module with the reasoning attached, since the function looked harmless in isolation.
- `src/components/importer/Importer.jsx`: a row whose key cannot survive resolution is now reported to the console instead of being dropped silently. `hasStableScanKey()` identifies the one remaining volatile case — a manual row with no path and no external source — so the same class of failure cannot recur invisibly.
- `tests/scan-row-key.test.js`: new, 10 tests asserting the key survives resolution for installed and not-installed rows from both providers, that 200 rows sharing a title and an empty folder still get 200 distinct keys, and that the volatile branch is flagged. Verified to fail 6 of 10 against the previous key — including passing the installed-row case, which is exactly the asymmetry that let this ship.
- `src/components/importer/Importer.jsx`, `steps/ScanTable.jsx`: "To wishlist (install path missing)" described a field rather than what happened. It now reads "To wishlist (file not found on disk)", and the status carries a hint naming the exact path that was tried, so an unplugged drive is distinguishable from a genuinely uninstalled game.
- `src/components/importer/Importer.jsx`: Update Matches re-checked every row in the list. It skipped the queries for rows that were already matched, but still spent an event-loop tick per row, so on a 2,300-row library the button's runtime was almost entirely rows with nothing to do. It now works only on rows that have never been matched or whose ID/title/creator the user has since edited (tracked as `matchDirty`, cleared once resolved), skips the rest with no query and no tick, and reports "Every row is already matched" rather than appearing to do nothing. The progress bar counts the rows being worked instead of the list length.
- `src/components/importer/Importer.jsx`: the initial match pass now resolves rows carrying a source ID before rows that need a title search. The two are not equally cheap or certain — an ID lookup is one indexed hit, a title search scans and then needs review — and in arrival order an external library import left ~2,000 ID-bearing rows sitting unmatched while title guesses were worked through. The chunk size also went from 10 to 50: the handler already pre-warms each chunk's lookups in parallel, so the cost is one IPC round trip per chunk, and 2,348 rows went from 235 sequential round trips to 47. Kept bounded so the table still fills in visibly and Stop Matching stays responsive.
- `src/components/importer/steps/ScanStep.jsx`, `electron/scanners/externalLibrary/*.js`: "Pending matches" and the readers' "Pending match" message both implied a row was unidentified when it was only waiting on a catalog lookup it already had the ID for. Now "Matching" and "Matching against the catalog".
- `src/components/importer/Importer.jsx`: the row-status and match-resolution paths shared one copy of "does this row have a usable ID" rather than two — the same duplication that produced the source-id whitelist drift earlier in this release.
- `src/components/importer/Importer.jsx`: the Import button was clickable while catalog matching was still resolving. It was disabled on `!canImport || isScanActive || isCancelingScan` but not on `isResolvingMatches`, and a row still in `pendingMatch` is not importable — so importing mid-resolve silently dropped every unresolved row. Matching a 2,300-row library runs in chunks of ten, so that window was minutes wide rather than theoretical. The button is now disabled during resolution and says why, and any remaining pending rows are counted in the confirmation.
- `src/components/importer/Importer.jsx`: a row carrying a thread ID no longer reports "Pending match". It is not waiting to be identified — it is waiting for the catalog lookup that turns the ID into an Atlas record — and "Pending match" across two thousand rows reads as Atlas not knowing what any of them are. Rows with an ID now say "Looking up ID…", rows without say "Matching by title…", which is the only case that actually depends on a title guess.
- `src/components/importer/steps/ScanTable.jsx`, `Importer.jsx`: the review table's wishlist status read "Wishlist - not installed", which parses as a statement about the wishlist rather than about the game — one report of it being read as the wishlist being unavailable. Now phrased as an action with the reason in parentheses: "To wishlist (not installed)".
- Everything user-facing and internal now calls it the wishlist. "Watchlist" and wishlist were the same feature under two names — `addToWatchlist`, `watchlistCandidate`, `summary.watchlist`, the `add-import-watchlist-entries` IPC channel, the review table's column header and the import step's mapping row. Renamed throughout, including the IPC channel and its preload binding on both sides.
- `electron/main.js`: clicking "Import library" for a newly added external library opened the ordinary folder importer instead of that library's import screen. `normalizeImporterSource()` validated the id against a hand-written array carrying the comment "Keep in sync with importerSources.js in the renderer", and it drifted the moment a provider was added. The failure mode is the damaging part: an unrecognised id does not error, it falls back to `'atlas'`, so the button appears broken rather than the id appearing rejected — nothing logged and nothing threw. External-library ids are now derived from the reader registry, which is the one place a provider is actually defined, so registering a reader is sufficient. Built-in sources (atlas, steam, gog, renpy, manual) stay listed literally because they are views the importer window implements rather than registry entries.
- `scripts/check-importer-sources.js`: new, 23 assertions reconciling the three places an importer source id has to be recognised — the reader registry, the main process and the renderer. Asserts the main process derives provider ids rather than listing them, that every provider has a renderer entry flagged `externalLibrary: true`, and that neither `main.js` nor `Importer.jsx` special-cases a provider by name. Verified to fail against the pre-fix code. Wired into `npm run check`.
- `electron/scanners/externalLibrary/f95checker.js`: pressing Import silently dropped rows that had nothing launchable on disk but did have something recorded. The watchlist default asked whether a row had no `executables` AND no `installed` version, which left three populations belonging to neither destination: a row whose recorded executable no longer resolves (library moved, or its drive is not mounted), a row with an `installed` version string but no executable, and a row whose executable entry is a directory. All three fail the importer's launchable check, so they could never become library records, and none of them were wishlist candidates either — so they were written nowhere and nothing said so. For a library whose games sit on an unmounted drive that was every row. The test is now whether an executable actually RESOLVED, so every row lands in exactly one destination: a library record or the wishlist. Each row carries a `watchlistReason` (`not-installed` / `install-path-missing` / `no-launchable`) and the summary breaks the count down by it, because a path that no longer resolves is usually fixable and worth distinguishing from a game that was never installed.
- `electron/scanners/externalLibrary/f95checker.js`: `summary.installed` counted rows with a resolved folder, which included directory entries with no executable beneath them. It now counts rows that will actually import, so the "installed on disk" figure in the import step matches what happens.
- `src/components/importer/Importer.jsx`: the import button now reports rows that would be skipped entirely — neither imported nor added to the wishlist — and asks for confirmation, listing the reasons. Unticking a row is a legitimate choice, but it should never be something the user discovers afterwards by noticing a game is missing.
- `src/components/importer/steps/ScanTable.jsx`: the review table said "Watchlist" for a feature the rest of Atlas calls the wishlist, and its checkbox tooltip promised "will be imported to the library" when unticked even for rows with nothing to launch, where unticking drops the row instead. Both corrected.
- `electron/db/games.js`: an edited Title, Engine or Developer was not marked as changed, and offered no reset, whenever no source had a value for that field. Engine was the common case — Steam and GOG rarely publish one and many Atlas records lack it — so an edited engine showed neither the marker nor the reset control. Detection no longer relies solely on comparing against the source: `updateGame()` now records what the column held before a user edit (`game_metadata_overrides.base_field_originals`, added by migration), which gives exact intent, works when the source has no value at all, avoids false positives when a source changes upstream, and provides a revert target that does not depend on the source. Comparison against the source is kept as a fallback so edits made before tracking existed are still detected.
- `electron/ipc/games.js`: the `update-game` handler was passing `getAssetBasePath()` and `process.defaultApp` as second and third arguments, which `updateGame()` has never read. Left in place they would have been received as the new options object. Removed, and replaced with the explicit `{ recordBaseEdits: true }` opt-in that distinguishes a user edit from the importer and scanner writes that also call `updateGame()`.
- `electron/db/games.js`: resetting Title, Engine or Developer could hit the `UNIQUE(title, creator, engine)` constraint on `games` and surface a raw `SQLITE_CONSTRAINT` message. This happens in practice with duplicate imports the user renamed to tell apart — restoring the source title would make the two records identical. The collision is now caught and reported as a clear message, leaving the record intact rather than half-reset.
- `electron/db/repair.js`: `validateGameMetadataOverrides()` no longer stalls boot. It ran one auto-committed `UPDATE` per affected row, so SQLite fsynced per statement — measured at 7.2s per 3,000 single-row updates versus 86ms for the same work in one transaction. On a library where every imported title had picked up an override row this meant a multi-minute first launch with no window on screen. All writes now run in a single transaction, blanking overrides are repaired with one set-based `UPDATE` per column instead of a row loop, and the sweep exits after a single `COUNT` when no title has custom data. A 12,000-row corrupted library now repairs in ~1.7s, with steady-state passes at ~0.3s and fresh installs skipping entirely.
- `electron/main.js`: guarded `window-all-closed` while booting, so tearing down the transient boot progress window cannot quit the app before the main window is created.
- `electron/db/games.js`: `updateGame()` now writes only the fields present in its payload. It previously wrote all thirteen `game_metadata_overrides` columns on every call, so editing one field in the game properties window turned every displayed value into a user override.
- `electron/db/games.js`: omitted fields are no longer stored as `''`. Because the metadata merge resolves as `COALESCE(game_metadata_overrides.x, <source chain>)`, an empty-string override is not null and therefore won the COALESCE — permanently blanking fields that had perfectly good Atlas/Steam/GOG values. Empty now means "clear this override" and is stored as `NULL`.
- `electron/db/games.js`: fixed `latest_version` being pinned by unrelated edits, which froze `isUpdateAvailable` and left the update badge permanently wrong for the affected title.
- `electron/ipc/importer.js` path: importing a title with a description no longer creates a full row of blanking overrides. The importer calls `updateGame()` with five keys, and the old write-everything behaviour blanked the other twelve fields with no user edit involved.
- `electron/db/games.js`: `updateGame()` no longer deletes every tag mapping when the payload omits tags — the same importer-shaped call was silently wiping a title's tags.
- `src/components/detail/GameDetailsWindow.jsx`: saving now sends only the fields whose value actually changed, so an override is created for exactly the field the user edited.

### Added
- `src/components/importer/ImportPlanModal.jsx`: new. Pressing Import now states exactly what will happen before anything is written — how many games go to the library, how many to the wishlist, how many are skipped entirely and why — with Continue and Exit. A folder scan is auditable from the review table; a 2,300-row external library import is not, because the rows do not fit on screen and they split across two destinations.
- `src/components/importer/ImportPlanModal.jsx`: also reports the outcome, which previously nothing did. A wishlist-only import simply closed the window, so a run that added two thousand entries gave no confirmation that anything had happened. The modal now shows how many were added, how many were skipped as already-owned, and how many failed. It reports at that point because it is the only honest one available: the main process closes the importer window as soon as the library import commits, and the wishlist finishes before that, so a mixed run pauses on the summary until the user continues.
- `src/components/importer/Importer.jsx`: the wishlist step now treats an unavailable IPC channel as a failure. It is called through optional chaining, so a channel rename that missed one side would return `undefined` and read as a successful run that wishlisted nothing — indistinguishable from working correctly. It now aborts and says so rather than continuing.
- `electron/scanners/externalLibrary/xlibrary.js`: import support for XLibrary. Auto-detects the live library at `%APPDATA%/xlibrary/canonical/library.games.json` (with the conventional macOS and Linux equivalents) and also accepts a dated `xlibrary-data-<date>.json` export through the file picker, for a library that lives on another machine. Both wrappers are read — the bare array the live file may hold, and the `{ games, settings }` object an export writes — because reporting "not an XLibrary library" for a valid file differing only in nesting is the kind of failure a user cannot act on. An empty library reads as empty rather than as the wrong file.
- `electron/scanners/externalLibrary/xlibrary.js`: maps across the data XLibrary records that F95Checker does not — playtime (total and per-session), per-category ratings, whole-game progress status, and written journal entries. `completionStatus` maps onto Atlas playstates (Completed→finished, In Progress→played, In Queue→planned, Waiting for Update→on_hold, Abandoned→dropped, Not Started→none); an unrecognised status writes no playstate rather than being guessed at, and is counted so the import step can say so. `categoryRatings.story/graphics/gameplay` map onto the Atlas categories of the same name; `grindability` has no Atlas home and is dropped and counted rather than folded into another category where it would skew the average.
- `electron/scanners/externalLibrary/xlibrary.js`: `totalPlaytime` is read as SECONDS. Evidence: it equals the sum of that game's session durations in every case in a 2,348-game reference export, and one game records two sessions six seconds apart with durations of 88 and 82, which is impossible as minutes. Atlas stores minutes, so values are converted and anything under thirty seconds is skipped rather than written as a bogus one-minute play.
- `electron/scanners/externalLibrary/xlibrary.js`: `journalEntries` holds written notes and launch telemetry in one array, separated only by `type: 'session'`. Session entries have empty `content`, so the two are split: written entries become notes (pinned first, then chronological, each stamped with its date and the version it was written against) and session durations feed playtime. Treating the array as notes would have pasted blank gaps between real entries and lost the playtime entirely.
- `electron/scanners/externalLibrary/xlibrary.js`: the thread id is recorded in both `externalLinks[].externalId` and the link URL. They are cross-checked, the URL wins when they disagree, and the disagreement is reported — the URL is what a user can click and verify, whereas `externalId` is a field some other importer wrote. `steam` / `itch` / `dlsite` links are read for identification only and deliberately never become a `steamId`: a store link the user pasted is not an owned Steam copy, and emitting one would divert the row down the importer's Steam in-place mapping path.
- `electron/scanners/externalLibrary/xlibrary.js`: multiple launch configurations in one folder become selectable executables on the row, since they are alternative ways to launch one install. Configurations pointing at a different folder are a second install of the same game, which one version row cannot represent, so the default configuration wins and the others are counted and reported rather than silently chosen between.
- `electron/scanners/externalLibrary/applyState.js`: applies playstate, playtime and per-category ratings. Playstate and playtime are fill-only, so a value the user has already set in Atlas is never overruled. Playtime deliberately does NOT go through `recordGamePlaytime()`, which adds to the running total — correct for a real launch, wrong for an import, where it would double every figure on a re-run and triple it on a third. Idempotence is now stated as a rule in that file's header alongside the existing never-overwrite rule.
- `electron/scanners/externalLibrary/f95checker.js`, `xlibrary.js`: each reader now owns its own field-mapping table and its own list of opt-in mappings, and the import step renders whatever it is given. The table was hardcoded in `ExternalLibraryStep.jsx` and was accurate for exactly one provider — F95Checker has tabs and no playtime, XLibrary has playtime and no tabs — so a second provider would have shown the first one's mapping.
- `electron/scanners/externalLibrary/index.js`: providers declare a `sourceNoun`, so the picker calls a JSON file a "library file" rather than a "database".
- `electron/scanners/externalLibrary/index.js`: providers can declare `candidatePaths()` — the exact FILE paths detection tests — and `describeProvider()` reports them as `searchedPaths`. The import step listed the candidate DIRECTORY beside the bare filename, which for XLibrary described `%APPDATA%/xlibrary/library.games.json` when detection actually tests `%APPDATA%/xlibrary/canonical/library.games.json`. Naming a path that was never tried sends the user looking in the wrong place. F95Checker supplies the same function so the registry has one rule rather than a special case.
- `electron/ipc/importer.js`: the file picker's dialog title used the word "database" for every provider, so choosing an XLibrary JSON file opened a dialog titled "Select the XLibrary database". It now uses the provider's `sourceNoun`.
- `src/components/importer/steps/ExternalLibraryStep.jsx`: the path field's placeholder names every input a provider accepts. XLibrary takes either the live `library.games.json` or a dated export, and naming only the former would make a user holding an export think they had the wrong file. The Browse picker and the path field are shown whether or not detection succeeded, so a library Atlas cannot find is always still importable by hand.
- `src/components/importer/importerSources.js`: added the XLibrary source, and `EXTERNAL_LIBRARY_SOURCE_IDS` derived from an `externalLibrary` flag, so the importer routes every external-library source with one check instead of a branch per tool.
- `scripts/check-xlibrary-parser.js`: 195 assertions over a fixture with real files on disk, covering both file shapes, the seconds-to-minutes conversion, the session/note split, playstate and engine vocabularies, id cross-checking, multi-configuration handling, malformed and wrong-shape files, a UTF-8 BOM, and the invariant that every row belongs to exactly one destination. Wired into `npm run check`.
- `scripts/check-f95checker-parser.js`: asserts the corrected wishlist rule, its reason breakdown, and the same one-destination invariant across the whole fixture. The previous suite asserted the old behaviour explicitly ("a recorded-but-missing path is a broken install, not a watchlist entry"), which is why the dropped rows never showed up as a failure.

- `electron/db/index.js`: added the `game_metadata_overrides.base_field_originals` column (JSON map of base column to its pre-edit value).
- `electron/db/overrides.js`: added `parseBaseOriginals()` / `serializeBaseOriginals()`, tolerant of null and malformed values; an empty map serializes to null so the row can still be pruned.
- `electron/db/games.js`: `updateGame()` takes `{ recordBaseEdits }` and records pre-edit values for Title/Engine/Developer when set; editing a field back to its recorded value clears the mark, and resetting forgets the recorded original.
- `electron/db/games.js`: `getGameOverrides()` reports `inheritedFrom` (`'original'` or `'source'`) so the UI can say whether a field reverts to its pre-edit value or to current source data.
- `src/components/detail/window/RecordTab.jsx` and `src/components/detail/GameDetailsWindow.jsx`: the value shown under a changed base field, and the reset confirmation, are labelled "Before your edit" or "Source value" to match where the revert target actually comes from.
- `electron/db/overrides.js`: added `BASE_FIELDS` and their source chains, covering the base `games` columns shown in the properties window (title, engine, creator). These are not overrides — `games.title/creator/engine` always hold a value and there is no override column, so no stored record of user intent exists. All that can honestly be reported is whether the stored value differs from what the sources currently say, which is why the UI wording says "differs from the source" rather than calling it a custom value.
- `electron/db/games.js`: `getGameOverrides()` now reports Title, Engine and Developer alongside the overridable fields, flagged `base: true` and carrying `resettable` (false when no source value exists). The summary also breaks the count down into `baseFieldCount` and `overrideFieldCount`.
- `electron/db/games.js`: `clearGameOverrides()` now resets base columns by writing the source value back into the games row rather than nulling an override, and accepts the `developer` form key for the `creator` column. A base field with no source value is skipped rather than blanked — title in particular is the record's identity across the library grid, search and sorting.
- `src/components/detail/window/RecordTab.jsx`: Title, Engine and Developer now show the pencil marker and their source value when they differ from the source, matching the overridable fields.
- `src/App.jsx`: added a post-boot summary toast reporting what the startup custom-metadata repair changed — how many fields were restored, across how many titles, and the split between fields that were blank and fields that merely duplicated the source value. Sticky rather than auto-dismissed, since it reports a one-time bulk change to the user's own data. Because the repair completes before the window exists, the summary is pulled on mount via `get-startup-repair-summary` rather than pushed, which avoids racing the window load; the main process clears it on read so the notice shows once per launch.
- `electron/main.js`: holds the startup repair summary for the renderer to collect, exposed on ctx as `takeStartupRepairSummary()`.
- `electron/ipc/games.js`: added the `get-startup-repair-summary` handler, exposed via `electron/preload.js` as `getStartupRepairSummary()`.
- `electron/main.js`: added a boot progress window for slow startup database work. Startup repairs run before `createWindow()`, so a slow pass previously left the app with nothing on screen and read as a hang. The window is created lazily — only if the task is still running after 400ms — so the normal fast path stays invisible instead of flashing a splash. It is self-contained (inline HTML via data URL, no preload, no node integration) and needs no build-config entry.
- `electron/db/repair.js`: `validateGameMetadataOverrides()` now accepts an `onProgress` callback reporting `{ phase, processed, total, message }`, throttled to every 50 rows. A throwing handler is caught and never breaks the repair.
- `electron/db/repair.js`: added `countGameMetadataOverrideRows()` as a cheap probe so a caller can skip the sweep entirely when no title has custom data.
- `electron/db/repair.js`: the summary now includes `durationMs` and `skipped`.
- `electron/db/overrides.js`: added a shared module defining the overridable metadata fields and, for each, the source chain it falls back to. Kept in sync with the merge queries in `electron/db/versions.js` and used by the write path, the custom-data report, and the validation sweep.
- `electron/db/games.js`: added `getGameOverrides()`, which reports per field whether the user has set a custom value, what that value is, and what the field would inherit if it were cleared.
- `electron/db/games.js`: added `clearGameOverrides()` to clear specific fields or every custom value for a title. An override row holding nothing is deleted, so the presence of a row is a truthful "this title has custom data" signal.
- `electron/db/repair.js`: added `validateGameMetadataOverrides()`, which repairs blanking (`''`) overrides, prunes overrides identical to the value the field would inherit anyway, and removes empty rows. Runs at startup (idempotent; a clean database reports nothing) and supports `{ dryRun: true }` for a report-only pass.
- `electron/ipc/games.js`: added `get-game-overrides`, `clear-game-overrides` and `validate-game-overrides` IPC handlers, exposed via `electron/preload.js`.
- `src/components/detail/window/RecordTab.jsx`: custom fields are now marked, show the source value they replace beneath the input, and can each be reset on their own. A summary strip reports how many fields are custom and offers a single "Clear all custom data" action.

### Changed
- `src/components/detail/window/RecordTab.jsx`: a field holding a custom value is now marked with a pencil icon rather than a "Custom" text pill, with the summary strip naming the marker so it is legible on first sight. The icon carries an `sr-only` label for assistive tech.
- `src/components/detail/GameDetailsWindow.jsx`: resetting a single field now asks for confirmation first, naming both the value being discarded and the source value it will fall back to. Discarding a typed value is not recoverable and the reset icons sit close to the inputs, so an accidental click was too cheap. Long values are clipped so a full description cannot push the dialog buttons off screen.
- `src/components/detail/window/RecordTab.jsx`: the "Reset all fields" button is now always rendered, disabled when a title has no custom values, so the affordance is discoverable rather than appearing only once a record already has custom data.
- `src/components/detail/window/RecordTab.jsx`: the Record tab is now responsive — fields stack in one column on narrow windows and split into two from `md` up, with labels above inputs on small widths. Inputs have visible keyboard focus rings and the reset controls carry aria-labels.
- `tests/game-edit.test.js`: extended with eighteen cases covering override isolation, empty-means-clear, tag preservation, override-row pruning, the custom-vs-source report, single-field and clear-all behaviour, and the validation sweep (including idempotency, dry-run, early exit, progress reporting, and single-transaction commit).

## 1.0.72 - 2026-06-15

### Added
- `electron/db/mediaSources.js`: added a shared module that parses `atlas_data.external_ids`, resolves the Steam app id, builds Steam `header_2x`/`library_hero`/`logo` art URLs, orders banners/previews by the configured source priority, and builds external-link entries.
- `src/components/detail/externalLinks.js`: added a renderer-side helper to parse `external_ids` and build labelled external links.
- `src/components/settings/Metadata.jsx`: added a reorderable Metadata Sources list (stored as `Metadata.sourceOrder`) that defines which source supplies banner images and previews; scales to additional sources beyond F95 and Steam.
- `src/components/detail/window/MappingsTab.jsx`: added a Steam mapping row (shown with its app id) and an External Links section for the remaining `external_ids`.
- `src/components/detail/GameDetailPage.jsx`: added an External Links section in the sidebar between Details and Tags.
- `src/components/detail/page/HeroBanner.jsx`: the details-page hero now uses the Steam `library_hero` image when available and overlays the Steam `logo` in the bottom-left, Steam-style, with graceful fallback to the banner/title when art is missing.
- Steam art is built from the unhashed Steam library CDN (`cdn.cloudflare.steamstatic.com/steam/apps/{appid}/…`) using `header.jpg` / `library_hero.jpg` / `logo.png`, since the high-res `header_2x.jpg` under `store_item_assets` requires a per-app content hash that isn't derivable from the app id. When a full Steam scan exists, the API-provided header/library_hero URLs (which may be the hashed high-res variants) are preferred.
- `electron/db/mediaSources.js` / `src/hooks/useImageFallback.js`: banner/hero/logo are now emitted as ordered *candidate* lists and resolved in the renderer, so a 404 from one image falls through to the next (Steam CDN → Steam shared.fastly → next source, e.g. F95). `GameBanner` resolves the working url before handing it to banner templates; `HeroBanner` resolves the hero and logo the same way.

### Changed
- `electron/db/versions.js`: `getGame`/`getGames` now select `external_ids`, the per-source banner candidates, and the Steam header/library_hero/logo columns.
- `electron/ipc/games.js` / `electron/ipc/media.js`: game results and preview lists are enriched/ordered by the configured metadata source order before reaching the renderer.

### Fixed
- `electron/ipc/games.js`: fixed the `get-games` handler passing mismatched positional arguments to `getGames`, which caused the install/uninstall filter and download storage mode to be ignored for the library grid.

### Removed
- `electron/database.js`: removed the legacy monolithic database module, which was dead code superseded by the `electron/db/` modules.

## 1.0.66 - 2026-05-20

### Changed
- `src/core/scanners/f95scanner.js`: changed existing-library resync root detection so runtime folders such as `lib/windows-i686`, `renpy/windows-x86_64`, architecture folders, and web/runtime folders are grouped under the real version install folder.
- `src/core/scanners/f95scanner.js`: changed resync executable selection to prefer primary/root launchers over duplicate runtime launchers while keeping nested launchers when they are the only valid option.

### Added
- `scripts/check-library-resync.js`: added a regression check for structured library scans with nested runtime executables, and wired it into `npm run check`.

### Fixed
- `src/core/scanners/f95scanner.js`: fixed `Scan Existing Library` returning thousands of false candidates like `lib/windows-i686` when scanning large migrated libraries.

## 1.0.65 - 2026-05-20

### Fixed
- `src/database.js`: fixed a packaged main-process crash when a user's local Atlas/F95 metadata returned `latestVersion` as a non-string value.
- `src/database.js`: removed the older hand-written `getGame(...)` update comparison path so Properties/detail refreshes use the same safe installed-version comparison as the main library grid.

## 1.0.64 - 2026-05-20

### Changed
- `src/database.js`: changed initial library loading to skip synchronous path validation, mark path-backed versions as pending, and let background validation confirm installed or missing state after the grid appears.
- `src/database.js`: added non-destructive indexes for hot large-library lookups on version paths, record/version pairs, Atlas mappings, and banner records.
- `src/database.js`: cached filter option loading so opening the filter panel does not repeatedly parse large metadata sets.
- `src/core/scanners/f95scanner.js`: changed existing-library resync to stream discovered game roots as they are found instead of building the full candidate list before updating the importer table.
- `src/core/scanners/f95scanner.js`: changed scan output so large imports can emit pending-match rows first, then resolve Atlas/F95 matches later.
- `src/core/importer/importer.jsx`: changed importer matching to resolve pending rows progressively in batches while keeping the table interactive.

### Added
- `src/main.js` and `src/renderer.js`: added background installed-path validation IPC with progress events and live game refresh updates.
- `src/main.js` and `src/renderer.js`: added batched import match/status resolution IPC to avoid thousands of individual matcher/status calls during large scans.
- `src/main.js`, `src/renderer.js`, and `src/core/importer/importer.jsx`: added scan/match cancellation support for large import and library-resync jobs.
- `src/App.jsx`: added visible `Validating installed paths...` feedback while the background path validator confirms large libraries.

### Fixed
- `src/App.jsx`: fixed startup freezes on very large databases by allowing the main grid/sidebar to render from pending installed-path state before slower filesystem checks finish.
- `src/core/importer/importer.jsx`: fixed huge scans doing a second full renderer-side status recheck after final scan completion.
- `src/core/scanners/f95scanner.js`: fixed library-resync usability for thousands of folders by yielding during traversal and sending rows progressively.
- `src/main.js`: fixed repeated manual scan/match work from starting overlapping jobs when cancellation or matching is already active.

## 1.0.63 - 2026-05-20

### Changed
- `src/database.js`: improved local Atlas/F95 importer matching by ranking normalized title and `short_name` matches in both directions, while filtering weak accidental matches from very short catalog names.
- `src/core/scanners/f95scanner.js`: improved archive/folder name parsing for episode, chapter, part, version, platform, and channel suffixes before lookup while preserving the installed version value.
- `src/core/SearchSidebar.jsx`: changed the filter sidebar to use the main app's active filter state instead of resetting its own state every time the panel opens.

### Fixed
- `src/App.jsx`: fixed the left game-title sidebar so large libraries scroll inside the header/footer bounds instead of extending under the footer.
- `src/App.jsx` and `src/core/SearchSidebar.jsx`: fixed filters resetting after closing and reopening the filter sidebar during the same app session.
- `src/database.js`: fixed compressed/imported names such as `ALT_CTRL_DEL_Ep._12-pc`, `MLTAwayFromHomeEp.30FL`, `HoteloftheDamnedDesires-DEMOv0.02-win`, and `YouOnlyDieTwice-.06-Part1-pc` failing to match local Atlas/F95 records.

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
- Updated README badges and GitHub links to point at the `towerwatchman/Atlas` fork.
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
