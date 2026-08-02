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
// Uses jsdom (already a dependency) rather than regex. The bucket logic is
// order-dependent - a <b> heading applies to every <a> that follows it until
// the next heading - so it needs real document-order traversal, which is
// exactly what regex cannot give.

const { JSDOM } = require("jsdom");

// File hosts seen in the wild. Ordered longest-first so "mixdrop.ag" is not
// shadowed by a shorter substring match. Frequencies from a 164k-link scan:
// mega 41.8k, pixeldrain 38.9k, mixdrop 24.0k, workupload 21.2k, gofile 21.3k,
// uploadhaven 10.8k, mediafire 5.5k, then a long tail.
const DOWNLOAD_HOSTS = [
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

/** Every descendant element in document order - BeautifulSoup's .descendants. */
function* walk(root) {
  for (const child of root.children) {
    yield child;
    yield* walk(child);
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

  const dom = new JSDOM(String(html || ""));
  const document = dom.window.document;

  const root = document.documentElement;
  if (root) {
    out.loggedIn = root.getAttribute("data-logged-in") === "true";
    const key = root.getAttribute("data-content-key") || "";
    const match = key.match(/thread-(\d+)/);
    if (match) out.threadId = match[1];
  }

  // First post body. Everything below lives inside it.
  const body = document.querySelector("div.bbWrapper");
  if (!body) return out;
  out.found = true;

  const buckets = {
    downloads: out.downloads,
    patches: out.patches,
    extras: out.extras,
    translations: out.translations,
  };

  const seen = new Set();
  let divider = null;      // null -> downloads area | 'extras' | 'translations'
  let group = "";
  let patchActive = false;
  let started = false;     // have we reached the first real download link yet

  for (const node of walk(body)) {
    const tag = node.tagName ? node.tagName.toLowerCase() : "";

    if (tag === "b") {
      const norm = (node.textContent || "").replace(/\s+/g, " ").trim()
        .replace(/:$/, "").trim().toLowerCase();
      if (norm === "extras" || norm === "extra") {
        divider = "extras"; patchActive = false; group = "";
      } else if (norm === "translations" || norm === "translation") {
        divider = "translations"; patchActive = false; group = "";
      } else if (norm === "download" || norm === "downloads") {
        divider = null; patchActive = false; group = "";
      } else {
        // A merged "DOWNLOAD Win/Linux" heading carries the group after the word.
        const heading = (node.textContent || "").replace(/\s+/g, " ").trim()
          .replace(/:$/, "").trim().replace(/^download\s+/i, "");
        group = heading;
        // Patch tracking only matters once we are inside the download area.
        if (started) {
          const low = heading.toLowerCase();
          if (low.includes("patch")) patchActive = true;
          else if (low.includes("season")) patchActive = false;
        }
      }
      continue;
    }

    if (tag !== "a") continue;
    const href = node.getAttribute("href");
    if (!href) continue;

    const classes = node.getAttribute("class") || "";
    if (classes.includes("js-lbImage") || node.querySelector("img")) continue; // screenshot
    if (href.includes("/members/")) continue; // @mention or credit

    const url = unwrap(href);
    const known = downloadHost(url);
    const host = known || hostOf(url);
    const isFile = Boolean(known) || url.includes("attachments.f95zone.to");
    const label = (node.textContent || "").replace(/\s+/g, " ").trim()
      || filenameFromUrl(url);

    if (isFile) started = true;

    let bucketName;
    if (divider === "extras" || divider === "translations") {
      bucketName = divider;
    } else if (started && (patchActive || group.toLowerCase().includes("patch"))) {
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
      kind = classifyType("extras", group, label, "");
      if (kind === "other") {
        const alt = classifyType("extras", "", "", filenameFromUrl(url));
        if (alt !== "other") kind = alt;
      }
    } else {
      kind = classifyType("download", group, label, "");
    }

    buckets[bucketName].push({
      group,
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
  unwrap,
  isMasked,
  hostOf,
  downloadHost,
  filenameFromUrl,
  classifyType,
  DOWNLOAD_HOSTS,
};
