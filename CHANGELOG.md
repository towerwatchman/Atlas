# Changelog

Stable release history. Nightly builds are tracked in
[NIGHTLY.CHANGELOG.md](./NIGHTLY.CHANGELOG.md); older releases are kept in
[LEGACY.CHANGELOG.md](./LEGACY.CHANGELOG.md), and the tag naming used before
0.9.14 is explained in [legacy-tag-history.md](./legacy-tag-history.md).

## [Unreleased]

## 0.9.13

- **fix**: Gofile's folder picker is isolated from the URL resolve path used by the other downloader sources.
- **feat**: LewdCorner is now a download source next to F95zone. The update dialog shows a tab per linked site, and each tab loads only when you open it.
  - LewdCorner links use their own per-game cache, and masked-link resolves use the session that matches the link.
- **fix**: Steam previews no longer render twice in Download mode, and Steam previews, banners, trailers and logos are scoped to their own season.
- **feat**: The browser used for external links can be chosen in Settings > Interface.
- **fix**: Installing a game in Download mode now fetches its images in the background once the install finishes, paced by the Delay after each media request setting and the same per-source rate limits as import and refresh (#421). Images are kept when the server URL changes.
- **feat**: Added an `Original Name` field to Edit Game Details, and search now matches it (#346).
- **feat**: The Edit Game Details version list shows Steam, GOG and Itch source chips for remote games (#345).
- **feat**: Game detail metadata is clickable (#130). Tags, category, engine and status jump to that filtered search, while developer and language run a text search.
  - A plain click follows the Click-to-search mode in Settings > Interface (Browse or Library); Shift-click jumps to the other mode.
  - A jumped-to filter section opens itself with the cursor in the section input; a text jump hands the cursor to the search box.
  - Tag removal in the game entry page is allowed only after entering edit mode with the pencil icon.
- **feat**: Esc now leaves the game entry page and unfocuses the search and filter inputs (#130).
- **fix**: Tag and category counts in the filter sidebar now match the results, engine and status counts include exclusive filters, and switching between Browse and Library without the sidebar no longer double-highlights a mode.
- **fix**: Updated F95 parsing and link fetching for the site's current structure.
- **changed**: When both sources hit a challenge, the F95 and LewdCorner fallback windows run in parallel, and each tab fetches its own version instead of sharing one latest version.
  - Parsing now handles the known F95 and LewdCorner templates, including LewdCorner entries where a `<b></b>` wraps the whole Downloads section.
- **fix**: Restored LewdCorner's Plus member check, so eligible Plus titles are available again.
- **fix**: LewdCorner thread links now open the real-browser window on a 403 or challenge page instead of failing outright, and a grant solved during account login carries over to downloads while it is still valid.
- **chore**: Added debug logging for Cloudflare and masked-resolve handling in the downloader popup, visible in the devtools console.
- **fix**: Banner previews now resolve in the order custom, downloaded, remote, and an async probe skips an invalid image path.
- **feat**: Added a Metadata setting that clears the web image cache, so an image cached from a transient 404 can be fetched again.
- **changed**: The masked download resolve window now waits for the page to go idle. It stays hidden through a Cloudflare challenge that clears on its own and through the `/dl/` countdown, and appears only after about 4 seconds without progress.
  - The hidden window is no longer throttled like a background tab, which could freeze F95's own scripts.
  - A funding or social page opened from a shown window is no longer accepted as the resolved link.
- **changed**: A game linked to only one site now shows a source tab in the update dialog, so the fetched version is visible there too.
- **chore**: Revise CHANGELOG & NIGHTLY.CHANGELOG to prepare to support release update notification

## 0.9.12

- **fix**: Follow-up fix for F95 Cloudflare challenges on the non-challenge fetch path, so solved cookies are reused there too.

## 0.9.11

- **changed**: Solved F95 Cloudflare checks are remembered and reused for thread fetches, through the real browser stack instead of a faked user agent.
  - F95 tightened its Cloudflare settings, so this shipped as a hotfix and may be revisited.

## 0.9.10

- **changed**: The media lightbox is now a global control, so images opened anywhere in the app use the same viewer instead of only inside Game Details.
- **fix**: The Personal Rating on the game detail page no longer counts unrated categories as zero, and now matches the figure the rating modal shows.
- **fix**: Saved Browse filters keep their sort order. Twelve of the sixteen sorts were being rewritten to Name A-Z on save, including the default Last Thread Update.
- **fix**: The library grid and Settings > Database each nested a second scroll container, so one working scrollbar sat away from the right edge.
- **fix**: Scrollbars are visible again at 4K and fractional Windows scaling. Chromium ignored the themed 12 px scrollbar once `scrollbar-width` was also set, so it rendered a hairline.
- **changed**: Removed the Has Steam mapping quick filter.
- **fix**: Wishlist state is read from the wishlist table, so a title no longer shows a stale flag that was set once and never cleared.
- **perf**: Wishlist-only filtering in Browse and Library is faster, through indexes on the filtered columns and separate EXISTS clauses instead of one multi-OR subquery.
- **feat**: Browse rows can be added to or removed from the wishlist from the right-click menu, with the row updating immediately.
- **fix**: Playtime is stored and shown as minutes everywhere with ceiling rounding, so the detail page and banner badge no longer show `1h 60m` or 0.4 minutes as Not played.
- **fix**: The Banner Editor's colour pickers stay open while you drag the slider or shade square.
- **feat**: The game detail split-button offers Download Version beside Manual Install, opening the downloads modal for any title with an F95zone thread, so another build can be fetched over an installed one.
- **fix**: Download lists no longer drop whole sections or mislabel builds. An Extras heading no longer swallows the rest of a post, and Part 1/2/3 read as build names instead of archive fragments.
- **fix**: The F95 thread parser reads OS tags that wrap the label in a different `<b>` element. Those downloads are listed again (#326).
- **feat**: The version readout in the topnav and sidebar opens that version's GitHub release page.
- **feat**: Added Buzzheavier as a download host (`buzzheavier.com`, `bzzhr.to`, `bzzhr.co`). Its Cloudflare challenge is solved in a persistent browser window, one resolve at a time, and only challenge cookies are kept.
- **fix**: Downloads and Collections scroll past the first screen again; neither had a scroll container of its own.
- **feat**: Custom preview images can be added from a file, drag-and-drop or an image URL, with live progress. Previews reorder by drag and the order survives re-downloads and metadata refreshes.
  - Only images are accepted, and a missing-only media refresh no longer re-downloads assets already on disk.
- **changed**: Windows download links are offered on Linux alongside the native builds, since Wine can run them.
- **feat**: Folder and program locations can be typed or pasted as well as browsed, with the path highlighted red or green as it validates.
- **fix**: The executable chooser lists its candidates again for archives with more than one executable.
- **fix**: `.bat` and `.cmd` launchers run again on Windows; the shell spawn split the path at the first space.
- **fix**: Catalog tag filtering matches Library exactly, using the same token rule and an indexed tag table instead of a substring scan on every click.
- **feat**: Added Date Added sorting and a date filter (last 7, 30, 90 days or a custom range) to the filter sidebar.
- **feat**: Added a Browse blacklist, managed from the right-click menu and the detail page, with Settings > Blacklist listing entries for removal.
- **feat**: Added Gofile as a download host. One-file folders queue directly, multi-file folders show a picker, and free usage needs no login.
- **feat**: Importer and Library folder schemes accept `{atlasId}`, so installs can be matched back to AtlasDB on re-import or rebuild.
- **feat**: AtlasDB admins can queue the current thread from the extension in one click, behind a new checkbox (#363).
- **feat**: Atlas detects your LewdCorner membership tier (Standard, Plus or logged out) and filters Browse to what the account allows, rechecking periodically and on re-link.
- **feat**: Clicking a cover in Downloads opens the game entry, and clicking the build label opens the source thread in the browser.
- **changed**: Search in Catalog Browse and Library waits for a pause before filtering, so typing on a large library no longer lags.
- **fix**: A pasted Steam, store or thread URL searches by the id extracted from it, including several DLC ids. The indexed URL is no longer the search term (#358).
- **changed**: Removed the restart popup from the Show debug console toggle; the setting applies to open windows immediately.
- **chore**: DevTools no longer opens automatically in dev mode unless it is enabled in config.

## 0.9.9

- **refactor**: Removed nine unreachable functions from the importer and made `no-undef` an error, clearing thirteen latent reference errors.
- **fix**: External library imports put every row in exactly one destination, a library record or the wishlist, and name the reason when a row goes to neither.
- **feat**: Added XLibrary import, including playtime, per-category ratings, playstate and journal notes.
- **feat**: External library imports show a plan before writing and a summary after, instead of closing silently.
- **perf**: Import matching resolves rows carrying a source ID first and in chunks of 50, so a 2,300-row library finishes in a fraction of the round trips.
- **fix**: The Import button is disabled while matching runs, and rows say "Looking up ID" or "Matching by title" instead of a blanket pending state.
- **feat**: Download lists group links by the post's own headings, so the current build and older or partial builds are no longer listed as interchangeable mirrors.
- **feat**: The update modal offers builds with mirrors as chips, hides builds for other platforms with a count, and drops the misleading "not the current build" badge.
- **fix**: `Update Only`, `Split` and patch sections are no longer offered as full-game downloads.
- **feat**: MEGA is a download host, with public-link downloads, AES-CBC decryption and resumable transfers.
- **perf**: MEGA's integrity check runs one AES-CBC pass per chunk instead of a cipher context per 16 bytes, lifting the chunk MAC from about 5 MB/s to 188 MB/s.
- **feat**: MEGA accounts can be signed in, with quota shown in Settings, 2FA support, and the hashcash proof of work solved on worker threads.
- **fix**: MEGA errors report the status and body, and a 402 no longer blames the password.
- **feat**: Pixeldrain is a download host with account sign-in, quota and link checks. Its `/d/` filesystem links resolve by path, not by file id.
- **changed**: Buzzheavier is hidden behind a disabled plugin after its resolver broke.
- **fix**: Version replace targets the version that is actually installed, asks which one when several are, and reports when it declines instead of doing nothing.
- **feat**: Manual install moved into a caret beside the primary action, and it is reachable from Browse rows.
- **feat**: A download started from Browse now creates the library record when it installs.
- **fix**: Browse downloads no longer fail as "no longer in your library"; catalog refs are normalised at enqueue, and a download without a record is queued as add rather than replace.
- **fix**: Installing a promoted download clears its wishlist entry, and a title-only match is reported rather than absorbed.
- **fix**: Install failures name their step, one install runs at a time, and the Downloads progress bar uses the full card width.
- **fix**: The Open thread button works again, using real thread ids and LewdCorner URLs.
- **fix**: The install prompt pre-fills the library's version instead of the filename guess.
- **fix**: Rating cards show `/10` consistently, and the rating modal keeps its draft through background refreshes.
- **fix**: `{engine}` and `{f95Id}` are filled during downloads-install.
- **feat**: The Steam INSTALL button opens a source picker when a title can be installed from more than one source.
- **feat**: The first install asks for the library folder layout, and an empty library folder can be set inline.
- **fix**: Download cards show banner art even when the game is outside the loaded library filter.
- **fix**: Context submenus no longer close when the import progress bar ticks.
- **fix**: Open Game Folder opens the version's own folder and appears for Steam and GOG titles.
- **fix**: The browser extension now reaches disk from a per-machine install, at `data/extension`.
- **fix**: Extension thread matching is isolated by site, so an F95 id no longer matches a LewdCorner id.

## 0.9.8

- **feat**: Tag lists union every catalog source, so a game shows the tags F95, LewdCorner, Steam and GOG each carry instead of only the highest-ranked set.
- **feat**: Catalog tags appear read-only on Browse rows.
- **feat**: Tags are editable in the properties window and on the detail page, and user edits are stored as a resettable override.
- **feat**: A whole collection can be tagged in one action, with filtering, autocomplete and bulk edits.
- **feat**: Linux releases launch games from deb, pacman and AppImage installs.
- **feat**: The emulator and wrapper path works for Wine and similar runners, and native programs run again.
- **fix**: Linux keeps data in the per-user directory instead of the install tree, and repairs an unwritable data folder with one elevated relaunch.
- **fix**: Linux builds use the Atlas icon instead of the Electron default.
- **fix**: 7-Zip is detected in one place, so startup and Settings cannot disagree about where it lives.
- **fix**: Compound tarballs extract fully instead of stopping at the first archive.
- **fix**: Startup table-rebuild migrations take the database write lock, so two windows cannot rebuild the same table at once.
- **fix**: The installer adopts an existing install path from `customInit` rather than `preInit`, and honours that location instead of installing beside it.
- **fix**: The library grid no longer flashes or shows blank rows while loading.
- **feat**: Game rows use a custom React context menu with nestable submenus, a Links submenu, versions ordered newest first, and a working Favorites action.
- **feat**: The rating card splits into Online and Personal ratings, each with its own categories.
- **feat**: Search scope is configurable and shared by all three search paths.
- **feat**: Browse can show only Free-tier LewdCorner entries.
- **fix**: Pacman dependencies sit at the top level of the build config, with the stale default list overridden.
- **chore**: Game artwork uses smooth downscaling.
- **fix**: App updates run the NSIS installer with a visible window and relaunch afterwards, instead of a silent `/S` install that looked like a hang.
- **fix**: A rasterized logo is bundled as a fallback for renderers that cannot show the WebP.

## 0.9.7

- **feat**: Steam-style collections for the local library, with a tile screen, a grouped library tree with counts, and add or remove from the right-click menu.
  - Opening a collection filters the grid like Favorites, and tile art is a cropped mosaic capped at 8 images.
- **feat**: The importer can add a game by store ID or by searching Steam and GOG, which covers delisted titles and installed games Steam omits from its owned list.
- **fix**: A library folder can be set in the middle of an import, the import wizard closes once a run commits, and per-game failures are reported in the main window.
- **fix**: Archive extraction shows the game title and percentage, and PLAY stays on RUNNING for the real process lifetime, including windows opened mid-session.
- **fix**: Hover-to-cycle banner previews works on the first hover again.
- **perf**: Startup no longer waits on the stale-executable sweep, which took minutes on a large library with a cold cache. The repair runs after the window opens, with a bounded async scan.

## 0.9.6

- **feat**: Custom metadata is marked with a pencil and can be reset one field at a time after a confirmation that names the value being discarded. Title, Engine and Developer carry the marker too, and Reset all fields is always present.
- **fix**: Editing one custom field no longer turns every other field into an override or wipes the title's tags; only the keys you change are written.
- **fix**: The startup metadata repair runs in one transaction with a boot progress window on slow libraries, and reports how many fields and titles it restored.
- **perf**: Browse reads from a local catalog index, so the first tile on a 32,000-entry catalog arrives in about 10 ms where it took over two minutes. Steam titles no longer appear twice from a mismatched `steam_id` key.
- **fix**: Browse shows "Preparing Browse..." with progress while the index builds, and a stalled page fetch shows a spinner instead of blank cells.
- **fix**: The library grid no longer claims "No games available" while it loads; it shows the real game and version counts, and a failed load offers Reload.
- **chore**: Config cleanup removes only the two keys verified unused and reports unknown keys instead of guessing.

## 0.9.5

- **feat**: Nightly builds update through their own channel, so they no longer offer or install a stable release. Switching the update channel in Settings takes effect without a restart.
- **fix**: Update checks run at all now; the per-channel baseline was a raw string, so every check failed before reaching the network and reported a generic error.
- **fix**: A channel with no published release reads as up to date instead of as a failed check.
- **chore**: Packaged builds write updater diagnostics to `atlas-updater.log`.

## 0.9.4

- **feat**: Steam seasons collapse onto one tile. Several appids that share an atlas entry (base game and seasons) show as one game with per-version media, and importing any of them attaches to the existing record. The Steam import step lists uninstalled seasons so one can be added on its own.
- **feat**: Settings, Theme Builder, Banner Editor, Importer, Importer Help and Game Details use native OS window chrome, so snapping, resize borders and shadows behave like any other window. The decorative window border is gone.
- **fix**: Atlas sync no longer blanks imported properties such as status, version, category and overview, and an unknown column no longer aborts the whole ingest.
- **fix**: Accented and non-Latin titles match their atlas row again; normalized titles are computed by the same rule on both sides.
- **fix**: The Browse Steam filter recognises appids stored in `steam_appids[]`, so manually linked and uninstalled titles are no longer treated as non-Steam.
- **fix**: The detail page loads previews and trailers for the selected Steam season, and Steam and GOG release dates no longer render as mm/dd/yyyy.
- **fix**: Switching update channels compares each channel against the version last installed from it.
- **fix**: External links from catalog data appear on the detail page, including every Steam appid.

## 0.9.3

- **feat**: GOG is a metadata and import source, with store pages, art and description, manual mapping, and its own release-date handling.
- **feat**: Steam sign-in through OpenID opens the owned library, with bulk import for all, installed or not-installed titles, an install handoff, and per-version Steam identity.
- **feat**: Steam artwork comes from the current GetItems keys, and the detail page gains a horizontal video strip with trailer thumbnails.
- **feat**: Playstates are tracked per version and per title, with a playstate filter in the library (#245).
- **feat**: Uninstalled games show by default without desaturation, and their install state is rechecked on the detail page.
- **feat**: The importer's library folder structure is configurable, and the wizard closes as soon as a run commits.
- **feat**: Toasts report updates and rate limits, so a background refresh no longer blocks the window.
- **fix**: Date filters accept compact YYYYMMDD dates, and update detection no longer misses or invents a version.
- **fix**: Switching from stable to nightly works.
- **chore**: A Vitest regression suite runs in CI, and release artifacts get a ClamAV scan.

## 0.9.2

- **feat**: When the bundled RAR extractor fails, Atlas offers to locate a 7-Zip executable and retries the import, keeping that path for next time.
- **fix**: Extraction no longer crashes on null stdio streams, and 7-Zip's exit code 1 counts as a warning rather than a failed archive.
- **fix**: The detail layout editor's drag target matches the panel height from the first paint, so a whole panel can be dragged without resizing the window first.
- **fix**: A database migration adds the floating and edited flags to existing library tables.
- **chore**: README links the F95Zone thread.

## 0.9.1

- **feat**: The detail page gains a layout editor with full-width rows and 1-5 column bands, per-column auto, flex or fixed widths, panel spans, larger drag handles, and reset to defaults.
- **feat**: A settings tour covers emulators, sources, media mode and accounts, with a richer About and an onboarding note.
- **feat**: The importer opens a help window with a live preview and a fixed footer, and refuses to start without a games folder.
- **fix**: Data and the image cache can live beside the executable with nothing written to AppData, and the cache has a configurable size.
- **fix**: Dragging a panel no longer crashes on a drop, and duplicate keys no longer break panel identity.

## 0.9.0

- **chore**: First release under the 0.9 version line. History before it, including the 1.0.x builds and the imported 0.1.0 nightlies, is kept in [LEGACY.CHANGELOG.md](./LEGACY.CHANGELOG.md).
