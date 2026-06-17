# Atlas — Theming Work, Checkpoint 4 (nav position actually switches)

**This zip contains ONLY the files that changed**, with matching folder
structure — drop these into your existing project, overwriting the files
at the same paths.

This is the highest-risk change so far in this whole effort — it touches
the main window's actual layout structure, not just colors or settings
plumbing. Please test carefully.

## What to test

1. Drop these files into your project (overwrite existing paths), then
   `npm run dev`.
2. App should launch looking **exactly like before** (Sidebar layout is
   the default, nothing should look different yet).
3. Go to **Settings → Appearance** and click **Top Bar**.
4. The main window should immediately change: the left sidebar
   disappears, and its icons (Add, List/Browse toggle, Updates, Settings —
   **not** Home, since "Games"/"Browse" already does that) now appear in
   the top header bar, to the right of the "Games"/"Browse" label.
5. The search bar (the long text box) should be replaced by a small
   search **icon button** on the far right of the header, next to the
   window minimize/maximize/close buttons. Clicking it should open the
   same filter sidebar the old search bar's funnel icon used to open.
6. **Click through every icon in the new top bar**:
   - **Add** → should open the importer window, same as before.
   - **List/Grid toggle** → should toggle between list view and grid view
     in the game library, same as before. The icon itself should still
     flip between the two styles depending on state.
   - **Browse** → should switch to Browse/catalog mode, same as before.
   - **Updates** → should trigger the DB update check, same as before.
   - **Settings** → should open the Settings window, same as before.
7. With the game list panel and/or the library sidebar toggled open in Top
   Bar mode, check that everything still lines up against the **left
   edge** of the window (no empty gap on the left where the old sidebar
   used to be).
8. Switch back to **Sidebar** in Appearance — everything should return to
   exactly how it looked before, left rail and all.
9. Try resizing the window in both layouts, and try both with a game
   selected (detail view) and not, just to make sure nothing overlaps or
   clips oddly.

## What I'd specifically like you to judge

I followed the reference XLibrary screenshot's approach (nav icons
integrated into the single top header bar, not a second bar underneath),
per your direction. I can't see what this actually looks like rendered —
spacing, icon sizing, whether it visually reads as "intentional" rather
than "cobbled together" is exactly the kind of judgment call that needs
your eyes. If anything looks cramped, misaligned, or just not right,
let me know what's off and I'll adjust.

## What changed in this checkpoint

- **New `src/components/ui/navItems.js`** — the nav icon definitions
  (Home, Add, List, Browse, Updates, Settings: their SVG paths and click
  behavior) extracted into one shared file. Both the sidebar and the new
  top bar use this same data, so they can't drift out of sync with each
  other over time.
- **`Sidebar.jsx`** — rewritten using that shared data (no visual or
  behavioral change, just cleaner code — it was using an older
  React.createElement style instead of normal JSX).
- **New `TopNav.jsx`** — the same nav icons laid out horizontally, with
  "Home" left out (Games/Browse label covers that). Meant to sit inside
  the existing header, not as a separate bar.
- **New `SearchButton.jsx`** — the icon-only search button used in Top Bar
  mode.
- **`App.jsx`** — now actually checks the saved layout setting and
  switches between the two structures described above.

## Verification already done on my end

- Real `vite build` succeeds (181 modules, up from 178 — the 3 new files).
- Render-tested the **actual JSX** (not a reimplementation) from App.jsx
  against both layout values and all combinations of the library-sidebar
  toggle: confirmed Sidebar-mode renders identically to before in every
  case (a regression check), and Top-Bar mode correctly omits the Home
  icon, omits the old search bar, includes the new search button, and
  drops every leftover left-margin that assumed a sidebar was there.

What I can't verify from here: how this actually looks, and whether the
electronAPI calls these icons trigger (open settings, open importer,
toggle list view, etc.) work correctly in a real running app, since I
have no way to run real Electron/sqlite3 in this environment.
