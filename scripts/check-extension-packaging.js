"use strict";

// ── The browser extension must survive packaging ─────────────────────────────
//
// Nothing asserted anything about build.files or build.asarUnpack, and the
// extension broke in exactly the gap that leaves: the files WERE in the
// installer, and still never reached a folder Chrome could load.
//
// Two independent faults, both invisible in dev:
//
//   1. `extension/**/*` was in build.files but not build.asarUnpack, so it went
//      into app.asar. Chrome cannot load an unpacked extension out of an asar,
//      which is why ensureExtensionFiles copies it out at all.
//
//   2. That copy used fs.cpSync, which cannot read across an asar boundary.
//      Electron's asar support patches the PUBLIC fs module; cpSync routes
//      almost everything through internal bindings instead. Asserted below by
//      measurement rather than by citation, because it is a property of the
//      Node version in .nvmrc and could change.
//
//      The candidate list compounded it: `candidates.find(fs.existsSync)` took
//      the first hit, the first entry was the in-asar path, and fs.existsSync
//      IS patched — so the real directories after it were never reached and the
//      only path ever tried was the one that could not work.
//
// In dev, app.getAppPath() is the project root, so candidate 1 was a real
// folder and there was no asar to cross. That is why this survived every run
// on a developer machine.
//
// Run: node scripts/check-extension-packaging.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const extensionSource = fs.readFileSync(
  path.join(ROOT, "electron", "ipc", "extension.js"),
  "utf8",
);

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

// ── Packaging ───────────────────────────────────────────────────────────────

check("the extension is shipped at all", () => {
  assert.ok(
    (pkg.build?.files || []).includes("extension/**/*"),
    "build.files must include extension/**/* or the extension is not in the installer",
  );
});

check("the extension is unpacked from the asar", () => {
  assert.ok(
    (pkg.build?.asarUnpack || []).includes("extension/**/*"),
    "build.asarUnpack must include extension/**/*. Chrome cannot load an unpacked "
    + "extension from inside app.asar, and the copy-out cannot read from one either.",
  );
});

check("every file the extension needs is present to be packaged", () => {
  // A manifest naming a script that was never committed produces an extension
  // Chrome refuses to load, with an error the user sees and the developer does
  // not.
  const dir = path.join(ROOT, "extension");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const referenced = new Set();
  for (const script of manifest.background?.service_worker ? [manifest.background.service_worker] : []) {
    referenced.add(script);
  }
  for (const entry of manifest.content_scripts || []) {
    for (const file of [...(entry.js || []), ...(entry.css || [])]) referenced.add(file);
  }
  if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
  for (const file of Object.values(manifest.icons || {})) referenced.add(file);

  for (const file of referenced) {
    assert.ok(
      fs.existsSync(path.join(dir, file)),
      `manifest.json references ${file}, which is not in extension/`,
    );
  }
});

// ── The copy-out ────────────────────────────────────────────────────────────

// Comments in extension.js explain at length why fs.cpSync is wrong here, so
// the source scans below run against code only. Stripping is crude but the file
// has no regex literals or strings containing `//`, and a scan that flagged its
// own warning label would push the explanation out of the file to satisfy the
// check — which is the wrong trade.
const codeOnly = extensionSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
  .join("\n");

check("fs.cpSync still cannot be trusted across an asar boundary", () => {
  // Measured, not assumed. If a future Node routes cpSync through the public fs
  // module, Electron's asar patch would cover it and this constraint would go
  // away — at which point this assertion fails and someone gets to delete a
  // workaround rather than inherit it forever.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-cp-"));
  fs.mkdirSync(path.join(base, "src", "sub"), { recursive: true });
  fs.writeFileSync(path.join(base, "src", "a.txt"), "a");
  fs.writeFileSync(path.join(base, "src", "sub", "b.txt"), "b");

  const seen = new Set();
  const originals = {};
  for (const name of ["readdirSync", "copyFileSync", "mkdirSync"]) {
    originals[name] = fs[name];
    fs[name] = function patched(...args) {
      seen.add(name);
      return originals[name].apply(this, args);
    };
  }
  try {
    fs.cpSync(path.join(base, "src"), path.join(base, "dst"), { recursive: true });
  } finally {
    for (const [name, fn] of Object.entries(originals)) fs[name] = fn;
    fs.rmSync(base, { recursive: true, force: true });
  }

  assert.strictEqual(
    seen.size, 0,
    `fs.cpSync now routes through public fs methods (${[...seen].join(", ")}). `
    + "If Electron's asar patch covers them, copyDirectoryRecursive in "
    + "electron/ipc/extension.js can go back to being fs.cpSync.",
  );
});

check("the copy-out does not use fs.cpSync", () => {
  assert.ok(
    !/fs\.cpSync/.test(codeOnly),
    "electron/ipc/extension.js uses fs.cpSync, which silently fails when the "
    + "source is inside app.asar. Use copyDirectoryRecursive.",
  );
});

check("the copy-out is built from fs methods Electron patches for asar", () => {
  for (const method of ["readdirSync", "copyFileSync", "mkdirSync"]) {
    assert.ok(
      new RegExp(`fs\\.${method}\\(`).test(codeOnly),
      `copyDirectoryRecursive should call fs.${method}, which is asar-aware`,
    );
  }
});

check("real directories are searched before the in-asar path", () => {
  // fs.existsSync IS patched for asar, so an in-asar candidate listed first
  // wins and every real directory after it is unreachable. Order is the whole
  // guard here; there is no other signal distinguishing the two.
  const block = codeOnly.slice(
    codeOnly.indexOf("const candidates = ["),
    codeOnly.indexOf("]", codeOnly.indexOf("const candidates = [")),
  );
  assert.ok(block, "could not find the candidates list");
  const unpacked = block.indexOf("app.asar.unpacked");
  const appPath = block.indexOf("appPath");
  assert.ok(unpacked > -1, "app.asar.unpacked must be a candidate — that is where a packaged build keeps these files");
  assert.ok(appPath > -1, "the appPath candidate should remain as a last resort");
  assert.ok(
    unpacked < appPath,
    "app.asar.unpacked must be searched BEFORE app.getAppPath(): the latter resolves "
    + "inside app.asar in a packaged build, fs.existsSync says it is there, and the "
    + "copy then fails with the real directories never tried.",
  );
});

if (!process.exitCode) console.log(`check-extension-packaging: ${passed} checks passed`);
