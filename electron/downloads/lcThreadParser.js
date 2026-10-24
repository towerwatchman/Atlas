"use strict";

// LewdCorner entry point. The scan lives in xenforoThreadParser.js
const xenforo = require("./xenforoThreadParser");
// LC posters sometimes put the mirrors ON the heading line, inside the bold
// that wraps the block (F95 posts never do), so the page gets one LC-only
// correction before the shared scan: inline-anchored bolds are re-emitted as
// the heading-bold + bare-mirrors shape the scan already reads correctly.
// Only bolds containing an <a> are touched, and F95 never enters this path.
const { separateInlineBolds } = require("./lcInlineBolds");

const parseLcThreadDownloads = (html) =>
  xenforo.parseThreadDownloads(separateInlineBolds(html), "lewdcorner");

module.exports = { parseLcThreadDownloads };
