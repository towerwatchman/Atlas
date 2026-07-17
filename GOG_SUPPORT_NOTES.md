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
