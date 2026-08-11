'use strict';

// ── Three zips, one source tree ──────────────────────────────────────────────
//
// extension/ holds a single copy of every script, style and asset. The only
// per-browser artifact is the manifest, so this script stages the shared files
// into a temp folder, drops in the right manifest as manifest.json, and zips
// that. Nothing is duplicated on disk and nothing can drift between targets
// except the one file that is supposed to differ.
//
// Manifest sources:
//   chrome  -> extension/manifest.json          (canonical; also what Atlas
//                                                side-loads at runtime, which
//                                                is why it keeps that name and
//                                                that location)
//   edge    -> extension/manifests/edge.json
//   firefox -> extension/manifests/firefox.json
//
// Why chrome's lives at extension/manifest.json rather than
// extension/manifests/chrome.json: electron/ipc/extension.js copies the whole
// extension/ folder out to the user data directory and points the browser at it
// unpacked. An unpacked extension must have manifest.json at its root. Moving it
// into manifests/ would mean the packaging step becomes a prerequisite for the
// desktop app working at all, including in dev, from source, with no build run.
//
// The "_comment" key is stripped on the way out. It is legal in a manifest
// (unknown keys are ignored) but AMO's strict validator complains, and shipping
// four paragraphs of rationale to end users is not the point of it.

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { generateIcons } = require('./generate-extension-icons');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const OUT_DIR = path.join(ROOT, 'release');

const TARGETS = [
  { name: 'chrome', manifest: path.join(EXT_DIR, 'manifest.json') },
  { name: 'edge', manifest: path.join(EXT_DIR, 'manifests', 'edge.json') },
  { name: 'firefox', manifest: path.join(EXT_DIR, 'manifests', 'firefox.json') },
];

// Everything a browser needs, relative to extension/. manifests/ is excluded
// deliberately: the chosen manifest is written to the staging root instead, and
// shipping the other two would leak a Firefox id into a Chrome package.
const SHARED_ENTRIES = [
  'compat.js',
  'background.js',
  'content.js',
  'popup',
  'styles',
  'icons',
];

async function copyRecursive(from, to) {
  const stat = await fsp.stat(from);
  if (stat.isDirectory()) {
    await fsp.mkdir(to, { recursive: true });
    for (const entry of await fsp.readdir(from)) {
      await copyRecursive(path.join(from, entry), path.join(to, entry));
    }
  } else {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }
}

function zipDirectory(sourceDir, zipFile) {
  if (process.platform === 'win32') {
    // -LiteralPath so a staging path containing [ or ] is not read as a
    // wildcard, which Compress-Archive otherwise does silently.
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath '${sourceDir}' | ForEach-Object { $_.FullName }) -DestinationPath '${zipFile}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  } else {
    // -r from inside the directory so entries are relative; a zip whose paths
    // start with a temp folder name will not load as an extension.
    execFileSync('zip', ['-q', '-r', zipFile, '.'], {
      cwd: sourceDir,
      stdio: 'inherit',
    });
  }
}

async function buildTarget(target, stagingRoot) {
  const staging = path.join(stagingRoot, target.name);
  await fsp.mkdir(staging, { recursive: true });

  for (const entry of SHARED_ENTRIES) {
    const from = path.join(EXT_DIR, entry);
    if (!fs.existsSync(from)) continue;
    await copyRecursive(from, path.join(staging, entry));
  }

  const manifest = JSON.parse(await fsp.readFile(target.manifest, 'utf8'));
  delete manifest._comment;
  await fsp.writeFile(
    path.join(staging, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const zipFile = path.join(OUT_DIR, `atlas-extension-${target.name}.zip`);
  if (fs.existsSync(zipFile)) await fsp.unlink(zipFile);
  zipDirectory(staging, zipFile);
  console.log(`[package-extension] ${path.relative(ROOT, zipFile)}`);
}

async function buildExtension() {
  console.log('[package-extension] Generating icons from logo.png...');
  await generateIcons();

  await fsp.mkdir(OUT_DIR, { recursive: true });

  const stagingRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-ext-'));
  try {
    for (const target of TARGETS) {
      if (!fs.existsSync(target.manifest)) {
        throw new Error(`Missing manifest for ${target.name}: ${target.manifest}`);
      }
      await buildTarget(target, stagingRoot);
    }
  } finally {
    await fsp.rm(stagingRoot, { recursive: true, force: true });
  }

  console.log('[package-extension] All three browser packages built.');
}

if (require.main === module) {
  buildExtension().catch((err) => {
    console.error('[package-extension] Error packaging extension:', err);
    process.exit(1);
  });
}

module.exports = { buildExtension, TARGETS, SHARED_ENTRIES };
