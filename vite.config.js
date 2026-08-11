import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src',
  base: './',
  server: {
    watch: {
      // ── Directories the app WRITES TO at runtime ──────────────────────────
      //
      // In dev, resolveDataRoot() returns the install directory, which is this
      // repo -- so Atlas's runtime data folder is <repo>/electron/data. The
      // dev server otherwise treats writes there as source edits and issues a
      // full page reload.
      //
      // That was not theoretical. Opening Settings -> Extension calls
      // get-extension-path, which syncs extension/ into
      // electron/data/extension/. Vite saw four JS files change and reloaded
      // the settings window; Settings.jsx keeps its active section in
      // useState(defaultSettingsTab), so the user landed back on "Interface" a
      // beat after clicking "Extension". The reload then re-mounted the panel
      // and triggered the sync again.
      //
      // electron/ipc/extension.js now compares bytes and writes nothing when
      // the target is current, which fixes it from the other side. Both are
      // kept: this stops ANY runtime write from reloading the UI -- the
      // database, logs, downloaded images, config.ini -- not just this one.
      ignored: [
        '**/electron/data/**',
        '**/src/data/**',
        '**/release/**',
        '**/dist/**',
      ],
    },
  },
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main:        resolve(__dirname, 'src/index.html'),
        settings:    resolve(__dirname, 'src/settings.html'),
        importer:    resolve(__dirname, 'src/importer.html'),
        importerhelp: resolve(__dirname, 'src/importerhelp.html'),
        gamedetails: resolve(__dirname, 'src/gamedetails.html'),
        themebuilder: resolve(__dirname, 'src/themebuilder.html'),
        bannereditor: resolve(__dirname, 'src/bannereditor.html'),
      },
    },
  },
  css: {
    postcss: {
      plugins: [
        require('tailwindcss'),
        require('autoprefixer'),
      ],
    },
  },
})
