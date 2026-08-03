"use strict";

// Assertions for electron/library/catalogIdentity.js.
//
// The property under test is that the SQL form and the JS form produce
// BYTE-IDENTICAL strings, so this does not compare two literals -- it runs the
// generated SQL through sqlite and compares the result to the JS function's
// output.
//
// Why that matters: db/catalogIndex.js builds the searchable browse index in JS
// and db/versions.js renders the tile in SQL. The index is what gets searched;
// the query is what gets shown. If the two names drift, a row becomes
// unfindable by the exact name printed on its own tile, and nothing fails --
// which is the same silent shape as `is_installed` vs `isInstalled` and the
// duplicated importer source list.
//
// It also asserts that every call site actually goes through the module, because
// the failure this guards against is someone adding a fifth literal.
//
// Run: node scripts/check-catalog-identity.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");

const {
  FALLBACK_CREATOR,
  FALLBACK_TITLE,
  SYNTHETIC_IDENTITY_PROVIDERS,
  syntheticTitle,
  syntheticTitleSql,
  fallbackCreatorSql,
} = require("../electron/library/catalogIdentity");

let passed = 0;
const check = (label, fn) => {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${label}\n  ${err.message}`);
    process.exitCode = 1;
  }
};
const checkAsync = async (label, fn) => {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${label}\n  ${err.message}`);
    process.exitCode = 1;
  }
};

// ── The JS form ─────────────────────────────────────────────────────────────

check("titles are built from the provider label and id", () => {
  assert.strictEqual(syntheticTitle("lewdcorner", 12345), "LewdCorner #12345");
  assert.strictEqual(syntheticTitle("LewdCorner", 1), "LewdCorner #1");
  assert.strictEqual(syntheticTitle("LEWDCORNER", 999), "LewdCorner #999");
});

check("an unusable id degrades to the shared fallback, never to a broken name", () => {
  // "LewdCorner #null" or "LewdCorner #NaN" on a tile is worse than "Untitled":
  // it looks like a real id and sends someone looking for a thread that
  // does not exist.
  for (const id of [null, undefined, 0, -1, "", "abc", NaN, {}]) {
    assert.strictEqual(
      syntheticTitle("lewdcorner", id),
      FALLBACK_TITLE,
      `expected the fallback title for id ${JSON.stringify(id)}`,
    );
  }
});

check("an unknown provider degrades rather than inventing a label", () => {
  assert.strictEqual(syntheticTitle("itch", 5), FALLBACK_TITLE);
  assert.strictEqual(syntheticTitle("", 5), FALLBACK_TITLE);
});

check("steam and gog are deliberately absent", () => {
  // Their tables carry a real title and developer, so their orphan branches
  // never need a synthetic one. Adding them here would imply otherwise.
  assert.ok(!("steam" in SYNTHETIC_IDENTITY_PROVIDERS));
  assert.ok(!("gog" in SYNTHETIC_IDENTITY_PROVIDERS));
  assert.deepStrictEqual(Object.keys(SYNTHETIC_IDENTITY_PROVIDERS), ["lewdcorner"]);
});

// ── The SQL form ────────────────────────────────────────────────────────────

check("the SQL builder refuses anything that is not a column reference", () => {
  // This concatenates into a query. The guard is what keeps that safe, so it is
  // asserted rather than assumed.
  for (const bad of [
    "lc.lc_id; DROP TABLE games",
    "(SELECT 1)",
    "lc.lc_id || 'x'",
    "1",
    "",
    null,
    "lc..lc_id",
  ]) {
    assert.throws(
      () => syntheticTitleSql("lewdcorner", bad),
      /Not a column reference/,
      `expected a throw for ${JSON.stringify(bad)}`,
    );
  }
});

check("the SQL builder accepts qualified and bare columns", () => {
  assert.doesNotThrow(() => syntheticTitleSql("lewdcorner", "lc.lc_id"));
  assert.doesNotThrow(() => syntheticTitleSql("lewdcorner", "lewdcorner_data.lc_id"));
  assert.doesNotThrow(() => syntheticTitleSql("lewdcorner", "lc_id"));
});

check("an unknown provider throws rather than emitting a query", () => {
  assert.throws(() => syntheticTitleSql("itch", "x.id"), /No synthetic identity/);
});

// ── SQL and JS must agree, proven by running the SQL ─────────────────────────

const runSql = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = new sqlite3.Database(":memory:");
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row);
    });
  });

const main = async () => {
  await checkAsync("the SQL title equals the JS title for the same id", async () => {
    for (const id of [1, 7, 42, 12345, 999999]) {
      const expression = syntheticTitleSql("lewdcorner", "lc_id");
      const row = await runSql(
        `SELECT ${expression} AS title FROM (SELECT ? AS lc_id)`,
        [id],
      );
      assert.strictEqual(
        row.title,
        syntheticTitle("lewdcorner", id),
        `SQL and JS disagree for lc_id ${id}: `
        + `${JSON.stringify(row.title)} vs ${JSON.stringify(syntheticTitle("lewdcorner", id))}`,
      );
    }
  });

  await checkAsync("the table alias does not change the output", async () => {
    // versions.js uses `lewdcorner_data.lc_id` and catalogEntry.js uses
    // `lc.lc_id`. Both must render the same name for the same row.
    const a = await runSql(
      `SELECT ${syntheticTitleSql("lewdcorner", "lc.lc_id")} AS title
         FROM (SELECT 12345 AS lc_id) AS lc`,
    );
    const b = await runSql(
      `SELECT ${syntheticTitleSql("lewdcorner", "lewdcorner_data.lc_id")} AS title
         FROM (SELECT 12345 AS lc_id) AS lewdcorner_data`,
    );
    assert.strictEqual(a.title, b.title);
    assert.strictEqual(a.title, syntheticTitle("lewdcorner", 12345));
  });

  await checkAsync("the SQL creator literal equals the JS constant", async () => {
    const row = await runSql(`SELECT ${fallbackCreatorSql()} AS creator`);
    assert.strictEqual(row.creator, FALLBACK_CREATOR);
  });

  // ── No call site may bypass the module ────────────────────────────────────
  //
  // Four literals is where this started. A fifth would reintroduce the drift the
  // module exists to prevent, and it would not fail any other test.
  await checkAsync("no hardcoded synthetic identity remains outside the module", async () => {
    const roots = ["electron", "src"];
    const allowed = path.join("electron", "library", "catalogIdentity.js");
    const offenders = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
        } else if (/\.(js|jsx)$/.test(entry.name)) {
          if (full.endsWith(allowed)) continue;
          const text = fs.readFileSync(full, "utf8");
          text.split(/\r?\n/).forEach((line, index) => {
            // Comments may name the format; code may not build it.
            if (/^\s*(\/\/|\*|--)/.test(line)) return;
            for (const { label } of Object.values(SYNTHETIC_IDENTITY_PROVIDERS)) {
              if (line.includes(`${label} #`)) {
                offenders.push(`${full}:${index + 1}: ${line.trim()}`);
              }
            }
          });
        }
      }
    };
    for (const root of roots) walk(path.join(__dirname, "..", root));

    assert.strictEqual(
      offenders.length,
      0,
      "synthetic identity built outside library/catalogIdentity.js:\n  "
      + offenders.join("\n  "),
    );
  });

  if (process.exitCode) {
    console.error(`\ncheck-catalog-identity: ${passed} assertions passed, failures above.`);
  } else {
    console.log(`check-catalog-identity: ${passed} assertions passed.`);
  }
};

main().catch((err) => {
  console.error("check-catalog-identity crashed:", err);
  process.exitCode = 1;
});
