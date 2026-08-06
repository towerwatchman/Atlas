# Atlas — Dead Code Audit

Scope: `src/App.jsx` (2,705 ln), `electron/ipc/importer.js` (4,933 ln),
`electron/main.js` (2,423 ln), plus the full IPC surface (`electron/ipc/*`,
`electron/preload.js`) since dead handlers can only be proven dead by tracing
main → preload → renderer.

Method: static trace of every `ipcMain.handle/on`, `ipcRenderer.invoke/on`,
and `webContents.send` across `.js`, `.jsx`, **and `.html`**, then manual
confirmation of each hit. Counts: 201 handlers, 200 preload invokes,
47 preload listeners.

**Every finding below was manually confirmed.** Two items that the automated
pass flagged turned out to be live code and are listed under False Positives
so they don't get deleted by mistake.

---

## 1. Confirmed dead — safe to remove

### 1.1 `send-game-data` / `onGameData` — vestigial push path
| Site | Line |
|---|---|
| `electron/preload.js` | 574–580 (`onGameData`) |
| `src/components/detail/GameDetailsWindow.jsx` | 319 (registration) |

Nothing in the codebase ever sends `send-game-data`. The live path is the
pull-based `requestGameData()` → `ipcMain.handle('request-game-data')`
(`electron/ipc/games.js:353`), which returns the game as the invoke result and
calls `handleGameData(null, fetchedGame)` directly. The `onGameData` listener
is registered and never fires. Also carries two stray `console.log`s.

Remove: the preload method, the registration at line 319.

### 1.2 `import-warning` / `onImportWarning` — never sent
| Site | Line |
|---|---|
| `electron/preload.js` | 653–655 |

Sole occurrence in the entire tree. No sender, no consumer. The comment above
it (`// Optional: better feedback during long imports/moves`) confirms it was
speculative.

### 1.3 `context-menu-command` / `onContextMenuCommand` — superseded
| Site | Line |
|---|---|
| `electron/preload.js` | 559 (allowlist), 571–572 (`onContextMenuCommand`) |
| `src/App.jsx` | 1721–1727 (handler), 1747 (cleanup list) |

Nothing sends `context-menu-command`. Context menu actions now route entirely
inside main via `processTemplate` → `handleContextAction`
(`electron/ipc/windows.js`). Specifically the `properties` action —
the only action the dead App.jsx handler cares about — is handled at
`windows.js:41` and calls `ctx.createGameDetailsWindow(recordId)`.

**This is a behavior change that was already made and half-cleaned.** The dead
App.jsx block still contains the *old* behavior (set `selectedGame` inline in
the main window). It never runs. Worth confirming the separate-window behavior
is the one you want before deleting, since the dead code is the only remaining
record of the old intent.

### 1.4 Orphaned `webContents.send` calls — fire into the void
| Channel | Sender | Note |
|---|---|---|
| `import-images-complete` | `electron/ipc/importer.js:4300` | no listener anywhere |
| `downloads-reordered` | `electron/downloads/downloadManager.js:681` | no listener; drag-reorder UI likely refreshes via `downloads-changed` |
| `wishlist-updated` | `electron/rpc/extensionServer.js:262` | no listener; extension writes wishlist, UI never learns |

`wishlist-updated` is the one I'd look at hardest — it's plausibly a *missing
listener* rather than a dead send. If the browser extension adds a wishlist
entry and the open library doesn't refresh, that's the cause.

---

## 2. Real bugs found during the trace

### 2.1 `executable-chooser.html` path is one level too high — window cannot load
`electron/main.js:1727`

```js
executableChooserWindow.loadFile(
  path.join(__dirname, '../../src/assets/ui/executable-chooser.html')
)
```

`__dirname` is `<app>/electron`, so `../../` resolves to the **parent of the
app root**. Every other window in `main.js` uses a single `../`:

```js
mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))       // 1383
settingsWindow.loadFile(path.join(__dirname, '../dist/renderer/settings.html')) // 1432
// …themebuilder 1484, bannereditor 1558, importerhelp 1594, gamedetails 1684
```

`package.json` `build.files` includes `src/assets/ui/**/*`, so the file ships
at `<app>/src/assets/ui/`. Correct path is `'../src/assets/ui/executable-chooser.html'`.

Effect: the executable chooser fails to load in both dev and packaged builds.
Since `showExecutableChooser` is awaited in the import flow
(`importer.js:3480–3485` waits on `ipcMain.once('executable-chosen')`), an
import that hits the multi-executable branch **hangs forever** — no timeout, no
rejection. This is a strong candidate for one of your open download-pipeline
issues.

### 2.2 `update-progress` is one name doing two jobs
- `electron/ipc/windows.js:383` — `ipcMain.handle('update-progress')` (renderer → main)
- `electron/preload.js:418` — `ipcRenderer.on('update-progress')` (main → renderer)

Nothing ever *sends* `update-progress` to the renderer; the real progress
channel is `db-update-progress` (`electron/db/updates.js`, 7 send sites). So
the listener half is dead, but it's dead in a way that reads as working.
`Importer.jsx:913` also lists `'update-progress'` in a channel cleanup array.

Rename the handler (e.g. `report-update-progress`) and drop the listener.

### 2.3 `electronIPC` bridge bypasses the channel allowlist
`electron/preload.js:677–685`

```js
contextBridge.exposeInMainWorld("electronIPC", {
  on:   (channel, func) => { ipcRenderer.on(channel, (event, ...args) => func(...args)) },
  send: (channel, data) => { ipcRenderer.send(channel, data) },
});
```

Arbitrary channel names in both directions, no allowlist — while
`removeAllListeners` right above it carefully gates against a 13-entry
`allowedChannels` set. Its only consumer is `executable-chooser.html`, which
needs exactly two channels (`init-executable-chooser`, `executable-chosen`).

Worth replacing with two named methods on the main bridge, which would also
let the chooser move onto the normal preload and delete `electronIPC` entirely.

---

## 3. Stale comment that will cause damage if trusted

`electron/preload.js:657–659`

```js
// ────────────────────────────────────────────────────────────────
//     METHODS TO REMOVE
// ────────────────────────────────────────────────────────────────
```

All **13** methods under this header are in active use:

| Method | Live caller |
|---|---|
| `getLibraryStats` | `src/hooks/useGames.js:101` |
| `countVersions` | `GameDetailsWindow.jsx:664` |
| `deleteVersion` | `GameDetailsWindow.jsx:685` |
| `deleteGameCompletely` | `GameDetailsWindow.jsx:672` |
| `deleteTitle` | `GameDetailPage.jsx:1088, 1098` |
| `deleteFolderRecursive` | `GameDetailsWindow.jsx:708` |
| `onGameDeleted` | `App.jsx:1653` |
| `getUniqueFilterOptions` | `SearchSidebar.jsx:117` |
| `getExtensionStatus` | `ExtensionSettings.jsx:17` |
| `saveExtensionSettings` | `ExtensionSettings.jsx:37` |

Delete the header, not the methods.

---

## 4. False positives — do NOT remove

Recording these because a naive grep or a JS-only scan flags them:

- **`executable-chosen` handler** (`importer.js:3483`) and
  **`init-executable-chooser` send** (`main.js:1698, 1731`) look dead to any
  scanner that only reads `.js`/`.jsx`. Their counterpart lives in
  `src/assets/ui/executable-chooser.html` (raw `electronIPC`, not React).
  Both are live. See 2.1 — they're broken, not dead.
- **Duplicate `detect-seven-zip` / `run-context-action` registrations** are
  test-local mocks in `tests/`, not real double-registration.

---

## 5. Suggested order

1. **2.1** — one-line path fix, unblocks a hanging import path. Highest value.
2. **3** — delete the misleading header before it costs someone an afternoon.
3. **1.1, 1.2** — pure deletions, zero behavioral risk.
4. **1.3** — delete after confirming the separate-window `properties` behavior is intended.
5. **2.2, 1.4** — decide sends vs. missing listeners, especially `wishlist-updated`.
6. **2.3** — the real refactor; do it last, it touches the chooser window.

Nothing above is a refactor of `App.jsx` / `importer.js` / `main.js` structure
yet — that's the next pass, once the tree is honest about what's live.
