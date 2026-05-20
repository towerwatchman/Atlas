const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { startScan } = require("../src/core/scanners/f95scanner");

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
}

function normalizeRelative(root, target) {
  return path.relative(root, target).replace(/\\/g, "/");
}

async function runScan(root) {
  let finalRows = null;
  const window = {
    webContents: {
      send(channel, payload) {
        if (channel === "scan-complete-final") {
          finalRows = payload;
        }
      },
    },
  };

  await startScan(
    {
      folder: root,
      mode: "libraryResync",
      gameExt: ["exe"],
      archiveExt: ["zip", "rar", "7z"],
      isCompressed: false,
      format: "",
      deferMatching: true,
    },
    window,
    { canceled: false },
  );

  return finalRows || [];
}

(async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-resync-check-"));

    touch(path.join(root, "Creator A", "Game A", "v1.0", "GameA.exe"));
    touch(
      path.join(
        root,
        "Creator A",
        "Game A",
        "v1.0",
        "lib",
        "windows-i686",
        "GameA.exe",
      ),
    );
    touch(
      path.join(
        root,
        "Creator A",
        "Game A",
        "v2.0",
        "lib",
        "windows-i686",
        "GameA.exe",
      ),
    );
    touch(
      path.join(
        root,
        "Creator B",
        "Game B",
        "Final",
        "renpy",
        "windows-x86_64",
        "GameB.exe",
      ),
    );

    const rows = await runScan(root);
    const simpleRows = rows.map((row) => ({
      title: row.title,
      version: row.version,
      folder: normalizeRelative(root, row.folder),
      selectedValue: row.selectedValue,
      executables: row.executables.map((exec) => exec.value),
    }));

    assert.strictEqual(simpleRows.length, 3);
    assert(!simpleRows.some((row) => row.title.toLowerCase() === "lib"));
    assert(!simpleRows.some((row) => row.folder.includes("windows-i686")));
    assert(!simpleRows.some((row) => row.folder.includes("windows-x86_64")));

    const v1 = simpleRows.find((row) => row.folder === "Creator A/Game A/v1.0");
    assert(v1);
    assert.strictEqual(v1.selectedValue, "GameA.exe");
    assert.deepStrictEqual(v1.executables, ["GameA.exe"]);

    const v2 = simpleRows.find((row) => row.folder === "Creator A/Game A/v2.0");
    assert(v2);
    assert.strictEqual(v2.selectedValue, "lib/windows-i686/GameA.exe");

    const final = simpleRows.find(
      (row) => row.folder === "Creator B/Game B/Final",
    );
    assert(final);
    assert.strictEqual(final.selectedValue, "renpy/windows-x86_64/GameB.exe");
  } finally {
    console.log = originalLog;
  }

  console.log("library resync shape checks passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
