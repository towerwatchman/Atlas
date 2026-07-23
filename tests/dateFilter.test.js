"use strict";

/**
 * Regression coverage for the sidebar date filter.
 *
 * Bug: normalizeDateValueMs() checked the generic pure-digit epoch branch
 * BEFORE the compact YYYYMMDD branch. An 8-digit calendar date like "20260713"
 * is all digits, so it was multiplied by 1000 and mapped to 1970, then dropped
 * from every date-range filter. Any game whose release date was stored compact
 * (common from Steam/some scrapers) silently vanished from date filtering.
 *
 * This test mirrors the exact normalize + bounds + applyDateFilter logic from
 * src/hooks/useFilters.js. It is intentionally self-contained (the hook pulls
 * in React/JSX and cannot be required directly under plain node), so if the
 * logic in useFilters.js changes, update this copy to match.
 */

const assert = require("assert");

const parseDateParts = (year, month, day) => {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date.getTime();
};

const normalizeDateValueMs = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value > 100000000000 ? value : value * 1000;
  }
  const normalized = String(value).trim();
  if (!normalized) return null;
  const compactDate = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDate) {
    const year = Number(compactDate[1]);
    const parsedCompact = parseDateParts(compactDate[1], compactDate[2], compactDate[3]);
    if (parsedCompact !== null && year >= 1970 && year <= 2100) return parsedCompact;
  }
  if (/^\d+$/.test(normalized)) {
    const n = Number(normalized);
    if (Number.isFinite(n)) {
      if (n <= 0) return null;
      return n > 100000000000 ? n : n * 1000;
    }
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const getDateRangeBounds = (range, dateFrom = "", dateTo = "") => {
  const now = Date.now();
  if (range === "7d") return { min: now - 7 * 86400000, max: now };
  if (range === "30d") return { min: now - 30 * 86400000, max: now };
  if (range === "90d") return { min: now - 90 * 86400000, max: now };
  if (range === "year") {
    const y = new Date(now).getFullYear();
    return { min: new Date(y, 0, 1).getTime(), max: new Date(y + 1, 0, 1).getTime() - 1 };
  }
  if (range === "custom") {
    const f = dateFrom ? Date.parse(`${dateFrom}T00:00:00`) : Number.NaN;
    const t = dateTo ? Date.parse(`${dateTo}T23:59:59.999`) : Number.NaN;
    const min = Number.isFinite(f) ? f : null;
    const max = Number.isFinite(t) ? t : null;
    if (min === null && max === null) return null;
    return { min, max };
  }
  return null;
};

const getDateFieldValue = (g, field) => {
  if (field === "releaseDate")
    return normalizeDateValueMs(g.release_date ?? g.releaseDate ?? g.steam_release_date ?? g.steamReleaseDate);
  if (field === "lastInstalled") return normalizeDateValueMs(g.lastInstalled);
  if (field === "lastPlayed") return normalizeDateValueMs(g.lastPlayed);
  if (field === "wishlistAdded") return normalizeDateValueMs(g.flagged_at ?? g.flaggedAt);
  return null;
};

const applyDateFilter = (games, f) => {
  if (!(f.dateField !== "none" && f.dateRange !== "any")) return games;
  const b = getDateRangeBounds(f.dateRange, f.dateFrom, f.dateTo);
  if (!b) return games;
  return games.filter((g) => {
    const v = getDateFieldValue(g, f.dateField);
    if (v === null) return false;
    if (b.min !== null && v < b.min) return false;
    if (b.max !== null && v > b.max) return false;
    return true;
  });
};

let pass = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  pass++;
};

const day = 86400000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const compact = (ms) => iso(ms).replace(/-/g, "");

// ── the core regression: compact dates must parse as calendar dates ──────────
check("compact 20260713 -> July 2026", new Date(normalizeDateValueMs("20260713")).getUTCFullYear() === 2026);
check("compact 20260713 month", new Date(normalizeDateValueMs("20260713")).getUTCMonth() === 6);
check("compact != 1970", new Date(normalizeDateValueMs("20260713")).getUTCFullYear() !== 1970);

// ── epoch handling must still work (no regression) ───────────────────────────
check("epoch seconds still parse", new Date(normalizeDateValueMs(1699999999)).getUTCFullYear() === 2023);
check("epoch ms still parse", normalizeDateValueMs(now) === now);
check("iso string still parses", normalizeDateValueMs("2026-07-13") !== null);

// ── end-to-end: a compact-dated game is included in ranges it belongs to ─────
const games = [
  { title: "iso", release_date: iso(now - 10 * day) },
  { title: "compact", release_date: compact(now - 10 * day) },
  { title: "old", release_date: iso(now - 200 * day) },
  { title: "none" },
];
const titles = (f) => applyDateFilter(games, f).map((g) => g.title).sort().join(",");

check("compact game in 30d range", titles({ dateField: "releaseDate", dateRange: "30d" }) === "compact,iso");
check("compact game in 90d range", titles({ dateField: "releaseDate", dateRange: "90d" }) === "compact,iso");
check("compact excluded from 7d", titles({ dateField: "releaseDate", dateRange: "7d" }) === "");
check(
  "custom from-only includes compact",
  titles({ dateField: "releaseDate", dateRange: "custom", dateFrom: iso(now - 30 * day), dateTo: "" }) === "compact,iso",
);
check(
  "custom bounded excludes old",
  titles({ dateField: "releaseDate", dateRange: "custom", dateFrom: iso(now - 30 * day), dateTo: iso(now - 5 * day) }) === "compact,iso",
);
check("none => passthrough", titles({ dateField: "none", dateRange: "30d" }) === "compact,iso,none,old");
check("missing date excluded", !applyDateFilter(games, { dateField: "releaseDate", dateRange: "90d" }).some((g) => g.title === "none"));

console.log(`\ndateFilter: ${pass} checks passed.\n`);
