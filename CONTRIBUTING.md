# Contributing to Atlas

Read this before writing code. It is short on purpose.

Everything here that can be enforced by CI **is** enforced by CI, so this
document mostly explains *why* the gates exist rather than asking you to
remember them. If you skip it and get a red check, the failure message will
point you back to the relevant section.

---

## The four rules

### 1. Branch from `nightly`. Never from `main`.

`main` is the release branch. `nightly` is the integration branch. A PR whose
base is `main` will be closed unmerged — not as a style objection, but because
it will carry the wrong commit history into a release build.

```bash
git checkout nightly
git pull origin nightly
git checkout -b your-change
```

Enforced by `.github/workflows/pr-policy.yml`, which fails any PR not based on
`nightly`.

### 2. New behaviour ships with a test that passes.

Any PR touching `src/` or `electron/` must also touch `tests/`. No exceptions
by default — see *Escape hatches* below for the rare genuine one.

The test must actually exercise the new path. CI can only verify that you wrote
one; reviewers verify that it means something.

### 3. Fixes ship with a regression test.

A fix without a test is a fix that gets reverted by the next refactor. The test
should **fail against the unfixed code** — write it first, watch it go red,
then fix. If it passes before your change, it is not testing your change.

Reference the issue or describe the broken behaviour in the test name, so the
next person to touch that code knows what they'd be breaking.

### 4. Comment new functions and every IPC handler.

Enforced for IPC handlers by `scripts/check-ipc-comments.js`.

Write **why, not what**. The channel name already says what. A comment earns
its place by recording something the next reader cannot recover from the code:
a constraint, a platform quirk, a rejected alternative, an ordering dependency.

The codebase is already good at this. Match these:

```js
// Windows draws a native DWM resize border (often tinted with the system
// accent color) around frame:false windows that aren't also transparent --
// that's the stray colored line on the left/right/bottom edges that no amount
// of CSS could ever reach, since it's painted by the OS outside the web
// content entirely.
transparent: true,
```

```js
// Created on demand by showExecutableChooser(), so a value snapshotted when
// buildCtx() runs is always null. Exposed as a getter and read via ctx at call
// time -- destructuring this would re-freeze it at null.
get executableChooserWindow() { return executableChooserWindow },
```

Not this:

```js
// gets the games
ipcMain.handle('get-games', ...)
```

That is worse than no comment, because it looks like the work was done.

---

## Before you push

```bash
npm ci
npm run check
```

`npm run check` is the same gate CI runs: lint, ~30 `check-*.js` contract
scripts, the Vitest suite, a renderer build, and `git diff --check`. It is slow.
Run it anyway — it is much faster than a CI round trip.

Node 22 (see `.nvmrc`). Other versions may work and are not supported.

---

## The IPC boundary

`electron/preload.js` is the security boundary between the renderer and the
main process. Changes there get extra review (see `.github/CODEOWNERS`).

Two scripts guard this surface, and both exist because of bugs that shipped:

- **`check-ipc-dead-code.js`** — module-level functions in `electron/ipc/` with
  no callers. Written after an audit found four such functions carrying five
  references to names that don't exist in scope. Dead code is where broken code
  hides, because nothing ever runs it and so nothing ever disagrees with it.

- **`check-ipc-channels.js`** — channel *names* that don't line up across the
  process boundary. Written after an audit found four dead channels, including
  one used as both an `ipcMain.handle` name and a renderer listen target, which
  read as working for months.

If you add a channel, add both sides in the same PR. If you remove one side,
remove the other. Half a channel always passes review and never works.

### The `ctx` trap

`registerXHandlers(ctx)` destructuring is load-bearing and has caused the same
class of bug at least twice:

```js
// WRONG -- snapshots the value at registration time
const { executableChooserWindow } = ctx;

// RIGHT -- reads through ctx when the handler actually runs
const window = ctx.executableChooserWindow;
```

Anything created *after* handler registration — windows opened on demand, the
database handle, anything lazily initialised — must be read through `ctx` at
call time. Destructuring a getter does not help; it invokes the getter once and
freezes the result.

---

## Pull requests

- Target `nightly`.
- One logical change per PR. A PR that fixes a bug *and* refactors the
  surrounding module will be asked to split.
- Update `CHANGELOG.md`. Enforced by CI.
- Fill in the PR template honestly. The checkboxes are for the reviewer's
  benefit, not yours.
- PRs are squash-merged, so the PR title becomes the commit message.

### Escape hatches

Two labels exist for genuine exceptions. Both are visible in the PR history
forever, which is the point.

- `no-test-needed` — skips the test-touch check. For changes that genuinely
  cannot be tested: build config, CI plumbing, asset swaps. Not for "this one
  is obviously fine."
- `no-changelog` — skips the changelog check. For internal changes with no
  user-visible effect.

Applying a label to make a check go away, when the check was right, is the one
thing that will get a PR rejected on principle.

---

## Reporting bugs

Open an issue and pick the template that fits — bug report, import/download
problem, or feature request. Blank issues are disabled, because a report
without a version and an OS needs a round trip before anyone can start.

One thing worth knowing: this repository automatically strips any attachment
that isn't a `.png`, `.jpg`, or `.gif`. Paste logs as text into the log field
rather than attaching a `.log` or `.zip`, or they will silently disappear from
your issue. Screenshots are fine.
