"use strict";

// ── Dead and broken IPC *channels* ───────────────────────────────────────────
//
// Sibling to check-ipc-dead-code.js. That script finds module-level functions
// with no callers; this one finds channel NAMES that don't line up across the
// process boundary. Different failure mode, and the reason a batch of them
// survived until the August audit:
//
//   - `send-game-data`  preload listened, nothing ever sent. Superseded by the
//                       pull-based request-game-data invoke.
//   - `import-warning`  preload listened, no sender anywhere in the tree.
//   - `context-menu-command`
//                       preload listened and App.jsx registered a handler, but
//                       the sender had been replaced by handleContextAction
//                       opening a window directly. The handler read as live.
//   - `update-progress` used as BOTH an ipcMain.handle name and a renderer
//                       listen target. The listen half was dead; the real
//                       channel is db-update-progress. Reads as working.
//
// eslint cannot see any of this: every one of those is a syntactically valid
// string literal. Nothing disagrees with a channel name that nobody answers.
//
// ── How matching works ───────────────────────────────────────────────────────
//
// Sends are frequently indirect -- broadcast(), emit(), and
// BrowserWindow.getAllWindows().forEach(win => win.webContents.send(ch)) all
// appear in this codebase, and a regex that tries to model those produces more
// false positives than findings (an early draft matched `.push("...")`).
//
// So the test is deliberately blunt: does the QUOTED channel name appear
// anywhere in the relevant directory at all? Quoting is what keeps it precise
// -- "log" as a channel is searched as `"log"`, not as the substring log.
// A channel that is genuinely wired will always have its name written down on
// both sides somewhere, however indirect the plumbing between them.
//
// IMPORTANT: .html is scanned too. src/assets/ui/executable-chooser.html talks
// over raw electronIPC rather than React, and a .js/.jsx-only scan reports its
// two live channels as dead. That mistake was made once already.
//
// Run: node scripts/check-ipc-channels.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCAN_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".html"];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "release",
  "build",
  ".git",
]);

// Channels that are intentionally one-sided. Keep this list short and always
// say why -- an entry here is a permanent exemption from the check.
const ALLOWED = new Map([
  // Example shape, remove once a real exemption exists:
  // ["some-channel", "why this is legitimately one-sided"],
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const files = walk(ROOT).map((file) => ({
  path: path.relative(ROOT, file).replace(/\\/g, "/"),
  source: fs.readFileSync(file, "utf8"),
}));

const inDirectory = (file, prefix) => file.path.startsWith(prefix);
const isTest = (file) => inDirectory(file, "tests/") || inDirectory(file, "scripts/");
const isPreload = (file) => file.path === "electron/preload.js";

/** Every quoted form a channel name can take, so "log" never matches `log(`. */
function mentions(source, channel) {
  return (
    source.includes(`"${channel}"`) ||
    source.includes(`'${channel}'`) ||
    source.includes(`\`${channel}\``)
  );
}

/** Collect channel registrations of a given kind, with file + line. */
function collect(pattern) {
  const found = new Map();
  for (const file of files) {
    if (isTest(file)) continue;
    for (const match of file.source.matchAll(pattern)) {
      const channel = match[match.length - 1];
      const line = file.source.slice(0, match.index).split("\n").length;
      if (!found.has(channel)) found.set(channel, []);
      found.get(channel).push({ file: file.path, line });
    }
  }
  return found;
}

const handlers = collect(/ipcMain\.(?:handle|handleOnce|on|once)\(\s*['"`]([^'"`]+)['"`]/g);
const invokes = collect(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*['"`]([^'"`]+)['"`]/g);
const listeners = collect(/ipcRenderer\.(?:on|once)\(\s*['"`]([^'"`]+)['"`]/g);

const findings = [];
const report = (channel, sites, message) => {
  if (ALLOWED.has(channel)) return;
  findings.push({ channel, sites, message });
};

// ── 1. A renderer call with no handler. Always a bug: the invoke rejects. ────
for (const [channel, sites] of invokes) {
  if (handlers.has(channel)) continue;
  // Raw electronIPC.send from a plain .html page is a valid caller too.
  const answered = files.some(
    (file) =>
      !isTest(file) &&
      inDirectory(file, "electron/") &&
      !isPreload(file) &&
      mentions(file.source, channel),
  );
  if (!answered) {
    report(channel, sites, "invoked from the renderer, but no ipcMain handler answers it");
  }
}

// ── 2. A handler nothing calls. ─────────────────────────────────────────────
for (const [channel, sites] of handlers) {
  const called = files.some(
    (file) =>
      !isTest(file) &&
      (isPreload(file) ||
        inDirectory(file, "src/") ||
        inDirectory(file, "extension/")) &&
      mentions(file.source, channel),
  );
  if (!called) {
    report(channel, sites, "registered as a handler, but nothing in preload, src, or extension calls it");
  }
}

// ── 3. A listener nothing sends to. ─────────────────────────────────────────
for (const [channel, sites] of listeners) {
  const sent = files.some(
    (file) =>
      !isTest(file) &&
      inDirectory(file, "electron/") &&
      !isPreload(file) &&
      mentions(file.source, channel),
  );
  if (!sent) {
    report(channel, sites, "listened for, but nothing in the main process ever sends it");
  }
}

// ── 4. One name doing two jobs. This is how update-progress hid. ────────────
for (const [channel, sites] of handlers) {
  if (!listeners.has(channel)) continue;
  report(
    channel,
    [...sites, ...listeners.get(channel)],
    "used as BOTH an ipcMain.handle name and a renderer listen target -- give the two directions different names",
  );
}

if (findings.length === 0) {
  const total = handlers.size + listeners.size;
  console.log(`check-ipc-channels: OK (${total} channels traced, no dead ends)`);
  process.exit(0);
}

console.error(`check-ipc-channels: ${findings.length} problem(s)\n`);
for (const { channel, sites, message } of findings) {
  console.error(`  ${channel}`);
  console.error(`    ${message}`);
  for (const site of sites) console.error(`    at ${site.file}:${site.line}`);
  console.error("");
}
console.error(
  "Either wire the missing side up, or delete the dead one. If a channel is\n" +
  "legitimately one-sided, add it to ALLOWED in this script with a reason.",
);
process.exit(1);
