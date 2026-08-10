// .mjs, not .js: this config is ESM but package.json has no "type": "module",
// so node reparses a .js config as ESM and warns about the cost. Adding
// "type": "module" is not an option — everything under electron/ is CommonJS.
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { includeIgnoreFile } from '@eslint/compat'

// ESLint flat config does not read .gitignore. Without this, any gitignored
// directory holding .js files under a linted path gets linted as if it were
// source, and `npm run check` fails locally on files CI never sees.
//
// That happened: electron/ipc/extension.js copies extension/ to
// <dataDir>/extension at app startup, which lands in the gitignored
// electron/data/ when running from source. No override matched that path, so
// the generated copy was linted as main-process CommonJS and every
// chrome/document/alert reference failed no-undef -- 50 errors on a branch
// whose PR had gone green, because actions/checkout never creates the dir.
//
// Reading .gitignore keeps the two lists from drifting. Same exposure exists
// for src/data/* and src/_data/, which sit under the renderer glob.
const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

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
  includeIgnoreFile(gitignorePath),
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
    ignores: ['extension/**/*.js'],
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
  // ── Browser Extension ─────────────────────────────────────────────────────
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        chrome: 'readonly',
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
  // ── no-undef is enforced everywhere ───────────────────────────────────────
  // This is where the importer.js / windows.js exemption used to be. Those two
  // files carried 13 no-undef hits, downgraded to warnings as tracked debt:
  // module-scope functions referencing names that only exist inside
  // registerXHandlers(ctx). Every one was a latent ReferenceError that threw only
  // when its path ran.
  //
  // One of them shipped. `recentlyDeletedGamePaths` at importer.js line 1013 sat
  // in isAllowedDeletionPath(), which replaceInstalledVersionAfterImport() calls
  // from module scope -- so version replace threw on every attempt it ever made,
  // while the same function called from inside a handler resolved the ctx copy
  // and worked. The rule had named it correctly from the start; downgrading it
  // buried the finding among 77 warnings where nobody would read it.
  //
  // The exemption is gone and no-undef is an error for every file. Do not add a
  // per-file downgrade back: this rule catches a class of bug that is invisible
  // to tests (the code parses, bundles, and only throws on the one path that
  // reaches it) and the cost of clearing it is a require in the right scope.
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
