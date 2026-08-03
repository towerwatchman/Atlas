"use strict";

// Guards the choice of which version an installing download replaces.
//
// This decides which directory gets DELETED, and it had no test coverage while
// living inline in the downloads-install handler. The bug it shipped with is the
// first case below: the filter read `entry.is_installed`, while the version
// objects from getGame() carry `isInstalled`. `undefined !== false` is true, so
// every row passed and the "installed version" was whichever row came first.

const assert = require("assert");
const {
  chooseReplaceTarget,
  describeReplaceOutcome,
  isInstalledVersion,
  REPLACE_SKIP_MESSAGES,
} = require("../electron/downloads/replaceTarget");

let assertions = 0;
const eq = (actual, expected, message) => {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
};
const deep = (actual, expected, message) => {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
};
const ok = (value, message) => {
  assertions += 1;
  assert.ok(value, message);
};

// The exact shape mapVersionRow() produces, which is what getGame() returns.
const version = (id, name, installed = true, extra = {}) => ({
  version_id: id,
  version: name,
  game_path: installed ? `D:\\Games\\${name}` : "",
  exec_path: installed ? `D:\\Games\\${name}\\game.exe` : "",
  isInstalled: installed,
  installState: installed ? "installed" : "missing",
  ...extra,
});

// ── isInstalledVersion ──────────────────────────────────────────────────────
// The regression. A row carrying only `isInstalled` must not read as installed
// when that flag is false, and the absence of `is_installed` must not be
// mistaken for "installed".
eq(isInstalledVersion(version(1, "v1", true)), true, "isInstalled true");
eq(isInstalledVersion(version(2, "v2", false)), false, "isInstalled false is respected");
eq(isInstalledVersion({ is_installed: false, game_path: "x" }), false, "snake_case honoured");
eq(isInstalledVersion({ installState: "missing", game_path: "x" }), false, "installState honoured");
eq(isInstalledVersion({ installState: "pending" }), false, "pending is not installed");
eq(isInstalledVersion({ game_path: "D:\\g" }), true, "a path alone implies installed");
eq(isInstalledVersion({}), false, "nothing at all is not installed");
eq(isInstalledVersion(null), false, "null is not installed");

// ── The bug this module was extracted to fix ────────────────────────────────
// Two versions, only the SECOND installed. The old inline logic returned the
// first row, so a replace deleted a build the user was not replacing.
{
  const versions = [version(10, "v0.9", false), version(11, "v1.0", true)];
  const target = chooseReplaceTarget({ versions });
  eq(target.version, "v1.0", "the installed version wins, not the first row");
  eq(target.versionId, 11);
  eq(target.reason, "only-installed-version");
}

// ── Explicit user choice wins ───────────────────────────────────────────────
{
  const versions = [version(1, "v1.0"), version(2, "v1.1"), version(3, "v1.2")];
  const target = chooseReplaceTarget({ versions, requestedVersionId: 2, selectedVersionId: 3 });
  eq(target.version, "v1.1", "the user's pick beats the record's selected version");
  eq(target.versionId, 2);
  eq(target.reason, "user-selected");
  // String ids arrive from IPC as strings.
  eq(chooseReplaceTarget({ versions, requestedVersionId: "3" }).version, "v1.2", "string id");
}

// A stale id from a modal opened before the list changed must not be trusted
// blind — it could name another game's row.
{
  const versions = [version(1, "v1.0")];
  const target = chooseReplaceTarget({ versions, requestedVersionId: 999 });
  eq(target.version, "", "an unknown id selects nothing");
  eq(target.reason, "requested-version-not-found");
}

// A user may deliberately choose an uninstalled row (a stale database entry with
// no files); the choice is honoured because it is explicit.
{
  const versions = [version(1, "v1.0", true), version(2, "v0.5", false)];
  const target = chooseReplaceTarget({ versions, requestedVersionId: 2 });
  eq(target.version, "v0.5", "an explicit choice is honoured even if not installed");
  eq(target.reason, "user-selected");
}

// ── The record's selected version ───────────────────────────────────────────
{
  const versions = [version(1, "v1.0"), version(2, "v1.1")];
  const target = chooseReplaceTarget({ versions, selectedVersionId: 1 });
  eq(target.version, "v1.0");
  eq(target.reason, "record-selected-version");
}

// Selected but not installed: there are no files to replace, so it must not be
// chosen just because it is selected.
{
  const versions = [version(1, "v1.0", false), version(2, "v1.1", true)];
  const target = chooseReplaceTarget({ versions, selectedVersionId: 1 });
  eq(target.version, "v1.1", "falls through to the only installed version");
  eq(target.reason, "only-installed-version");
}

// ── Refusing to guess ───────────────────────────────────────────────────────
// Several installed builds and nothing to disambiguate them. Picking one would
// delete a directory the user never chose, so this reports instead.
{
  const versions = [version(1, "v1.0"), version(2, "v1.1"), version(3, "v1.2", false)];
  const target = chooseReplaceTarget({ versions });
  eq(target.version, "", "no target when it would be a guess");
  eq(target.reason, "ambiguous");
  eq(target.ambiguous, true);
  deep(
    target.candidates,
    [{ versionId: 1, version: "v1.0" }, { versionId: 2, version: "v1.1" }],
    "only the installed builds are offered as candidates",
  );
}

// ── Empty and degenerate input ──────────────────────────────────────────────
eq(chooseReplaceTarget({ versions: [] }).reason, "no-versions");
eq(chooseReplaceTarget({}).reason, "no-versions");
eq(chooseReplaceTarget({ versions: null }).reason, "no-versions");
eq(
  chooseReplaceTarget({ versions: [version(1, "  ")] }).reason,
  "no-versions",
  "a blank version name is not a usable target",
);
eq(
  chooseReplaceTarget({ versions: [version(1, "v1.0", false)] }).reason,
  "no-installed-version",
);
// A row with no usable rowid can still be replaced by name.
{
  const target = chooseReplaceTarget({ versions: [{ version: "v1.0", game_path: "D:\\g" }] });
  eq(target.version, "v1.0");
  eq(target.versionId, null, "a missing id is reported as null, not NaN");
}

// ── Outcome reporting ───────────────────────────────────────────────────────
// The reason every skip exists to be reported. The handler used to discard
// these, which is why a replace that did nothing looked identical to one that
// worked.
eq(describeReplaceOutcome({ replaced: true }), "", "a success says nothing");
for (const reason of Object.keys(REPLACE_SKIP_MESSAGES)) {
  ok(
    describeReplaceOutcome({ replaced: false, reason }).length > 20,
    `'${reason}' has a user-facing explanation`,
  );
}
// An unmapped reason must still surface rather than vanish.
ok(
  describeReplaceOutcome({ replaced: false, reason: "something-new" }).includes("something-new"),
  "an unknown reason is still reported",
);
ok(
  describeReplaceOutcome({ replaced: false }).length > 10,
  "even a reasonless skip says something",
);

console.log(`Replace target checks passed (${assertions} assertions)`);
