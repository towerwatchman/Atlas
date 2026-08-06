# Atlas — agent instructions

**Read `CONTRIBUTING.md` in full before writing any code.** It is the single
source of truth; this file exists only because agent tooling auto-loads it and
`CONTRIBUTING.md` is not guaranteed to be in your context.

## Non-negotiable

1. **Base every change on `nightly`, never `main`.** A PR targeting `main` is
   rejected automatically.
2. **New behaviour requires a test in `tests/` that passes.** A PR touching
   `src/` or `electron/` without touching `tests/` fails CI.
3. **A fix requires a regression test that fails against the unfixed code.**
   Write it first and confirm it goes red before you fix anything.
4. **Comment every new function and every IPC handler.** Say *why*, not *what*.
   Enforced by `scripts/check-ipc-comments.js`.

## Before you claim to be done

```bash
npm run check
```

This is the CI gate: lint, ~30 contract scripts, Vitest, a renderer build. Do
not report a task complete without it passing. If you cannot run it, say so
explicitly rather than implying the change is verified.

## Traps in this codebase

**Never destructure lazily-created values out of `ctx`.** `registerXHandlers(ctx)`
runs before windows and the database exist, so a destructured binding freezes at
`null`. Read `ctx.thing` at call time. Destructuring a getter does not help — it
invokes the getter once. This has caused shipped bugs twice.

**IPC channels have two sides.** Adding `ipcMain.handle` without a caller, or
`ipcRenderer.on` without a sender, passes lint and review and silently does
nothing. `scripts/check-ipc-channels.js` will catch it. Add or remove both sides
in the same change.

**Scan `.html` when tracing IPC.** `src/assets/ui/executable-chooser.html` uses
raw `electronIPC` rather than React. A `.js`/`.jsx`-only search reports its live
channels as dead. This mistake has been made.

**`electron/preload.js` is the security boundary.** Do not widen the
`removeAllListeners` allowlist or the `electronIPC` bridge without saying so
prominently in the PR description.

## Style

Match the surrounding code. Comments here explain constraints and rejected
alternatives, not mechanics — see `showExecutableChooser` in `electron/main.js`
for the register to aim at. Do not add JSDoc boilerplate to a file that has none.

Do not reformat, reorder imports, or "clean up" code you were not asked to
touch. Unrequested diff noise buries the actual change and will be asked for
removal.

## Honesty

If you could not run the tests, could not reproduce the bug, or are unsure a
change is correct, say so plainly in your summary. A confident wrong report
costs more than an uncertain accurate one.
