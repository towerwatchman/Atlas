"use strict";

// ── F95 thread download parser (client port) ─────────────────────────────────
//
// Port of the download-link half of the scraper's agents/f95_detail.py
// parse_thread_detail(). The client has to do its own parsing because masked
// URLs are minted per viewer: the signature covers the requesting account's
// user id, so a link stored in the catalog under the scraper's account cannot
// be opened by anyone else. The client fetches the thread under the user's own
// session and gets links that belong to them.
//
// This is deliberately NOT a full port. The scraper also extracts title,
// prefixes, rating, tags, overview, screenshots and external store ids - all
// of which Atlas already has from the catalog. Only the four link buckets are
// reproduced here, because those are the only part that has to be per-user.
//
// KEEP IN SYNC with f95_detail.py. The bucket state machine below mirrors it
// step for step; if the divider or group handling changes there, it has to
// change here too. The shared fixtures under the scraper repo are the way to
// check both implementations agree.
//
// Parsed with a linear tag scan rather than a DOM library. jsdom was used
// originally and shipped broken: it was a devDependency, so electron-builder
// left it out and every packaged install crashed with "cannot find module
// 'jsdom'" the first time an update was checked.
//
// A full DOM was never needed. The bucket logic only ever reads <b> text and
// <a href> IN DOCUMENT ORDER, which a sequential scan gives directly - and it
// adds no runtime dependency to an app that would otherwise ship jsdom's whole
// tree for two element types. scripts/check-f95-thread-parser.js runs 652
// assertions over the real captured threads, so equivalence is measured rather
// than assumed.

// One match per tag. Attribute values may contain ">", so the character class
// excludes quotes and steps over quoted runs.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

const ATTR = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

function parseAttributes(raw) {
  const out = {};
  let match;
  ATTR.lastIndex = 0;
  while ((match = ATTR.exec(raw || "")) !== null) {
    out[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
  }
  return out;
}

// stripTags now lives in headingLines, next to the line splitting that has to
// run BEFORE it. Keeping it here is what let the <br> handling be written the
// wrong way round for so long: stripTags deletes <br>, so any caller that
// stripped first had already lost the line structure.
const {
  stripTags,
  splitHeadingLines,
  applyHeadingLines,
  emptyHeading,
  headingLabel,
  classifyHeadingLine,
} = require("./headingLines");

// The KIND axis, shared with the update modal's filter. The old patch test was
// `heading.includes("patch")`, a substring check that missed "Update Only"
// entirely - a partial update, bucketed as a full game and offered as one, which
// with on_complete: 'replace' means deleting a working install to put a fragment
// in its place. KIND_MARKERS already knew about it; the parser just was not
// asking.
const { classifyGroup } = require("./groupClassifier");

// Kinds that mean "the links below this heading patch an install rather than
// being one". Anything else resets the flag.
const PATCH_KINDS = new Set([
  "update-only",
  "update",
  "patch",
  "hotfix",
  "incremental",
]);

// File hosts seen in the wild. Ordered longest-first so "mixdrop.ag" is not
// shadowed by a shorter substring match. Frequencies from a 164k-link scan:
// mega 41.8k, pixeldrain 38.9k, mixdrop 24.0k, workupload 21.2k, gofile 21.3k,
// uploadhaven 10.8k, mediafire 5.5k, then a long tail.
const DOWNLOAD_HOSTS = [
  // Longest first so a shorter entry cannot shadow a more specific one.
  // buzzheavier/datanodes/vikingfile were missing entirely: this list was built
  // from a metrics run whose top hosts predate them, so their links were not
  // classified as files and were dropped before reaching the classifier.
  "buzzheavier.com",
  "vikingfile.com",
  "datanodes.to",
  "bzzhr.to",
  "pixeldrain.com",
  "workupload.com",
  "uploadhaven.com",
  "mediafire.com",
  "anonfiles.com",
  "1fichier.com",
  "akirabox.com",
  "dropbox.com",
  "mixdrop.ag",
  "mixdrop.co",
  "mixdrop.to",
  "racaty.net",
  "racaty.io",
  "gofile.io",
  "mega.nz",
  "mega.co.nz",
  "mixdrop",
  "racaty",
];

// Hosts that are never a download, however far down the post they appear.
//
// DOWNLOAD_HOSTS used to be the gate: a link whose host was not on it was
// dropped. That is the wrong shape for a list that can only ever be behind the
// threads it is read from - these two captures alone contributed dropmefiles,
// download.gg, uploadnow and krakenfiles, four working mirrors discarded in
// silence. The list stays, because knowing a host is a file host is still
// useful for deciding where the download area STARTS, but it no longer decides
// what gets kept.
//
// Inverting it means the question becomes "is this obviously not a download",
// which is a small, stable set: the poster's funding links, the store pages, and
// the socials. A new mirror host now works on the day it appears; a new social
// network shows up as one junk row that can be added here.
const NON_DOWNLOAD_HOSTS = [
  "patreon.com",
  "subscribestar.com",
  "subscribestar.adult",
  "boosty.to",
  "ko-fi.com",
  "buymeacoffee.com",
  "itch.io",
  "steampowered.com",
  "steamcommunity.com",
  "gog.com",
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "twitter.com",
  "x.com",
  "bsky.app",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "youtube.com",
  "youtu.be",
  "twitch.tv",
  "tumblr.com",
  "pixiv.net",
  "deviantart.com",
  "imgur.com",
  "postimg.cc",
  "ibb.co",
  "wikipedia.org",
];

/**
 * Is this link something other than a file to fetch?
 *
 * f95zone.to itself is denied EXCEPT for attachments.f95zone.to. An in-thread
 * link is a pointer to another post - "COMPRESSED", "Crack", "Here" - and while
 * those often lead to more downloads, following them is a fetch this parser does
 * not do. Offering the post url as if it were an archive would queue a
 * transfer that lands an html page.
 */
function isNonDownloadHost(url) {
  const host = hostOf(url).toLowerCase();
  if (!host) return true;
  if (host === "attachments.f95zone.to") return false;
  if (host === "f95zone.to" || host.endsWith(".f95zone.to")) return true;
  return NON_DOWNLOAD_HOSTS.some(
    (denied) => host === denied || host.endsWith(`.${denied}`),
  );
}

// Normalised payload type. Checked top-down; word boundaries keep "Part 1"
// from matching "art". Mirrors TYPE_RULES in f95_detail.py.
const TYPE_RULES = [
  ["translation", [/translation/i, /\btl\b/i]],
  ["walkthrough", [/walkthrough/i, /\bwt\s?mod\b/i, /\bwtmod\b/i]],
  ["gallery_unlock", [/gallery/i, /unlock/i]],
  ["cheat", [/cheat/i]],
  ["soundtrack", [/soundtrack/i, /\bost\b/i]],
  ["wallpaper_art", [/wallpaper/i, /\bbanner/i, /\bart\b/i, /character (?:intro|banner)/i]],
  ["save", [/\bsaves?\b/i, /save\s?(?:file|data)/i]],
  ["patch", [/patch/i]],
  ["mod", [/\bmods?\b/i]],
  ["guide", [/\bguide\b/i, /\bfaq\b/i]],
];

const isMasked = (url) => String(url || "").includes("/masked/");

/**
 * Unwrap F95's link-confirmation / proxy wrappers.
 *
 * Masked links are returned UNCHANGED: they are encrypted server-side and
 * cannot be decoded offline. They are resolved at request time by opening them
 * in a browser window where the user clears the challenge.
 */
function unwrap(href) {
  if (!href) return href;
  if (!href.includes("link-confirmation") && !href.includes("proxy.php")) return href;
  try {
    const parsed = new URL(href, "https://f95zone.to");
    for (const key of ["url", "u", "link", "dest"]) {
      const value = parsed.searchParams.get(key);
      if (value) return decodeURIComponent(value);
    }
  } catch {
    // Unparseable - hand back what we were given.
  }
  return href;
}

const netloc = (url) => {
  try {
    return new URL(url, "https://f95zone.to").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Real destination host, including for masked links (/masked/<host>/...). */
function hostOf(url) {
  if (isMasked(url)) {
    const after = String(url).split("/masked/")[1] || "";
    return after.split("/")[0].replace(/^www\./, "");
  }
  return netloc(url);
}

/** The known file host in a url, or null if it is not a download link. */
function downloadHost(url) {
  const low = String(url || "").toLowerCase();
  for (const host of DOWNLOAD_HOSTS) {
    if (low.includes(host)) return host;
  }
  return null;
}

/** Best-effort filename from a url path, stripping F95's numeric prefix. */
function filenameFromUrl(url) {
  try {
    const path = new URL(url, "https://f95zone.to").pathname.replace(/\/+$/, "");
    const tail = path.split("/").pop() || "";
    return decodeURIComponent(tail.replace(/^\d+_/, ""));
  } catch {
    return "";
  }
}

function classifyType(section, group, label, name) {
  const sec = String(section || "").toLowerCase();
  if (sec.startsWith("translation")) return "translation";
  const text = [group, label, name].filter(Boolean).join(" ").toLowerCase();
  for (const [kind, patterns] of TYPE_RULES) {
    if (patterns.some((pattern) => pattern.test(text))) return kind;
  }
  if (sec === "download" || sec === "downloads") return "game";
  return "other";
}

/**
 * Emit the <b> and <a> elements of a fragment in document order.
 *
 * Only those two matter: a <b> sets the current heading, and every <a> after it
 * inherits that heading until the next one. Nesting is irrelevant to that rule,
 * which is why a flat scan is equivalent to the tree walk it replaces - and why
 * no DOM is needed.
 *
 * For each element the opening tag's attributes are parsed and the inner HTML
 * up to the matching close tag is captured, so callers can read both the href
 * and the visible label.
 *
 * A <b> INSIDE a <b> already emitted is skipped. Its text is part of the outer
 * bold's inner HTML and has therefore been read once already, and re-emitting it
 * meant the child's lines ran a second time on top of the parent's - overwriting
 * the state the parent had just set. Being a Wife's heading is literally
 *
 *   <b><span>DOWNLOAD</span><br><span>Win/<b>Linux</b></span></b>
 *
 * so the outer bold resolved the platform to "Win/Linux" and the inner bold then
 * reduced it to "Linux". Every Windows build on that thread was labelled
 * Linux-only. Being a DIK's <b><b>.zip</b></b> tripped the same wire twice over.
 */
function* walkElements(fragment) {
  const scanner = new RegExp(TAG.source, "g");
  let match;
  // End offset of the outermost <b> currently open. Anchors are unaffected: a
  // nested <a> is invalid html and does not occur, and an <a> inside a <b> is a
  // link that genuinely needs emitting.
  let boldEnd = -1;
  while ((match = scanner.exec(fragment)) !== null) {
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (closing || (name !== "b" && name !== "a")) continue;
    if (name === "b" && match.index < boldEnd) continue;

    const attrs = parseAttributes(match[3]);
    const contentStart = match.index + match[0].length;

    // Find the matching close, allowing for the same tag nested inside.
    const inner = new RegExp(`</?${name}\\b`, "gi");
    inner.lastIndex = contentStart;
    let depth = 1;
    let contentEnd = fragment.length;
    let step;
    while ((step = inner.exec(fragment)) !== null) {
      depth += step[0][1] === "/" ? -1 : 1;
      if (depth === 0) {
        contentEnd = step.index;
        break;
      }
    }

    if (name === "b") boldEnd = contentEnd;

    yield { tag: name, attrs, html: fragment.slice(contentStart, contentEnd) };
  }
}

/**
 * Parse the download buckets out of a thread page.
 *
 * @param {string} html raw thread html, fetched under the user's own session
 * @returns {{downloads:Array, patches:Array, extras:Array, translations:Array,
 *            loggedIn:boolean|null, threadId:string|null, found:boolean}}
 */
function parseThreadDownloads(html) {
  const out = {
    threadId: null,
    loggedIn: null,
    downloads: [],
    patches: [],
    extras: [],
    translations: [],
    found: false,
  };

  const source = String(html || "");

  // <html> carries the session and thread markers as attributes.
  const htmlTag = source.match(/<html\b([^>]*)>/i);
  if (htmlTag) {
    const attrs = parseAttributes(htmlTag[1]);
    out.loggedIn = attrs["data-logged-in"] === "true";
    const key = attrs["data-content-key"] || "";
    const keyMatch = key.match(/thread-(\d+)/);
    if (keyMatch) out.threadId = keyMatch[1];
  }

  // First post body. Everything below lives inside it, so the scan is bounded
  // to that region by tracking div depth to the matching close tag.
  const openMatch = source.match(/<div\b[^>]*class="[^"]*\bbbWrapper\b[^"]*"[^>]*>/i);
  if (!openMatch) return out;
  out.found = true;

  const bodyStart = openMatch.index + openMatch[0].length;
  let depth = 1;
  let bodyEnd = source.length;
  TAG.lastIndex = bodyStart;
  let scan;
  while ((scan = TAG.exec(source)) !== null) {
    if (scan[2].toLowerCase() !== "div") continue;
    depth += scan[1] === "/" ? -1 : 1;
    if (depth === 0) {
      bodyEnd = scan.index;
      break;
    }
  }
  const body = source.slice(bodyStart, bodyEnd);

  const buckets = {
    downloads: out.downloads,
    patches: out.patches,
    extras: out.extras,
    translations: out.translations,
  };

  const seen = new Set();
  let divider = null;      // null -> downloads area | 'extras' | 'translations'
  // Three fields where there was one string. See headingLines.js: `group` doing
  // double duty as build label AND platform is what merged "Season 2 Final" with
  // "4K Win/Linux/Mac" and collapsed two DLCs into one entry called "Win/Linux/Mac".
  let heading = emptyHeading();
  let patchActive = false;
  let started = false;     // have we reached the first real download link yet

  for (const node of walkElements(body)) {
    const tag = node.tag;

    if (tag === "b") {
      // Split on <br> FIRST. One bold routinely stacks build, quality and
      // platform on separate lines, and each line means something different.
      for (const line of splitHeadingLines(node.html)) {
        const norm = line.toLowerCase();
        if (norm === "extras" || norm === "extra") {
          divider = "extras"; patchActive = false; heading = emptyHeading();
          continue;
        }
        if (norm === "translations" || norm === "translation") {
          divider = "translations"; patchActive = false; heading = emptyHeading();
          continue;
        }
        if (norm === "download" || norm === "downloads") {
          divider = null; patchActive = false; heading = emptyHeading();
          // The divider itself opens the download area. `started` used to wait
          // for the first link on a KNOWN host, which meant a thread whose
          // mirrors were all on hosts missing from DOWNLOAD_HOSTS never opened
          // the area at all and parsed to nothing - the exact failure the
          // deny-list exists to end, reintroduced one layer up.
          started = true;
          continue;
        }
        // A merged "DOWNLOAD Win/Linux" on one line still carries the heading
        // after the word. With the split above this is now the rare case rather
        // than the common one.
        const text = line.replace(/^download\s+/i, "").trim();
        if (!text) continue;
        const kindOfLine = classifyHeadingLine(text);
        heading = applyHeadingLines(heading, [text]);
        // Patch tracking hangs off the BUILD line, not off any line: a bare
        // "Win/Linux" says nothing about whether the section is a patch, and
        // re-deciding on it is how the old substring test flip-flopped.
        if (started && kindOfLine === "build") {
          patchActive = PATCH_KINDS.has(classifyGroup(text).kind);
        }
      }
      continue;
    }

    if (tag !== "a") continue;
    const href = node.attrs.href;
    if (!href) continue;

    const classes = node.attrs.class || "";
    // An anchor wrapping an image is a screenshot thumbnail, not a download.
    if (classes.includes("js-lbImage") || /<img\b/i.test(node.html)) continue;
    if (href.includes("/members/")) continue; // @mention or credit

    const url = unwrap(href);
    const known = downloadHost(url);
    const host = known || hostOf(url);
    const label = stripTags(node.html) || filenameFromUrl(url);

    // A known host still opens the download area on threads that never write a
    // "DOWNLOAD" bold at all.
    if (known) started = true;

    // Inside the download area, anything that is not obviously a store page, a
    // funding link or a social is a mirror. Outside it, only a known file host
    // counts - the overview above the downloads is full of ordinary links
    // (Patreon, Steam, GOG, "Here", other games) and none of them are files.
    const isFile = started
      ? !isNonDownloadHost(url)
      : Boolean(known) || url.includes("attachments.f95zone.to");

    let bucketName;
    if (divider === "extras" || divider === "translations") {
      bucketName = divider;
    } else if (
      started &&
      (patchActive || PATCH_KINDS.has(classifyGroup(headingLabel(heading)).kind))
    ) {
      bucketName = "patches";
    } else if (isFile) {
      bucketName = "downloads";
    } else {
      continue; // not a file host, not a patch, no divider
    }

    if (seen.has(url)) continue;
    seen.add(url);

    let kind;
    if (bucketName === "patches") {
      kind = "patch";
    } else if (bucketName === "translations") {
      kind = "translation";
    } else if (bucketName === "extras") {
      kind = classifyType("extras", headingLabel(heading), label, "");
      if (kind === "other") {
        const alt = classifyType("extras", "", "", filenameFromUrl(url));
        if (alt !== "other") kind = alt;
      }
    } else {
      kind = classifyType("download", headingLabel(heading), label, "");
    }

    buckets[bucketName].push({
      // The poster's build heading, verbatim, with only a 4K/1080p/720p line
      // folded in. Empty when the post gave no build heading - the DISPLAY layer
      // names that case, so the parser and the UI cannot disagree about a string.
      group: headingLabel(heading),
      // Platform as its own axis, raw as written ("Win/Linux/Mac"). A filter,
      // not part of the option's name.
      platform: heading.platform,
      // {index, total, whole} when the link sat under a fragment heading, null
      // otherwise. `whole: true` is the unsplit ".zip" sibling listed beside the
      // parts - a complete archive, and NOT a member of the set.
      part: heading.part,
      label,
      type: kind,
      host,
      url,
      masked: isMasked(href),
    });
  }

  return out;
}

module.exports = {
  parseThreadDownloads,
  stripTags,
  unwrap,
  isMasked,
  hostOf,
  downloadHost,
  filenameFromUrl,
  classifyType,
  isNonDownloadHost,
  DOWNLOAD_HOSTS,
  NON_DOWNLOAD_HOSTS,
};
