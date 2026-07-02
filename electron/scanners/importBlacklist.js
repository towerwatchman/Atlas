const path = require("path");

const exactNames = new Set([
  "unitycrashhandler64.exe",
  "unitycrashhandler32.exe",
  "payload.exe",
  "nwjc.exe",
  "notification_helper.exe",
  "nacl64.exe",
  "chromedriver.exe",
  "squirrel.exe",
  "zsync.exe",
  "zsyncmake.exe",
  "cmake.exe",
  "pythonw.exe",
  "python.exe",
  "dxwebsetup.exe",
  "readme.html",
  "manual.htm",
  "unins000.exe",
  "ue4prereqsetup_x64.exe",
  "ueprereqsetup_x64.exe",
  "credits.html",
  "licenses.chromium.html",
  "uninstall.exe",
  "config_dl.exe",
  "copyright.html",
  "awesomium_process.exe",
  "awesomium_pak_utility.exe",
  "rm_rpyc.bat",
  "debug_mode.bat",
  "delete_rpyc.bat",
  "debug.bat",
  "novel_sound.swf",
  "smartsteamloader_x64.exe",
]);

const namePatterns = [
  /^rencruncher.*\.bat$/i,
];

function isImportBlacklisted(filePath) {
  const filename = path.basename(String(filePath || "")).toLowerCase();
  return exactNames.has(filename) || namePatterns.some((pattern) => pattern.test(filename));
}

module.exports = { isImportBlacklisted };
