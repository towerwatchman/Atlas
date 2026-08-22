"use strict";

// ── Download group classifier ────────────────────────────────────────────────
//
// Decides whether a link's `group` heading describes something we can safely
// queue as a full game download for this machine.
//
// Why this is not a lookup table: a scan of 164,381 stored links found 3,920
// distinct group values. The top of that distribution is orderly ("Win",
// "Mac", "Win/Linux", "Android", "Linux", "All") and the tail is whatever the
// poster typed - "Win x64", "Win, Linux", "Win/Lin", "-", "LOP Gold",
// "v2022-05-24", "Individual". Any design that enumerates values is wrong on
// arrival, so this tokenizes and reasons about two independent axes.
//
//   PLATFORM  which systems the download targets
//   KIND      whether it is a full game, or a patch/extra/fragment
//
// KIND OUTRANKS PLATFORM. "Win - Update Only" mentions Windows, but it is a
// patch. Queueing it as a full game with on_complete: 'replace' would delete a
// working install and put a fragment in its place. That asymmetry is the whole
// reason this module exists, and it is why unrecognised headings are accepted
// on platform (probably just oddly worded) but never skip the kind check.
//
// Multi-part archives are DETECTED but not decided here. ~3,900 links are
// labelled "Part 1".."Part 6"; a single part is useless on its own, and
// whether to queue the whole set or refuse is a policy call for the caller.

// Anything not on this list is not a platform we target. Mac and Android are
// recognised specifically so they can be rejected with a clear reason rather
// than falling through as "unknown".
const PLATFORM_TOKENS = {
  win: "win",
  win32: "win",
  win64: "win",
  windows: "win",
  x32: "win",
  x64: "win",
  pc: "win",
  lin: "linux",
  linux: "linux",
  mac: "mac",
  macos: "mac",
  osx: "mac",
  android: "android",
  apk: "android",
  ios: "ios",
  web: "web",
  html: "web",
  browser: "web",
  all: "all",
  any: "all",
};

// Which platforms this machine can actually run. A Windows machine cannot run
// a Linux build, and a macOS machine cannot run a Win/Linux one - both are
// filtered out. A Linux machine CAN run a Windows build (electron/ipc/games.js
// routes .exe launchers through Wine via resolveLinuxLaunch), so it is offered
// BOTH its own "linux" builds and "win" ones; a combined "Win/Linux" heading
// suits it directly for the same reason.
//
// "all" and unlabeled always pass: they are the poster saying the download
// suits everyone, and rejecting those would hide most of the library.
const PLATFORM_SETS = {
  win32: new Set(["win", "all"]),
  linux: new Set(["linux", "win", "all"]),
  darwin: new Set(["mac", "all"]),
};

// Default derived from the running process. Overridable so the classifier can
// be tested for every platform from any machine.
const platformKey = () =>
  typeof process !== "undefined" && process.platform ? process.platform : "win32";

const wantedFor = (platform) =>
  PLATFORM_SETS[platform || platformKey()] || PLATFORM_SETS.win32;

// Kept for callers that want the full set rather than the current machine's.
const WANTED_PLATFORMS = new Set(["win", "linux", "all"]);

// A hit on any of these disqualifies the link regardless of platform.
// Ordered most-specific first so the reported reason is the useful one.
const KIND_MARKERS = [
  [/\bupdate\s*only\b/i, "update-only"],
  // A "Split" heading means the poster chopped the archive up. Those were
  // already refused when the individual links said "Part 1", but a bold that
  // says Split once and then lists bare mirrors gave nothing for PART to match,
  // so every fragment was offered as a whole game. \b on both sides so
  // "Splitscreen" is not caught.
  [/\bsplit\b/i, "split"],
  [/\bupdate\b/i, "update"],
  [/\bpatch(es)?\b/i, "patch"],
  [/\bhotfix\b/i, "hotfix"],
  [/\bincremental\b/i, "incremental"],
  [/\bwalkthrough\b/i, "walkthrough"],
  [/\bguide\b/i, "guide"],
  [/\bcheats?\b/i, "cheat"],
  [/\bmods?\b/i, "mod"],
  [/\bsaves?\b/i, "save"],
  [/\bsoundtrack|\bost\b/i, "soundtrack"],
  [/\bgallery\b/i, "gallery"],
  [/\bwallpapers?\b/i, "wallpaper"],
  [/\bart(work)?\b/i, "artwork"],
  [/\btranslations?\b/i, "translation"],
  [/\bextras?\b/i, "extras"],
];

// Media-only payloads. Present in the data as "MP4", "Swf" - not a game build.
const MEDIA_MARKERS = [/\bmp4\b/i, /\bswf\b/i, /\bmkv\b/i, /\bavi\b/i];

// "Compressed Win/Linux" (213) and "Compressed" (100) are full games with
// downscaled assets. Playable, so not rejected, but flagged so a caller can
// prefer the full build when both exist.
const COMPRESSED = /\bcompress(ed|ion)?\b|\blite\b/i;

const PART = /\bpart\s*[.:#-]?\s*(\d{1,2})\b/i;
// "1 of 3", "1/3" - a total, when the poster supplies one.
const PART_TOTAL = /\b(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})\b/i;

// Split on every separator seen in the data: slash, comma, dash, plus, pipe,
// ampersand, parens, whitespace. "Win x64" becomes ["win","x64"], and the
// bare value "-" becomes [] rather than a token.
const tokenize = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[\s/,\-+|&()[\]]+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

/**
 * Classify a group heading.
 *
 * @param {string} group   the raw heading, e.g. "Win/Linux" or "Win - Update Only"
 * @param {object} [link]  optional full link object; its `type` field is used
 *                         when present, since the scraper already tags
 *                         non-game payloads (save, mod, patch, soundtrack...)
 * @returns {{
 *   accepted: boolean, platforms: string[], kind: string, reason: string,
 *   compressed: boolean, part: {index:number,total:number|null}|null,
 *   requiresAllParts: boolean, raw: string
 * }}
 */
function classifyGroup(group, link = null, options = {}) {
  const wanted = wantedFor(options.platform);
  const raw = String(group == null ? "" : group).trim();
  // Platform used to be embedded in `group`, so tokenizing the heading was the
  // same thing as reading the platform. headingLines now splits them onto
  // separate fields, and tokenizing `raw` alone would find no platform token in
  // "Season 2 Final 4K" - every link would classify as unlabeled and the
  // platform filter would quietly stop filtering. So the platform text is
  // tokenized alongside it, from the option, the link, or the explicit option.
  const platformText = String(
    options.platformText ?? link?.platform ?? "",
  ).trim();
  const tokens = tokenize(platformText ? `${raw} ${platformText}` : raw);

  const result = {
    raw,
    accepted: false,
    platforms: [],
    kind: "game",
    reason: "",
    compressed: false,
    part: null,
    requiresAllParts: false,
  };

  // The scraper already classifies payload type on a minority of links
  // (95 save, 91 wallpaper_art, 90 translation, 58 mod, 43 patch...). When it
  // has an opinion other than "game", trust it over the heading.
  const declaredType = String(link?.type || "").trim().toLowerCase();
  if (declaredType && declaredType !== "game") {
    result.kind = declaredType;
    result.reason = `link type is '${declaredType}', not a game build`;
    return result;
  }

  // The parser's own reading of the fragment heading, when it has one. It saw
  // the nesting; a regex over a flattened label did not, which is why this is
  // preferred over the PART match below rather than merely agreeing with it.
  const declaredPart = link?.part || null;

  // ── Kind first. A patch that mentions Windows is still a patch. ──────────
  for (const [pattern, kind] of KIND_MARKERS) {
    if (!pattern.test(raw)) continue;
    // The `split` marker is a fallback for a bold that says "Split" and then
    // lists bare mirrors, leaving nothing for PART to match. When the parser has
    // already told us exactly which fragment this is, that guess is not needed
    // and applying it would reject the very links it exists to protect - every
    // part of "SPLIT-S3-Int+Ep12", and the unsplit .zip listed beside them.
    if (kind === "split" && declaredPart) continue;
    result.kind = kind;
    result.reason = `heading marks this as '${kind}', not a full game`;
    return result;
  }
  for (const pattern of MEDIA_MARKERS) {
    if (pattern.test(raw)) {
      result.kind = "media";
      result.reason = "heading marks this as media, not a game build";
      return result;
    }
  }

  // ── Multi-part. Detected and flagged; the SET is assembled by the caller. ─
  //
  // `whole: true` is the unsplit .zip sibling. It carries a fragment heading but
  // is a complete archive, so it stays a single - grouping it into the set would
  // make a five-part set look like six and fail the contiguity check.
  if (declaredPart) {
    if (!declaredPart.whole) {
      result.part = { index: declaredPart.index, total: declaredPart.total };
      result.requiresAllParts = true;
    }
  } else {
    const partMatch = raw.match(PART);
    const totalMatch = raw.match(PART_TOTAL);
    if (partMatch) {
      result.part = {
        index: Number.parseInt(partMatch[1], 10),
        total: totalMatch ? Number.parseInt(totalMatch[2], 10) : null,
      };
      result.requiresAllParts = true;
    }
  }

  result.compressed = COMPRESSED.test(raw);

  // ── Platform. ────────────────────────────────────────────────────────────
  const found = new Set();
  for (const token of tokens) {
    const platform = PLATFORM_TOKENS[token];
    if (platform) found.add(platform);
  }
  result.platforms = Array.from(found);

  // An empty heading is not a signal of anything - 3,322 links have one and
  // they are ordinary downloads. Treat as unlabeled, which is acceptable.
  if (found.size === 0) {
    result.accepted = true;
    result.reason = raw
      ? "no platform recognised in heading; treated as unlabeled"
      : "no heading; treated as unlabeled";
    return result;
  }

  const usable = result.platforms.filter((platform) => wanted.has(platform));
  if (usable.length > 0) {
    result.accepted = true;
    result.reason = `targets ${usable.join(", ")}`;
    return result;
  }

  result.accepted = false;
  result.reason = `targets ${result.platforms.join(", ")}, not this system`;
  return result;
}

/**
 * Filter a parsed link list down to what can be offered in the update modal.
 *
 * Multi-part sets are grouped: every part of a set is returned together under
 * one entry so the caller can queue the whole thing or refuse it, rather than
 * presenting individual fragments as if they were downloads.
 *
 * @param {Array} links       parsed thread links
 * @param {object} [options]
 * @param {Set<string>} [options.supportedHosts] only keep hosts with a plugin
 * @param {boolean} [options.allowCompressed]    default true
 */
function selectDownloadableLinks(links, options = {}) {
  const { supportedHosts = null, allowCompressed = true, platform = null } = options;
  const accepted = [];
  const rejected = [];

  // Position in the post. The poster lists the current build FIRST, so document
  // order carries meaning that alphabetical or bucket order destroys - and the
  // buckets below split one ordered list into three, which is exactly how the
  // newest build ends up rendered underneath the older ones.
  let position = 0;
  for (const link of Array.isArray(links) ? links : []) {
    const verdict = classifyGroup(link?.group, link, {
      platform,
      platformText: link?.platform,
    });
    const entry = { link, verdict, index: position };
    position += 1;

    if (!verdict.accepted) {
      rejected.push(entry);
      continue;
    }
    if (!allowCompressed && verdict.compressed) {
      rejected.push({ ...entry, verdict: { ...verdict, reason: "compressed build excluded" } });
      continue;
    }
    if (supportedHosts) {
      const host = String(link?.host || "").toLowerCase().split(".")[0];
      if (!supportedHosts.has(host)) {
        rejected.push({ ...entry, verdict: { ...verdict, reason: `no plugin for ${host}` } });
        continue;
      }
    }
    accepted.push(entry);
  }

  // Group multi-part entries so all parts of one set travel together.
  //
  // Keyed on host + build + PLATFORM. The old key stripped "Part n" back out of
  // a flattened heading, which was the only thing available when the parser
  // emitted `group: "Part 1"` and nothing else - and it collapsed Being a DIK's
  // Win/Linux and Mac fragment lists into a single ten-part set that could never
  // satisfy the contiguity check. Now that a part carries the build and platform
  // it hangs under, the key can say what it means.
  const sets = new Map();
  const singles = [];
  for (const entry of accepted) {
    if (!entry.verdict.part) {
      singles.push(entry);
      continue;
    }
    // The part marker is stripped from the heading before keying. When the
    // parser supplied `link.part` the group is already clean and this is a
    // no-op; when the part was found by the PART regex on a flat heading
    // ("Win Part 1"), the marker is still IN the group and leaving it there
    // gives every part its own key - three sets of one instead of one set of
    // three. Both paths have to land on the same key.
    const key = [
      String(entry.link?.host || "").toLowerCase(),
      String(entry.link?.group || "")
        .replace(PART, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
      String(entry.link?.platform || "").trim().toLowerCase(),
    ].join("|");
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(entry);
  }

  const multiPart = Array.from(sets.values()).map((parts) => {
    const sorted = parts.sort((a, b) => a.verdict.part.index - b.verdict.part.index);
    return {
      parts: sorted,
      host: sorted[0].link?.host || "",
      group: sorted[0].link?.group || "",
      platform: sorted[0].link?.platform || "",
      declaredTotal: sorted[0].verdict.part.total,
      // Where the set sits in the post, so it can be re-interleaved with the
      // singles it was separated from.
      index: Math.min(...sorted.map((entry) => entry.index)),
      // A gap means the thread is missing a part; extraction would fail.
      complete: isContiguous(sorted.map((entry) => entry.verdict.part.index),
                             sorted[0].verdict.part.total),
    };
  });

  // A COMPLETE set is offerable as one option covering N files. An incomplete
  // one never is: a missing part fetches fine and then fails to extract, after
  // the bytes have already been spent. That distinction is the whole reason
  // isContiguous exists, and it is why this is a split rather than a flag.
  const offerableSets = multiPart.filter((set) => set.complete);
  const incompleteSets = multiPart.filter((set) => !set.complete);

  // Still reported so the modal can explain an omission, and only when there is
  // something to explain: a game whose sets are all complete should never see
  // the disclaimer.
  const hiddenMultiPart = {
    sets: incompleteSets.length,
    links: incompleteSets.reduce((total, set) => total + set.parts.length, 0),
    hosts: Array.from(new Set(incompleteSets.map((set) => set.host))).filter(Boolean),
  };

  // Builds refused for PLATFORM, summarised the same way and for the same
  // reason: an omission the user cannot see is one they cannot report. Now that
  // headingLines gives platform its own axis, a build posted only for Mac or
  // Android disappears from a Windows machine's list with nothing said, and the
  // thread visibly has downloads the app claims not to find.
  //
  // Summarised rather than shown as greyed rows: a build this machine cannot run
  // is not a choice, and rendering it as one invites the click. Counting it, and
  // naming the platforms, tells the user the list is complete without offering
  // them a download that would not launch.
  //
  // Only platform rejections, not kind rejections. A patch or a soundtrack was
  // never a candidate for this list and saying "3 builds hidden" about them would
  // be a lie about what the thread offers.
  const platformRejected = rejected.filter(
    (entry) => entry.verdict.kind === "game" && entry.verdict.platforms.length > 0,
  );
  const hiddenPlatform = {
    links: platformRejected.length,
    builds: Array.from(
      new Set(platformRejected.map((entry) => entry.verdict.raw).filter(Boolean)),
    ),
    platforms: Array.from(
      new Set(platformRejected.flatMap((entry) => entry.verdict.platforms)),
    ),
  };

  // Links that were a genuine candidate - right kind, right platform - and lost
  // ONLY because no plugin can fetch their host.
  //
  // These used to vanish into `rejected` and never reach the modal. With two
  // plugins live, that meant a build posted to nine mirrors, none of them mega
  // or pixeldrain, disappeared entirely: Being a DIK's current
  // "Season 3 Interlude + Episode 12" was absent while three older builds
  // remained, because those happened to have a mega mirror. Someone opening the
  // modal to UPDATE was shown only older builds - the exact mistake the build
  // grouping was introduced to prevent.
  //
  // Returned separately rather than mixed into `singles` so a caller cannot
  // queue one by accident: there is nothing to queue them with.
  const unsupportedHost = rejected.filter(
    (entry) => /^no plugin for /.test(entry.verdict.reason),
  );

  return {
    singles,
    // Complete sets, each meant to be offered as ONE option that fetches every
    // part. Callers that only understand one url per option must ignore this and
    // use `singles`, which is why it is a separate field rather than merged in.
    offerableSets,
    unsupportedHost,
    multiPart,
    hiddenMultiPart,
    hiddenPlatform,
    rejected,
  };
}

// Parts must run 1..n with no gaps, and match the declared total if given.
//
// A single part with no declared total counts as INCOMPLETE. If a poster
// labelled something "Part 1" there is implicitly a Part 2, so finding one in
// isolation means the rest are missing - not that the set is whole. Returning
// true here would let a lone fragment be queued as a finished download, which
// then fails to extract after the bytes have already been fetched.
function isContiguous(indexes, declaredTotal) {
  const sorted = Array.from(new Set(indexes)).sort((a, b) => a - b);
  if (sorted.length === 0 || sorted[0] !== 1) return false;
  for (let position = 1; position < sorted.length; position += 1) {
    if (sorted[position] !== sorted[position - 1] + 1) return false;
  }
  if (declaredTotal) return sorted.length === declaredTotal;
  // No total declared: only trust a set that actually has multiple parts.
  return sorted.length >= 2;
}

module.exports = {
  classifyGroup,
  wantedFor,
  PLATFORM_SETS,
  PLATFORM_TOKENS,
  selectDownloadableLinks,
  isContiguous,
  tokenize,
  WANTED_PLATFORMS,
};
