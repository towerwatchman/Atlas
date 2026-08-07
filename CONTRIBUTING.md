# Contributing to Atlas

Read this before writing code. It is short on purpose.

Everything here that can be enforced by CI **is** enforced by CI, so this
document mostly explains *why* the gates exist rather than asking you to
remember them. If you skip it and get a red check, the failure message will
point you back to the relevant section.

---

## The five rules

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

### 5. Say whether AI wrote any of it, and which one.

Enforced by `.github/workflows/pr-policy.yml`, which reads the **AI assistance**
section of the PR description.

This is not a rule against using AI. Plenty of Atlas was written with it. It is
a rule about telling the reviewer *which* one, because the answer changes what
the review needs to look for.

Different assistants fail differently, and the failures are consistent enough to
look for on purpose:

- Some invent APIs that read perfectly and do not exist — a plugin method never
  defined, an `electronAPI` name never exposed in `preload.js`.
- Some quietly rewrite surrounding code to their own house style, so a
  three-line fix arrives as a two-hundred-line diff and the actual change is
  buried in reformatting.
- Some write tests that assert what the code does rather than what it should do.
  Those pass, prove nothing, and fail rule 3 while looking like they satisfy it.
- Some normalise line endings, and this repository is CRLF on disk. A whole-file
  ending flip makes every line look changed and hides the real diff.
- Some carry conventions in from other projects — a state library Atlas does not
  use, `localStorage` in a renderer that has no such thing.

A reviewer who knows the tool can check its specific habits first. A reviewer
who doesn't has to read everything with equal suspicion, which in practice means
reading nothing carefully.

So: name the tool and model, say which files it touched, and say what you
verified yourself. "Claude Opus 5 via Claude Code — wrote the whole extractor
and its tests; I checked the regexes against three real threads by hand" is a
useful disclosure. "Some AI" is not.

Two things worth being clear about:

**Autocomplete counts once it writes logic.** Accepting a Copilot suggestion for
a whole function is AI-written code. Tab-completing a variable name you had
already decided on is not. If you are unsure, disclose — nobody has ever been
criticised here for over-disclosing.

**You own the code either way.** Disclosure is not a disclaimer, and "the AI
wrote it" is not a defence for a change you cannot explain. If you cannot say
why a line is there, do not open the PR — that is the same standard rule 4 asks
of every other line in the codebase.

This is self-reported, and CI can only check that you answered, not that you
answered truthfully. It works on the same basis as the rest of this document.

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
- Complete the **AI assistance** section. Enforced by CI. There is deliberately
  no escape-hatch label for it: "did a machine write this" always has an answer.
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
