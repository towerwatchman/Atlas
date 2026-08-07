"use strict";

// ── Bold heading lines ───────────────────────────────────────────────────────
//
// F95 posters write one <b> that carries several facts stacked on <br>:
//
//   <b>Season 1<br>1080p<br>Win/Linux</b>
//
// The parser used to flatten that with stripTags, which deletes <br> and
// collapses whitespace, producing the single string "Season 1 1080p Win/Linux"
// and then handing it downstream as `group`. One string was doing two jobs -
// build label AND platform - and the two failure modes were both silent:
//
//   * "<b>4K<br>Win/Linux/Mac</b>" showed as "4K Win/Linux/Mac", and because a
//     bold REPLACES the group it also erased "Season 2 Final" from the bold
//     above it. The build the user actually wanted was gone from the label.
//   * "<b>Win/Linux/Mac</b>" - a platform-only bold - replaced the group too, so
//     two DLCs listed under separate headings collapsed into one entry named
//     after a platform.
//
// The fix is to split on <br> BEFORE stripping tags and give each line its own
// job. Three kinds of line, in the order they resolve:
//
//   PLATFORM  every token is a known platform token ("Win/Linux/Mac", "Win x64",
//             "Android"). Sets the platform. LEAVES THE BUILD LABEL ALONE - this
//             is the whole point.
//   QUALITY   exactly "4K", "1080p" or "720p". Fills a separate quality slot
//             rather than appending to the label, because the NEXT quality line
//             must replace it: "Season 1 / 1080p" followed by a bare "720p"
//             means "Season 1 720p", not "Season 1 1080p 720p".
//   PART      "Part 1", "Part 3 of 5", ".zip". A FRAGMENT of the build above it,
//             not a build of its own. Sets the part slot and LEAVES BASE AND
//             PLATFORM ALONE - see below.
//   BUILD     anything else. Replaces the base label and clears the quality
//             slot, because "Season 2" after "Season 1 / 1080p" is Season 2, not
//             Season 2 at 1080p.
//
// The PART axis is what makes a nested post readable. Being a DIK stacks three
// levels:
//
//   SPLIT-S3-Int+Ep12          build
//     Win/Linux                platform
//       .zip / Part 1 .. 5     part
//     Mac
//       .zip / Part 1 .. 5
//
// With only three axes, "Part 1" was an unrecognised line and therefore a BUILD,
// so it replaced "SPLIT-S3-Int+Ep12" and cleared "Win/Linux". The thread's 20
// split links came out as ten pairs named "Part 1".."Part 5" with no platform
// and no build - the Win/Linux Part 1 and the Mac Part 1 were byte-identical
// records, and only the url dedupe kept both alive. Nothing downstream could
// tell them apart, and nothing could tell which build they belonged to.
//
// A part line therefore inherits rather than replaces. A PLATFORM line clears
// the part slot, because "Mac" after "Part 5" opens a new set of parts rather
// than continuing the old one, and a BUILD line clears it for the same reason.
//
// Deliberately only those three exact quality tokens inherit a parent label.
// Every other unrecognised line is treated as a build label of its own rather
// than guessed at, because a wrong guess about what a line MEANS produces a
// confidently mislabelled download and there is no signal in the markup to
// recover from it.

const { PLATFORM_TOKENS } = require("./groupClassifier");

// Text with tags removed and entities collapsed enough for heading comparison.
// Lives here rather than in the parser because line splitting has to happen
// before this runs, and keeping them adjacent is what makes that order obvious.
function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// <br>, <br/>, <br />, <BR> - and <p>/</p>, which posters use interchangeably
// with <br> for the same stacked layout.
const LINE_BREAK = /<\s*br\s*\/?\s*>|<\s*\/?\s*p\b[^>]*>/gi;

// Exact tokens only. "1080p Win" is not a quality line; it is a build label
// that happens to mention a resolution, and treating it as quality would append
// it to whatever came before and lose the platform.
const QUALITY_LINES = new Set(["4k", "1080p", "720p", "2k", "480p", "360p"]);

// "Part 1", "Part.3", "Part 2 of 5", "Pt 4". Anchored to the whole line: a
// build genuinely called "Part of the Family" must not read as a fragment, and
// requiring the line to BE the part marker is what separates the two.
const PART_LINE = /^(?:part|pt)\s*[.:#-]?\s*(\d{1,2})(?:\s*(?:of|\/)\s*(\d{1,2}))?$/i;

// The unsplit sibling posters list alongside the parts - a bare extension used
// as a heading. ".zip" is not a build label, and treating it as one is what
// produced entries called ".zip" with the build above them erased.
const WHOLE_ARCHIVE_LINE = /^\.?(?:zip|rar|7z|tar|gz)$/i;

// Same split characters as groupClassifier.tokenize, so a line is classified on
// exactly the tokens the platform filter will later see.
const tokenize = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[\s/,\-+|&()[\]]+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

/**
 * Split a <b>'s inner HTML into its visible lines.
 *
 * Runs on HTML, not on text: stripTags has already destroyed the <br> by the
 * time it returns, which is the bug this exists to prevent.
 *
 * @param {string} html inner HTML of one <b>
 * @returns {string[]} non-empty lines, in document order
 */
function splitHeadingLines(html) {
  return String(html == null ? "" : html)
    .split(LINE_BREAK)
    .map((line) => stripTags(line).replace(/:$/, "").trim())
    .filter(Boolean);
}

/**
 * What one heading line is telling us.
 *
 * @param {string} line a single stripped line
 * @returns {'platform'|'quality'|'part'|'build'}
 */
function classifyHeadingLine(line) {
  const text = String(line || "").trim();
  if (!text) return "build";
  if (QUALITY_LINES.has(text.toLowerCase())) return "quality";
  // Before the platform check: neither pattern tokenizes to a platform, but
  // keeping the fragment tests together is what stops a later platform token
  // from being added and quietly swallowing "Part 1".
  if (PART_LINE.test(text) || WHOLE_ARCHIVE_LINE.test(text)) return "part";
  const tokens = tokenize(text);
  // Every token a platform token, and at least one of them. A bare "-" or "()"
  // tokenizes to nothing and must not read as "platform: none".
  if (tokens.length > 0 && tokens.every((token) => PLATFORM_TOKENS[token])) {
    return "platform";
  }
  return "build";
}

/** The heading state a fresh download area starts in. */
const emptyHeading = () => ({ base: "", quality: "", platform: "", part: null });

/**
 * Read a part line into `{index, total, whole}`.
 *
 * `whole: true` is the unsplit ".zip" sibling - a complete archive, so it has no
 * index and must NOT be grouped into the part set beside it. That distinction is
 * the difference between offering one download and offering six.
 */
function parsePartLine(line) {
  const text = String(line || "").trim();
  if (WHOLE_ARCHIVE_LINE.test(text)) return { index: null, total: null, whole: true };
  const match = text.match(PART_LINE);
  if (!match) return null;
  return {
    index: Number.parseInt(match[1], 10),
    total: match[2] ? Number.parseInt(match[2], 10) : null,
    whole: false,
  };
}

/**
 * Fold one <b>'s lines into the running heading state.
 *
 * Returns a NEW state rather than mutating, so the parser can hold a previous
 * one to compare against without having to copy defensively.
 *
 * @param {{base:string, quality:string, platform:string}} state
 * @param {string[]} lines from splitHeadingLines
 */
function applyHeadingLines(state, lines) {
  const next = { ...emptyHeading(), ...(state || {}) };
  for (const line of Array.isArray(lines) ? lines : []) {
    switch (classifyHeadingLine(line)) {
      case "platform":
        next.platform = line;
        // A new platform opens a new set of fragments. Carrying "Part 5" across
        // from the Win/Linux list into the Mac list would key the two sets
        // together and produce a six-part set from two three-part ones.
        next.part = null;
        break;
      case "quality":
        next.quality = line;
        break;
      case "part":
        // INHERITS. The whole point of the axis: a fragment says nothing about
        // which build or platform it belongs to, so it must not clear either.
        next.part = parsePartLine(line);
        break;
      default:
        next.base = line;
        // A new build clears the quality it was not given...
        next.quality = "";
        // ...and any fragment marker left over from the build before it.
        next.part = null;
        // ...and the platform, which is the safe direction: an empty platform
        // reads as "unlabeled" to groupClassifier and is ACCEPTED, whereas an
        // inherited one can filter an option out of the list entirely. A build
        // the user cannot use is a visible mistake they can ignore; a build
        // silently missing from the list is one they cannot even report.
        next.platform = "";
        break;
    }
  }
  return next;
}

/**
 * The label to group links under: the poster's build heading, verbatim, with
 * only a trailing quality token folded in.
 *
 * Empty when the post gave no build heading at all. That is not synthesised
 * here - the parser reports what the thread says and the display layer names
 * the unlabeled case, so the two do not disagree about a string.
 */
function headingLabel(state) {
  return [state?.base || "", state?.quality || ""].filter(Boolean).join(" ").trim();
}

module.exports = {
  stripTags,
  splitHeadingLines,
  classifyHeadingLine,
  applyHeadingLines,
  emptyHeading,
  headingLabel,
  parsePartLine,
  QUALITY_LINES,
  PART_LINE,
  WHOLE_ARCHIVE_LINE,
  LINE_BREAK,
};
