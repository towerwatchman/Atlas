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
  isNonDownloadHost,
} = require("../electron/downloads/f95ThreadParser");
const { selectDownloadableLinks } = require("../electron/downloads/groupClassifier");

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
// The browser decodes a bare & written as &amp; in the href attribute; this
// string is what the resolver loads instead, so the escape must be undone or
// every query token after the first arrives as a nonsense "amp;..." name.
assert.strictEqual(
  unwrap("https://f95zone.to/dl/598927/?u=45151&amp;k=x&amp;t=y"),
  "https://f95zone.to/dl/598927/?u=45151&k=x&t=y",
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

  // A heading applies to every link after it until the next one. What CHANGED
  // here: "Win/Linux" is a platform-only bold, so it now sets `platform` and
  // leaves `group` empty rather than becoming the build's name. These three
  // links are the whole game with nothing further said about it, which the
  // display layer names "Full Archive" - and the Mac links are a different
  // platform of the same build, not a different build.
  assert.strictEqual(result.downloads[0].group, "");
  assert.strictEqual(result.downloads[1].group, "");
  assert.strictEqual(result.downloads[2].group, "");
  assert.strictEqual(result.downloads[0].platform, "Win/Linux");
  assert.strictEqual(result.downloads[1].platform, "Win/Linux");
  assert.strictEqual(result.downloads[2].platform, "Mac");
  checks += 6;

  assert.strictEqual(result.downloads[0].host, "mega.nz");
  assert.strictEqual(result.downloads[0].masked, true);
  assert.strictEqual(result.downloads[0].type, "game");
  checks += 3;
}

{
  // A poster wrapped the " - " mirror separator in
  // its own bold. A bold that is only separator punctuation is decoration,
  // not a build heading: it must neither end the current build nor clear the
  // platform. Filed every mirror after the dash under a junk build named "-"
  // and left Full Archive with the single mirror that preceded it.
  const result = parseThreadDownloads(page(`
    <b>DOWNLOAD</b>
    <b>Win/Linux</b>
    <a href="https://f95zone.to/dl/598927/?u=45151&amp;k=d8624d9b00d7&amp;r=1792649814&amp;t=peKLZ2fKKguzZ9Hs" target="_blank" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/gofile.io.ico&quot;);">GOFILE</a>
    <b> - </b>
    <a href="https://f95zone.to/dl/598927/?u=45151&amp;k=a4545594cc74&amp;r=1792649814&amp;t=00TBBPg03KE641Qn" target="_blank" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/mega.nz.ico&quot;);">MEGA</a>
    <b>Mac</b>
    <a href="https://f95zone.to/dl/598927/?u=45151&amp;k=2fb369ef5745&amp;r=1792649814&amp;t=a4xmtb938CcIzvxp" target="_blank" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/mega.nz.ico&quot;);">MEGA</a>
  `));
  check(result.downloads.length === 3, "separator bold must not split the row");
  checks += 1;
  assert.strictEqual(result.downloads[0].group, "");
  assert.strictEqual(result.downloads[1].group, "", "a bold only a dash is not a build name");
  assert.strictEqual(result.downloads[2].group, "");
  checks += 3;
  assert.strictEqual(result.downloads[1].platform, "Win/Linux");
  assert.strictEqual(result.downloads[2].platform, "Mac");
  checks += 2;
  // The href leaves the parser on its way to the resolve window; a mint where
  // the & survives written as &amp; is rejected by the interstitial page.
  assert.strictEqual(
    result.downloads[0].url,
    "https://f95zone.to/dl/598927/?u=45151&k=d8624d9b00d7&r=1792649814&t=peKLZ2fKKguzZ9Hs",
  );
  checks += 1;
}

{
  // Compressed-row shape: the bold is only "Win/Linux" and
  // the variant qualifier "(Compressed):" is a text node AFTER it. That text
  // is part of the heading: read, the compressed mirrors are the poster's own
  // build section; ignored, they merged into the unlabeled row above as if
  // the compressed build did not exist.
  const result = parseThreadDownloads(page(`
    <b>DOWNLOAD</b>
    <b>Win/Linux</b>
    <a href="https://f95zone.to/dl/598927/?u=45151&amp;k=d8624d9b00d7&amp;r=1792649814&amp;t=peKLZ2fKKguzZ9Hs" target="_blank" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/gofile.io.ico&quot;);">GOFILE</a>
    <b>Win/Linux </b>(Compressed):
    <a href="https://f95zone.to/dl/598927/?u=45151&amp;k=3a1455b8ad4d&amp;r=1792649814&amp;t=DXazrvUTIX33TPHA" target="_blank" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/mega.nz.ico&quot;);">MEGA</a>
  `));
  check(result.downloads.length === 2, "full and compressed rows both parse");
  checks += 1;
  assert.strictEqual(result.downloads[0].group, "");
  assert.strictEqual(result.downloads[0].platform, "Win/Linux");
  // The row above owns its label; the qualifier rides on the platform row as
  // its section name, without the parenthesis and trimmed.
  assert.strictEqual(result.downloads[1].group, "Win/Linux Compressed");
  assert.strictEqual(result.downloads[1].platform, "Win/Linux");
  checks += 2;
}

{
  // Variant-stacked layout: the qualifier is INSIDE the bold and the
  // poster stacks variants of the same build with one row per platform. A bare
  // qualifier label ("(Heavy)", "(Lite)") collapsed the two Lite rows - one
  // for Win/Linux, one for Mac - into a single jumbled section, so the label
  // repeats what the qualifier rides on: platform + qualifier.
  const result = parseThreadDownloads(page(`
    <b>DOWNLOAD</b>
    <b>Win/Linux (Heavy)</b>: <a href="https://gofile.io/d/a1">GOFILE</a> - <a href="https://pixeldrain.com/u/a2">PIXELDRAIN</a> - <a href="https://mega.nz/file/a3">MEGA</a>
    <b>Win/Linux (Lite)</b>: <a href="https://mega.nz/file/b1">MEGA</a> - <a href="https://pixeldrain.com/u/b2">PIXELDRAIN</a>
    <b>Mac (Lite)</b>: <a href="https://mega.nz/file/c1">MEGA</a> - <a href="https://pixeldrain.com/u/c2">PIXELDRAIN</a>
  `));
  assert.strictEqual(result.downloads[0].group, "Win/Linux Heavy");
  assert.strictEqual(result.downloads[0].platform, "Win/Linux");
  assert.strictEqual(result.downloads[3].group, "Win/Linux Lite");
  assert.strictEqual(result.downloads[3].platform, "Win/Linux");
  // Same qualifier, different platform row: a separate section, not a merge.
  assert.notStrictEqual(result.downloads[5].group, result.downloads[3].group);
  assert.strictEqual(result.downloads[5].group, "Mac Lite");
  assert.strictEqual(result.downloads[5].platform, "Mac");
  checks += 6;
}

{
  // Site-styled row: the qualifier text lives in its own
  // font-size <span> AFTER the bold, and the bold itself wraps a span. The
  // old tail reader stopped at the span tag, so the qualifier was lost: every
  // row then inherited the previous build's label and the dl id + host keys
  // collided, silently dropping the entire Win/Linux (Lite) row.
  const result = parseThreadDownloads(page(`
    <b><span style="font-size: 22px"><b>DOWNLOAD</b></span></b>
    <span style="font-size: 18px"><b>Win/Linux</b> (Heavy): <a href="https://f95zone.to/dl/1878/?u=45151&amp;k=ka1&amp;r=1&amp;t=t" target="_blank" class="link link--external has-favicon" rel="nofollow noopener" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/gofile.io.ico&quot;);">GOFILE</a> - <a href="https://f95zone.to/dl/1878/?u=45151&amp;k=ka2&amp;r=1&amp;t=t" target="_blank" class="link link--external has-favicon" rel="nofollow noopener" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/pixeldrain.com.ico&quot;);">PIXELDRAIN</a> - <a href="https://f95zone.to/dl/1878/?u=45151&amp;k=ka3&amp;r=1&amp;t=t" target="_blank" class="link link--external has-favicon" rel="nofollow noopener" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/mega.nz.ico&quot;);">MEGA</a></span>
    <b><span style="font-size: 18px">Win/Linux</span></b><span style="font-size: 18px"> (Lite): <a href="https://f95zone.to/dl/1878/?u=45151&amp;k=kb1&amp;r=1&amp;t=t" target="_blank" class="link link--external has-favicon" rel="nofollow noopener" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/gofile.io.ico&quot;);">GOFILE</a> - <a href="https://f95zone.to/dl/1878/?u=45151&amp;k=kb2&amp;r=1&amp;t=t" target="_blank" class="link link--external has-favicon" rel="nofollow noopener" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/mega.nz.ico&quot;);">MEGA</a> - <a href="https://f95zone.to/dl/1878/?u=45151&amp;k=kb3&amp;r=1&amp;t=t" target="_blank" class="link link--external has-favicon" rel="nofollow noopener" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/pixeldrain.com.ico&quot;);">PIXELDRAIN</a></span>
    <b><span style="font-size: 18px">Mac</span></b><span style="font-size: 18px"> (Lite): </span><a href="https://f95zone.to/dl/1878/?u=45151&amp;k=kc1&amp;r=1&amp;t=t" target="_blank" class="link link--external has-favicon" rel="nofollow noopener" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/mega.nz.ico&quot;);"><span style="font-size: 18px">MEGA</span></a><span style="font-size: 18px"> - <a href="https://f95zone.to/dl/1878/?u=45151&amp;k=kc2&amp;r=1&amp;t=t" target="_blank" class="link link--external has-favicon" rel="nofollow noopener" style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/pixeldrain.com.ico&quot;);">PIXELDRAIN</a></span>
  `));
  // Eight anchors: three per platform row plus the Mac row's two. The two
  // Lites must survive AND carry their own labels - same id + same hosts as
  // the Heavy row, so any inherited label is a dedupe collision that deletes
  // the links.
  assert.strictEqual(result.downloads.length, 8, "all three rows parse");
  checks += 1;
  assert.strictEqual(result.downloads[0].group, "Win/Linux Heavy");
  assert.strictEqual(result.downloads[1].group, "Win/Linux Heavy");
  assert.strictEqual(result.downloads[2].group, "Win/Linux Heavy");
  assert.strictEqual(result.downloads[3].group, "Win/Linux Lite");
  assert.strictEqual(result.downloads[3].platform, "Win/Linux");
  assert.strictEqual(result.downloads[5].group, "Win/Linux Lite");
  assert.strictEqual(result.downloads[5].platform, "Win/Linux");
  // The Mac row carries its own qualifier row, so its label is its own.
  const macRows = result.downloads.filter((dl) => dl.group === "Mac Lite");
  assert.strictEqual(macRows.length, 2, "the Mac row keeps its own label");
  assert.strictEqual(macRows[0].platform, "Mac");
  checks += 9;
}

{
  // "DOWNLOAD Win/Linux" as one heading - the prefix must be stripped.
  const result = parseThreadDownloads(page(`
    <b>DOWNLOAD Win/Linux</b>
    <a href="https://mixdrop.ag/f/abc">MIXDROP</a>
  `));
  // Same split: the stripped remainder is a platform, so it lands on `platform`.
  assert.strictEqual(result.downloads[0].group, "");
  assert.strictEqual(result.downloads[0].platform, "Win/Linux");
  assert.strictEqual(result.downloads[0].masked, false, "mixdrop links are not masked");
  checks += 3;
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

// ── Build headings, from the structures observed on real threads ────────────
//
// Every case below is a <br>-stacked bold recorded in the session handoff with
// its observed-vs-wanted label. These assertions FAIL against the flatten-first
// parser, which is the only thing that makes them worth having: stripTags
// deletes <br>, so "Season 1<br>1080p<br>Win/Linux" arrived as one string and
// one string could not be both a build label and a platform.

const wrapBody = (inner) =>
  `<html data-logged-in="true" data-content-key="thread-95982">` +
  `<div class="bbWrapper">${inner}</div></html>`;
const mirror = (n) => `<a href="https://f95zone.to/masked/mega.nz/1/2/s/i/p${n}">MEGA</a>`;

{
  // Quality lines and DLC rows beneath one platform bold: four rows, all four
  // wrong before this.
  const parsed = parseThreadDownloads(wrapBody(`
    <b>DOWNLOAD</b>
    <b>Season 2 Final</b>
    <b>4K<br>Win/Linux/Mac</b>            ${mirror(1)}
    <b>Season 1<br>1080p<br>Win/Linux</b> ${mirror(2)}
    <b>720p<br>Win/Linux</b>              ${mirror(3)}
    <b>Chloe's: Desire Express DLC</b>
    <b>Win/Linux/Mac</b>                  ${mirror(4)}
    <b>Julia in Japan DLC</b>
    <b>Win/Linux/Mac</b>                  ${mirror(5)}
  `));

  assert.deepStrictEqual(
    parsed.downloads.map((link) => link.group),
    [
      // A platform-only bold no longer erases the build above it.
      "Season 2 Final 4K",
      "Season 1 1080p",
      // 720p inherits "Season 1" and REPLACES 1080p rather than stacking on it.
      "Season 1 720p",
      // Two DLCs under one shared "Win/Linux/Mac" stay two builds.
      "Chloe's: Desire Express DLC",
      "Julia in Japan DLC",
    ],
    "FreshWomen build labels",
  );
  assert.deepStrictEqual(
    parsed.downloads.map((link) => link.platform),
    ["Win/Linux/Mac", "Win/Linux", "Win/Linux", "Win/Linux/Mac", "Win/Linux/Mac"],
    "FreshWomen platforms, as their own axis",
  );
  checks += 2;
}

{
  // doc 5. "Update Only" is a partial update; offered as a full game with
  // on_complete: 'replace' it would delete a working install and leave a
  // fragment. The old test was heading.includes("patch"), which never matched.
  const parsed = parseThreadDownloads(wrapBody(`
    <b>DOWNLOAD</b>
    <b>v0.9 Full<br>Win/Linux</b>   ${mirror(1)}
    <b>Update Only<br>Win/Linux</b> ${mirror(2)}
  `));
  assert.deepStrictEqual(parsed.downloads.map((l) => l.group), ["v0.9 Full"],
    "Update Only is not offered as a download");
  assert.deepStrictEqual(parsed.patches.map((l) => l.group), ["Update Only"],
    "Update Only is bucketed as a patch");
  checks += 2;
}

{
  // A "Split" bold followed by bare mirrors. Nothing said "Part 1", so the
  // multi-part detector had nothing to match and every fragment was offered as a
  // whole game. Split is a KIND now, and KIND outranks platform.
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><b>Split<br>Win</b>${mirror(1)}${mirror(2)}`));
  const selection = selectDownloadableLinks(parsed.downloads, { platform: "win32" });
  check(selection.singles.length === 0, "a Split heading offers nothing");
  check(selection.rejected.every((entry) => entry.verdict.kind === "split"),
    "Split is refused on kind, not on platform");
}

{
  // Patch tracking hangs off the BUILD line. A bare platform bold says nothing
  // about whether the section is a patch, and re-deciding on it is how the old
  // substring test flip-flopped mid-section.
  const parsed = parseThreadDownloads(wrapBody(`
    <b>DOWNLOAD</b>
    <b>Patch v3</b>
    <b>Win/Linux</b> ${mirror(1)}
    <b>Win/Mac</b>   ${mirror(2)}
  `));
  check(parsed.downloads.length === 0, "a platform bold does not end a patch section");
  check(parsed.patches.length === 2, "both mirrors stay in the patch bucket");
}

{
  // A build heading with no links directly beneath it is SKIPPED - the next
  // heading wins. The fixture's "Season 1&2 + DLCs" is the case, pinned
  // deliberately rather than left incidental.
  //
  // It is also, for now, a bare "DLC" heading - where the wanted answer was
  // "DLC: Valentine". Those two cases are structurally identical and the handoff
  // gave them opposite answers, so prefixing has to be decided on MEANING.
  // Prefixing only a generic parent would give both answers for the FIRST child
  // and then get every sibling after it wrong: "Voidseeker" arriving after links
  // is indistinguishable from a new top-level "Season 3 - 64%" arriving after
  // links, and only container nesting separates them. walkElements is flat by
  // design, so persistent parent scope is not knowable here - which makes the
  // prefix question and the nesting question ONE question, not two.
  const parsed = parseThreadDownloads(wrapBody(`
    <b>DOWNLOAD</b>
    <b>Season 1&amp;2 + DLCs</b>
    <b>Season 2 Final<br>Win/Linux</b> ${mirror(1)}
  `));
  assert.deepStrictEqual(parsed.downloads.map((l) => l.group), ["Season 2 Final"],
    "a heading with no links beneath it is skipped");
  checks += 1;
}

{
  // Builds refused on platform are counted, not dropped in silence. A thread
  // that visibly has downloads while Atlas shows none of them has to say why.
  const parsed = parseThreadDownloads(wrapBody(`
    <b>DOWNLOAD</b>
    <b>Season 2<br>Win/Linux</b> ${mirror(1)}
    <b>Season 2<br>Mac</b>       ${mirror(2)}
  `));
  const selection = selectDownloadableLinks(parsed.downloads, { platform: "win32" });
  check(selection.singles.length === 1, "the usable build is offered");
  check(selection.hiddenPlatform.links === 1, "the Mac build is counted as hidden");
  check(selection.hiddenPlatform.platforms.includes("mac"), "and names the platform");
  // A kind rejection must not be counted as a platform rejection.
  const withPatch = selectDownloadableLinks(
    [{ group: "Update Only", platform: "Win", host: "mega.nz", url: "x" }],
    { platform: "win32" });
  check(withPatch.hiddenPlatform.links === 0,
    "a patch is not reported as hidden on platform");
}

{
  // A <b> nested inside a <b>. Being a Wife's download heading is literally
  // `<b><span>DOWNLOAD</span><br><span>Win/<b>Linux</b></span></b>`: the outer
  // bold resolved the platform to "Win/Linux" and the inner bold then re-ran on
  // its own and reduced it to "Linux". Every Windows build on that thread was
  // labelled Linux-only, and the modal filtered them all out on a Windows box.
  const parsed = parseThreadDownloads(wrapBody(
    `<b><span>DOWNLOAD</span><br><span>Win/<b>Linux</b></span></b>${mirror(1)}`));
  assert.deepStrictEqual(parsed.downloads.map((l) => l.platform), ["Win/Linux"],
    "a nested bold does not clobber the platform its parent set");
  checks += 1;
}

{
  // The SIBLING case, which the nested guard above does not cover. LA: Streets
  // of Sorcery (thread 265629) writes `<b>Win</b>/<b>Linux</b>: <a>...</a>`, two
  // bolds joined by a slash. Each ran applyHeadingLines separately and the
  // second REPLACED the platform, so the only Windows-capable build in the post
  // was labelled Linux-only and every one of its mirrors failed the platform
  // filter. Fifteen live links, an empty modal, and no message saying why.
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br /><b>Win</b>/<b>Linux</b>: ${mirror(1)}`));
  assert.deepStrictEqual(parsed.downloads.map((l) => l.platform), ["Win/Linux"],
    "sibling bolds joined by a separator are one heading");
  assert.deepStrictEqual(parsed.downloads.map((l) => l.group), [""],
    "and the merged platform line is still a platform, not a build label");
  checks += 2;

  // Proof the merge is what did it: on a Windows box the build now survives
  // selection. Before, all of it was rejected as "targets linux".
  const selection = selectDownloadableLinks(parsed.downloads, { platform: "win32" });
  check(selection.singles.length === 1, "a Win/Linux build is offerable on Windows");
  check(selection.hiddenPlatform.links === 0, "and is not counted as hidden");
}

{
  // WHITESPACE IS NOT GLUE. `<b>Season 2</b> <b>Win/Linux</b>` renders on one
  // line too, but those are two headings - a build and a platform - and merging
  // them rebuilds the single mixed "Season 2 Win/Linux" string that headingLines
  // was written to eliminate. Only a separator the poster typed counts.
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br /><b>Season 2</b> <b>Win/Linux</b> ${mirror(1)}`));
  assert.deepStrictEqual(parsed.downloads.map((l) => `${l.group}|${l.platform}`),
    ["Season 2|Win/Linux"],
    "a space between bolds keeps the build and platform on separate axes");
  checks += 1;
}

{
  // An <a> in the gap ends the run: the first heading has already produced a
  // link, so the second bold opens a new one. Merging across it would give the
  // Mac mirror the label "Win/Mac" and offer a Mac build to a Windows user.
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br /><b>Win</b>: ${mirror(1)} - <b>Mac</b>: ${mirror(2)}`));
  assert.deepStrictEqual(parsed.downloads.map((l) => l.platform), ["Win", "Mac"],
    "a link in the gap breaks the bold run");
  checks += 1;
}

{
  // A <br> in the gap is a line break by definition, separator or not.
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br /><b>Season 1</b>-<br /><b>Win/Linux</b> ${mirror(1)}`));
  assert.deepStrictEqual(parsed.downloads.map((l) => `${l.group}|${l.platform}`),
    ["Season 1|Win/Linux"],
    "a <br> in the gap is never glue");
  checks += 1;
}

{
  // Merging happens on HTML, so the <br> split inside the merged run still
  // works: the build line survives and only the platform line is joined.
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br /><b>Season 1<br>Win</b>/<b>Linux</b> ${mirror(1)}`));
  assert.deepStrictEqual(parsed.downloads.map((l) => `${l.group}|${l.platform}`),
    ["Season 1|Win/Linux"],
    "merging a bold run does not flatten the lines inside it");
  checks += 1;
}

{
  // Three-level nesting, from Being a DIK. Before the part axis, "Part 1" was an
  // unrecognised line and therefore a BUILD: it replaced "SPLIT-S3" and cleared
  // "Win/Linux", so the Win/Linux Part 1 and the Mac Part 1 were identical
  // records. Twenty split links arrived as ten indistinguishable pairs.
  const parsed = parseThreadDownloads(wrapBody(`
    <b>DOWNLOAD</b>
    <b>SPLIT-S3</b>
    <b>Win/Linux</b>
      <b><b>.zip</b></b> ${mirror(1)}
      <b>Part 1</b>      ${mirror(2)}
      <b>Part 2</b>      ${mirror(3)}
    <b>Mac</b>
      <b>Part 1</b>      ${mirror(4)}
      <b>Part 2</b>      ${mirror(5)}
  `));
  assert.deepStrictEqual(
    parsed.downloads.map((l) => `${l.group}|${l.platform}|${l.part ? (l.part.whole ? "zip" : l.part.index) : "-"}`),
    ["SPLIT-S3|Win/Linux|zip", "SPLIT-S3|Win/Linux|1", "SPLIT-S3|Win/Linux|2",
     "SPLIT-S3|Mac|1", "SPLIT-S3|Mac|2"],
    "fragments inherit the build and platform they hang under",
  );
  checks += 1;

  const selection = selectDownloadableLinks(parsed.downloads, { platform: "win32" });
  // The .zip is a complete archive listed beside the parts - a single, not a
  // sixth member of the set.
  check(selection.singles.length === 1, "the unsplit .zip stays a single option");
  check(selection.offerableSets.length === 1, "the Win/Linux parts form ONE offerable set");
  check(selection.offerableSets[0].parts.length === 2, "with both of its parts");
  check(selection.offerableSets[0].platform === "Win/Linux",
    "and the Mac set is not merged into it");
  // A "SPLIT" heading no longer refuses links the parser has already identified.
  check(selection.rejected.every((entry) => entry.verdict.kind !== "split"),
    "an explicit fragment is not re-refused by the split heading marker");
}

{
  // An incomplete set is still withheld: a missing part fetches fine and then
  // fails to extract, after the bytes have already been spent.
  const parsed = parseThreadDownloads(wrapBody(`
    <b>DOWNLOAD</b><b>Build</b><b>Win</b>
    <b>Part 1</b> ${mirror(1)}
    <b>Part 3</b> ${mirror(2)}
  `));
  const selection = selectDownloadableLinks(parsed.downloads, { platform: "win32" });
  check(selection.offerableSets.length === 0, "a set with a gap is not offered");
  check(selection.hiddenMultiPart.sets === 1, "and is reported as hidden");
}

{
  // Hosts are decided by a deny-list now. These two captures alone contributed
  // four working mirrors that the old allow-list dropped in silence.
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><b>Win</b>` +
    `<a href="https://krakenfiles.com/view/abc/file.html">KRAKENFILES</a>` +
    `<a href="https://dropmefiles.com/xyz">DROPMEFILES</a>` +
    `<a href="https://www.patreon.com/someone">Patreon</a>` +
    `<a href="https://store.steampowered.com/app/1/">Steam</a>` +
    `<a href="https://f95zone.to/threads/other.123/post-9">COMPRESSED</a>`));
  assert.deepStrictEqual(parsed.downloads.map((l) => l.label),
    ["KRAKENFILES", "DROPMEFILES"],
    "unknown file hosts are kept; funding, store and in-thread links are not");
  checks += 1;
}

{
  // The overview above the downloads is full of ordinary links. None of them are
  // files, and the deny-list must not start accepting them just because they are
  // not on it.
  const parsed = parseThreadDownloads(wrapBody(
    `<a href="https://f95zone.to/threads/acting-lessons.1/">Acting Lessons</a>` +
    `<a href="https://example.com/dev-blog">Dev blog</a>` +
    `<b>DOWNLOAD</b><b>Win</b>${mirror(1)}`));
  check(parsed.downloads.length === 1,
    "links above the download heading are not treated as mirrors");
}

{
  // F95's link guard re-serves every external mirror as its own redirect:
  // `https://f95zone.to/dl/<postId>/?u=<user>&k=<sig>&r=<ts>&t=<token>`. The
  // destination is no longer in the href (it is minted server-side per
  // account), but the anchor still says what it points at: XenForo's
  // has-favicon embeds the destination domain in the style attribute, and the
  // visible label names the host. The first bzzhr anchor here is the route
  // copy wrapped in a hidden no-quote span - same dl id and host, different
  // k/t mint. The walker marks the hidden copy structurally, so the visible
  // twin (the one the poster wrote and the page shows) is what survives.
  const dl = (t, style, label) =>
    `<a href="https://f95zone.to/dl/21960808/?u=45151&k=5fbe367c8e88&r=1792644872&t=${t}"`
    + (style ? ` style="background-image: url(&quot;${style}&quot;);"` : "")
    + `>${label}</a>`;
  const dlBody = `<b>DOWNLOAD</b><br /><b>Win</b>: `
    + `<span class="u-hidden js-noSelectToQuote">`
    + dl("A", "https://external-content.duckduckgo.com/ip3/bzzhr.to.ico", "BZZHR")
    + `</span>`
    + dl("B", "https://external-content.duckduckgo.com/ip3/bzzhr.to.ico", "BUZZHEAVIER") + ` - `
    + dl("C", "https://external-content.duckduckgo.com/ip3/datanodes.to.ico", "DATANODES") + ` - `
    + dl("D", "", "MYSTERY");

  // A /dl/ url is a real mirror, not an in-thread pointer. The two shapes the
  // deny-list exists for stay denied.
  check(isNonDownloadHost("https://f95zone.to/dl/21960808/?u=45151&k=x&r=1&t=y") === false,
    "a /dl/ redirect is a mirror");
  check(isNonDownloadHost("https://f95zone.to/goto/post?id=1"),
    "/goto/ post pointers stay denied");
  check(isNonDownloadHost("https://f95zone.to/threads/nemesis.298432/"),
    "in-thread links stay denied");
  check(isNonDownloadHost("https://f95zone.com/threads/save-request.15428/"),
    "the forum's alternate domain is a pointer too");
  checks += 4;

  const parsed = parseThreadDownloads(wrapBody(dlBody));
  assert.deepStrictEqual(
    parsed.downloads.map((l) => `${l.host}|${l.label}`),
    ["bzzhr.to|BUZZHEAVIER", "datanodes.to|DATANODES", "f95zone.to|MYSTERY"],
    "/dl/ anchors become mirrors; the hidden copy is skipped so the visible twin survives; no favicon degrades",
  );
  checks += 1;
  check(parsed.downloads.every((l) => l.masked), "every /dl/ mirror must resolve in a browser");
  check(parsed.downloads[0].url.includes("t=B"),
    "the visible twin's url survives verbatim");
  checks += 2;

  // The recovered hosts drive selection exactly like a /masked/ link's host
  // did: buzzheavier is offered, a host with no plugin shows as unsupported,
  // and the unresolvable one does not crash the classifier.
  const selection = selectDownloadableLinks(parsed.downloads, {
    platform: "win32",
    supportedHosts: new Set(["pixeldrain", "buzzheavier", "bzzhr", "mega", "gofile"]),
  });
  check(selection.singles.length === 1, "the bzzhr mirror is offerable");
  check(selection.singles[0].link.host === "bzzhr.to");
  check(selection.unsupportedHost.some((e) => /^no plugin for datanodes/.test(e.verdict.reason)),
    "datanodes surfaces as unsupported, not missing");
  check(selection.unsupportedHost.some((e) => /^no plugin for f95zone/.test(e.verdict.reason)),
    "the favicon-less mirror degrades to an unsupported row too");
  checks += 4;
}

{
  // The hidden copy re-serves the row verbatim, and the styled rows are full of
  // font-size spans. A non-hidden span closing inside the copy must not
  // un-hide the anchors around it, and a copy bold that sits after such a
  // close must stay hidden - it would otherwise file the row under a junk
  // section named after the copy text.
  const dl = (t, label) =>
    `<a href="https://f95zone.to/dl/21960808/?u=45151&k=a&r=1&t=${t}"`
    + ` style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/gofile.io.ico&quot;);">`
    + `${label}</a>`;

  // Styled row inside the copy: bold-with-span, then a sibling span holding
  // the anchors. The second anchor and the visible one sit after the sibling's
  // close, so only properly paired open/close tracking keeps them hidden.
  const copySiblings = `<span class="u-hidden js-noSelectToQuote">`
    + `<b><span style="font-size: 18px">Mac</span></b>`
    + `<span style="font-size: 18px"> (Heavy): ${dl("H1", "GOFILE")} - ${dl("H2", "MEGA")}</span>`
    + `</span>`;
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br /><b>Win</b>: ` + copySiblings + dl("V", "GOFILE"),
  ));
  assert.deepStrictEqual(
    parsed.downloads.map((l) => `${l.host}|${l.label}|${l.group}`),
    ["gofile.io|GOFILE|"],
    "a sibling span inside the copy must not un-hide the copy's anchors",
  );
  checks += 1;

  // Junk bold in the copy, positioned after a font-size span close: the heading
  // state must not see it, so the visible anchor stays Full Archive.
  const copyBold = `<span class="u-hidden js-noSelectToQuote">`
    + `<span style="font-size: 18px">note</span><b>JUNK BUILD</b></span>`;
  const parsedBold = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br />` + copyBold + dl("V", "GOFILE"),
  ));
  check(parsedBold.downloads.length === 1, "the copy behind a closed span is skipped");
  assert.strictEqual(parsedBold.downloads[0].group, "",
    "a copy bold reached through a closed span must not become the section name");
  checks += 2;

  // A separator beside the hidden copy must not glue a copy bold onto a real
  // bold: merged flags come from the first bold, so copy-first swallows the
  // real heading and real-first carries copy text into it. Merging is for two
  // real bolds only.
  const copied = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br />`
    + `<span class="u-hidden js-noSelectToQuote"><b>Win</b></span> - <b>Linux</b>: `
    + dl("V", "GOFILE"),
  ));
  check(copied.downloads.length === 1, "the copy bold does not swallow the real heading's links");
  assert.strictEqual(copied.downloads[0].platform, "Linux",
    "a copy bold behind separator glue must not drop the real heading");
  assert.strictEqual(copied.downloads[0].group, "", "the real heading stays Full Archive");
  checks += 3;

  const polluted = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br />`
    + `<b>Win</b>/<span class="u-hidden js-noSelectToQuote"><b>Mac</b></span>`
    + `: ` + dl("V", "GOFILE"),
  ));
  assert.strictEqual(polluted.downloads[0].platform, "Win",
    "a copy bold must not merge into a visible heading");
  checks += 1;
}

{
  // A split archive: several real files on ONE host written in one row. Each
  // anchor carries its own k/t mint, so a dedupe key of dl-id+host+row collapses
  // parts 2..n and the download would extract 1 of 5 parts. The hidden no-quote
  // copy that the key was built for is marked structurally instead, so the
  // parts survive verbatim while the hidden copies stay out.
  const split = (t, label) =>
    `<a href="https://f95zone.to/dl/21960808/?u=45151&k=5fbe367c8e88&r=1792644872&t=${t}"`
    + ` style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/mega.nz.ico&quot;);"`
    + `>${label}</a>`;
  const parts = [1, 2, 3, 4, 5].map((n) => split(`p${n}`, `MEGA p${n}`)).join(" - ");
  const hiddenTwin = `<span class="u-hidden js-noSelectToQuote">`
    + `<b>Win</b>: ` + [1, 2].map((n) => split(`p${n}`, `MEGA p${n}`)).join(" - ") + `</span>`;

  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br /><b>Win</b>: ` + parts + ` ` + hiddenTwin,
  ));
  assert.deepStrictEqual(
    parsed.downloads.map((l) => l.label),
    ["MEGA p1", "MEGA p2", "MEGA p3", "MEGA p4", "MEGA p5"],
    "five parts on one host survive; the hidden no-quote copy stays out",
  );
  checks += 1;
}

{
  // Fallback for an anchor whose favicon lookup never happened: the poster's own
  // label names the host. Matched against each DOWNLOAD_HOSTS entry's first
  // segment; a bare alias (mixdrop) wins outright, and among dotted entries with
  // the same segment the last in list order wins. No entry: stays degraded.
  const named = `<b>DOWNLOAD</b><br /><b>Win</b>: `
    + `<a href="https://f95zone.to/dl/21960808/?u=45151&k=a&r=1&t=E">DATANODES</a> - `
    + `<a href="https://f95zone.to/dl/21960808/?u=45151&k=b&r=1&t=F">MIXDROP</a> - `
    + `<a href="https://f95zone.to/dl/21960808/?u=45151&k=c&r=1&t=G">MYSTERY</a>`;
  const parsed = parseThreadDownloads(wrapBody(named));
  assert.deepStrictEqual(
    parsed.downloads.map((l) => l.host),
    // MIXDROP exists under several domains and the label cannot say which -
    // the bare alias entry reports it as unsupported rather than guessing a
    // specific one.
    ["datanodes.to", "mixdrop", "f95zone.to"],
    "label recovery names the entry whose first label matches; otherwise degrade",
  );
  checks += 1;
}

{
  const dl = (t, style, label) =>
      `<a href="https://f95zone.to/dl/2434/?u=45151&k=e5821f3ddd04&r=1792647564&t=${t}"`
    + (style ? ` style="background-image: url(&quot;${style}&quot;);"` : "")
    + `>${label}</a>`;

  // XenForo turns the favicon into a full-host name when the mirror lives on a
  // www domain: a mirrored www host serves `ip3/www.mediafire.com.ico`.
  // Without stripping the prefix the classifier would report "no plugin for
  // www" - it names plugins by their dot-split first segment.
  const parsed = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br /><b>Win</b>: `
    + dl("H", "https://external-content.duckduckgo.com/ip3/www.mediafire.com.ico", "MEDIAFIRE"),
  ));
  assert.deepStrictEqual(
    parsed.downloads.map((l) => l.host),
    ["mediafire.com"],
    "a www. favicon recovers the bare host",
  );
  checks += 1;

  // The dl id is the post's, so every platform row shares it: deduping on
  // id+host alone would fold the Mac row into the Win entry and a macOS user
  // would see the mirror vetoed as "Win/Linux". The row's platform is part of
  // the key; the host minted identically across rows (one k/t pair on GOFILE,
  // as in the real post) already collapses through the plain URL dedupe.
  const row = (p, tDn, tGo) => `<b>${p}</b>: `
    + dl(tDn, "https://external-content.duckduckgo.com/ip3/datanodes.to.ico", "DATANODES") + ` - `
    + dl(tGo, "https://external-content.duckduckgo.com/ip3/gofile.io.ico", "GOFILE");
  const cross = parseThreadDownloads(wrapBody(
    `<b>DOWNLOAD</b><br />` + row("Win/Linux", "w1", "w6iw") + `<br />` + row("Mac", "m1", "w6iw"),
  ));
  assert.deepStrictEqual(
    cross.downloads.map((l) => `${l.host}|${l.label}|${l.platform}`),
    [
      "datanodes.to|DATANODES|Win/Linux",
      "gofile.io|GOFILE|Win/Linux",
      "datanodes.to|DATANODES|Mac",
    ],
    "same-host rows survive across platforms; identically minted links collapse",
  );
  checks += 1;
}

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
