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
//   BUILD     anything else. Replaces the base label and clears the quality
//             slot, because "Season 2" after "Season 1 / 1080p" is Season 2, not
//             Season 2 at 1080p.
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
 * @returns {'platform'|'quality'|'build'}
 */
function classifyHeadingLine(line) {
  const text = String(line || "").trim();
  if (!text) return "build";
  if (QUALITY_LINES.has(text.toLowerCase())) return "quality";
  const tokens = tokenize(text);
  // Every token a platform token, and at least one of them. A bare "-" or "()"
  // tokenizes to nothing and must not read as "platform: none".
  if (tokens.length > 0 && tokens.every((token) => PLATFORM_TOKENS[token])) {
    return "platform";
  }
  return "build";
}

/** The heading state a fresh download area starts in. */
const emptyHeading = () => ({ base: "", quality: "", platform: "" });

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
        break;
      case "quality":
        next.quality = line;
        break;
      default:
        next.base = line;
        // A new build clears the quality it was not given...
        next.quality = "";
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
  QUALITY_LINES,
  LINE_BREAK,
};
