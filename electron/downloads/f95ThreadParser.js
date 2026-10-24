"use strict";

// F95 entry point. The scan lives in xenforoThreadParser.js
const xenforo = require("./xenforoThreadParser");

const parseThreadDownloads = (html) => xenforo.parseThreadDownloads(html, "f95");

module.exports = {
  ...xenforo,
  parseThreadDownloads,
};
