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
    const items = fs.readdirSync(current, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(current, item.name);

      if (item.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      const ext = path.extname(item.name).toLowerCase().slice(1);
      const nameLower = item.name.toLowerCase();

      if (
        extensions.includes(ext) &&
        !blacklist.some((b) => nameLower.includes(b.toLowerCase()))
      ) {
        // Return relative path from dir
        const relative = fullPath.replace(dir + path.sep, "");
        execs.push(relative);
        console.log(`Found executable: ${relative}`);
      }
    }
  }

  console.log(`Total executables found: ${execs.length}`);
  return execs;
}

module.exports = { findExecutables };
