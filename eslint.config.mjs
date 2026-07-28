// .mjs, not .js: this config is ESM but package.json has no "type": "module",
// so node reparses a .js config as ESM and warns about the cost. Adding
// "type": "module" is not an option — everything under electron/ is CommonJS.
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

// Deliberately narrow. This is not a style linter — Prettier handles formatting
// (npm run format) and a full style sweep over a codebase this size would bury
// the rules that matter in thousands of cosmetic warnings.
//
// The rules below exist because each one corresponds to a bug that reached a
// release build and survived every check in `npm run check`:
//
//   no-undef                  — `toMediaSrc` and `useMemo` used without being
//                               imported. vite build resolves neither, so the
//                               bundle built cleanly and threw on first render.
//   no-use-before-define      — a `let` assigned by a function called earlier in
//                               the module: "Cannot access 'dataWriteState'
//                               before initialization" at startup.
//   react-hooks/rules-of-hooks — conditional or nested hook calls.
//
// exhaustive-deps is a warning, not an error: this codebase has many effects
// with deliberately trimmed dependency arrays, and failing the build on those
// would mean either a huge refactor or blanket disable comments.

export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'release/**',
      'scripts/**',
      '*.config.js',
      'eslint.config.mjs',
    ],
  },
  // ── Renderer ──────────────────────────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        // Exposed by electron/preload.js via contextBridge.
        electronAPI: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-undef': 'error',
      // A warning, not an error. It cannot distinguish a genuine temporal dead
      // zone from an arrow-function const referenced inside another function
      // that only runs later, and the latter accounts for 36 of 36 current
      // hits. Real TDZ is caught by executing the module — see
      // tests/main-startup-smoke.test.js.
      'no-use-before-define': ['warn', { functions: false, variables: true, classes: false }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // ── Main process ──────────────────────────────────────────────────────────
  {
    files: ['electron/**/*.js', 'workers/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-use-before-define': ['warn', { functions: false, variables: true, classes: false }],
    },
  },
  // ── Banner templates ──────────────────────────────────────────────────────
  // Evaluated with React injected into scope rather than importing it, so React
  // is a legitimate free variable here.
  {
    files: ['src/assets/templates/**/*.{js,jsx}'],
    languageOptions: {
      globals: { React: 'readonly' },
    },
  },
  // ── Known debt ────────────────────────────────────────────────────────────
  // These two files have ~18 genuine no-undef hits: module-scope functions
  // referencing names that only exist inside registerImporterHandlers(ctx) /
  // the equivalent in windows.js. Each is a latent ReferenceError that throws
  // only when that path runs — the same bug already fixed for `appConfig` in
  // importer.js, where removeEmptyParentDirectories() referenced a binding that
  // did not exist at module scope.
  //
  // Downgraded to a warning so the rule can be enforced everywhere else
  // immediately rather than waiting on the cleanup. This is tracked debt, NOT a
  // decision that the findings are false positives. Known offenders include
  // `db`, `mainWindow`, `defaultConfig`, `getVersionPathsForRecord`,
  // `deleteGameCompletely`, `recentlyDeletedGamePaths`, `copyFolderWithProgress`.
  {
    files: ['electron/ipc/importer.js', 'electron/ipc/windows.js'],
    rules: {
      'no-undef': 'warn',
    },
  },
  // ── Tests ─────────────────────────────────────────────────────────────────
  {
    files: ['tests/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.node,
        ...globals.browser,
        // vitest.config.js sets globals: true.
        test: 'readonly',
        expect: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
]
