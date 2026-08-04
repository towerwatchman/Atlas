"use strict";

// ── Dead module-level code in the IPC layer ──────────────────────────────────
//
// Fails when a module-level function in an ipc/ module has no callers.
//
// This exists because of what the importer audit turned up. Four functions --
// `moveFolderFast`, `getNormalizedArchiveRoot`, `getArchiveInfo`,
// `extractArchiveWithSevenZip` -- plus three unreachable duplicates of main.js's
// delete helpers had no callers at all, and between them they carried FIVE
// references to names that do not exist in their scope. Dead code is not inert
// here: it is where broken code hides, because nothing ever runs it and so
// nothing ever disagrees with it. `moveFolderFast` called
// `copyFolderWithProgress`, which is not defined anywhere in the codebase.
//
// It also catches the specific trap that made the duplicates invisible.
// registerXHandlers(ctx) destructures names from ctx, and those SHADOW
// module-level functions of the same name. So `deleteTitleRecord` meant two
// different functions depending on where in the file you stood: handlers got
// main.js's working copy through ctx, and the module-level copy was never
// reachable from anywhere. It read as used and was not.
//
// eslint cannot see this: an unused function is not an error, and no-unused-vars
// does not track "declared, referenced only from other unreachable code".
//
// Run: node scripts/check-ipc-dead-code.js

const fs = require("fs");
const path = require("path");

const IPC_DIR = path.join(__dirname, "..", "electron", "ipc");

// Names that are entry points rather than callees: they are wired by reference,
// so a caller does not appear as `name(`.
const ENTRY_POINT_PATTERNS = [
  /^register[A-Z]/, // registerImporterHandlers etc, assigned to module.exports
];

/** Declarations at module scope, i.e. before the register function begins. */
function moduleLevelDeclarations(lines, registerIndex) {
  const declarations = [];
  lines.slice(0, registerIndex).forEach((line, index) => {
    const match = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
      || line.match(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/)
      || line.match(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/);
    if (match) declarations.push({ name: match[1], line: index + 1 });
  });
  return declarations;
}

function countReferences(lines, name) {
  const use = new RegExp(`(^|[^.\\w$])${name}\\s*[(,)\\]]`, "g");
  const declaration = new RegExp(
    `^\\s*(?:async\\s+)?function\\s+${name}\\b|^const\\s+${name}\\s*=`,
  );
  let total = 0;
  for (const line of lines) {
    if (/^\s*(\*|\/\/)/.test(line)) continue;
    const code = line.replace(/\/\/.*$/, "");
    if (declaration.test(code)) continue;
    const found = code.match(use);
    if (found) total += found.length;
  }
  return total;
}

const findings = [];
let checked = 0;

for (const file of fs.readdirSync(IPC_DIR).filter((f) => f.endsWith(".js"))) {
  const full = path.join(IPC_DIR, file);
  const source = fs.readFileSync(full, "utf8");
  const lines = source.split(/\r?\n/);
  const registerIndex = lines.findIndex((l) => /^module\.exports\s*=\s*function\s+register/.test(l));
  if (registerIndex === -1) continue;
  checked += 1;

  // Names genuinely re-exported: `module.exports.foo = ...` and the keys of a
  // __testables object. Deliberately NOT "everything after the first
  // module.exports": that swallows the whole register function, whose ctx
  // destructuring mentions these very names, and it silently exempted the three
  // unreachable delete helpers this check was written to find.
  const exported = new Set();
  for (const match of source.matchAll(/module\.exports\.([A-Za-z_$][\w$]*)/g)) {
    exported.add(match[1]);
  }
  const testables = source.match(/__testables\s*=\s*\{([\s\S]*?)\n\};/);
  if (testables) {
    for (const line of testables[1].split(/\r?\n/)) {
      const name = line.trim().replace(/[,:].*$/, "");
      if (/^[A-Za-z_$][\w$]*$/.test(name)) exported.add(name);
    }
  }

  for (const declaration of moduleLevelDeclarations(lines, registerIndex)) {
    if (ENTRY_POINT_PATTERNS.some((pattern) => pattern.test(declaration.name))) continue;
    // Exposed for tests or other modules, so a caller may be out of this file.
    if (exported.has(declaration.name)) continue;

    const references = countReferences(lines, declaration.name);
    if (references === 0) {
      findings.push({ file, ...declaration, reason: "never referenced" });
      continue;
    }
  }
}

if (findings.length > 0) {
  console.error("Unreachable module-level code in the IPC layer:\n");
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.name}`);
    console.error(`      ${finding.reason}`);
  }
  console.error(
    "\nDead code in these modules is where broken code hides: nothing runs it, so\n"
    + "nothing disagrees with it. Remove it, or wire it up.\n",
  );
  process.exitCode = 1;
} else {
  console.log(`check-ipc-dead-code: ${checked} ipc modules, no unreachable module-level code.`);
}
