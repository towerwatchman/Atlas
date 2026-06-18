'use strict'

const { ipcMain, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

// The one non-Default theme Atlas ships with, seeded into the user's
// templates/theme/ folder on first run (only if that folder is empty) so
// there's a working second theme to look at and edit immediately. This is
// the SAME content as the old built-in XLIBRARY_THEME object that used to
// live in src/theme/themes.js — moved here as a plain inline object (rather
// than a bundled file under src/assets/) specifically so it ships correctly
// in a packaged build without needing an electron-builder "files" entry:
// electron/**/* is already packaged, src/assets/templates/** is not.
//
// Once written to disk, this object has no further special status — it's
// just the starting contents of xlibrary.json. A person can edit, rename,
// or delete that file like any other theme they add themselves.
const SEED_THEMES = [
  {
    filename: 'xlibrary.json',
    theme: {
      id: 'xlibrary',
      name: 'XLibrary',
      radius: 'lg',
      font: '"Inter", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
      // Requested defaults for this theme: nav buttons glow (accent-colored,
      // matching the reference screenshot), nav sits at the top (topnav
      // layout) with icon+text labels, and the header's accent-bar notch
      // strip is turned off. filterSidebar keeps the overall default
      // (right/overlay) — listed explicitly so this seed theme stays a
      // complete, self-documenting reference for anyone authoring their
      // own theme file. Selecting this theme in Appearance adopts all of
      // this nav block — see ThemeProvider.jsx's setTheme.
      nav: {
        layout: 'topnav',
        displayMode: 'iconsAndText',
        accentBarEnabled: false,
        glow: {
          enabled: true,
          color: '#E21D48',
          offsetX: 0,
          offsetY: 0,
          intensity: 14,
        },
        filterSidebar: {
          side: 'right',
          mode: 'overlay',
        },
      },
      colors: {
        canvas: '#0B0A0F',
        shadow: '#000000',
        primary: '#100F15',
        secondary: '#17151D',
        // Subtle vertical gradient — darkest in the middle, slightly
        // lighter toward top and bottom — matching the reference
        // screenshot's main background (sampled directly from the
        // image: roughly #14121A/#1E1B26 at the edges down to
        // #0A0A10 in the middle). This is the one surface the
        // reference actually uses a gradient on; everything else
        // (buttons, the active tab, etc.) is flat color there too,
        // so this theme keeps those flat as well.
        tertiary: { type: 'linear', angle: 180, stops: ['#1E1B26', '#0A0A10', '#1E1B26'] },
        border: '#322E3B',
        selected: '#2A2733',
        accent: '#E21D48',
        accentBar: '#E21D48',
        atlasLogo: '#FFFFFF',
        text: '#E5E2E8',
        highlight: '#E21D48',
        overlayTop: '#000000',
        overlayBottom: '#000000',
        muted: '#9590A0',
        danger: '#DC2626',
        dangerHover: '#B91C1C',
        dangerStrong: '#7F1D1D',
        success: '#16A34A',
        successHover: '#15803D',
        warning: '#FACC15',
        info: '#38BDF8',
        buttonHover: '#2A2733',
        accentHover: '#B9173B',
      },
    },
  },
]

// Structural validation only — NOT the full field-by-field schema check.
// That's normalizeTheme() on the renderer side (src/theme/themes.js),
// which is the authoritative source for the theme shape (THEME_COLOR_KEYS,
// RADIUS_OPTIONS, etc.) and already has tests covering it. Duplicating that
// full list here in CommonJS would just create a second copy to keep in
// sync. This check exists only to stop genuinely broken files (not valid
// JSON, not an object, no colors at all) from reaching the renderer.
function isPlausibleTheme(parsed) {
  return (
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.colors === 'object' &&
    parsed.colors !== null
  )
}

// "my theme.json" -> "my-theme", "Xlibrary.JSON" -> "xlibrary". Lowercased
// and slugified so ids are stable, URL/CSS-attribute-safe (used in
// data-theme="...", see applyTheme.js), and so two filenames that only
// differ by case or spacing can't silently collide.
function idFromFilename(filename) {
  return path
    .basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'theme'
}

module.exports = function registerThemeHandlers(ctx) {
  const { themeTemplatesDir, createThemeBuilderWindow } = ctx

  // Seed the example theme(s) on first run only — i.e. only if the folder
  // is completely empty. If a person deletes xlibrary.json on purpose,
  // Atlas will NOT recreate it on next launch; "empty folder" is only
  // assumed to mean "never set up," not "user doesn't want any themes."
  function seedThemesIfEmpty() {
    try {
      if (!fs.existsSync(themeTemplatesDir)) {
        fs.mkdirSync(themeTemplatesDir, { recursive: true })
      }
      const existing = fs.readdirSync(themeTemplatesDir)
      if (existing.length > 0) return
      for (const seed of SEED_THEMES) {
        const filePath = path.join(themeTemplatesDir, seed.filename)
        fs.writeFileSync(filePath, JSON.stringify(seed.theme, null, 2) + '\n', 'utf8')
      }
    } catch (err) {
      console.error('Failed to seed example theme files:', err)
    }
  }

  seedThemesIfEmpty()

  ipcMain.handle('get-available-themes', async () => {
    try {
      if (!fs.existsSync(themeTemplatesDir)) return []
      const files = fs.readdirSync(themeTemplatesDir).filter((f) => f.endsWith('.json'))

      const themes = []
      for (const filename of files) {
        const filePath = path.join(themeTemplatesDir, filename)
        try {
          const raw = fs.readFileSync(filePath, 'utf8')
          const parsed = JSON.parse(raw)
          if (!isPlausibleTheme(parsed)) {
            console.warn(`Skipping ${filename}: not a valid theme file (missing "colors" object)`)
            continue
          }
          // id is always derived from the filename, even if the file itself
          // specifies a different id — this guarantees uniqueness (the
          // filesystem already enforces no two files share a name) and
          // means renaming a file is how a person "renames" a theme's slot,
          // without needing to also edit the file's contents to match.
          themes.push({ ...parsed, id: idFromFilename(filename) })
        } catch (err) {
          console.warn(`Skipping ${filename}: failed to parse (${err.message})`)
        }
      }
      return themes
    } catch (err) {
      console.error('get-available-themes error:', err)
      return []
    }
  })

  // Used by the Theme Builder (src/components/settings/ThemeBuilder.jsx)
  // "Save as New Theme" step. Writes a new file into templates/theme/ —
  // the SAME directory get-available-themes reads from above, and the
  // SAME mechanism XLibrary's seed file already uses — so a saved theme
  // immediately shows up in the regular Appearance theme picker on next
  // load, no separate storage path needed.
  //
  // name is slugified into a filename the same way idFromFilename()
  // derives an id from one, so the resulting id is predictable from the
  // name the person typed. If that slug collides with an existing file,
  // overwrite is required to proceed — this is a deliberate "are you
  // sure" gate rather than silently appending "-2" to the filename, since
  // a person picking an existing theme's exact name most likely means to
  // replace it.
  ipcMain.handle('save-theme', async (event, theme, { overwrite = false } = {}) => {
    try {
      if (!theme || typeof theme !== 'object' || !theme.name || typeof theme.name !== 'string') {
        return { success: false, error: 'Theme must have a name.' }
      }
      if (!isPlausibleTheme(theme)) {
        return { success: false, error: 'Theme is missing a colors object.' }
      }
      if (!fs.existsSync(themeTemplatesDir)) {
        fs.mkdirSync(themeTemplatesDir, { recursive: true })
      }
      const slug = idFromFilename(theme.name)
      const filename = `${slug}.json`
      const filePath = path.join(themeTemplatesDir, filename)
      if (fs.existsSync(filePath) && !overwrite) {
        return { success: false, error: 'A theme with this name already exists.', exists: true }
      }
      // Strip id before writing — id is always derived from the filename
      // on read (see idFromFilename() above), so persisting a stale id
      // field here would just be dead weight that get-available-themes
      // ignores anyway.
      const { id, ...themeToWrite } = theme
      fs.writeFileSync(filePath, JSON.stringify(themeToWrite, null, 2) + '\n', 'utf8')
      return { success: true, theme: { ...themeToWrite, id: slug } }
    } catch (err) {
      console.error('save-theme error:', err)
      return { success: false, error: err.message }
    }
  })

  // Opens the Theme Builder as its own BrowserWindow (see
  // createThemeBuilderWindow in main.js) — called from the "Open Theme
  // Builder" button on Appearance.jsx, same pattern as open-settings/
  // open-importer elsewhere in this app.
  ipcMain.handle('open-theme-builder', () => {
    createThemeBuilderWindow()
  })

  // Relays a live draft theme from the Theme Builder window to every
  // OTHER open window, so the in-progress edit is visible app-wide (main
  // library, Settings, etc.) as the person adjusts colors/effects/nav
  // settings — not just within the builder window itself. Sent on every
  // draft change (see ThemeBuilder.jsx's live-preview effect), so this is
  // a high-frequency channel during an active drag/slider interaction;
  // kept deliberately simple (no diffing/throttling here) since a full
  // theme object is small and applyTheme() on the receiving end is cheap.
  // event.sender is excluded so the builder window doesn't needlessly
  // re-receive and re-apply its own change.
  ipcMain.handle('broadcast-theme-preview', (event, draftTheme) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && win.webContents.id !== event.sender.id) {
        win.webContents.send('theme-preview-changed', draftTheme)
      }
    })
  })
}
