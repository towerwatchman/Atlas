"use strict";

// ── Diagnostics that survive a packaged build ────────────────────────────────
//
// console.log from the main process goes to stdout, and a packaged Windows app
// is built for the GUI subsystem with no console attached -- so in the only
// environment users run, it goes nowhere. main.js already records this for the
// updater ("electron-updater's console output only appears in the main-process
// log, which is invisible in packaged builds") and solved it there with a
// dedicated file. Every other subsystem kept logging into the void.
//
// That is not a theoretical gap. The MEGA hashcash worker failed on every
// packaged machine MEGA challenged, and the only evidence of it -- the elapsed
// time that would have shown a 30ms "timeout" against a 300-second budget -- was
// written to a stream nobody could read. The bug was reported as "sign-in does
// not work" because that was genuinely all anyone could see.
//
// ── WHERE IT GOES ────────────────────────────────────────────────────────────
//
// <dataDir>/logs/atlas.log, via app.getPath('logs'), which main.js points at the
// Atlas data folder alongside userData, sessionData, cache and crashDumps. That
// means it follows a portable install rather than landing in %APPDATA%, and it
// sits beside the data a user is already told to back up.
//
// Note that app.getPath('userData') is REDIRECTED too -- to <dataDir>/chrome --
// so it is not the OS default and not the right home for a log a human is meant
// to find. 'logs' is the path main.js set aside for exactly this.
//
// In dev the redirect does not run (main.js guards it with process.defaultApp),
// so this falls back to Electron's default log directory. That is fine: dev runs
// in a terminal where console output is visible anyway.

const fs = require("fs");
const path = require("path");

const FILE_NAME = "atlas.log";
// Rotated at 2MB, one generation kept. Large enough to hold a long session,
// small enough that a user can attach it to a bug report.
const MAX_BYTES = 2 * 1024 * 1024;

let cachedDir;

function logDirectory() {
  if (cachedDir !== undefined) return cachedDir;
  cachedDir = null;
  try {
    const { app } = require("electron");
    // 'logs' is redirected to <dataDir>/logs by main.js in packaged builds.
    cachedDir = app.getPath("logs");
  } catch {
    // Not under Electron -- tests, or a require before app is ready. Logging is
    // diagnostic; it must never be the reason something fails.
  }
  return cachedDir;
}

function rotate(file) {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    fs.renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or the rename lost a race with another window. Either way
    // the append below still works.
  }
}

/**
 * Append one structured line.
 *
 * JSON payload rather than prose because these lines are read by whoever is
 * debugging a machine they cannot touch, and a field that is always present and
 * always named the same thing can be searched for. Values that are `undefined`
 * are dropped by JSON.stringify, so callers can pass optional fields inline.
 *
 * Mirrored to console so a dev terminal still shows everything.
 */
function write(tag, payload) {
  const stamp = new Date().toISOString();
  let body;
  try {
    body = typeof payload === "string" ? payload : JSON.stringify(payload);
  } catch {
    body = String(payload);
  }
  const line = `[${stamp}] [${tag}] ${body}`;
  console.log(line);

  const dir = logDirectory();
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, FILE_NAME);
    rotate(file);
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    // A log that throws would turn a diagnostic into an outage. An unwritable
    // data folder is already surfaced by main.js's dataWriteState.
  }
}

/** The path a user should be pointed at, or null when it cannot be determined. */
function logFilePath() {
  const dir = logDirectory();
  return dir ? path.join(dir, FILE_NAME) : null;
}

module.exports = { write, logFilePath, FILE_NAME, MAX_BYTES };
