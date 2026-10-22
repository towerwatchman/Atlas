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

// ── /dl/ interstitial automation ─────────────────────────────────────────────
//
// F95 now sends download clicks to its own intermediate page
// (f95zone.to/dl/<postId>/?...): a form the page's own f95dl JS walks through
// Continue -> visible countdown -> "Generate your link" -> redirect to the
// mirror. The resolver must click that flow's REAL controls each poll tick -
// never synthesize the POST, since `_xfToken` and the `w` code are
// session-bound - and hold the window open (hidden) while the countdown runs.

const dlGate = require("../electron/downloads/dlGate");
const { JSDOM, VirtualConsole } = require("jsdom");

// Builds one interstitial state and evaluates DL_POLL_SCRIPT against it, the
// same way the resolver evaluates it against the live window each tick. The
// virtual console swallows jsdom's "Not implemented: requestSubmit" notice -
// the live page's f95dl JS intercepts the submit; jsdom just logs its lack.
const runPoll = (html) => {
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  const document = dom.window.document;
  const result = eval(dlGate.DL_POLL_SCRIPT);
  dom.window.close();
  return result;
};

const DL_BODY = (state) => {
  const countdown =
    state === "counting"
      ? `<div class="f95dl-countdown js-f95dlCountdown"><span class="js-f95dlSeconds">7</span></div>`
      : `<div class="f95dl-countdown js-f95dlCountdown u-hidden"><span class="js-f95dlSeconds">0</span></div>`;
  const continueBtn =
    state === "generate"
      ? `<button type="button">Generate your link</button>`
      : `<button type="submit" class="button--primary js-f95dlContinue"><span class="button-text">Continue</span></button>`;
  return `<html><body><form action="/dl/21960808/" method="post">
    <input name="w" class="js-f95dlCode" value="abc" />
    ${countdown}${continueBtn}
    <span class="f95dl-link-host">bzzhr.to</span>
  </form></body></html>`;
};
const OTHER_BODY = `<html><body><div>Some off-site page or old /masked/ gate</div></body></html>`;

{
  // Fresh interstitial: the poll clicks the real submit button; nothing is
  // counting, so the reveal holds nothing.
  const result = runPoll(DL_BODY("fresh"));
  eq(result.clicked, "continue", "fresh interstitial: the continue button is clicked");
  eq(result.dlActive, false, "fresh interstitial is not yet progressing");
  eq(result.seconds, null, "no countdown yet");
}
{
  // Mid-countdown: nothing clicked, the resolver is told to wait.
  const result = runPoll(DL_BODY("counting"));
  eq(result.clicked, false, "countdown state clicks nothing");
  eq(result.dlActive, true, "countdown marks the interstitial as progressing");
  eq(result.seconds, 7, "the tick's remaining seconds are reported");
  const at = 5000;
  ok(dlGate.holdReveal({ dlActive: true, at }, at + 9000) === true,
    "a live countdown holds the reveal");
  ok(dlGate.holdReveal({ dlActive: true, at }, at + 15001) === false,
    "the hold expires so a stuck page still gets shown");
  // The resolver refreshes `at` every tick, so a fresh `at` proves nothing: a
  // page whose JS hangs mid-countdown still reports dlActive every second. The
  // hold is therefore bounded from the first sighting of the countdown, not by
  // the last poll - past DL_HOLD_MS from then, the window is revealed.
  const firstSeen = at + 200;
  ok(dlGate.holdReveal({ dlActive: true, at: at + 15500 }, at + 15501, firstSeen) === false,
    "a fresh last poll cannot keep a stale countdown hidden forever");
  ok(dlGate.holdReveal({ dlActive: true, at }, at + 9001, firstSeen) === true,
    "a countdown under the ceiling still holds");
  ok(dlGate.holdReveal({ dlActive: false, at }, at + 1000) === false,
    "no progress, no hold");
  ok(dlGate.holdReveal(null, at + 1000) === false, "no poll data, no hold");
}
{
  // Countdown done: the button text changes but carries no known class; the
  // poll still has to click it.
  const result = runPoll(DL_BODY("generate"));
  eq(result.clicked, "generate", "the Generate-state button is clicked by text match");
}
{
  // Not an interstitial (old /masked/ page or the destination): the script is
  // a no-op, leaving the htmx poll and continue logic untouched.
  const result = runPoll(OTHER_BODY);
  eq(result.clicked, false, "no /dl/ controls, nothing clicked");
  eq(result.dlActive, false, "no /dl/ controls, no hold");
}

console.log(`Masked resolver checks passed (${checks} assertions)`);
