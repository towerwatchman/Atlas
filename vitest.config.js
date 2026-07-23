import { defineConfig } from 'vitest/config'

// Regression test suite for Atlas. Tests live under tests/ and exercise the
// REAL functions from electron/ (CommonJS) and src/ (ESM). No jsdom by default
// — these are logic/behaviour contracts, not DOM tests; a page smoke-test env
// can be added per-file later if needed.
export default defineConfig({
  test: {
    // Only pick up our dedicated suite, not the legacy scripts/check-*.js files
    // (those still run directly via `npm run check`).
    include: ['tests/**/*.test.{js,jsx}'],
    environment: 'node',
    globals: true,
    // Keep output readable in CI.
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: [
        'electron/scanners/**',
        'electron/db/**',
        'src/components/detail/page/gameDetailUtils.js',
      ],
      reporter: ['text-summary', 'html'],
    },
  },
})
