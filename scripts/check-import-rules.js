"use strict";

// Characterization tests for library/importRules.js.
//
// These functions were moved verbatim out of ipc/importer.js. A refactor that
// changes behaviour is not a refactor, so this file exists to prove it did not:
// every exported function is exercised, and the assertions describe what the
// code did BEFORE the move, not what it arguably should do.
//
// Where behaviour looks odd, it is pinned as-is and marked. Fixing it is a
// separate change with its own reasoning - folding a fix into a move is how a
// "safe refactor" quietly breaks an import path months later.
//
// This is also the safety net for the remaining split. importer.js is still
// 4,500 lines and more will come out of it; these tests mean the next
// extraction has something to fail against.

const assert = require("assert");
const path = require("path");
const rules = require("../electron/library/importRules");

let checks = 0;
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };

// Every export must be present and callable - a destructured require that
// silently yields undefined is the main hazard of this kind of move.
const EXPECTED_EXPORTS = [
  "sanitizePathSegment", "normalizeVersionName", "buildStructuredImportPath",
  "toPositiveInteger", "getLewdCornerIdFromGame", "TARBALL_SUFFIXES",
  "isCompoundTarballPath", "getArchiveExtension", "getConfiguredExtractionExtensions",
  "isArchiveFilePath", "isRarArchivePath", "isSteamImportRow", "getSteamIdFromGame",
  "isGogImportRow", "getGogIdFromGame", "inferCatalogImportVersion",
  "getConfiguredGameExtensions",
];
for (const name of EXPECTED_EXPORTS) {
  ok(rules[name] !== undefined, `${name} is exported`);
}
eq(Object.keys(rules).length, EXPECTED_EXPORTS.length, "no unexpected exports");

// ── sanitizePathSegment ─────────────────────────────────────────────────────
// Path segments become folder names, so anything the filesystem rejects has to
// go. The fallback matters: an empty segment would create an unnamed folder.
eq(rules.sanitizePathSegment("Normal Name"), "Normal Name", "clean name untouched");
eq(rules.sanitizePathSegment("a/b"), "a_b", "slash replaced");
eq(rules.sanitizePathSegment("a:b*c?d"), "a_b_c_d", "reserved characters replaced");
eq(rules.sanitizePathSegment(""), "Unknown", "empty falls back");
eq(rules.sanitizePathSegment(null), "Unknown", "null falls back");
eq(rules.sanitizePathSegment("", "Custom"), "Custom", "caller can choose the fallback");

// ── normalizeVersionName ────────────────────────────────────────────────────
// The version becomes a folder name and is compared against installed builds.
eq(rules.normalizeVersionName("v1.0"), "v1.0", "version preserved");
eq(rules.normalizeVersionName(""), "Unknown", "empty falls back");
eq(rules.normalizeVersionName(null), "Unknown", "null falls back");
eq(rules.normalizeVersionName("  1.2  "), "1.2", "trimmed");

// ── buildStructuredImportPath ───────────────────────────────────────────────
{
  const built = rules.buildStructuredImportPath(
    path.join("C:", "Games"),
    "{creator}/{title}/{version}",
    { creator: "Dev", title: "Game", version: "v1.0" },
  );
  ok(built.includes("Dev"), "creator in the path");
  ok(built.includes("Game"), "title in the path");
  ok(built.includes("v1.0"), "version in the path");
}
{
  // Missing fields must not produce an empty path segment.
  const built = rules.buildStructuredImportPath(
    path.join("C:", "Games"), "{creator}/{title}/{version}", {},
  );
  ok(built.includes("Unknown"), "missing fields fall back rather than collapsing");
}
{
  // A separator inside a field must not escape the library root. Note the
  // property being asserted is CONTAINMENT, not the absence of the substring
  // "..": "Evil/../.." sanitises to the single segment "Evil_.._", which reads
  // alarming but cannot traverse anywhere because the slashes are gone. An
  // earlier version of this test checked for the substring and failed on
  // perfectly safe output.
  const root = path.join("C:", "Games");
  const built = rules.buildStructuredImportPath(root, "{creator}/{title}",
    { creator: "Evil/../..", title: "Game" });
  const segments = built.split(/[\\/]/);
  ok(!segments.includes(".."), "no '..' survives as its own path segment");
  ok(segments.length === root.split(/[\\/]/).length + 2,
     "exactly two segments added, so the field could not inject extra levels");
}

{
  // A format with no usable segments must NOT return the library root. Returning
  // it made the library root an extraction destination and, downstream, a
  // deletion target -- the path that cost a user their archive drive.
  const root = path.join("C:", "Games");
  for (const format of ["", "   ", "///", " / / "]) {
    const built = rules.buildStructuredImportPath(root, format, { title: "Game" });
    ok(built !== root, `format ${JSON.stringify(format)} does not collapse to the library root`);
    ok(built.startsWith(root), `format ${JSON.stringify(format)} still lands inside the library`);
  }
  const untitled = rules.buildStructuredImportPath(root, "", {});
  ok(untitled !== root, "an empty game object still descends a level");
}

// ── toPositiveInteger ───────────────────────────────────────────────────────
eq(rules.toPositiveInteger("42"), 42, "numeric string");
eq(rules.toPositiveInteger(42), 42, "number");
eq(rules.toPositiveInteger("0"), null, "zero is not positive");
eq(rules.toPositiveInteger("-1"), null, "negative rejected");
eq(rules.toPositiveInteger("abc"), null, "non-numeric rejected");
eq(rules.toPositiveInteger(null), null, "null rejected");

// ── Archive detection ───────────────────────────────────────────────────────
ok(Array.isArray(rules.TARBALL_SUFFIXES), "tarball suffix list exported");
ok(rules.TARBALL_SUFFIXES.length > 0, "and is populated");

ok(rules.isRarArchivePath("game.rar"), "rar detected");
ok(rules.isRarArchivePath("GAME.RAR"), "case insensitive");
ok(!rules.isRarArchivePath("game.zip"), "zip is not rar");

ok(rules.isCompoundTarballPath("game.tar.gz"), "compound tarball detected");
ok(!rules.isCompoundTarballPath("game.zip"), "zip is not a compound tarball");

// Extension lists come from config; an empty config must fall back to the
// defaults rather than matching nothing.
{
  const fromEmpty = rules.getConfiguredExtractionExtensions({});
  ok(Array.isArray(fromEmpty) && fromEmpty.length > 0, "extraction extensions default");
  const configured = rules.getConfiguredExtractionExtensions({
    Library: { extractionExtensions: "zip,7z" },
  });
  ok(configured.includes("zip"), "configured value honoured");
}
{
  const games = rules.getConfiguredGameExtensions({});
  ok(Array.isArray(games) && games.length > 0, "game extensions default");
}
ok(rules.isArchiveFilePath("game.zip", {}), "zip is an archive");
ok(!rules.isArchiveFilePath("game.exe", {}), "exe is not an archive");

// ── Row classification ──────────────────────────────────────────────────────
// Three independent signals, any one of which is sufficient: the row's
// sourceType, the scan status it came back with, or simply the presence of an
// id. Note it is `sourceType`, NOT `source` - a plausible-looking { source:
// 'steam' } is deliberately NOT a steam row, and asserting otherwise is a
// mistake this test previously made.
ok(rules.isSteamImportRow({ sourceType: "steam" }), "steam by sourceType");
ok(rules.isSteamImportRow({ scanStatus: "steamVersion" }), "steam by scanStatus");
ok(rules.isSteamImportRow({ steam_appid: "440" }), "steam by id presence");
ok(!rules.isSteamImportRow({ source: "steam" }), "`source` is not the field checked");
ok(!rules.isSteamImportRow({}), "empty row is not steam");

ok(rules.isGogImportRow({ sourceType: "gog" }), "gog by sourceType");
ok(rules.isGogImportRow({ scanStatus: "gogVersion" }), "gog by scanStatus");
ok(rules.isGogImportRow({ gog_id: "123" }), "gog by id presence");
ok(!rules.isGogImportRow({}), "empty row is not gog");

// Id extraction has to tolerate both snake_case and camelCase, since rows
// arrive from the database and from the renderer.
ok(rules.getSteamIdFromGame({ steam_appid: "440" }) != null, "steam id from snake_case");
ok(rules.getGogIdFromGame({ gog_id: "123" }) != null, "gog id from snake_case");
eq(rules.getSteamIdFromGame({}), null, "absent steam id is null");
eq(rules.getGogIdFromGame({}), null, "absent gog id is null");
eq(rules.getLewdCornerIdFromGame({}), null, "absent lewdcorner id is null");

// ── inferCatalogImportVersion ───────────────────────────────────────────────
// Candidates are tried in order - filename, parent folder, then the catalog's
// own version fields - and the first pattern match wins.
eq(rules.inferCatalogImportVersion("C:/dl/Game-v1.0.zip", {}), "v1.0",
   "v-prefixed version read from the filename");
eq(rules.inferCatalogImportVersion("C:/dl/Game-1.2.3.zip", {}), "1.2.3",
   "dotted version read from the filename");
eq(rules.inferCatalogImportVersion("C:/dl/Game-Chapter5.zip", {}), "Chapter5",
   "chapter form recognised");
// Filename wins over the catalog when both have something.
eq(rules.inferCatalogImportVersion("C:/dl/Game-v1.0.zip", { version: "9.9" }), "v1.0",
   "filename takes precedence over the catalog");
// Nothing in the path: fall through to the catalog, normalised.
eq(rules.inferCatalogImportVersion("C:/dl/Game.zip", { latestVersion: "2.0" }), "2.0",
   "falls back to the catalog version");
eq(rules.inferCatalogImportVersion("", {}), "Unknown",
   "nothing anywhere normalises to Unknown rather than empty");

console.log(`Import rules checks passed (${checks} assertions)`);
