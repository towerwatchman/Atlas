# Atlas — agent instructions

See [`CLAUDE.md`](./CLAUDE.md) for the full set, and [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for the authoritative version. Kept as a separate file so tooling that looks
for `AGENTS.md` finds it; the content is deliberately not duplicated here, so
there is only ever one source of truth to update.

The short version:

1. Base on `nightly`, never `main`.
2. New behaviour needs a passing test in `tests/`.
3. Fixes need a regression test that fails before the fix.
4. Comment new functions and IPC handlers — why, not what.
5. Run `npm run check` before reporting done. Say so if you could not.
