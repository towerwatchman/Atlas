"use strict";

// ── Renderer calls vs preload surface ────────────────────────────────────────
//
// Fails when the renderer calls a `window.electronAPI` method that preload does
// not expose.
//
// It exists because of a button that did nothing. UpdateModal called
// `window.electronAPI.openExternal?.(threadUrl)` while preload exposes
// `openExternalUrl` — one of thirteen call sites with the wrong name. The `?.`
// turned it into a silent no-op: the button rendered, the click was accepted, and
// nothing happened. No error, no console warning, nothing to search for.
//
// Optional chaining is the trap. It is the right tool for a method that may
// legitimately be absent (an older preload, a feature behind a flag) and it is
// indistinguishable from a typo. Nothing at runtime can tell those apart, so it
// has to be checked statically.
//
// eslint cannot: `window.electronAPI` is an untyped object, so any property
// access on it is valid JavaScript.
//
// Run: node scripts/check-preload-api.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PRELOAD = path.join(ROOT, "electron", "preload.js");
const SRC = path.join(ROOT, "src");

// Keys of the object handed to contextBridge.exposeInMainWorld are indented two
// spaces. Deeper indentation is a nested object's key and is not callable as
// `electronAPI.<name>`, so matching on indentation keeps this precise rather than
// over-collecting and hiding real misses.
function exposedNames() {
  const source = fs.readFileSync(PRELOAD, "utf8");
  const names = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^ {2}([A-Za-z_$][\w$]*)\s*:/);
    if (match) names.add(match[1]);
  }
  return names;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const exposed = exposedNames();
if (exposed.size === 0) {
  console.error("check-preload-api: found no exposed names in preload.js — the parse is wrong.");
  process.exit(1);
}

const offenders = [];
const used = new Set();

for (const file of walk(SRC)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    // Comments may discuss a name; only calls matter.
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const match of line.matchAll(/electronAPI\??\.\s*([A-Za-z_$][\w$]*)/g)) {
      const name = match[1];
      used.add(name);
      if (!exposed.has(name)) {
        offenders.push({
          file: path.relative(ROOT, file),
          line: index + 1,
          name,
          text: line.trim().slice(0, 88),
        });
      }
    }
  });
}

if (offenders.length > 0) {
  console.error("Renderer calls a preload method that does not exist:\n");
  for (const offender of offenders) {
    console.error(`  ${offender.file}:${offender.line}  electronAPI.${offender.name}`);
    console.error(`      ${offender.text}`);
    // The commonest cause is a near-miss, so name the likely intended key.
    const close = [...exposed].filter(
      (candidate) => candidate.toLowerCase().startsWith(offender.name.toLowerCase())
        || offender.name.toLowerCase().startsWith(candidate.toLowerCase()),
    );
    if (close.length > 0) console.error(`      did you mean: ${close.join(", ")}`);
  }
  console.error(
    "\nWith optional chaining these fail silently: the control renders, the click is\n"
    + "accepted, and nothing happens.\n",
  );
  process.exitCode = 1;
} else {
  console.log(
    `check-preload-api: ${used.size} distinct calls, all ${exposed.size} preload names reconciled.`,
  );
}
