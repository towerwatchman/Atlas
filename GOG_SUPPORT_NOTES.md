# GOG Support — Change Summary

Adds GOG as a first-class metadata/import source, mirroring the existing Steam
integration.

## New files
- `electron/db/gog.js` — mapping/lookup helpers (getGogIDbyRecord, addGogMapping,
  findRecordByGogId, getGogBannerUrl, getGogScreensUrlList).
- `electron/scanners/gogscanner.js` — dual local scan (GOG Galaxy `galaxy-2.0.db`
  + standalone `goggame-*.info` files, merged & de-duped), GOG products API
  (`api.gog.com/products/{id}` + `v2/games/{id}` enrichment), YouTube trailers,
  best-fit image mapping (background→hero, logo→header/logo, boxArt→capsule).

## Schema (electron/db/index.js)
- New tables: `gog_data`, `gog_screens`, `gog_movies`, `gog_mappings` + indexes.
- `gog_mappings` added to the orphaned-record sweep.

## Detail page + previews/trailers
- `db/mediaSources.js` — GOG image resolution, hero/logo candidates, external
  links (gog_id → gog.com), preview-source detection (gog-statics/youtube).
- `db/versions.js` — GOG columns in all catalog UNION arms + a dedicated
  `gog_branch` CTE so standalone GOG games appear without an Atlas record.
- `db/media.js` — GOG screens/movies in browse + remote preview queries.
- `PreviewLightbox.jsx` — inline YouTube `<iframe>` playback for GOG trailers.
- `gameDetailUtils.js` — GOG id/detection + developer/release-date fallbacks.
- `GameDetailPage.jsx` — passes gog_id to the browse preview loader.

## Import + scan + launch
- IPC: `start-gog-scan`, `get-gog-game-data`, `select-gog-directory`,
  `prompt-gog-directory` (importer.js), gog_id wired into browse previews
  (media.js). GOG launch via `goggalaxy://openGameView/{id}` (games.js).
- `preload.js` — startGogScan / selectGogDirectory / onPromptGogDirectory /
  getGogGameData bridges.
- Importer UI: source registered (importerSources.js, SourceStep.jsx),
  scan flow (Importer.jsx), scan-row GOG store button (ScanTable.jsx).
- Settings → Metadata: GOG added to the reorderable source list.

## Notes / follow-ups
- Download-to-disk mirroring of GOG assets was intentionally deferred this pass
  (per scope). GOG art currently streams from the CDN like the other sources.
- GOG API field names were mapped from live response shapes; if GOG changes
  their response schema, adjust `getGogGameData` in gogscanner.js.

## Fix round 2 (import visibility, executable, window routing)
- electron/main.js: added 'gog' to the main-process importer source whitelist
  (normalizeImporterSource). Previously clicking GOG fell back to the Atlas
  importer window because the main process had its own copy of the whitelist.
- electron/scanners/gogscanner.js: resolve a real executable at scan time - read
  the primary play-task path from goggame-*.info, else scan the install dir for
  a .exe. Scan rows now carry execPath/exec_path + a real executables list +
  gogUrl so the game runs directly and the GOG store button populates.
- electron/ipc/importer.js: treat GOG imports as in_place (like Steam) so the
  version persists; carry gogId + sourceType 'gog' on the version.
- electron/db/versions.js: getGames force-marks GOG-mapped versions installed
  (like Steam) so imported GOG titles show in banner/library view without an
  Atlas mapping; gog_id selected via COALESCE(mapping, data).

## Fix round 3 (mappings + image URLs)
- MappingsTab.jsx: show GOG id row (game properties) mirroring Steam.
- externalLinks.js: GOG link def + fa-gg icon so gog_id renders as a link.
- GameDetailPage.jsx: buildDetailExternalLinks is GOG-aware and injects the
  GOG store link for mapped GOG games (id lives in gog_mappings, not
  external_ids), mirroring the Steam special-case.
- gogscanner.js: rewrote gogImageUrl to handle all known GOG URL forms
  (protocol-relative concrete, bare hash + size suffix, and {formatter}/
  {ext} templates). Screenshots use formatter=ggvgm_2x; header/hero/logo/
  boxart use concrete size suffixes.
- scripts/gog-api-probe.js: NEW helper to dump a real GOG product response so
  image URL building can be verified against ground truth.

## Fix round 4 (images verified against real GOG API)
Confirmed via scripts/gog-api-probe.js against a live product:
- v1 data.images gives CONCRETE .jpg/.png urls (background, logo, logo2x, icon).
  No {formatter}/resize token needed for these — removed bogus size suffixes.
- v1 has NO boxArtImage/galaxyBackground. Those live in v2 _links
  (galaxyBackgroundImage, boxArtImage, logo) as concrete hrefs.
- Screenshots carry a formatted_images[] array of concrete urls at named sizes;
  now pick the largest (ggvgl_2x -> ... -> ggvgt) instead of substituting the
  template.
Result mapping:
- header/logo   <- images.logo2x (or v2 _links.logo)
- library_hero  <- v2 galaxyBackgroundImage/backgroundImage, else v1 background
- library_capsule <- v2 boxArtImage (portrait), else hero/logo fallback
- screenshots   <- formatted_images ggvgl_2x

## Fix round 5 (v2-primary, full metadata)
Rewrote getGogGameData to use the v2 endpoint as the PRIMARY source (v1 is now
only a fallback), verified against a real v2 response:
- logo    <- v2 _links.logo.href (real logo)
- hero    <- v2 _links.galaxyBackgroundImage.href (then backgroundImage, then v1)
- capsule <- v2 _links.boxArtImage.href (portrait)
- header/banner <- v2 _embedded.product._links.image (templated) formatter "800"
- screenshots <- v2 _embedded.screenshots[]._links.self (templated), first *_2x
- description/overview <- v2 top-level description/overview (HTML)
- developer/publisher <- v2 _embedded.developers / publishers
- genre <- v2 _embedded.properties (curated), tags <- _embedded.tags
- languages (text/voice) <- v2 _embedded.localizations scopes
- os <- v2 _embedded.supportedOperatingSystems
- release_date <- product.globalReleaseDate / gogReleaseDate
- censored <- inferred from esrbRating/uskRating age

## Fix round 6 (store link, info panel, manual mapping, banner metadata)
1. Store link: capture v2 _links.store.href (slug URL) into new gog_data.store_url
   column (+ migration). GameDetailPage/ActionBar now open the real store page
   (fa-gg "Open on GOG" button + GOG external link) instead of /game/{numericId},
   which GOG does not resolve.
2. Info panel: InfoPanel now shows GOG box art (gog_library_capsule) + the
   description (overview) for GOG games, mirroring Steam.
3. Manual mapping: added a "GOG ID" field to the Mappings modal. set-manual-
   mappings now writes a gog_mappings row and fetches metadata so art/desc/
   developer fill in immediately. Any game can now be given a GOG id.
4. Banner metadata: getGame/getGames COALESCE now fold gog_data into category,
   censored, genre, language, os, overview, translations, voice, publisher,
   release_date. Banner creator resolver falls back to gog_developer, so the
   developer/creator shows on the banner.

## Fix round 7 (refresh modal: missing vs all + stream/download setting)
- New src/components/ui/RefreshMediaModal.jsx: choose "missing only" vs "all",
  with a read-only note showing whether images download or stream (per the saved
  Settings > Metadata media-storage mode).
- electron/ipc/media.js: refactored refresh into a shared refreshOneGame(recordId,
  {mode, download}) that re-fetches BOTH Steam and GOG metadata and only calls
  downloadImages when the setting is 'download' (otherwise streams). 'missing'
  mode skips metadata re-fetch when *_data already looks populated and skips
  image download when banner+previews already exist on disk.
  - refresh-game-media now accepts { recordId, mode } (back-compat: bare id ok).
  - NEW refresh-media-library handler iterates all games with progress
    (refresh-media-progress event).
- preload.js: refreshGameMedia(recordId,{mode}); refreshMediaLibrary({mode});
  onRefreshMediaProgress.
- Detail page: the Refresh Media button opens the modal (per-game).
- Nav "Updates" button: now opens the library refresh modal; confirming runs the
  online DB catalog sync AND a library-wide media refresh, then reloads lists.

## Fix round 8 (release date + store link refresh)
1. formatReleaseDate: GOG stores release_date as "YYYY-MM-DD" (folded into
   release_date via COALESCE). The old code ran parseInt on it
   (parseInt("1996-08-31")===1996 -> 1970-01-01). Now detects ISO date strings
   and returns them verbatim; only purely-numeric values are treated as unix
   timestamps. Fixes Daggerfall showing 1970-01-01.
2. Store link: store_url is captured from v2 _links.store.href and persisted;
   the detail-bar GOG button + external link both use it. Existing games have a
   null store_url until refreshed. media.js 'missing' mode now also re-fetches
   GOG when store_url is empty, so "Refresh missing" (not just "Refresh all")
   repairs the stale /game/{numericId} links.
