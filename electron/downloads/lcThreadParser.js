"use strict";

// LewdCorner entry point. The scan lives in xenforoThreadParser.js
const xenforo = require("./xenforoThreadParser");

const parseLcThreadDownloads = (html) => xenforo.parseThreadDownloads(html, "lewdcorner");

module.exports = { parseLcThreadDownloads };
