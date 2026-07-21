# Atlas regression tests

Behaviour contracts that prevent regressions when multiple developers touch
shared code (Steam scanning, media/previews, versions, importer). If you change
one of these areas, **run the suite and update the relevant test** so the new
behaviour is locked in.

## Running

```
npm test          # watch mode (Vitest) while developing
npm run test:run  # one-shot, used by CI
npm run test:coverage
npm run check     # everything: syntax + asset/layout checks + tests + vite build
```

CI runs `npm run test:run` and `npm run check` on every push and pull request
(`.github/workflows/ci.yml`). A red suite blocks the change.

## Two layers, on purpose

1. **`scripts/check-*.js`** — the original framework-free checks (mock input,
   call the real function, `assert`, `process.exit(1)`). Still run via
   `npm run check`. Fine for quick single-function guards.
2. **`tests/*.test.js`** — Vitest suite for richer assertions, grouping, and
   coverage. Prefer this for new tests.

Both exercise the **real** exported functions — no reimplementing logic in the
test. Mock only the boundaries (`global.fetch`, the DB).

## What's covered today

| File | Contract it protects |
|------|----------------------|
| `steam-assets.test.js` | GetItems is authoritative; logo resolves `library_logo`→`logo`; **empty (not fabricated) logo when Steam omits it**; 2x variants win; `${FILENAME}` never leaks; source-order defaults; screenshot dedupe by content hash |
| `steam-movies.test.js` | Trailer extraction from DASH (`dash_h264`/`dash_av1` `.mpd`) and legacy mp4/webm; screenshots → full-size URLs; no-movies is not a crash |
| `video-url.test.js` | `isVideoUrl` recognises `.mp4/.webm/.m4v/.mpd`; `isDashUrl` true only for `.mpd` |

## Adding a test

1. Create `tests/<area>.test.js`.
2. `import { describe, it, expect, vi } from 'vitest'`. Backend modules load with
   `require('../electron/...')` (CommonJS); `src/` modules with `import` (ESM).
3. Mock boundaries with `vi.fn()`; restore in `afterEach`.
4. Assert the **observable output**, not internals.
5. Run `npm run test:run` before pushing.

## When you change behaviour on purpose

Update the test in the same commit. A failing test after an intentional change
means the contract moved — edit the assertion and note why in the commit. Never
delete a test to make CI green without a stated reason.
