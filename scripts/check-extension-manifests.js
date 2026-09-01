'use strict';

// ── The three manifests must differ only where they are supposed to ──────────
//
// One shared source tree, three manifests. That layout only pays off if the
// manifests cannot quietly drift: the failure mode it replaced was three copies
// of everything, and the failure mode it introduces is a permission added to
// Chrome and forgotten on Firefox, which produces an extension that installs
// fine and then does nothing on one browser for reasons no error message
// mentions.
//
// So: every field is asserted identical across all three, except the ones
// listed in ALLOWED_DIFFERENCES, each of which is then checked positively for
// the shape it is supposed to have.
//
// Run: node scripts/check-extension-manifests.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');

const MANIFESTS = {
  chrome: path.join(EXT, 'manifest.json'),
  edge: path.join(EXT, 'manifests', 'edge.json'),
  firefox: path.join(EXT, 'manifests', 'firefox.json'),
};

// Fields a target is permitted to differ on, with the reason, so a future
// addition here has to be argued for rather than just appended.
const ALLOWED_DIFFERENCES = new Set([
  '_comment', // rationale block, stripped at package time
  'key', // Chromium-only ID derivation; absent on Firefox
  'browser_specific_settings', // Gecko-only
  'background', // service_worker vs scripts
]);

let passed = 0;
const check = (label, fn) => {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${label}\n  ${err.message}`);
    process.exitCode = 1;
  }
};

const loaded = {};
for (const [name, file] of Object.entries(MANIFESTS)) {
  loaded[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

check('every manifest declares the same key set', () => {
  const keysOf = (m) =>
    Object.keys(m)
      .filter((k) => !ALLOWED_DIFFERENCES.has(k))
      .sort();
  const base = keysOf(loaded.chrome);
  for (const name of ['edge', 'firefox']) {
    assert.deepStrictEqual(
      keysOf(loaded[name]),
      base,
      `${name}.json has a different set of top-level fields than manifest.json`,
    );
  }
});

check('shared fields are byte-identical across targets', () => {
  for (const field of Object.keys(loaded.chrome)) {
    if (ALLOWED_DIFFERENCES.has(field)) continue;
    for (const name of ['edge', 'firefox']) {
      assert.deepStrictEqual(
        loaded[name][field],
        loaded.chrome[field],
        `"${field}" differs between manifest.json and ${name}.json. If that is `
          + 'deliberate, add it to ALLOWED_DIFFERENCES with a reason; if not, the '
          + 'two packages behave differently for no stated cause.',
      );
    }
  }
});

check('compat.js is loaded before content.js everywhere', () => {
  // content.js reads globalThis.atlasBrowser at module scope. Reversed order is
  // not a subtle bug -- the content script throws immediately and no badges
  // ever render.
  for (const [name, manifest] of Object.entries(loaded)) {
    for (const entry of manifest.content_scripts || []) {
      const js = entry.js || [];
      assert.ok(
        js.indexOf('compat.js') === 0,
        `${name}: compat.js must be the first entry in content_scripts.js`,
      );
      assert.ok(
        js.indexOf('content.js') > 0,
        `${name}: content.js must come after compat.js`,
      );
    }
  }
});

check('Chromium targets keep the pinned key', () => {
  // Without it, an unpacked install gets a path-derived ID, the CORS allowlist
  // in electron/rpc/extensionServer.js cannot match, and every RPC call fails
  // in a way that looks like Atlas being offline.
  for (const name of ['chrome', 'edge']) {
    assert.ok(
      typeof loaded[name].key === 'string' && loaded[name].key.length > 100,
      `${name}.json must keep the "key" field or its extension ID becomes `
        + 'per-machine and unpinnable.',
    );
  }
  assert.strictEqual(
    loaded.chrome.key,
    loaded.edge.key,
    'Chrome and Edge must share the key so they share one extension origin.',
  );
});

check('Firefox drops the key and declares a gecko id instead', () => {
  assert.ok(
    !('key' in loaded.firefox),
    'firefox.json must not carry "key"; Gecko ignores it and AMO flags it.',
  );
  const gecko = loaded.firefox.browser_specific_settings?.gecko;
  assert.ok(gecko?.id, 'firefox.json needs browser_specific_settings.gecko.id');
  assert.ok(
    gecko.strict_min_version,
    'firefox.json needs a strict_min_version; MV3 event pages are not universal.',
  );
});

check('background entry points match each engine', () => {
  assert.ok(
    loaded.chrome.background?.service_worker === 'background.js',
    'Chromium MV3 backgrounds are service workers.',
  );
  assert.ok(
    loaded.edge.background?.service_worker === 'background.js',
    'Edge is Chromium; same background shape as Chrome.',
  );
  const ffScripts = loaded.firefox.background?.scripts || [];
  assert.deepStrictEqual(
    ffScripts,
    ['compat.js', 'background.js'],
    'Gecko MV3 backgrounds are event pages using background.scripts, and '
      + 'compat.js must be first because importScripts does not exist there.',
  );
});

check('every target ships the same version string', () => {
  const versions = new Set(Object.values(loaded).map((m) => m.version));
  assert.strictEqual(
    versions.size,
    1,
    `Version drift across manifests: ${[...versions].join(', ')}`,
  );
});

if (!process.exitCode) {
  console.log(`[check-extension-manifests] All ${passed} checks passed clean.`);
}
