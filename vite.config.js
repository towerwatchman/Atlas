import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src',
  base: './',
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main:        resolve(__dirname, 'src/index.html'),
        settings:    resolve(__dirname, 'src/settings.html'),
        importer:    resolve(__dirname, 'src/importer.html'),
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
