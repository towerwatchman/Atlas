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

function findExecutables(dir, extensions) {
  const execs = [];
  const stack = [dir];

  console.log(`Scanning for executables in: ${dir}`);
  console.log(`Allowed extensions: ${extensions.join(", ")}`);

  while (stack.length) {
    const current = stack.pop();
    let foundInThisDir = false;

    let items;
    try {
      items = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      console.warn(`Cannot read directory ${current}: ${err.message}`);
      continue;
    }

    for (const item of items) {
      const fullPath = path.join(current, item.name);

      if (item.isDirectory()) {
        // Only push subdir if we haven't already found an executable in this folder
        if (!foundInThisDir) {
          stack.push(fullPath);
        }
        continue;
      }

      const ext = path.extname(item.name).toLowerCase().slice(1);
      const nameLower = item.name.toLowerCase();

      if (!extensions.includes(ext)) continue;

      // Blacklist + -32 check
      if (
        blacklist.some((b) => nameLower.includes(b.toLowerCase())) ||
        nameLower.includes("-32")
      ) {
        continue;
      }

      // Found a valid executable
      const relative = path.relative(dir, fullPath);
      execs.push(relative);
      console.log(`Found executable: ${relative}`);

      foundInThisDir = true;
      // We can break early if you only want **one** match per folder
      // break;
    }

    // Optional: if you want to stop after first match in the whole search, add:
    // if (execs.length > 0) break;
  }

  console.log(`Total executables found: ${execs.length}`);
  return execs;
}

module.exports = { findExecutables };
