const fs = require("fs");
const path = require("path");

const blacklist = [
  "UnityCrashHandler64.exe",
  "UnityCrashHandler32.exe",
  "payload.exe",
  "nwjc.exe",
  "notification_helper.exe",
  "nacl64.exe",
  "chromedriver.exe",
  "Squirrel.exe",
  "zsync.exe",
  "zsyncmake.exe",
  "cmake.exe",
  "pythonw.exe",
  "python.exe",
  "dxwebsetup.exe",
  "README.html",
  "manual.htm",
  "unins000.exe",
  "UE4PrereqSetup_X64.exe",
  "UEPrereqSetup_x64.exe",
  "credits.html",
  "LICENSES.chromium.html",
  "Uninstall.exe",
  "CONFIG_dl.exe",
];

// Blacklist check is case-insensitive exact match on filename
function isBlacklisted(name) {
  const lower = name.toLowerCase();
  return blacklist.some((b) => b.toLowerCase() === lower);
}

function findExecutables(dir, extensions) {
  const execs = [];
  // Each stack entry is { path, isRoot } — only descend into subdirs if no
  // executables were found directly in the current directory (same logic as old
  // scanner, but correctly applied: collect files and dirs separately per level).
  const stack = [dir];

  console.log(`Scanning for executables in: ${dir}`);
  console.log(`Allowed extensions: ${extensions.join(", ")}`);

  while (stack.length) {
    const current = stack.pop();

    let items;
    try {
      items = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      console.warn(`Cannot read directory ${current}: ${err.message}`);
      continue;
    }

    // Separate files and subdirs in one pass
    const subdirs = [];
    let foundInThisDir = false;

    for (const item of items) {
      const fullPath = path.join(current, item.name);

      if (item.isDirectory()) {
        subdirs.push(fullPath);
        continue;
      }

      if (!item.isFile()) continue;

      const ext = path.extname(item.name).toLowerCase().slice(1);
      const nameLower = item.name.toLowerCase();

      if (!extensions.includes(ext)) continue;
      if (isBlacklisted(item.name) || nameLower.includes("-32")) continue;

      // Valid executable found
      const relative = path.relative(dir, fullPath);
      execs.push(relative);
      console.log(`Found executable: ${relative}`);
      foundInThisDir = true;
    }

    // Only descend into subdirectories if this directory had no matches.
    // This matches the original fast behaviour: game root contains the exe,
    // so we don't need to recurse into runtime subdirs (www, game, lib, etc.)
    if (!foundInThisDir) {
      for (const subdir of subdirs) {
        stack.push(subdir);
      }
    }
  }

  console.log(`Total executables found: ${execs.length}`);
  return execs;
}

module.exports = { findExecutables };
