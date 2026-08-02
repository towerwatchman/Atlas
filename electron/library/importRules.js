"use strict";

// ── Import rules ─────────────────────────────────────────────────────────────
//
// Pure decision logic lifted out of ipc/importer.js: how an import row is
// classified, how a version string is normalised, and where a game lands
// inside the library folder.
//
// Extracted because none of it needs the importer's IPC context - every
// function here is a function of its arguments alone. That makes it directly
// testable, and reusable by the download installer, which needs the same
// version normalisation and archive detection. Reaching into a 4,700-line IPC
// module for those was what blocked that work.
//
// Moved VERBATIM. Behaviour is byte-identical to what shipped inside
// importer.js; only the location changed. scripts/check-import-rules.js pins
// that behaviour down so a later tidy-up cannot quietly alter it.

const path = require("path");
// getLewdCornerIdFromGame falls back to parsing an id out of a thread url.
// This dependency was missed on the first extraction pass and surfaced as a
// ReferenceError the moment a test called the function - which is what the
// characterization tests exist for.
//
// Required LAZILY on purpose. db/lewdcorner pulls in db/index and therefore
// sqlite3, a native module. This file is otherwise pure logic, and making it
// transitively depend on a compiled binary would mean it could not be loaded
// or tested without a full native build. Deferring the require keeps that
// cost on the one code path that actually needs it.
//
// The proper fix is to move parseLewdCornerIdFromUrl (and normalizeId) down
// into a pure module that db/lewdcorner imports, inverting the dependency.
// Left for the next pass rather than folded into a move.
let parseLewdCornerIdFromUrlCached = null;
const parseLewdCornerIdFromUrl = (value) => {
  if (!parseLewdCornerIdFromUrlCached) {
    parseLewdCornerIdFromUrlCached = require("../db/lewdcorner").parseLewdCornerIdFromUrl;
  }
  return parseLewdCornerIdFromUrlCached(value);
};

function sanitizePathSegment(value, fallback = "Unknown") {
  const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  let sanitized = String(value || fallback)
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!sanitized || sanitized === "." || windowsReservedName.test(sanitized)) {
    sanitized = windowsReservedName.test(sanitized) ? `_${sanitized}` : fallback;
  }
  return sanitized;
}

function normalizeVersionName(value, fallback = "Unknown") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function buildStructuredImportPath(targetLibrary, format, game) {
  const pathSegments = format
    .trim()
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) =>
      sanitizePathSegment(
        part.replace(/\{([^}]+)\}/g, (_, token) => {
          const key = String(token || "").trim().toLowerCase();
          if (key === "creator") return game.creator || "Unknown";
          if (key === "title") return game.title || "Untitled";
          if (key === "version") return normalizeVersionName(game.version);
          if (key === "engine") return game.engine || "Unknown";
          if (key === "f95id") return game.f95Id || "Unknown";
          if (key === "lcid" || key === "lewdcornerid") return game.lcId || game.lewdCornerId || "Unknown";
          return "Unknown";
        }),
      ),
    );

  return path.join(targetLibrary, ...pathSegments);
}

const toPositiveInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const getLewdCornerIdFromGame = (game = {}) =>
  toPositiveInteger(
    game.lcId ||
    game.lc_id ||
    game.lewdCornerId ||
    game.lewdcornerId ||
    game.lewdcorner_id ||
    parseLewdCornerIdFromUrl(game.lewdCornerSiteUrl || game.lewdcornerSiteUrl || game.siteUrl || game.site_url || game.sourceUrl || game.url),
  );

// Compound tarballs: the compression and the archive are SEPARATE layers, so one
// pass of 7-Zip only strips the outer compression and leaves a .tar behind. A
// second pass is required. Linux game builds ship this way routinely.
const TARBALL_SUFFIXES = [
  ".tar.gz", ".tgz",
  ".tar.bz2", ".tbz2", ".tbz",
  ".tar.xz", ".txz",
  ".tar.zst", ".tzst",
  ".tar.lz4", ".tar.lzma",
];

const isCompoundTarballPath = (filePath) => {
  const lower = String(filePath || "").toLowerCase();
  return TARBALL_SUFFIXES.some((suffix) => lower.endsWith(suffix));
};

// path.extname only ever returns the LAST extension, so "game.tar.bz2" reports
// "bz2". Checking the compound suffixes first is what makes these detectable.
const getArchiveExtension = (filePath) => {
  const lower = String(filePath || "").toLowerCase();
  const compound = TARBALL_SUFFIXES.find((suffix) => lower.endsWith(suffix));
  if (compound) return compound.replace(/^\./, "");
  return path.extname(lower).replace(/^\./, "");
};

const getConfiguredExtractionExtensions = (appConfig) =>
  // tar and the compressed variants are in the default set: without them a
  // Linux release downloaded as .tar.bz2 is not recognised as an archive at all,
  // so it is imported as a single file with no executable inside.
  String(appConfig?.Library?.extractionExtensions
    || "zip,7z,rar,tar,gz,bz2,xz,zst,tgz,tbz2,txz")
    .split(",")
    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

const isArchiveFilePath = (filePath, appConfig) => {
  if (isCompoundTarballPath(filePath)) return true;
  const ext = path.extname(String(filePath || "")).toLowerCase().replace(/^\./, "");
  return ext ? getConfiguredExtractionExtensions(appConfig).includes(ext) : false;
};

const isRarArchivePath = (filePath) =>
  path.extname(String(filePath || "")).toLowerCase() === ".rar";

function isSteamImportRow(game = {}) {
  return (
    game.sourceType === "steam" ||
    game.scanStatus === "steamVersion" ||
    Boolean(game.steamId || game.steam_id || game.steam_appid)
  );
}

const getSteamIdFromGame = (game = {}) =>
  toPositiveInteger(game.steamId || game.steam_id || game.steam_appid);

function isGogImportRow(game = {}) {
  return (
    game.sourceType === "gog" ||
    game.scanStatus === "gogVersion" ||
    Boolean(game.gogId || game.gog_id || game.gog_appid)
  );
}

const getGogIdFromGame = (game = {}) =>
  toPositiveInteger(game.gogId || game.gog_id || game.gog_appid);

const inferCatalogImportVersion = (sourcePath, catalog = {}) => {
  const candidates = [
    path.basename(String(sourcePath || ""), path.extname(String(sourcePath || ""))),
    path.basename(path.dirname(String(sourcePath || ""))),
    catalog.latestVersion,
    catalog.latest_version,
    catalog.version,
  ];
  const patterns = [
    /\bv(?:ersion)?[\s._-]*([0-9]+(?:[._-][0-9a-z]+){0,4})\b/i,
    /\b((?:ch|chapter)[\s._-]*[0-9]+[a-z]?)\b/i,
    /\b([0-9]+(?:\.[0-9a-z]+){1,4})\b/i,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match?.[1]) return match[0].startsWith("v") ? match[0] : match[1];
    }
  }
  return normalizeVersionName(catalog.latestVersion || catalog.latest_version || catalog.version);
};

const getConfiguredGameExtensions = (appConfig) =>
  String(appConfig?.Library?.gameExtensions || "exe,swf,flv,f4v,rag,cmd,bat,jar,html")
    .split(",")
    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

module.exports = {
  sanitizePathSegment,
  normalizeVersionName,
  buildStructuredImportPath,
  toPositiveInteger,
  getLewdCornerIdFromGame,
  TARBALL_SUFFIXES,
  isCompoundTarballPath,
  getArchiveExtension,
  getConfiguredExtractionExtensions,
  isArchiveFilePath,
  isRarArchivePath,
  isSteamImportRow,
  getSteamIdFromGame,
  isGogImportRow,
  getGogIdFromGame,
  inferCatalogImportVersion,
  getConfiguredGameExtensions,
};
