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
6. Identify yourself. If you wrote or edited code here, tell whoever you are
   working with your name and model, so they can fill in the **AI assistance**
   section of the PR. CI rejects a PR that leaves it blank. Name the specific
   model, not just "an AI" — the disclosure exists so a reviewer knows which
   failure modes to check for, and that only works if the tool is named.

Two habits that cause trouble here specifically:

- **This repository is CRLF on disk** (`.gitattributes` is `text=auto`). Do not
  normalise line endings on files you touch. A whole-file ending flip makes
  every line look changed and buries the real diff.
- **Do not restyle code you are not changing.** A three-line fix that arrives as
  a two-hundred-line reformat will be asked to split, and the actual change is
  the part nobody can find.
