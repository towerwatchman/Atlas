"use strict";

// ── Every IPC handler explains itself ────────────────────────────────────────
//
// A channel name is not documentation. `ipcMain.handle('get-unique-filter-
// options')` tells you nothing about what it returns, what it costs, or who is
// allowed to call it -- and the process boundary means the caller is in another
// file, in another process, written by someone else.
//
// This is a RATCHET, not a wall. 153 of the 200 handlers that existed when the
// rule landed had no comment; failing all of them would have meant the rule got
// deleted instead of followed. So the baseline below records that debt, and the
// check fails only on handlers added or renamed after it. The count can go down
// and never up.
//
// Paying one off is just writing the comment and running:
//   node scripts/check-ipc-comments.js --update-baseline
//
// ── What counts ──────────────────────────────────────────────────────────────
//
// Any comment line directly above the registration -- //, /* */, or a JSDoc
// block. A blank line between comment and handler is fine.
//
// Write why, not what. The house style is already good at this; see the DWM
// resize-border note in main.js's showExecutableChooser, or the explanation of
// why db is read through dbModule at call time in ipc/importer.js. Aim for
// those. `// gets the games` is worse than nothing, because it looks like
// someone already did the work.
//
// Run: node scripts/check-ipc-comments.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, "ipc-comment-baseline.json");
const SCAN_ROOTS = ["electron"];
const REGISTRATION = /ipcMain\.(?:handle|handleOnce|on|once)\(\s*['"`]([^'"`]+)['"`]/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(".js")) out.push(full);
  }
  return out;
}

/** True when the nearest non-blank line above `index` is a comment. */
function hasCommentAbove(lines, index) {
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === "") continue;
    return (
      line.startsWith("//") ||
      line.startsWith("*") ||
      line.startsWith("/*") ||
      line.endsWith("*/")
    );
  }
  return false;
}

const undocumented = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const relative = path.relative(ROOT, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const match = line.match(REGISTRATION);
      if (!match) return;
      if (hasCommentAbove(lines, index)) return;
      undocumented.push({ channel: match[1], file: relative });
    });
  }
}

const key = (entry) => `${entry.file}::${entry.channel}`;
const current = new Set(undocumented.map(key));

if (process.argv.includes("--update-baseline")) {
  const sorted = [...current].sort();
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`check-ipc-comments: baseline written with ${sorted.length} entries`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(
    "check-ipc-comments: no baseline found.\n" +
    "Run: node scripts/check-ipc-comments.js --update-baseline",
  );
  process.exit(1);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")));
const added = [...current].filter((entry) => !baseline.has(entry));
const fixed = [...baseline].filter((entry) => !current.has(entry));

if (added.length > 0) {
  console.error(`check-ipc-comments: ${added.length} undocumented IPC handler(s)\n`);
  for (const entry of added.sort()) {
    const [file, channel] = entry.split("::");
    console.error(`  ${channel}`);
    console.error(`    in ${file} -- add a comment directly above the registration`);
  }
  console.error(
    "\nSay why the handler exists and anything a caller in another process\n" +
    "could not work out for itself. Not what the channel is named.",
  );
  process.exit(1);
}

if (fixed.length > 0) {
  console.log(
    `check-ipc-comments: OK -- ${fixed.length} handler(s) newly documented.\n` +
    "Lock it in: node scripts/check-ipc-comments.js --update-baseline",
  );
  process.exit(0);
}

console.log(`check-ipc-comments: OK (${baseline.size} pre-existing, none added)`);
