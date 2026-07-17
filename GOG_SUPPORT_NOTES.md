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
