"use strict";

const assert = require("assert");
const {
  getIsUpdateAvailable,
  compareVersionStrings,
  parseVersion,
  isTerminal,
} = require("../electron/utils/versionCompare");

let pass = 0;
let fail = 0;
const failures = [];

function upd(latest, installed, expected, note = "") {
  const got = getIsUpdateAvailable(latest, [{ version: installed }]);
  if (got === expected) pass++;
  else {
    fail++;
    failures.push(
      `getIsUpdateAvailable("${latest}", ["${installed}"]) => ${got} (expected ${expected})${note ? "  // " + note : ""}`,
    );
  }
}

function cmp(a, b, expected, note = "") {
  const got = compareVersionStrings(a, b);
  if (got === expected) pass++;
  else {
    fail++;
    failures.push(
      `compare("${a}", "${b}") => ${got} (expected ${expected})${note ? "  // " + note : ""}`,
    );
  }
}

// ── plain semver ─────────────────────────────────────────────────────────────
upd("v0.10.0", "v0.9.11", true, "0.10 > 0.9.11 numeric not lexical");
upd("v1.10.3", "v1.2.1", true);
upd("v0.9", "v0.9", false);
upd("v1.0", "v1.0.0", false, "1.0 == 1.0.0");
upd("v0.2", "v0.3", false, "installed newer");
upd("v0.123", "v0.9", true, "0.123 read as [0,123] > [0,9]");

// ── letter revisions ─────────────────────────────────────────────────────────
upd("v0.3.6c", "v0.3.6b", true);
upd("v0.9c", "v0.9", true, "letter rev newer than bare");
upd("v0.02c", "v0.02", true);
upd("v0.1a", "v0.1", true);
upd("Ep.5.02p", "Ep.5.02", true, "trailing p letter rev on episode");

// ── terminal markers ─────────────────────────────────────────────────────────
upd("Final", "v0.9", true, "final beats in-progress");
upd("Final", "Final", false);
upd("Final + DLC", "Final", false, "dlc is noise");
upd("v0.9", "Final", false, "already at final");
upd("Finale", "Ep.4", true);
upd("Epilogue", "Ch.3", true);
upd("Ep.9.2 Complete", "Ep.9.2", true, "complete terminal");
upd("Final Itch", "v1.0", true, "itch is noise, final wins");

// ── chapter progression ──────────────────────────────────────────────────────
upd("Ch.10", "Ch.2", true, "chapter numeric ordering");
upd("Ch.2", "Ch.10", false);
upd("Chapter 2", "Chapter 1", true);
upd("Ch.1-6", "Ch.1-3", true, "range top-end");
upd("Ch.4", "Ch.4", false);
upd("Act II", "Act I", true, "roman");

// ── chapter + semver (chapter primary) ───────────────────────────────────────
upd("Ch.7 v0.7.0", "Ch.6 v0.6.0", true);
upd("Ch.1 v0.2", "Ch.1 v0.1", true, "same chapter, semver bumps");
upd("Ch.2 v0.1", "Ch.1 v9.9", true, "chapter dominates semver");
upd("Ch.1 v1.19", "Ch.1 v1.2", true, "1.19 > 1.2");

// ── episode progression ──────────────────────────────────────────────────────
upd("Ep.3", "Ep.2", true);
upd("Ep.30", "Ep.5", true, "numeric not lexical");
upd("Ep.3.5.2", "Ep.3.5.1", true, "sub-decimal episode");
upd("Ep.2 v0.7.1", "Ep.2 v0.7.0", true);
upd("Ep.4 v0.4.1", "Ep.4 v0.4.0", true);
upd("Ep.1 Final", "Ep.1 v0.9", true, "terminal within episode");

// ── season nesting (season primary) ──────────────────────────────────────────
upd("S2 Ep.4", "S1 Ep.9", true, "season dominates episode");
upd("S1 Ep.3", "S1 Ep.2", true);
upd("S01 Ep 02", "S01 Ep 01", true, "zero padded");

// ── chapter + episode (chapter is higher) ────────────────────────────────────
upd("Ch.2 Ep.1", "Ch.1 Ep.9", true, "chapter above episode");
upd("Ch.1 Ep.3", "Ch.1 Ep.2", true, "same chapter, episode bumps");

// ── part sub-steps ───────────────────────────────────────────────────────────
upd("Ep.2 P3", "Ep.2 P1", true);
upd("Ch.1 P2 v1.0.2", "Ch.1 P1 v1.0.2", true);

// ── qualifier ranking ────────────────────────────────────────────────────────
upd("v1.0 Public", "v1.0 Demo", true, "public > demo");
upd("v0.1", "v0.1 Demo", true, "normal > demo");
upd("Ep.3 Full", "Ep.3 Beta", true);
upd("v1.0 Demo", "v1.0 Public", false, "demo older, no update");

// ── noise-only differences (no update) ───────────────────────────────────────
upd("v1.0 + DLC", "v1.0", false);
upd("v0.5.4c HotFix2", "v0.5.4c", false);
upd("v1.0 Steam Patched", "v1.0", false);
upd("Ep.2 v2.23 SE", "Ep.2 v2.23", false, "special edition noise");
upd("v1.0 Voiceless", "v1.0", false);
upd("Chapter 2 v1.11 Patreon", "Chapter 2 v1.11", false);

// ── dates ────────────────────────────────────────────────────────────────────
upd("March 2026", "Dec 2025", true, "month-year comparable");
upd("Dec 2025", "March 2026", false);
upd("2026-06-03", "2025-09-24", true, "ISO dates");
upd("March 2026", "March 2026", false);

// ── incomparable → suppress ──────────────────────────────────────────────────
upd("2026-06-03", "v0.9", false, "date vs semver incomparable");
upd("Lythe! Blade of Malpractice", "v1.0", false, "unparseable title");
upd("Compact Edition", "v0.9", false, "edition-only, no structure");

// ── multi-version libraries ──────────────────────────────────────────────────
{
  const got = getIsUpdateAvailable("v1.2", [
    { version: "v1.0" },
    { version: "v1.2" }, // already have latest
    { version: "v0.9" },
  ]);
  if (got === false) pass++;
  else {
    fail++;
    failures.push(`multi-version has-latest => ${got} (expected false)`);
  }
}
{
  const got = getIsUpdateAvailable("v1.3", [
    { version: "v1.0" },
    { version: "v1.2" },
  ]);
  if (got === true) pass++;
  else {
    fail++;
    failures.push(`multi-version newest older => ${got} (expected true)`);
  }
}

// ── direct compare spot-checks ───────────────────────────────────────────────
cmp("Ch.10", "Ch.2", 1);
cmp("v0.9", "v0.9", 0);
cmp("2026-06-03", "v0.9", null, "incomparable");
cmp("Final", "v0.9", 1);

// ── parse sanity ─────────────────────────────────────────────────────────────
assert.strictEqual(isTerminal("Final + DLC"), true);
assert.strictEqual(isTerminal("v1.0 Demo"), false);
assert.deepStrictEqual(parseVersion("Ch.10 v0.10.0").chapter, [10]);
assert.deepStrictEqual(parseVersion("S2 Ep.4").season, [2]);
assert.deepStrictEqual(parseVersion("Ep.3.5.2").episode, [3, 5, 2]);

console.log(`\nversionCompare: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("All version comparison checks passed.\n");
