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
  //
  // Every manifest is checked, not just the Chrome one. Firefox declares its
  // background as background.scripts (an array) rather than
  // background.service_worker, so a check that only read service_worker would
  // pass a firefox.json naming a file that does not exist.
  //
  // extension/icons/ is EXCLUDED from the existence check and handled
  // separately below. Those PNGs are generated from /logo.png by
  // scripts/generate-extension-icons.js and are gitignored, so on a clean clone
  // they legitimately do not exist yet. Asserting on them would fail CI for the
  // one state the repo is supposed to be in.
  const dir = path.join(ROOT, "extension");
  const manifestPaths = [
    path.join(dir, "manifest.json"),
    path.join(dir, "manifests", "edge.json"),
    path.join(dir, "manifests", "firefox.json"),
  ];

  for (const manifestPath of manifestPaths) {
    assert.ok(
      fs.existsSync(manifestPath),
      `${path.relative(ROOT, manifestPath)} is missing; one browser has no package`,
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const referenced = new Set();

    const background = manifest.background || {};
    if (background.service_worker) referenced.add(background.service_worker);
    for (const script of background.scripts || []) referenced.add(script);

    for (const entry of manifest.content_scripts || []) {
      for (const file of [...(entry.js || []), ...(entry.css || [])]) referenced.add(file);
    }
    if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
    for (const file of Object.values(manifest.icons || {})) referenced.add(file);
    for (const file of Object.values(manifest.action?.default_icon || {})) referenced.add(file);

    for (const file of referenced) {
      if (file.startsWith("icons/")) continue; // generated, see below
      assert.ok(
        fs.existsSync(path.join(dir, file)),
        `${path.basename(manifestPath)} references ${file}, which is not in extension/`,
      );
    }
  }
});

check("every element popup.js reaches for exists in popup.html", () => {
  // The popup is plain DOM with no framework and no build step, so a renamed
  // id fails at runtime as a null dereference inside a DOMContentLoaded
  // handler -- which surfaces as a popup that opens completely blank, with the
  // error buried in a devtools window most users will never open. Cheap to
  // check statically, and it caught the statusDot -> readout rename that came
  // with the redesign.
  const dir = path.join(ROOT, "extension", "popup");
  const html = fs.readFileSync(path.join(dir, "popup.html"), "utf8");
  const js = fs.readFileSync(path.join(dir, "popup.js"), "utf8");

  const ids = [...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, "No getElementById calls found; did popup.js move?");

  for (const id of ids) {
    assert.ok(
      new RegExp(`id=["']${id}["']`).test(html),
      `popup.js looks up #${id}, which popup.html does not define`,
    );
  }
});

check("the popup does not hardcode a version string", () => {
  // popup.html shipped the literal "v1.0.0" in its footer while the manifest
  // said 1.0.7. Nobody noticed because nothing reads a footer. The version now
  // comes from runtime.getManifest(); this keeps it that way.
  const html = fs.readFileSync(
    path.join(ROOT, "extension", "popup", "popup.html"),
    "utf8",
  );
  const hardcoded = html.match(/v\d+\.\d+\.\d+/);
  assert.ok(
    !hardcoded,
    `popup.html hardcodes the version "${hardcoded && hardcoded[0]}". Read it `
    + "from runtime.getManifest().version instead; a literal drifts the moment "
    + "the manifest is bumped.",
  );
});

check("the icon generator runs before anything that needs icons", () => {
  // The icons are gitignored, so every entry point that reads or ships the
  // extension has to generate them first. `npm run dev` did not, and the result
  // was a browser refusing the whole package with "Could not load icon
  // 'icons/16.png'" -- an error naming a file that has never existed in git.
  //
  // predev/precheck are npm lifecycle hooks rather than inline prefixes
  // because npm runs them automatically: a new entry point cannot forget a
  // hook the way it can forget to repeat a command.
  const scripts = pkg.scripts || {};
  const ICON_STEP = "build:extension:icons";

  assert.ok(scripts[ICON_STEP], `package.json needs a "${ICON_STEP}" script`);

  for (const entry of ["predev", "precheck", "build", "publish"]) {
    assert.ok(
      (scripts[entry] || "").includes(ICON_STEP),
      `npm script "${entry}" must run ${ICON_STEP}. Without it the extension `
      + "is loaded or packaged with a manifest pointing at icons that were "
      + "never generated, and the browser rejects the entire manifest.",
    );
  }
});

check("the generated icons can actually be generated", () => {
  // The icons are not committed, so the thing worth asserting is that whatever
  // produces them, and the single source image it reads, are both still here. A
  // deleted logo.png would otherwise only surface at package time.
  assert.ok(
    fs.existsSync(path.join(ROOT, "logo.png")),
    "logo.png is the only committed copy of the Atlas mark and every extension "
    + "icon is derived from it. Without it the extension ships with no icons.",
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, "scripts", "generate-extension-icons.js")),
    "scripts/generate-extension-icons.js is missing, so nothing produces "
    + "extension/icons/ and the manifests all point at files that never appear.",
  );
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
    + "If Electron's asar patch covers them, syncDirectoryContents in "
    + "electron/ipc/extension.js can go back to being fs.cpSync.",
  );
});

check("the copy-out refuses to ship an extension with no icons", () => {
  // Belt to the npm hooks' braces: `electron .` run directly bypasses npm
  // entirely, so the runtime path needs its own check with the fix in the text.
  assert.ok(
    /missingIcons\.length/.test(codeOnly),
    "ensureExtensionFiles must verify extension/icons/ exists before syncing.",
  );
  assert.ok(
    /build:extension:icons/.test(extensionSource),
    "The missing-icons error must name `npm run build:extension:icons`. The "
    + "browser's own message names a generated file and gives no hint where "
    + "it is supposed to come from.",
  );
});

check("the copy-out does not use fs.cpSync", () => {
  assert.ok(
    !/fs\.cpSync/.test(codeOnly),
    "electron/ipc/extension.js uses fs.cpSync, which silently fails when the "
    + "source is inside app.asar. Use syncDirectoryContents.",
  );
});

check("the copy-out is built from fs methods Electron patches for asar", () => {
  // copyFileSync dropped from this list deliberately: the copy-out is now a
  // content-addressed sync built on readFileSync/writeFileSync, because it has
  // to compare bytes before deciding to write at all. Both are patched, so the
  // asar property this check exists to protect is unchanged.
  for (const method of ["readdirSync", "readFileSync", "writeFileSync", "mkdirSync"]) {
    assert.ok(
      new RegExp(`fs\\.${method}\\(`).test(codeOnly),
      `syncDirectoryContents should call fs.${method}, which is asar-aware`,
    );
  }
});

check("the copy-out writes nothing when the target is already current", () => {
  // This is the whole reason the sync is content-addressed. In dev the target
  // lives under <repo>/electron/data, which Vite watches; a sync that rewrites
  // unchanged files reloads the settings window and throws the user off the tab
  // they just clicked. A guard here because the regression is invisible in a
  // packaged build and only shows up as UI flicker in dev.
  assert.ok(
    /sameFileContents\(/.test(codeOnly),
    "syncDirectoryContents must compare file contents before writing. An "
    + "mtime comparison is not enough: copyFileSync does not preserve mtimes, "
    + "so the target always looks stale on the pass after a fresh checkout.",
  );
  assert.ok(
    !/getLatestMtime/.test(codeOnly),
    "The mtime-based staleness check is back. It re-copied the whole tree on "
    + "every call in dev and caused a settings-window reload loop.",
  );
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

check("the copy target is inside the data folder, not the install root", () => {
  // The whole reason this bug survived the last fix. asarUnpack put the files
  // where they belonged and the candidate order found them, and the copy then
  // failed at the DESTINATION: on win32, dataLocation.js resolveDataRoot
  // returns installDir, so `path.join(appDataRoot, 'extension')` resolved to
  // C:\Program Files\Atlas\extension.
  //
  // build/installer.nsh grants Users modify on $INSTDIR\data and
  // $INSTDIR\launchers and deliberately NOT on $INSTDIR — that folder holds
  // Atlas.exe, and Atlas runs unelevated because it launches game executables
  // that would otherwise inherit administrator. So the old target was a folder
  // the app is never permitted to write to, by a decision that is correct.
  //
  // Asserted against the nsh rather than hardcoded, so if the grant ever moves,
  // this fails rather than silently guarding the wrong directory.
  const nsh = fs.readFileSync(path.join(ROOT, "build", "installer.nsh"), "utf8");
  assert.ok(
    /icacls[^\n]*INSTDIR\\+data/.test(nsh),
    "installer.nsh no longer grants write access to $INSTDIR\\data — the "
    + "extension target below assumes it does",
  );
  assert.ok(
    !/icacls[^\n]*"\$INSTDIR"\s/.test(nsh),
    "installer.nsh now grants write access to $INSTDIR itself. That is a "
    + "privilege-escalation route (user-writable folder of executables), not a "
    + "licence to copy the extension there.",
  );

  const target = codeOnly.match(/const targetDir = path\.join\(([^)]*)\)/);
  assert.ok(target, "could not find the extension targetDir");
  assert.ok(
    /dataDir/.test(target[1]),
    `extension targetDir is built from ${target[1].trim()}. It must hang off `
    + "dataDir: on Windows appDataRoot IS the install directory, which is not "
    + "user-writable, and installer.nsh's DeleteLoop also wipes every $INSTDIR "
    + "subfolder except data and launchers on upgrade.",
  );
});

check("the extension folder survives an upgrade", () => {
  // DeleteLoop removes every subfolder of $INSTDIR except the ones named here.
  // A target outside them is deleted by the next installer run, taking with it
  // the unpacked extension Chrome is pointed at.
  const nsh = fs.readFileSync(path.join(ROOT, "build", "installer.nsh"), "utf8");
  const preserved = [...nsh.matchAll(/StrCmp \$1 "([^"]+)" \$\{PREFIX\}next/g)].map((m) => m[1]);
  assert.ok(
    preserved.includes("data"),
    `installer.nsh preserves ${preserved.join(", ")} on upgrade but not "data"`,
  );
});

check("the copy-out reports failure instead of swallowing it", () => {
  // It used to log and return the target path regardless, so the settings page
  // got a path that looked fine and a folder that was not there — and said
  // "Extension directory does not exist", which describes the symptom and names
  // neither the source tried nor the reason.
  assert.ok(
    /return\s*\{\s*extensionPath/.test(codeOnly),
    "ensureExtensionFiles should return an object carrying ok/error, not a bare path",
  );
  assert.ok(
    /ok:\s*false/.test(codeOnly) && /error,/.test(codeOnly),
    "ensureExtensionFiles should report both the failure and its reason",
  );
});

if (!process.exitCode) console.log(`check-extension-packaging: ${passed} checks passed`);
