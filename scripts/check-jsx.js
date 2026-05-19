const fs = require("fs");
const path = require("path");
const Babel = require("@babel/standalone");

const files = [
  "src/App.jsx",
  "src/core/banner/GameDetailsWindow.jsx",
  "src/core/importer/importer.jsx",
  "src/core/SearchBox.jsx",
  "src/core/SearchSidebar.jsx",
  "src/core/settings/Appearance.jsx",
  "src/core/settings/EmulatorLauncher.jsx",
  "src/core/settings/Interface.jsx",
  "src/core/settings/Library.jsx",
  "src/core/settings/Metadata.jsx",
  "src/core/settings/Platforms.jsx",
  "src/core/settings/Settings.jsx",
];

for (const file of files) {
  const sourcePath = path.join(process.cwd(), file);
  Babel.transform(fs.readFileSync(sourcePath, "utf8"), {
    presets: ["react"],
    filename: file,
  });
  console.log(`${file} parsed`);
}
