"use strict";

// ── Worker threads must be able to load what they require ────────────────────
//
// Sibling to check-extension-packaging.js, and the same bug class it was written
// for. That one caught files that were in build.files but not build.asarUnpack;
// this one catches a file that IS unpacked correctly but reaches out to one that
// is not.
//
// The failure it exists to prevent, in full:
//
//   workers/megaHashcashWorker.js contained
//     require("../electron/downloads/hosts/megaHashcash")
//
//   `workers/**/*` is in build.asarUnpack, so the worker itself lands on disk at
//   app.asar.unpacked/workers/. `electron/**/*` is NOT, so it exists only inside
//   app.asar. From the unpacked worker that require resolves to
//   app.asar.unpacked/electron/downloads/hosts/megaHashcash.js -- a directory
//   electron-builder never creates.
//
// Three things made it survive review and ship:
//
//   1. In dev there is no asar. Both files are ordinary paths on disk and the
//      require resolves, so it worked on every developer machine.
//   2. `new Worker()` does NOT throw on an unresolvable module. The error arrives
//      asynchronously on the 'error' event, so the try/catch wrapped around
//      construction never fired.
//   3. The pool treated a failed worker and an exhausted budget as the same
//      result, so users were told the proof of work "did not finish in time" for
//      a worker that never ran a hash.
//
// None of that is visible to eslint: the require is a valid string literal
// naming a file that genuinely exists in the source tree.
//
// ── The rule ─────────────────────────────────────────────────────────────────
//
// Every static require in workers/ must resolve to either a Node built-in, a
// package under node_modules, or a file that build.asarUnpack also unpacks.
// In practice that means workers may only require siblings inside workers/.
//
// Run: node scripts/check-worker-packaging.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WORKERS_DIR = path.join(ROOT, "workers");

const REQUIRE = /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

function readAsarUnpackGlobs() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const globs = pkg?.build?.asarUnpack;
  if (!Array.isArray(globs)) {
    throw new Error("package.json build.asarUnpack is missing or not an array");
  }
  return globs;
}

/**
 * Does any asarUnpack glob cover this repo-relative path?
 *
 * Deliberately simple: the globs in use are of the form `dir/**\/*`, so the test
 * is whether the path sits under a directory one of them names. A stricter glob
 * engine would be a dependency for no gain, and a false PASS is impossible here
 * -- the check only ever widens to a whole directory.
 */
function isUnpacked(relPath, globs) {
  const normalized = relPath.split(path.sep).join("/");
  return globs.some((glob) => {
    const base = glob.replace(/\/?\*\*.*$/, "").replace(/\/?\*.*$/, "");
    if (!base) return false;
    return normalized === base || normalized.startsWith(`${base}/`);
  });
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function main() {
  const globs = readAsarUnpackGlobs();
  const failures = [];
  let scanned = 0;
  let checked = 0;

  const files = fs.readdirSync(WORKERS_DIR)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(WORKERS_DIR, name));

  if (files.length === 0) failures.push("no worker files found - has workers/ moved?");

  for (const file of files) {
    scanned += 1;
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);

    if (!isUnpacked(path.relative(ROOT, file), globs)) {
      failures.push(`${rel} is not covered by build.asarUnpack, so it cannot be spawned as a worker`);
    }

    for (const match of source.matchAll(REQUIRE)) {
      const spec = match[1];
      // Built-ins and packages are fine: node_modules dependencies that need
      // unpacking (node-unrar-js) are already listed in asarUnpack themselves.
      if (!spec.startsWith(".")) continue;
      checked += 1;

      const target = resolveRelative(file, spec);
      if (!target) {
        failures.push(`${rel} requires "${spec}", which does not resolve to a file`);
        continue;
      }
      const targetRel = path.relative(ROOT, target);
      if (!isUnpacked(targetRel, globs)) {
        failures.push(
          `${rel} requires "${spec}" -> ${targetRel.split(path.sep).join("/")}, `
          + "which is packed into app.asar. A worker thread cannot load it: in a "
          + "packaged build the require resolves under app.asar.unpacked/ where "
          + "that file does not exist. Move it into workers/, or add it to "
          + "build.asarUnpack.",
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error("check-worker-packaging: FAILED");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`check-worker-packaging: ok (${scanned} workers, ${checked} relative requires)`);
}

main();
