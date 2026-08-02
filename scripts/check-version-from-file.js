"use strict";

// Tests for the archive filename version parser.
//
// The install prompt pre-fills the version from the downloaded filename, and
// that string becomes the folder name and decides whether an install replaces
// an existing build. A wrong guess is destructive, so the parser reports
// confidence and the prompt stays editable - these tests pin down when it
// should be sure and when it should admit it is not.
//
// The headline case is the real filename from the first successful download:
//   AFamilyVenture-0.09_V4-Fix_Supporter-pc.zip
// which contains 0.09, a "V4" that is NOT a version, and three noise tokens.

const assert = require("assert");
const {
  versionFromFileName,
  titleFromFileName,
  suggestVersion,
  stripExtension,
} = require("../electron/downloads/versionFromFile");

let checks = 0;
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };

// ── Extensions ──────────────────────────────────────────────────────────────
eq(stripExtension("game.zip"), "game", "zip");
eq(stripExtension("game.tar.gz"), "game", "double extension");
eq(stripExtension("game.7z"), "game", "7z");
eq(stripExtension("game"), "game", "no extension");

// ── The real filename ───────────────────────────────────────────────────────
{
  // The version is 0.09. "V4" is a fix revision, and a v-prefixed BARE integer
  // must never outrank a dotted number - getting this backwards would name the
  // install folder "v4" and compare wrongly against every other build.
  const result = versionFromFileName("AFamilyVenture-0.09_V4-Fix_Supporter-pc.zip");
  eq(result.version, "0.09", "dotted number beats a bare v-integer");
  eq(result.confidence, "high", "a dotted number is a confident read");
}
// A bare v-integer on its own is still usable, just not trusted.
eq(versionFromFileName("Game-v4.zip").version, "v4", "bare v-integer used when alone");
eq(versionFromFileName("Game-v4.zip").confidence, "low", "but flagged low confidence");

// ── Clear cases ─────────────────────────────────────────────────────────────
eq(versionFromFileName("Game-v0.9.2-pc.zip").version, "v0.9.2", "v-prefixed");
eq(versionFromFileName("Game-v0.9.2-pc.zip").confidence, "high", "v-prefix is high confidence");
eq(versionFromFileName("SomeGame_1.2.3.zip").version, "1.2.3", "dotted numeric");
eq(versionFromFileName("Game-2021.05.24-win.zip").version, "2021.05.24", "date form");
eq(versionFromFileName("Game-2021.05.24-win.zip").confidence, "high", "date is high confidence");
eq(versionFromFileName("Game v1.0a.zip").version, "v1.0a", "trailing letter kept");
eq(versionFromFileName("Game-Chapter5.zip").version, "5", "chapter number");
eq(versionFromFileName("Game-Chapter5.zip").confidence, "medium", "chapter is medium");

// ── Nothing to find ─────────────────────────────────────────────────────────
eq(versionFromFileName("Game-Final-pc.zip").version, "", "no version present");
eq(versionFromFileName("").version, "", "empty input");
eq(versionFromFileName(null).version, "", "null input");
// A bare integer must not be mistaken for a version - "Part 2" is not v2.
eq(versionFromFileName("Game-Part2.zip").version, "", "bare integer is not a version");

// ── Titles ──────────────────────────────────────────────────────────────────
{
  const title = titleFromFileName("AFamilyVenture-0.09_V4-Fix_Supporter-pc.zip")
  ok(/AFamilyVenture/i.test(title), `title keeps the name, got: ${title}`);
  ok(!/supporter/i.test(title), "noise token dropped");
  ok(!/\bpc\b/i.test(title), "platform token dropped");
}

// ── Reconciling with the catalog ────────────────────────────────────────────
{
  // Agreement written two ways is still agreement.
  const result = suggestVersion("Game-v0.9.2.zip", "0.9.2");
  eq(result.mismatch, false, "v-prefix difference is not a mismatch");
  eq(result.version, "0.9.2", "catalog spelling preferred when they agree");
  eq(result.confidence, "high", "agreement is high confidence");
}
{
  // Real disagreement. The file describes the bytes on disk; the catalog
  // describes what the thread advertises. The file wins, but it is flagged.
  const result = suggestVersion("Game-v0.9.2.zip", "0.9.5");
  eq(result.mismatch, true, "disagreement detected");
  eq(result.version, "v0.9.2", "file wins - it describes the actual bytes");
  eq(result.confidence, "low", "and confidence drops so the prompt says so");
  eq(result.catalogVersion, "0.9.5", "both reported for the user to settle");
  eq(result.fileVersion, "v0.9.2", "both reported");
}
{
  // Filename has nothing usable: fall back to the catalog, unverified.
  const result = suggestVersion("Game-Final.zip", "0.9.5");
  eq(result.version, "0.9.5", "catalog used as fallback");
  eq(result.confidence, "medium", "unverified against the file");
  eq(result.mismatch, false, "no disagreement when there is nothing to disagree with");
}
{
  // Neither source knows. The prompt must ask.
  const result = suggestVersion("Game-Final.zip", "");
  eq(result.version, "", "nothing to suggest");
  eq(result.confidence, "low", "user has to supply it");
}

console.log(`Version parser checks passed (${checks} assertions)`);
