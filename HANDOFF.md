# Atlas — outstanding work

Updated after the section 1 pass. Sections 2–7 are carried forward from the
previous handoff unchanged except where the work below touched them.

Line numbers have drifted; the surrounding comments remain the reliable anchor.

---

## 1. Install flow — CLOSED

All four items are done. What follows is what was actually found and built, so
the next session does not re-derive it.

### 1.1 Wishlist promotion — fixed, but not where the last handoff said

The removal was already written and shipping. It did not work, and the reason
matters more than the fix.

`downloads-install` rebuilt an identity key from `promotion.identity`, which
comes out of `getCatalogEntryByRef` with its `SIBLING_IDS` subqueries filled in.
A game wishlisted from a LewdCorner or Atlas row is stored under `atlas:30956` —
the ladder in `normalizeWishlistEntry` only reaches `atlas:` when there is no f95
id — but the promotion hands it back carrying an f95 id it never had when it was
added, and the ladder prefers that. The DELETE ran against `f95:44821`, matched
nothing, and returned `wishlistRemoved: false` with nothing logged.

It now calls `getWishlistEntry(identity)` first. That WHERE clause matches on
`identity_key` OR any of the four provider ids, so whatever it returns IS the
row, and its `identity_key` is the one that deletes. No row found means nothing
deleted.

**`getWishlistEntry` had to be added to `db/wishlist.js`'s exports.** It was not
there. Destructuring it would have thrown into the surrounding catch and logged a
warning — the same shape as the three `ctx` bugs in section 4, and further
evidence for the check script proposed there.

**f95 ref kind: deliberately NOT added.** Decided as a message, not a feature.
The hole is narrower than the last handoff implied: `mapWishlistRow` builds
`catalog_ref` from `current_atlas_id`, which `wishlistHydratedSelect` already
coalesces out of `f95_zone_data.atlas_id`, so any thread linked to an Atlas row
works today. Only a genuinely orphaned f95 row is stuck — and adding the kind
would not be sufficient anyway, because every query in `db/catalogEntry.js`
hydrates from `atlas_data`, so there would still be nothing to build a record
FROM. Closing it properly means a create-record-from-f95-metadata path, which is
a feature, not a ref kind.

Instead the dead end moved forward: `downloads-suggest-version` returns
`cannotCreateRecord`, `InstallModal` shows it and disables Install, and the
`no-catalog-ref` failure branches on `item.source` so an F95 title is told to add
the game manually rather than to re-queue — which the old text advised, and which
loops back to the same message.

### 1.2 Download card banner art — fixed

New module `electron/db/downloadArt.js`. A three-level CTE resolves each row to
effective atlas / steam / lc / gog ids from either its `record_id` mappings or its
parsed `catalog_ref`, then eight art columns hang off that. `db/downloads.js`
joins it into `listDownloads` and `getDownload`; `mapRow` exposes
`bannerCandidates`, shaped to match a game's `banner_candidates`.

Three things worth knowing before touching it:

- **Every art lookup is a scalar subquery, not a join.**
  `f95_zone_data.atlas_id` and `lewdcorner_data.atlas_id` are not unique (the
  server migration), and `lewdcorner_mappings` is only `UNIQUE(record_id, lc_id)`.
  Joining any of them onto `downloads` multiplies rows, and the queue renders one
  card per row. `getGame` survives the same joins behind a `GROUP BY`; there is no
  `GROUP BY` here and there should not be one.
- **The asset base path is configured once**, via
  `downloadsDb.configureArt()` in `registerDownloadsHandlers`, not passed per
  call. `downloadManager` emits `getDownload` results as `download-updated` from a
  dozen places; a progress tick returning the row without its art columns would
  blank the cover the list already had.
- **`claimNextQueued` and `listAwaitingFile` deliberately skip the join.** Neither
  is ever rendered as a card.

`scripts/check-download-art.js` (14 assertions) runs the SQL against a real
in-memory database via `node:sqlite` — no native build needed, unlike
`check-catalog-identity.js`. It is in `npm run check`. Two of its assertions exist
solely to catch row multiplication; a string-matching test would pass on the
broken version.

### 1.3 / 1.4 Folder and structure prompts — done, as two modals

`LibraryFolderModal` and `LibraryStructureModal`, plus
`src/utils/librarySettings.js` holding the shared read-modify-write and the single
`pickGameFolder`. Settings `Library.jsx` now uses those too — there is one picker
for `Library.gameFolder`, not two.

`openInstall` gates in order: folder, then structure, then the install modal. The
folder prompt is ALSO raised reactively on `result.step === 'no-library-folder'`,
with different wording, because the folder can be cleared between the pre-flight
check and the attempt and only the main process knows the difference.

Two decisions taken, both reversible:

- **Structure prompt fires at first install, not first launch.** The layout is
  abstract until something is about to be written. Existing installs count as
  un-prompted and see it once.
- **Editing the structure field in Settings sets `structurePrompted`.** Someone
  who found the setting has answered the question, with more freedom than the
  three presets offer.

`LibraryStructureModal` writes both keys in ONE `saveLibrarySettings` call. Two
sequential single-key saves race, and losing that race sets the flag while
reverting the structure — the one combination that cannot be recovered without
editing `config.ini` by hand.

---

## 2. Install source picker — CLOSED

A Steam mapping used to take the INSTALL button away from every other source.
`resolveActionBarRoutes` had `hasSteamInstall ? 'steam'` at the top of its
priority chain, so a title with both a Steam appid and F95 mirrors could only be
installed from Steam — and the mirrors were not hidden or greyed, they were
unreachable, because the one control that opened them now did something else
under the same INSTALL label.

**The rule existed twice, and only the second copy drove the button.**
`resolveActionBarRoutes` returned `installRoute`, and `ActionBar` then derived
its own `steamInstallCta` in the component body and used THAT for both the click
handler and the label. The resolver could have been entirely correct and the
button would still have handed off to Steam. Worth remembering when reading that
file: its header comment says routing was centralised so it would not be "a chain
of `||` inside JSX", and `steamInstallCta` was written as exactly that, six lines
below the call to the function that exists to prevent it.

New `src/components/detail/page/installSources.js` resolves the list; the COUNT
decides the route.

- 2+ sources → `picker` (`InstallSourceModal`)
- exactly 1 → straight to it; Steam-only still hands off to Steam with no dialog
- 0 → the manual import panel, unchanged

Rules baked in, each with a test:

- Sources removed from `Metadata.sourceOrder` are excluded. An UNSET key means
  every source; an EMPTY STRING means none. Those are different states and
  collapsing them would either ignore a deliberate choice or hide everything from
  someone who never made one.
- GOG appears only when a store page exists. There is no `gog://` equivalent of
  `steam://install`, so without a URL the entry is a button that does nothing.
  Its handler is separate from the toolbar's `openGog` on purpose — same
  destination today, but one is a link and one is an install route.
- LewdCorner is never offered. `UpdateModal` fetches by `f95_id` and there is no
  LewdCorner download path, so it would be an option that cannot be taken.
- Manual Install stays on the caret, not in the picker.

`tests/install-source-routing.test.jsx` (7) MOUNTS ActionBar, which the
resolver's unit tests cannot — and that is the point, since the second copy of
the rule lived in the component. Three of the seven fail against the pre-fix
component and four pass either way; verified by restoring `steamInstallCta` in a
scratch tree and confirming exactly those three flip. `tests/action-bar-routes.test.js`
had an assertion pinning the bug ("lets Steam take the install button when it
owns the title"); it was replaced in place rather than deleted.

---

## 3. Extension packaging — CLOSED

The extension shipped in the installer and never reached disk. Two independent
faults, both invisible in dev.

1. **`extension/**/*` was in `build.files` but not `build.asarUnpack`**, so it
   went inside `app.asar`. Chrome cannot load an unpacked extension from there,
   which is the entire reason `ensureExtensionFiles` copies it out.

2. **The copy used `fs.cpSync`, which cannot read across an asar boundary.**
   Electron's asar support patches the PUBLIC `fs` module. Measured on the Node
   22 in `.nvmrc`, the only public method `cpSync` calls is `lstatSync` —
   `readdirSync`, `copyFileSync` and `mkdirSync` all go to internal bindings that
   bypass the patch, see `app.asar` as a file rather than a directory, and throw.
   The `catch` swallowed it, `ensureExtensionFiles` returned the target path
   anyway, and `get-extension-path` reported a folder that had never been
   written.

The candidate list compounded it. `candidates.find(fs.existsSync)` takes the
first hit, the first entry was the in-asar path, and `fs.existsSync` IS patched
— so it returned true and the three real-directory fallbacks below it were never
tried. Real directories are searched first now, `app.asar.unpacked` at the head,
with the asar path kept last as a genuine fallback.

**Both only ever broke in packaged builds.** In dev `app.getAppPath()` is the
project root, so the first candidate was a real folder and there was no asar to
cross. That is why this survived every run on a developer machine, and it is the
reason to distrust "it works here" for anything in this file.

`scripts/check-extension-packaging.js` (7) is in `npm run check`. It asserts the
config, cross-checks `manifest.json` against the files on disk, and MEASURES the
`cpSync` constraint rather than citing it — so if a future Node routes `cpSync`
through the public `fs`, the check fails and someone gets to delete a workaround
instead of inheriting it forever.

3. **The copy TARGET was not writable.** `ensureExtensionFiles` used
   `path.join(appDataRoot, 'extension')`, and on Windows `appDataRoot` IS the
   install directory — `dataLocation.js` `resolveDataRoot` returns `installDir`
   on win32. So the target was `C:\Program Files\Atlas\extension` and every copy
   failed with EPERM.

   This one is not a permissions oversight. `build/installer.nsh` grants Users
   modify on `$INSTDIR\data` and `$INSTDIR\launchers` and deliberately NOT on
   `$INSTDIR`, because that folder holds Atlas.exe and a user-writable directory
   of executables that something elevated later runs is a privilege-escalation
   route. Atlas runs unelevated for the same reason — it launches games, and a
   child inherits its parent's elevation. **Do not "fix" this by widening the
   grant.**

   Target is `dataDir` now. That is also the only choice that survives an
   upgrade: `DeleteLoop` in `installer.nsh` wipes every `$INSTDIR` subfolder
   except `data` and `launchers`.

   Older `perMachine: false` builds installed into `%LOCALAPPDATA%`, which is
   writable, so the wrong path happened to work there. That is why this read as a
   regression from the per-machine switch rather than as a path that was always
   wrong.

The folder was also created LAZILY, only by the three IPC handlers — all behind a
settings screen. Someone who installed and went straight to Chrome's "Load
unpacked" found nothing. `registerExtensionHandlers` syncs once at startup now;
the mtime check keeps that free after the first launch.

`ensureExtensionFiles` returns `{ extensionPath, ok, error, sourceDir }` rather
than a bare path, and `ExtensionSettings` shows the reason. It used to log and
return the target regardless, so "Extension directory does not exist" was the
only thing the user ever saw — identical output for an unwritable install
directory and for a build with no extension in it.

**The pattern worth carrying forward:** three rounds on this bug, each fix
exposing the next, and all three worked in dev. In dev `app.getAppPath()` is the
project root, `appDataRoot` is `electron/`, and both are writable. "It works
here" has now been wrong about this file three times.

**Still not covered:** nothing inspects the built artifact.
`check-extension-packaging.js` (10) asserts the config that produces it,
cross-checks the manifest against disk, and measures the `cpSync` constraint;
`tests/extension-files.test.js` (5) exercises the copy itself. Catching the
packaged output means unpacking a built `app.asar`, which needs a full
`electron-builder` run — see section 8.

---

## 4. Security — the last soft spot

### `electronIPC` accepts arbitrary channels

**Where:** `electron/preload.js`, the `contextBridge.exposeInMainWorld("electronIPC", …)` call

```js
on:   (channel, func) => { ipcRenderer.on(channel, (event, ...args) => func(...args)) },
send: (channel, data) => { ipcRenderer.send(channel, data) },
```

No allowlist in either direction, while `removeAllListeners` directly above it
carefully gates a 13-entry set. Its only consumer is
`src/assets/ui/executable-chooser.html`, which needs exactly two channels:
`init-executable-chooser` and `executable-chosen`.

Replace with two named methods on the main bridge. That also lets the chooser
move onto the normal preload and `electronIPC` be deleted entirely.

Unchanged by the section 1 work. This is now the only remaining item of its kind
— the extension RPC server was locked down last session (token + origin
allowlist).

---

## 5. Dead code from the original audit

See `docs/DEAD-CODE-AUDIT.md` for the full trace. Everything is resolved except:

| Channel | Sender | Note |
|---|---|---|
| `import-images-complete` | `electron/ipc/importer.js` | no listener anywhere |
| `downloads-reordered` | `electron/downloads/downloadManager.js` | no listener; drag-reorder likely refreshes via `downloads-changed` |

`scripts/check-ipc-channels.js` deliberately does **not** flag
sends-without-listeners — indirection through `broadcast()` / `emit()` made that
check produce more false positives than findings — so these will not fail CI.
Decide per channel whether the send is dead or the listener is missing.

---

## 6. A check script worth writing — now with a fourth case

Unchanged in substance, and reinforced: `getWishlistEntry` missing from
`db/wishlist.js`'s exports (found during 1.1) is the same class of bug as the
three `ctx` cases, just one module boundary over.

`ctx` is assembled by hand in `electron/main.js` (`buildCtx()` plus a block of
`Object.defineProperty` calls), and each `register*Handlers(ctx)` destructures
names off it with nothing verifying the two agree. A missing name is `undefined`,
and the failure appears much later as `X is not a function`.

The four:

- `ctx.executableChooserWindow` — snapshotted as `null`, threw on `.on()`
- `ctx.getConfig` / `ctx.saveSettings` — never defined; extension settings
  silently never persisted, and the pairing token could not generate
- `ctx.isWishlistEntry` — never passed through; `wishlist-check` threw on every
  call
- `getWishlistEntry` — not exported from `db/wishlist.js`; would have thrown into
  a catch and logged a warning

**`scripts/check-ctx-contract.js`** would catch the whole class: parse each
`const { … } = ctx` in `electron/ipc/*.js`, collect the names, and assert each one
appears in `buildCtx()`'s returned object or the `defineProperty` block.

Worth widening to destructured `require`s of local modules while in there — the
fourth case is that shape, and it is a strictly easier check because the
exporting module's `module.exports` is right there. A 20-line version of exactly
this was run by hand during 1.1 and found the bug.

Two traps for whoever writes it, both hit previously:

- A naive regex over the destructure block captures local variables from the
  function body below it. Bound the capture to the destructure itself.
- Names that look missing may be direct `require`s rather than ctx properties
  (`clearTagOverride`, `getKnownTags`, `resolveLinuxLaunch`, `applySeasonMerge`
  are all false positives of this kind). Check the requires before reporting.

Fits alongside the existing `scripts/check-*.js` and would run in `npm run check`.

---

## 7. GitHub settings — cannot be done from a PR

Unchanged. None of this is reachable from the working tree.

- **Default branch → `nightly`.** Currently `main`. Until this changes, every
  contributor's PR defaults to the wrong base and trips the policy check once
  before they learn. Also: issue templates only take effect from the default
  branch.
- **Import the rulesets** in `.github/rulesets/`. One at a time, via
  Settings → Rules → Rulesets → Import. Import `main-release.json` **after** CI
  has run at least once, or the required status check names will not exist yet
  and PRs will hang on a check that never reports.
- **Status check contexts are `checks` and `PR policy`** — not `CI`. The first is
  the job id in `ci.yml`; adding a `name:` to that job would silently break the
  ruleset.
- **`@towerwatchman` needs write access** or CODEOWNERS does nothing. GitHub
  ignores unresolvable owners with no error.
- **Create labels:** `importer` (used by the issue template), `no-test-needed` and
  `no-changelog` (the PR-policy escape hatches — without them the hatches do not
  exist).
- **Store `atlas-extension-PRIVATE-KEY.pem` off the repo.** `*.pem` and `keys/`
  are gitignored as a guard. The public half lives in `extension/manifest.json` as
  `key` and is safe to commit; it pins the extension id to
  `eeejnjabpobbeoklajpekhfofnokoboe`.

---

## 8. Verify after the next build

Carried forward, plus the section 1 work.

- **Does the wishlist entry actually disappear?** Wishlist a game from a
  **LewdCorner or Atlas** row specifically — an f95 one would have worked even
  before the fix, so testing that one proves nothing. Install it from the queue
  and confirm the wishlist row is gone. `[downloads-install] wishlist cleared` is
  logged either way now, with the key it used and whether it matched.
- **Cover art on a Browse/wishlist download.** Queue something not in the library
  and confirm the card shows art before it is installed. Then filter the library
  down to exclude an installed game with a queued download, and confirm that card
  keeps its art — that is the `gamesByRecordId` case.
- **The two prompts, in order.** Clear `Library.gameFolder` and
  `Library.structurePrompted` in `config.ini`, press Install, and confirm the
  folder prompt comes first, the structure prompt second, and the install modal
  third. Then confirm neither reappears on the next install.
- **The reactive folder prompt.** Set a folder, open Downloads, clear the folder
  in Settings in the other window, then Install. It should fail and raise the
  prompt with the "the install stopped" wording, not the "before we start"
  wording.
- **Does the extension folder actually exist after installing?** Needs a real
  packaged build, not a dev run — all three faults here were invisible in dev by
  construction. Install from the NSIS installer and check
  `C:\Program Files\Atlas\data\extension` on disk BEFORE opening Settings; the
  sync runs at startup now, so it should already be there. Then open Settings,
  confirm the path shown matches, and confirm "Open extension folder" opens it.
  On failure the page names both folders it tried and the reason, rather than
  only saying the directory does not exist.
- **INSTALL on a game with both Steam and F95.** Confirm it opens the picker
  rather than jumping to Steam, and that the button carries no Steam glyph. Then
  remove Steam in Settings > Metadata and confirm the same game's INSTALL goes
  straight to the mirrors with no dialog.
- **Do extension setting toggles persist?** `ctx.saveSettings` never existed, so
  `save-extension-settings` had been throwing for as long as it has been there.
  Flip a toggle, restart, confirm it stuck.
- **Does `build.productName` equal "Atlas"?** The issue templates tell users their
  logs are in `%APPDATA%\Atlas`. If it differs they will hunt for a folder that
  does not exist.
- **Multi-executable import.** The executable-chooser fixes (stale `ctx` binding
  plus a `../../` path that resolved above the app root) are only reachable when
  an archive contains more than one executable. Worth one deliberate test.
- **Nightly build.** The publish race fix restructured `nightly.yml` into
  prepare → build → publish. Delete any stray `v0.9.9-nightly.430` release or tag
  first: `prepare` reuses an existing release by design, so a broken leftover
  would be adopted rather than recreated.

---

## 9. Decisions still parked

**Extension distribution.** Currently load-unpacked, which needs developer mode
and shows a startup nag. The Web Store gives one-click install, auto updates, and
no developer mode — but the content scripts target adult forums and Google's
program policies restrict sexually explicit content, so rejection is a real risk
and removal later would break every user at once.

A third option worth understanding before investing in token-pairing
improvements: **native messaging**. Chrome launches the app over stdio and the
native host manifest lists exactly which extension ids may connect, so the browser
enforces the boundary and there is no localhost port to guard at all. Larger
change; the extension still has to get installed somehow.

**CHANGELOG note owed:** existing extension users are unpaired on upgrade and must
paste the token once.

**New: `Metadata.sourceOrder` and download card art.** The row's chain
(`downloadArt.js`) resolves sources in the SQL default order and does not honour
the user's configured source preference — `applyMediaSources` does that, and it
runs in the games pipeline. The renderer therefore prefers a game object's chain
when it has one and falls back to the row's otherwise, so the only rows affected
are the ones that previously showed no art at all. Fixing it properly means the
queue layer reading metadata config, which is a boundary worth thinking about
before crossing.
