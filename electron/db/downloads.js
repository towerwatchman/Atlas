"use strict";

// ── Download queue persistence ───────────────────────────────────────────────
//
// The queue survives restarts. A game download is long-running and users close
// the app mid-transfer, so the queue is state in the database rather than in
// memory — on relaunch, anything that was mid-flight comes back as paused with
// its byte count intact so it can resume instead of restarting.
//
// One row per queued item. Deliberately NOT one row per version: an item exists
// before we know what we got (the archive may contain a different version string
// than the thread claimed), so the version is resolved at completion and the
// item points at the record it belongs to.
//
// State machine:
//   queued      -> waiting for a worker slot
//   downloading -> bytes moving
//   paused      -> user paused, or the app was closed mid-transfer
//   verifying   -> download finished, checking the file is intact/complete
//   ready       -> bytes on disk and verified, WAITING FOR THE USER to
//                  confirm the version before anything is installed. A
//                  download never installs itself: the version string
//                  becomes a folder name and can replace an existing build,
//                  so it gets a confirmation step.
//   extracting  -> unpacking into the library
//   importing   -> attaching as a version to the record
//   done        -> finished, version attached
//   failed      -> gave up; `error` explains why, item stays for retry
//   canceled    -> user canceled; partial file removed
//
// `awaiting_file` is the watch-folder case: the item is real and visible in the
// UI, but Atlas is not fetching the bytes (a masked/CAPTCHA link the user is
// handling in a browser). It sits there until a matching file appears in the
// watch folder, then moves to verifying like any other.

const dbModule = require("./index");

const getDb = () => dbModule.db;

const DOWNLOADS_DDL = `
  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER REFERENCES games (record_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    creator TEXT,
    version TEXT,
    -- Where the bytes come from. url is empty for awaiting_file items.
    url TEXT,
    host TEXT,
    source TEXT,
    -- Absolute path of the file being written, once known.
    file_path TEXT,
    file_name TEXT,
    total_bytes INTEGER DEFAULT 0,
    received_bytes INTEGER DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    -- 'replace' swaps the installed version, 'add' keeps both. Decided when the
    -- item is queued so a completed download never has to stop and ask.
    on_complete TEXT NOT NULL DEFAULT 'replace',
    -- Lower runs first. Gaps are fine; reordering rewrites this.
    queue_order INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER,
    completed_at INTEGER,
    -- When the archive was installed into the library. Distinct from
    -- completed_at, which only means the bytes finished transferring.
    -- Null on a finished download that was never installed - including
    -- everything downloaded before the install step existed.
    installed_at INTEGER
  )
`;

const DOWNLOADS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_downloads_state ON downloads(state)`,
  `CREATE INDEX IF NOT EXISTS idx_downloads_order ON downloads(queue_order)`,
  `CREATE INDEX IF NOT EXISTS idx_downloads_record ON downloads(record_id)`,
];

// States that mean "this item is finished with, one way or another".
const TERMINAL_STATES = ["done", "canceled"];
// States the queue runner is allowed to pick up.
const RUNNABLE_STATES = ["queued"];
// States that were mid-flight if the app died. Recovered to paused on boot.
const INTERRUPTED_STATES = ["downloading", "verifying", "extracting", "importing"];

const now = () => Math.floor(Date.now() / 1000);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

const mapRow = (row) => {
  if (!row) return null;
  const total = Number(row.total_bytes) || 0;
  const received = Number(row.received_bytes) || 0;
  return {
    id: row.id,
    recordId: row.record_id,
    title: row.title,
    creator: row.creator || "",
    version: row.version || "",
    url: row.url || "",
    host: row.host || "",
    source: row.source || "",
    filePath: row.file_path || "",
    fileName: row.file_name || "",
    totalBytes: total,
    receivedBytes: received,
    // Only meaningful when the server told us a length. A chunked response with
    // no Content-Length reports 0, and the UI shows an indeterminate bar rather
    // than a fake percentage.
    percent: total > 0 ? Math.min(100, Math.round((received / total) * 1000) / 10) : null,
    state: row.state,
    error: row.error || "",
    onComplete: row.on_complete || "replace",
    queueOrder: Number(row.queue_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    installedAt: row.installed_at,
    // A finished download whose archive is still on disk and was never
    // installed. Drives the Install action, including for items that
    // predate the install step.
    installable: Boolean(row.file_path) && !row.installed_at
      && ['ready', 'done'].includes(row.state),
  };
};

const initializeDownloads = async () => {
  await run(DOWNLOADS_DDL);
  // Added after the table shipped, so existing installs need it bolted on.
  // Failure means it is already there.
  await run(`ALTER TABLE downloads ADD COLUMN installed_at INTEGER`).catch(() => {});
  for (const sql of DOWNLOADS_INDEXES) await run(sql);
  // Anything the app was actively working on when it exited is not actually in
  // progress any more. Park it as paused, keeping received_bytes so a resume can
  // pick up with a Range request rather than starting over.
  await run(
    `UPDATE downloads
        SET state = 'paused',
            error = 'Interrupted when Atlas closed',
            updated_at = ?
      WHERE state IN (${INTERRUPTED_STATES.map(() => "?").join(", ")})`,
    [now(), ...INTERRUPTED_STATES],
  );
};

const listDownloads = async ({ includeFinished = true } = {}) => {
  const rows = await all(
    includeFinished
      ? `SELECT * FROM downloads ORDER BY
           CASE state WHEN 'done' THEN 1 WHEN 'canceled' THEN 1 ELSE 0 END,
           queue_order ASC, id ASC`
      : `SELECT * FROM downloads
          WHERE state NOT IN (${TERMINAL_STATES.map(() => "?").join(", ")})
          ORDER BY queue_order ASC, id ASC`,
    includeFinished ? [] : TERMINAL_STATES,
  );
  return rows.map(mapRow);
};

const getDownload = async (id) => mapRow(await get(`SELECT * FROM downloads WHERE id = ?`, [id]));

const enqueueDownload = async ({
  recordId = null,
  title,
  creator = "",
  version = "",
  url = "",
  host = "",
  source = "",
  fileName = "",
  onComplete = "replace",
  state = null,
}) => {
  const clean = String(title || "").trim();
  if (!clean) return { success: false, error: "A title is required" };

  // Appended to the end of the queue. MAX + 1 rather than COUNT so removing
  // items never causes two rows to share a position.
  const tail = await get(`SELECT COALESCE(MAX(queue_order), -1) + 1 AS next FROM downloads`);
  const timestamp = now();
  // No URL means Atlas is not fetching this one — it is waiting for the file to
  // show up in the watch folder.
  const initialState = state || (String(url).trim() ? "queued" : "awaiting_file");

  const result = await run(
    `INSERT INTO downloads
       (record_id, title, creator, version, url, host, source, file_name,
        state, on_complete, queue_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recordId, clean, creator, version, url, host, source, fileName,
      initialState, onComplete === "add" ? "add" : "replace",
      tail?.next || 0, timestamp, timestamp,
    ],
  );
  return { success: true, id: result.lastID, item: await getDownload(result.lastID) };
};

// Partial update. Only the keys supplied are written, so a progress tick does not
// have to restate the whole row.
const updateDownload = async (id, patch = {}) => {
  const columns = {
    recordId: "record_id",
    title: "title",
    creator: "creator",
    version: "version",
    url: "url",
    host: "host",
    source: "source",
    filePath: "file_path",
    fileName: "file_name",
    totalBytes: "total_bytes",
    receivedBytes: "received_bytes",
    state: "state",
    error: "error",
    onComplete: "on_complete",
    queueOrder: "queue_order",
    completedAt: "completed_at",
    installedAt: "installed_at",
  };
  const assignments = [];
  const params = [];
  for (const [key, column] of Object.entries(columns)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      assignments.push(`${column} = ?`);
      params.push(patch[key]);
    }
  }
  if (assignments.length === 0) return { success: true, changes: 0 };
  assignments.push("updated_at = ?");
  params.push(now(), id);
  const result = await run(
    `UPDATE downloads SET ${assignments.join(", ")} WHERE id = ?`,
    params,
  );
  return { success: true, changes: result.changes };
};

const removeDownload = (id) => run(`DELETE FROM downloads WHERE id = ?`, [id]);

const clearFinishedDownloads = () =>
  run(
    `DELETE FROM downloads WHERE state IN (${TERMINAL_STATES.map(() => "?").join(", ")})`,
    TERMINAL_STATES,
  );

// The next item the runner should start, honouring queue order.
const claimNextQueued = async () => {
  const row = await get(
    `SELECT * FROM downloads
      WHERE state IN (${RUNNABLE_STATES.map(() => "?").join(", ")})
      ORDER BY queue_order ASC, id ASC LIMIT 1`,
    RUNNABLE_STATES,
  );
  return mapRow(row);
};

// Items parked waiting for a file to appear, newest first — the watch folder
// matcher tries these against each arriving file.
const listAwaitingFile = async () => {
  const rows = await all(
    `SELECT * FROM downloads WHERE state = 'awaiting_file' ORDER BY id DESC`,
  );
  return rows.map(mapRow);
};

// Persist a new explicit ordering. Positions are rewritten from the given list so
// the result is dense and unambiguous.
const reorderDownloads = async (ids = []) => {
  let position = 0;
  for (const id of ids) {
    await run(`UPDATE downloads SET queue_order = ?, updated_at = ? WHERE id = ?`, [
      position, now(), id,
    ]);
    position += 1;
  }
  return { success: true };
};

const countActive = async () => {
  const row = await get(
    `SELECT COUNT(*) AS total FROM downloads
      WHERE state NOT IN (${TERMINAL_STATES.map(() => "?").join(", ")})`,
    TERMINAL_STATES,
  );
  return Number(row?.total) || 0;
};

module.exports = {
  DOWNLOADS_DDL,
  DOWNLOADS_INDEXES,
  TERMINAL_STATES,
  INTERRUPTED_STATES,
  initializeDownloads,
  listDownloads,
  listAwaitingFile,
  getDownload,
  enqueueDownload,
  updateDownload,
  removeDownload,
  clearFinishedDownloads,
  claimNextQueued,
  reorderDownloads,
  countActive,
  mapRow,
};
