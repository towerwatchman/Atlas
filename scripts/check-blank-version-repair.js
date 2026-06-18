const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const dbModule = require("../electron/db/index");
const { addVersion, upsertVersion, updateVersion } = require("../electron/db/versions");
const { repairBlankVersionNames } = require("../electron/db/repair");

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbModule.db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbModule.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

(async () => {
  const originalLog = console.log;
  console.log = () => {};
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-blank-version-check-"));
  try {
    dbModule.initializeDatabase(dataDir);

    await run(
      `INSERT INTO games (record_id, title, creator, engine) VALUES (?, ?, ?, ?)`,
      [1, "Blank Version Check", "Tester", "Unknown"],
    );

    await addVersion({ version: "", folder: "", executables: [] }, 1);
    await addVersion({ version: "   ", folder: "", executables: [] }, 1);
    await upsertVersion({ version: "\t", folder: "", execPath: "" }, 1);

    let rows = await all(
      `SELECT rowid, version FROM versions WHERE record_id = ? ORDER BY rowid`,
      [1],
    );
    assert.deepStrictEqual(
      rows.map((row) => row.version),
      ["Unknown", "Unknown (2)"],
    );

    await run(
      `INSERT INTO versions (record_id, version, game_path, exec_path) VALUES (?, NULL, ?, ?)`,
      [1, "", ""],
    );
    await run(
      `INSERT INTO versions (record_id, version, game_path, exec_path) VALUES (?, ?, ?, ?)`,
      [1, "   ", "", ""],
    );

    const repairedCount = await repairBlankVersionNames();
    assert.strictEqual(repairedCount, 2);
    rows = await all(
      `SELECT rowid, version FROM versions WHERE record_id = ? ORDER BY rowid`,
      [1],
    );
    assert.deepStrictEqual(
      rows.map((row) => row.version),
      ["Unknown", "Unknown (2)", "Unknown (3)", "Unknown (4)"],
    );

    await updateVersion(
      {
        version_id: rows[2].rowid,
        previousVersion: rows[2].version,
        version: "  Fixed Name  ",
        game_path: "",
        exec_path: "",
      },
      1,
    );
    const fixedRows = await all(
      `SELECT version FROM versions WHERE record_id = ? ORDER BY rowid`,
      [1],
    );
    assert.deepStrictEqual(
      fixedRows.map((row) => row.version),
      ["Unknown", "Unknown (2)", "Fixed Name", "Unknown (4)"],
    );

    await assert.rejects(
      () => updateVersion({ version_id: rows[3].rowid, version: " " }, 1),
      /Version name is required/,
    );
  } finally {
    console.log = originalLog;
  }

  console.log("blank version repair checks passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
