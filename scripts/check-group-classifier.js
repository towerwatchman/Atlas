"use strict";

// Tests for the download group classifier.
//
// Every heading below is a real value from the 164,381-link scan, with its
// observed frequency in a comment where it is in the top of the distribution.
// This matters: the classifier is the one component where a wrong answer
// destroys user data. A misfiled "Update Only" queued with on_complete:
// 'replace' deletes a working install and leaves a patch fragment behind.
//
// The 3,920 distinct group values in production mean the interesting cases are
// not the tidy ones. What is being verified here is mostly the ugly tail.

const assert = require("assert");
const {
  classifyGroup,
  selectDownloadableLinks,
  isContiguous,
  tokenize,
} = require("../electron/downloads/groupClassifier");

let checks = 0;
const accepts = (group, note) => {
  const verdict = classifyGroup(group);
  assert.ok(verdict.accepted, `expected ACCEPT for ${JSON.stringify(group)} (${note}) - got: ${verdict.reason}`);
  checks += 1;
  return verdict;
};
const rejects = (group, note) => {
  const verdict = classifyGroup(group);
  assert.ok(!verdict.accepted, `expected REJECT for ${JSON.stringify(group)} (${note}) - got: ${verdict.reason}`);
  checks += 1;
  return verdict;
};

// ── The orderly top of the distribution ─────────────────────────────────────
accepts("Win", "52612 links");
accepts("Win/Linux", "24678");
accepts("Linux", "5894");
accepts("All", "3415");
accepts("", "3322 links have an empty heading - ordinary downloads");
accepts("Win/Linux/Mac", "1307 - includes a platform we want");
rejects("Mac", "29783 - not a target platform");
rejects("Android", "19545");

// ── Spelling variants from the tail ─────────────────────────────────────────
accepts("Win64", "206");
accepts("Win x64", "174 - space-separated");
accepts("Windows", "155");
accepts("Win/Lin", "155 - abbreviated");
accepts("PC", "150");
accepts("Win32", "113");
accepts("Win x32", "99");
accepts("ALL", "95 - uppercase");
accepts("Win, Linux", "93 - comma separated");
accepts("Win/Mac", "114 - Win present, so wanted");
rejects("MAC", "147 - uppercase, still Mac");

// ── Kind outranks platform. The whole point of the module. ──────────────────
{
  const verdict = rejects("Update Only", "350 links");
  assert.strictEqual(verdict.kind, "update-only");
}
{
  // The dangerous case: mentions a wanted platform AND is a patch.
  const verdict = rejects("Win - Update Only", "platform token must not rescue it");
  assert.strictEqual(verdict.kind, "update-only");
  assert.ok(/not a full game/.test(verdict.reason));
}
rejects("Win/Linux Update", "update anywhere in the heading");
rejects("Patch", "patch");
rejects("Win Hotfix", "hotfix");
rejects("Walkthrough", "11 links labelled walkthrough");
rejects("Incremental Patch", "incremental");
rejects("Extras", "extras belong in their own bucket");
rejects("Android Patch", "rejected on both axes");

// ── Media payloads ──────────────────────────────────────────────────────────
rejects("MP4", "136 - video, not a build");
rejects("Swf", "91");

// ── Unrecognised headings are accepted on platform but still kind-checked ───
{
  const verdict = accepts("LOP Gold", "130 - game-specific tier, no platform token");
  assert.deepStrictEqual(verdict.platforms, []);
  assert.ok(/unlabeled/.test(verdict.reason));
}
accepts("Individual", "127");
accepts("v2022-05-24", "125 - a version string used as a heading");
accepts("-", "161 - junk, tokenizes to nothing");
accepts("Others", "193");
rejects("LOP Gold Update Only", "unknown heading, but kind check still fires");

// ── Compressed builds: playable, so accepted, but flagged ───────────────────
{
  const verdict = accepts("Compressed Win/Linux", "213 - downscaled assets, still a game");
  assert.strictEqual(verdict.compressed, true);
}
{
  const verdict = accepts("Compressed", "100");
  assert.strictEqual(verdict.compressed, true);
}

// ── Multi-part detection ────────────────────────────────────────────────────
{
  const verdict = accepts("Part 1", "699 links");
  assert.deepStrictEqual(verdict.part, { index: 1, total: null });
  assert.strictEqual(verdict.requiresAllParts, true);
}
{
  const verdict = accepts("Win/Linux Part 1", "112 - platform and part together");
  assert.strictEqual(verdict.part.index, 1);
  assert.ok(verdict.platforms.includes("win"));
}
{
  const verdict = rejects("Mac Part 1", "172 - part of a Mac set, still Mac");
  assert.strictEqual(verdict.accepted, false);
}
{
  const verdict = accepts("Part 2 of 3", "explicit total");
  assert.deepStrictEqual(verdict.part, { index: 2, total: 3 });
}

// ── The scraper's own type field wins when it disagrees ─────────────────────
{
  const verdict = classifyGroup("Win", { type: "save" });
  assert.ok(!verdict.accepted, "type=save must reject even under a Win heading");
  assert.strictEqual(verdict.kind, "save");
  checks += 1;
}
{
  const verdict = classifyGroup("Win", { type: "game" });
  assert.ok(verdict.accepted, "type=game is the normal case");
  checks += 1;
}

// ── tokenize ────────────────────────────────────────────────────────────────
assert.deepStrictEqual(tokenize("Win/Linux"), ["win", "linux"]);
assert.deepStrictEqual(tokenize("Win x64"), ["win", "x64"]);
assert.deepStrictEqual(tokenize("Win, Linux"), ["win", "linux"]);
assert.deepStrictEqual(tokenize("-"), []);
assert.deepStrictEqual(tokenize(""), []);
assert.deepStrictEqual(tokenize(null), []);
checks += 6;

// ── isContiguous ────────────────────────────────────────────────────────────
assert.strictEqual(isContiguous([1, 2, 3], 3), true);
assert.strictEqual(isContiguous([1, 2, 3], null), true);
assert.strictEqual(isContiguous([1, 3], null), false, "gap");
assert.strictEqual(isContiguous([2, 3], null), false, "must start at 1");
assert.strictEqual(isContiguous([1, 2], 3), false, "short of declared total");
assert.strictEqual(isContiguous([], null), false);
// A lone "Part 1" with no declared total means the rest are missing, not that
// the set is whole. Getting this wrong queues a fragment as a finished file.
assert.strictEqual(isContiguous([1], null), false, "lone part 1 is incomplete");
assert.strictEqual(isContiguous([1], 1), true, "unless a total of 1 is explicit");
checks += 8;

// ── selectDownloadableLinks ─────────────────────────────────────────────────
{
  // Shaped like a real thread: three hosts x three platforms, as seen on 295876.
  const links = [
    { host: "mega.nz", group: "Win/Linux", label: "MEGA", type: "game" },
    { host: "pixeldrain.com", group: "Win/Linux", label: "PIXELDRAIN", type: "game" },
    { host: "workupload.com", group: "Win/Linux", label: "WORKUPLOAD", type: "game" },
    { host: "mega.nz", group: "Mac", label: "MEGA", type: "game" },
    { host: "pixeldrain.com", group: "Mac", label: "PIXELDRAIN", type: "game" },
    { host: "mega.nz", group: "Android", label: "MEGA", type: "game" },
  ];
  const result = selectDownloadableLinks(links);
  assert.strictEqual(result.singles.length, 3, "only the Win/Linux row survives");
  assert.strictEqual(result.rejected.length, 3);
  assert.strictEqual(result.multiPart.length, 0);
  checks += 3;

  // Host gating for the "only show hosts we have plugins for" rule.
  const gated = selectDownloadableLinks(links, {
    supportedHosts: new Set(["mega", "pixeldrain"]),
  });
  assert.strictEqual(gated.singles.length, 2, "workupload filtered out");
  assert.ok(gated.rejected.some((entry) => /no plugin for workupload/.test(entry.verdict.reason)));
  checks += 2;
}

{
  // A complete three-part set groups into one entry rather than three downloads.
  const links = [
    { host: "mega.nz", group: "Win Part 1", type: "game" },
    { host: "mega.nz", group: "Win Part 2", type: "game" },
    { host: "mega.nz", group: "Win Part 3", type: "game" },
  ];
  const result = selectDownloadableLinks(links);
  // Split archives are never offered, complete or not.
  assert.strictEqual(result.singles.length, 0, "parts must not be offered");
  assert.strictEqual(result.multiPart.length, 1);
  assert.strictEqual(result.multiPart[0].parts.length, 3);
  assert.strictEqual(result.multiPart[0].complete, true);
  // The modal needs to know so it can explain the omission.
  assert.strictEqual(result.hiddenMultiPart.sets, 1);
  assert.strictEqual(result.hiddenMultiPart.links, 3);
  assert.deepStrictEqual(result.hiddenMultiPart.hosts, ["mega.nz"]);
  checks += 7;
}

{
  // A set with a missing part must be reported incomplete - extracting it
  // would fail, so the caller has to warn rather than queue it.
  const links = [
    { host: "mega.nz", group: "Win Part 1", type: "game" },
    { host: "mega.nz", group: "Win Part 3", type: "game" },
  ];
  const result = selectDownloadableLinks(links);
  assert.strictEqual(result.multiPart.length, 1);
  assert.strictEqual(result.multiPart[0].complete, false, "gap must be detected");
  checks += 2;
}

{
  // Parts on different hosts are separate sets - you cannot mix a Mega part 1
  // with a Pixeldrain part 2 and expect the archive to extract.
  const links = [
    { host: "mega.nz", group: "Win Part 1", type: "game" },
    { host: "pixeldrain.com", group: "Win Part 2", type: "game" },
  ];
  const result = selectDownloadableLinks(links);
  assert.strictEqual(result.multiPart.length, 2, "one set per host");
  assert.ok(result.multiPart.every((set) => set.complete === false));
  assert.strictEqual(result.hiddenMultiPart.sets, 2);
  checks += 3;
}

{
  // No split archives: the disclaimer must stay hidden. A game with ordinary
  // downloads should never be told parts were omitted.
  const result = selectDownloadableLinks([
    { host: "mega.nz", group: "Win/Linux", type: "game" },
  ]);
  assert.strictEqual(result.singles.length, 1);
  assert.strictEqual(result.hiddenMultiPart.sets, 0, "no disclaimer when nothing hidden");
  assert.strictEqual(result.hiddenMultiPart.links, 0);
  checks += 3;
}

console.log(`Group classifier checks passed (${checks} assertions)`);
