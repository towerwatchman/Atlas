"use strict";

// Tests for the client-side F95 thread download parser.
//
// Two layers:
//
//   1. Synthetic html covering the bucket state machine - dividers, group
//      inheritance, patch tracking, dedupe, screenshot/mention exclusion.
//   2. If the scraper repo's fixtures are reachable, the real captures are
//      parsed too and the results sanity-checked. Set F95_FIXTURES to point
//      at scraper/fixtures, or place the repo alongside this one.
//
// Layer 2 is the one that matters for staying in step with f95_detail.py:
// both implementations read the same files, so a divergence shows up as a
// different bucket count rather than as a silent behaviour drift months later.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  parseThreadDownloads,
  unwrap,
  isMasked,
  hostOf,
  downloadHost,
  filenameFromUrl,
  classifyType,
} = require("../electron/downloads/f95ThreadParser");

let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

check(isMasked("https://f95zone.to/masked/mega.nz/1/2/a/b/c"), "masked detected");
check(!isMasked("https://mixdrop.ag/f/abc"), "plain link is not masked");

// Host comes out of the path for masked links, and the netloc otherwise.
assert.strictEqual(hostOf("https://f95zone.to/masked/mega.nz/295876/11261704/a/b/c"), "mega.nz");
assert.strictEqual(hostOf("https://www.mediafire.com/file/abc"), "mediafire.com");
checks += 2;

assert.strictEqual(downloadHost("https://mixdrop.ag/f/l647kkz0cor9og"), "mixdrop.ag");
assert.strictEqual(downloadHost("https://f95zone.to/threads/295876/"), null);
checks += 2;

// Masked urls must survive untouched - they cannot be decoded offline.
{
  const masked = "https://f95zone.to/masked/mega.nz/1/2/sig/iv/payload";
  assert.strictEqual(unwrap(masked), masked, "masked url must not be rewritten");
  checks += 1;
}
// ?url= wrappers do carry the real destination.
assert.strictEqual(
  unwrap("https://f95zone.to/goto/link-confirmation?url=https%3A%2F%2Fmega.nz%2Ffile%2Fabc"),
  "https://mega.nz/file/abc",
);
checks += 1;

// F95 attachment filenames carry a numeric prefix that is not part of the name.
assert.strictEqual(
  filenameFromUrl("https://attachments.f95zone.to/2021/09/1410346_Walkthrough.zip"),
  "Walkthrough.zip",
);
checks += 1;

assert.strictEqual(classifyType("download", "Win/Linux", "MEGA", ""), "game");
assert.strictEqual(classifyType("download", "Win", "Walkthrough Mod", ""), "walkthrough");
assert.strictEqual(classifyType("translations", "", "", ""), "translation");
// Word boundaries: "Part 1" must not match the \bart\b wallpaper rule.
assert.strictEqual(classifyType("download", "Part 1", "MEGA", ""), "game");
checks += 4;

// ── Bucket state machine ────────────────────────────────────────────────────

const page = (inner) => `<!doctype html><html data-logged-in="true"
  data-content-key="thread-295876"><body><div class="bbWrapper">${inner}</div></body></html>`;

{
  // The shape seen on thread 295876: three hosts under each platform heading.
  const html = page(`
    <b>DOWNLOAD</b>
    <b>Win/Linux</b>
    <a href="https://f95zone.to/masked/mega.nz/295876/11261704/s/i/p">MEGA</a>
    <a href="https://f95zone.to/masked/pixeldrain.com/295876/11261704/s/i/p">PIXELDRAIN</a>
    <b>Mac</b>
    <a href="https://f95zone.to/masked/mega.nz/295876/11261704/s2/i2/p2">MEGA</a>
  `);
  const result = parseThreadDownloads(html);
  check(result.found, "bbWrapper located");
  assert.strictEqual(result.threadId, "295876");
  assert.strictEqual(result.loggedIn, true);
  assert.strictEqual(result.downloads.length, 3);
  checks += 3;

  // A group heading applies to every link after it until the next heading.
  assert.strictEqual(result.downloads[0].group, "Win/Linux");
  assert.strictEqual(result.downloads[1].group, "Win/Linux");
  assert.strictEqual(result.downloads[2].group, "Mac");
  checks += 3;

  assert.strictEqual(result.downloads[0].host, "mega.nz");
  assert.strictEqual(result.downloads[0].masked, true);
  assert.strictEqual(result.downloads[0].type, "game");
  checks += 3;
}

{
  // "DOWNLOAD Win/Linux" as one heading - the prefix must be stripped.
  const result = parseThreadDownloads(page(`
    <b>DOWNLOAD Win/Linux</b>
    <a href="https://mixdrop.ag/f/abc">MIXDROP</a>
  `));
  assert.strictEqual(result.downloads[0].group, "Win/Linux");
  assert.strictEqual(result.downloads[0].masked, false, "mixdrop links are not masked");
  checks += 2;
}

{
  // Dividers route links away from downloads.
  const result = parseThreadDownloads(page(`
    <b>Download</b><b>Win</b>
    <a href="https://mega.nz/file/game">MEGA</a>
    <b>Extras</b>
    <a href="https://mega.nz/file/wallpapers">Wallpapers</a>
    <b>Translations</b>
    <a href="https://mega.nz/file/spanish">Spanish</a>
  `));
  assert.strictEqual(result.downloads.length, 1, "only the game is a download");
  assert.strictEqual(result.extras.length, 1);
  assert.strictEqual(result.translations.length, 1);
  assert.strictEqual(result.extras[0].type, "wallpaper_art");
  assert.strictEqual(result.translations[0].type, "translation");
  checks += 5;
}

{
  // A patch heading inside the download area diverts to the patches bucket,
  // and a following "season" heading turns it back off.
  const result = parseThreadDownloads(page(`
    <b>Download</b><b>Win</b>
    <a href="https://mega.nz/file/base">MEGA</a>
    <b>Patch</b>
    <a href="https://mega.nz/file/patch1">MEGA</a>
    <b>Season 2</b>
    <a href="https://mega.nz/file/season2">MEGA</a>
  `));
  assert.strictEqual(result.downloads.length, 2, "base plus season, not the patch");
  assert.strictEqual(result.patches.length, 1);
  assert.strictEqual(result.patches[0].type, "patch");
  checks += 3;
}

{
  // Screenshots, @mentions and duplicates must all be skipped.
  const result = parseThreadDownloads(page(`
    <b>Download</b><b>Win</b>
    <a href="https://attachments.f95zone.to/2021/09/1_shot.jpg" class="js-lbImage">shot</a>
    <a href="https://f95zone.to/members/someone.123/">@someone</a>
    <a href="https://mega.nz/file/dup">MEGA</a>
    <a href="https://mega.nz/file/dup">MEGA mirror</a>
    <a href="https://f95zone.to/threads/other/">see also</a>
  `));
  assert.strictEqual(result.downloads.length, 1, "image, mention, dupe and thread link all skipped");
  checks += 1;
}

{
  // No first-post body at all - must degrade quietly, not throw.
  const result = parseThreadDownloads("<html><body><p>nothing here</p></body></html>");
  assert.strictEqual(result.found, false);
  assert.strictEqual(result.downloads.length, 0);
  checks += 2;
}
{
  const result = parseThreadDownloads("");
  assert.strictEqual(result.found, false);
  checks += 1;
}

// ── Real fixtures, when reachable ───────────────────────────────────────────

const fixtureDir = process.env.F95_FIXTURES || path.resolve(
  __dirname, "..", "..", "atlas-gamedb", "scraper", "fixtures");

if (fs.existsSync(fixtureDir)) {
  const files = fs.readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".html") && !name.startsWith("lc_"));
  console.log(`\nParsing ${files.length} real fixture(s) from ${fixtureDir}`);
  for (const name of files) {
    const html = fs.readFileSync(path.join(fixtureDir, name), "utf8");
    const result = parseThreadDownloads(html);
    const masked = result.downloads.filter((link) => link.masked).length;
    console.log(`  ${name.padEnd(32)} downloads=${String(result.downloads.length).padStart(3)}`
      + ` masked=${String(masked).padStart(3)}`
      + ` extras=${String(result.extras.length).padStart(2)}`
      + ` patches=${String(result.patches.length).padStart(2)}`
      + ` loggedIn=${result.loggedIn}`);

    // A logged-in capture must yield links; a logged-out one must not yield
    // masked links, since F95 does not render them for guests.
    if (name.includes("loggedout")) {
      check(masked === 0, `${name}: guests must not see masked links`);
    }
    for (const link of result.downloads) {
      check(Boolean(link.url), `${name}: every link has a url`);
      check(Boolean(link.host), `${name}: every link has a host`);
    }
  }
} else {
  console.log(`\n(skipping real fixtures - not found at ${fixtureDir})`);
  console.log("  set F95_FIXTURES to the scraper's fixtures directory to enable");
}

console.log(`\nThread parser checks passed (${checks} assertions)`);
