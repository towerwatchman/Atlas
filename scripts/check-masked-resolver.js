"use strict";

// Tests for the masked resolver's pure URL logic.
//
// The window itself needs a real Electron runtime, but the decisions that
// determine whether a resolve is USABLE are all pure functions, and they are
// the ones worth pinning down:
//
//   - is this URL still the F95 gate, or the destination
//   - does it carry a fragment
//   - when several navigation events report the same destination and only some
//     of them kept the fragment, which one do we keep
//
// That last one matters more than it looks. Mega's decryption key lives in the
// fragment, so a resolve that returns the same URL minus "#key" looks perfectly
// successful, downloads several gigabytes, and produces a file that cannot be
// decrypted. Preferring the fragment-bearing candidate is the whole ballgame.

const assert = require("assert");
const {
  isGateUrl,
  isNavigableHttp,
  hasFragment,
  pickBestCandidate,
} = require("../electron/downloads/maskedResolverUrls");

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };

// ── Gate detection ──────────────────────────────────────────────────────────
ok(isGateUrl("https://f95zone.to/masked/mega.nz/295876/11261704/s/i/p"), "masked url is the gate");
ok(isGateUrl("https://f95zone.to/threads/295876/"), "thread page is the gate");
ok(isGateUrl("https://www.f95zone.to/masked/x"), "www prefix still the gate");
ok(isGateUrl("https://attachments.f95zone.to/2021/09/1_x.zip"), "subdomain still the gate");
ok(!isGateUrl("https://mega.nz/file/abc#key"), "mega is the destination");
ok(!isGateUrl("https://pixeldrain.com/u/abc"), "pixeldrain is the destination");
// A lookalike domain must not read as ours.
ok(!isGateUrl("https://f95zone.to.evil.com/x"), "suffix lookalike is not the gate");
// Unparseable input is treated as unresolved rather than accidentally accepted.
ok(isGateUrl("not a url"), "garbage counts as not-yet-resolved");

// ── Scheme filtering ────────────────────────────────────────────────────────
ok(isNavigableHttp("https://mega.nz/file/a"), "https accepted");
ok(isNavigableHttp("http://example.com"), "http accepted");
ok(!isNavigableHttp("about:blank"), "about:blank rejected");
ok(!isNavigableHttp("data:text/html,x"), "data uri rejected");
ok(!isNavigableHttp("devtools://devtools/x"), "devtools rejected");
ok(!isNavigableHttp(""), "empty rejected");
ok(!isNavigableHttp(null), "null rejected");

// ── Fragment detection ──────────────────────────────────────────────────────
ok(hasFragment("https://mega.nz/file/abc#Zm9vYmFy"), "real fragment detected");
ok(!hasFragment("https://mega.nz/file/abc"), "no fragment");
// A bare trailing hash carries no key and must not count as one.
ok(!hasFragment("https://mega.nz/file/abc#"), "empty fragment is not a fragment");
ok(!hasFragment(""), "empty string");

// ── Candidate selection ─────────────────────────────────────────────────────
{
  // Nothing off-site yet: still on the gate, keep waiting.
  const best = pickBestCandidate([
    { source: "did-navigate", url: "https://f95zone.to/masked/mega.nz/1/2/s/i/p", fragment: false },
  ]);
  eq(best, null, "gate-only candidates resolve to nothing");
}
{
  const best = pickBestCandidate([
    { source: "will-navigate", url: "https://pixeldrain.com/u/abc", fragment: false },
  ]);
  eq(best.url, "https://pixeldrain.com/u/abc", "single off-site candidate wins");
}
{
  // THE case. web-request saw it first but stripped the fragment, because
  // fragments are never sent to servers. will-navigate is renderer-level and
  // kept the key. The keyed one has to win despite arriving second.
  const best = pickBestCandidate([
    { source: "web-request", url: "https://mega.nz/file/abc", fragment: false },
    { source: "will-navigate", url: "https://mega.nz/file/abc#Zm9vYmFy", fragment: true },
  ]);
  eq(best.source, "will-navigate", "fragment-bearing candidate beats the earlier one");
  eq(best.hasOwnProperty("url") && best.url.includes("#Zm9vYmFy"), true, "key preserved");
}
{
  // Ordering must not matter.
  const best = pickBestCandidate([
    { source: "will-navigate", url: "https://mega.nz/file/abc#key", fragment: true },
    { source: "web-request", url: "https://mega.nz/file/abc", fragment: false },
  ]);
  eq(best.source, "will-navigate", "fragment still wins when it arrives first");
}
{
  // No fragment anywhere is fine for hosts that do not use one.
  const best = pickBestCandidate([
    { source: "web-request", url: "https://gofile.io/d/abc", fragment: false },
    { source: "did-navigate", url: "https://gofile.io/d/abc", fragment: false },
  ]);
  eq(best.source, "web-request", "earliest wins when no fragment exists");
}
{
  // Gate URLs mixed in with the real destination must be filtered out first.
  const best = pickBestCandidate([
    { source: "did-navigate", url: "https://f95zone.to/masked/mega.nz/1/2/s/i/p", fragment: false },
    { source: "web-request", url: "https://f95zone.to/assets/js/masked.js", fragment: false },
    { source: "will-navigate", url: "https://mega.nz/file/abc#key", fragment: true },
  ]);
  eq(best.source, "will-navigate", "gate noise ignored");
  eq(best.fragment, true, "fragment retained");
}
{
  // Non-http noise must never be selected.
  const best = pickBestCandidate([
    { source: "did-navigate", url: "about:blank", fragment: false },
    { source: "will-navigate", url: "https://mega.nz/file/x#k", fragment: true },
  ]);
  eq(best.url, "https://mega.nz/file/x#k", "about:blank skipped");
}
{
  eq(pickBestCandidate([]), null, "no candidates");
}

console.log(`Masked resolver checks passed (${checks} assertions)`);
