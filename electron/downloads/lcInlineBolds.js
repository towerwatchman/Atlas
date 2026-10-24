"use strict";

// LC poster correction, applied before the shared scan in
// xenforoThreadParser.js ever sees the page.
//
// F95 posters write each download row as
//
//   <b>Win/Linux</b>: <a>MEGA</a> - <a>Pixeldrain</a>
//
// so the shared scan folds the heading bold whole and the mirrors outside
// inherit it. That is why F95 threads parse correctly. LC posters instead
// sometimes put the mirrors ON the heading line, inside the bold that wraps
// the block:
//
//   <b>DOWNLOADS<br>Win/Linux: <a>MEGA</a> - <a>Pixeldrain</a> -<br>Mac: ...
//     <br>Android: ...</b>
//
// (thread 19787, whose whole download parse came out as links:0; and thread
// 7, Grandma's House, whose outer <b> spans an entire "Part 7" spoiler with
// per-row platform bolds plus an "Update Patch (...)" section). Folding a
// bold whole reads the mirror labels as heading text, the LAST line replaces
// the heading and clears the platform, and every anchor in the bold inherits
// that junk state - so nothing splits into rows at all.
//
// The fix lives here, not in the shared scan, because the shared scan is
// correct for the F95 shape and F95 html must never route new code. Only
// bolds whose text CONTAINS an anchor are rewritten, and each is re-emitted
// in exactly the shape F95 gives the scan for free:
//
//   <b>DOWNLOADS<br>Win/Linux</b> <a>MEGA</a> - <a>Pixeldrain</a> -
//   <br><b>Mac</b> ...
//
// After that, the ordinary fold - part promotion on "Part 7", the patches
// bucket off an "Update Patch (...)" build line, dividers, quality - all
// works on LC pages through the one code path that already has the tests.

const { LINE_BREAK, stripTags, classifyHeadingLine } = require("./headingLines");

// One matched <b>...</b> pair per outermost bold, in document order. Same
// depth walk the shared walker uses, for the same reason: a nested <b> is
// formatting decoration and its parent covers its text.
const B_TAG = /<(\/?)b\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

// A spoiler's clickable title is forum chrome: the button names the reveal,
// never a download, and a link cannot sit inside one. A copy-pasted bold
// can wrap the button, so its title span must not survive as bare text the
// fold would read as a heading. The whole element goes, content divs stay.
// Non-greedy match: an unclosed button is left in place rather than eating
// the rest of the page.
const BUTTON = /<button\b[^>]*>[\s\S]*?<\/button>/gi;

// The title is the one place a label for the section below it exists on this
// site: the poster writes no heading inside that block, so a labelled spoiler
// can never be named at all once the button is dropped whole. Part titles are
// always promoted. Any other title needs a version or date to count as a build
// ("Before the Tech Update (v0.20.16)"), which keeps "Changelog" and
// "Screenshots" out of the heading state.
// shortcut: a build labelled without a version keeps the remove-only path;
// upgrade when a real page uses some other build label.
const BUTTON_TITLE = /class="bbCodeSpoiler-button-title"[^>]*>([^<]*)</i;
const PART_TEXT = /^\s*(?:part|pt)\s*[.:#-]?\s*\d/i;
const VERSION_TEXT = /\bv?\d+\.\d+|(?:19|20)\d{2}-\d{2}-\d{2}\b/i;

const replaceButton = (button) => {
  const span = button.match(BUTTON_TITLE);
  // The title span is the normal shape. A button that lost it still carries the
  // label as plain text after the "Spoiler:" prefix.
  const title = span
    ? stripTags(span[1])
    : stripTags(button).replace(/^\s*Spoiler:\s*/i, "").trim();
  const part = PART_TEXT.test(title);
  if (!part && !VERSION_TEXT.test(title)) return "";
  // The marker tells the parser this heading is the poster's name for the
  // build, so a title like "Before the Tech Update" is not read as an update
  // payload by the kind checks. Part titles keep their old path. The break
  // keeps the title on its own line: the block under it often opens with the
  // same label ("Part 5<br>Win/Linux:"), and with no break between them the
  // folded line reads "Part 5 Part 5" and names the section that.
  const marker = part ? "" : ' data-build-title="1"';
  return `<b${marker}>${title}</b><br>`;
};

// Full-pack compressed rows write the OS inside a bold of its own and the file
// size in a bracket tail outside it:
//
//   <b><u>Win/Linux</u></b><span> [1,09 GB] <a>MEGA</a>
//
// The fold reads bold and tail as one heading line, so the row is named
// "Win/Linux [1,09 GB]" with no platform at all and the section heading above
// it is lost. The bracket states file size, never target OS, so it goes and the
// row is re-cut into the per-row shape the fold already reads.
// shortcut: the OS bold must read as a bare platform and the bracket must sit
// on the same line as the first mirror. Nothing else is touched; upgrade when a
// page states the platform some other way beside a size bracket.
const SIZE_ROW =
  /<b\b[^>]*>((?:(?!<\/?b\b)[\s\S])*?)<\/b>(?:\s*(<span\b[^>]*>))?\s*\[\s*\d[\d.,]*\s*(?:[KMG]i?B|B)\s*\]\s*(?=[^<]*<a\b)/gi;

const replaceSizedRow = (row, inner, span) => {
  const os = stripTags(inner).replace(/:$/, "").trim();
  if (classifyHeadingLine(os) !== "platform") return row;
  return `<b>${os}</b>: ${span || ""}`;
};

// Collapse one bold that carries its own mirrors: heading runs become bolds,
// mirrors become bare anchors, and the <br> between them is kept so two
// heading bolds can never be read as a glued single heading.
const flattenBold = (inner) => {
  const flat = inner.replace(/<\/?b\b[^>]*>/gi, "");
  let out = "";
  const group = [];
  const flushGroup = () => {
    if (!group.length) return;
    out += `<b>${group.join("<br>")}</b><br>`;
    group.length = 0;
  };
  // A line starts here unless a heading is already waiting to be written: that
  // bold goes in at this exact spot, and the <br> after it ends the line. This
  // is what keeps a heading that was glued to the row above in its own place
  // instead of landing after the next line's markup.
  const startLine = () => {
    if (out && !out.endsWith("<br>") && !group.length) out += "<br>";
  };
  // Heading text glued between two mirrors — the next section's "Part n"
  // opener or its platform label — must go back through the group: the fold
  // promotes headings only from inside a <b>, so the label a dropped bold
  // left as bare text can never name the rows that follow. Separator junk
  // between mirrors (" - ", spacer markup, a caret note) rides with the
  // anchors instead, exactly as before.
  const isHeadingText = (node) => {
    const line = stripTags(node).replace(/:$/, "").trim();
    if (PART_TEXT.test(line)) return true;
    const kind = classifyHeadingLine(line);
    return kind === "part" || kind === "platform";
  };
  for (const fragment of flat.split(LINE_BREAK)) {
    startLine();
    const at = fragment.search(/<\s*a\b/i);
    const head = at === -1 ? fragment : fragment.slice(0, at);
    // A line's heading text is everything before its first anchor; the
    // colon that hung the mirrors off it is dropped the same way
    // splitHeadingLines drops it when folding.
    if (stripTags(head).replace(/:$/, "").trim()) group.push(head);
    if (at === -1) continue;
    // One token per anchor element, markup tag or text node; anchor inner text
    // and markup are swallowed whole so a mirror's own label never reads as a
    // heading, and a tag never merges with the text it wraps. An anchor with no
    // closing tag glues its remainder verbatim.
    const token =
      /<\s*a\b[^>]*>[\s\S]*?<\/\s*a\s*>|<\s*a\b[^>]*>[\s\S]*$|<\/?[a-z][^>]*>|[^<]+|</gi;
    let match;
    const rest = fragment.slice(at);
    while ((match = token.exec(rest)) !== null) {
      const piece = match[0];
      if (/^<\s*a/i.test(piece)) {
        flushGroup();
        out += piece;
      } else if (isHeadingText(piece)) {
        group.push(piece);
      } else {
        out += piece;
      }
    }
  }
  flushGroup();
  return out;
};

function separateInlineBolds(html) {
  // Buttons go first so no later step ever sees their text. A part-labelled
  // title is re-emitted as the heading bold the fold promotes, the rest is
  // dropped whole. Size brackets go before the flatten so the OS line the
  // flatten promotes is the platform alone.
  const source = String(html || "")
    .replace(BUTTON, replaceButton)
    .replace(SIZE_ROW, replaceSizedRow);
  const inline = /<\s*a\b/i;
  const edits = [];
  const scan = new RegExp(B_TAG.source, "gi");
  let boldEnd = -1;
  let match;
  while ((match = scan.exec(source)) !== null) {
    if (match[1] === "/") continue;
    if (match.index < boldEnd) continue;
    const contentStart = match.index + match[0].length;
    const inner = new RegExp("<(/?)b\\b", "gi");
    inner.lastIndex = contentStart;
    let depth = 1;
    let contentEnd = source.length;
    let step;
    while ((step = inner.exec(source)) !== null) {
      depth += step[1] === "/" ? -1 : 1;
      if (depth === 0) {
        contentEnd = step.index;
        break;
      }
    }
    boldEnd = contentEnd;
    const closeEnd = source.indexOf(">", contentEnd);
    const end = closeEnd === -1 ? source.length : closeEnd + 1;
    const boldHtml = source.slice(contentStart, contentEnd);
    if (!inline.test(boldHtml)) continue;
    edits.push({ start: match.index, end, html: flattenBold(boldHtml) });
  }
  // String built back to front so the collected offsets stay valid.
  let out = source;
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    out = out.slice(0, edits[i].start) + edits[i].html + out.slice(edits[i].end);
  }
  return out;
}

module.exports = { separateInlineBolds };
