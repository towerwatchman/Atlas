const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const roots = ["electron", "workers", "scripts"];

function collectJsFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = roots.flatMap((root) => collectJsFiles(path.join(process.cwd(), root)));

for (const file of files) {
  cp.execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

console.log("main-process JavaScript syntax checks passed");
