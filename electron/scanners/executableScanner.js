const fsp = require("fs").promises;
const path = require("path");
const { isImportBlacklisted } = require("./importBlacklist");

// ── Executable scanner ───────────────────────────────────────────────────────
//
// Finds the launcher inside a game folder. Async and breadth-first, and it stops
// the moment any directory yields a match.
//
// It used to be `fs.readdirSync` in a loop, on the main process. That is fine
// right up until it isn't: the walk only descends into a directory when the one
// above it had no matches, so a RenPy game (launcher under `game/`), an HTML
// game with no .exe at all, or any archive whose contents miss the configured
// extension list sends it through the ENTIRE extracted tree with the event loop
// blocked the whole way. Nothing paints, no IPC resolves, every window freezes.
// Installing a 40k-file game hung the client outright.
//
// This is the same fix electron/db/versions.js already made for the startup
// exec-path repair (see findLaunchablesInFolderAsync there) — awaiting each
// readdir hands control back between directories, so a slow walk is slow instead
// of fatal. The install path never got the same treatment; now it has.
//
// ── Why breadth-first, and why it stops ──────────────────────────────────────
//
// The old walk used a LIFO stack, so it went depth-first down whichever branch
// happened to be last, and "don't descend" only applied to the directory that
// matched — sibling branches already on the stack were still walked to the
// bottom. It also collected across the whole tree and every caller then took
// [0], so most of that work was thrown away.
//
// Breadth-first reaches the shallowest executable first, which is the one that
// is almost always right: the launcher sits at the game root, and anything
// deeper is a bundled runtime (`lib/python.exe`, `www/nw.exe`). Returning as
// soon as a directory produces matches means a normal game costs ONE readdir,
// and the pathological case costs a level of the tree rather than all of it.
//
// The trade is real and worth stating: a launcher buried below a directory that
// happens to contain some other matching file will no longer be found. Every
// caller takes [0] and the shallowest match is what [0] meant in practice, so
// this changes which single path is picked only in trees where the old answer
// was already arbitrary.

/**
 * @param {string} dir              Folder to search.
 * @param {string[]} extensions     Allowed extensions, without dots.
 * @returns {Promise<string[]>}     Paths relative to `dir`, shallowest first.
 *                                  Empty when nothing matches.
 */
async function findExecutables(dir, extensions) {
  if (!dir) return [];

  const allowed = new Set(
    (Array.isArray(extensions) ? extensions : [])
      .map((value) => String(value || "").trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean),
  );
  if (allowed.size === 0) return [];

  // FIFO. The old stack was LIFO, which is what made the walk depth-first.
  let level = [dir];

  while (level.length > 0) {
    const nextLevel = [];

    for (const current of level) {
      let items;
      try {
        items = await fsp.readdir(current, { withFileTypes: true });
      } catch (err) {
        // An unreadable directory is skipped, not fatal. A permission-denied
        // subfolder should not cost the caller its executable.
        console.warn(`Cannot read directory ${current}: ${err.message}`);
        continue;
      }

      const matches = [];
      for (const item of items) {
        const fullPath = path.join(current, item.name);

        if (item.isDirectory()) {
          nextLevel.push(fullPath);
          continue;
        }
        if (!item.isFile()) continue;

        const ext = path.extname(item.name).toLowerCase().slice(1);
        if (!allowed.has(ext)) continue;
        // `-32` skips the 32-bit twin that ships beside the real launcher.
        if (isImportBlacklisted(item.name) || item.name.toLowerCase().includes("-32")) continue;

        matches.push(path.relative(dir, fullPath));
      }

      if (matches.length > 0) {
        // Done — the whole walk, not just this branch. Sorted so a folder with
        // several candidates returns the same [0] every run rather than
        // whatever order the filesystem reported.
        matches.sort((a, b) => a.localeCompare(b));
        console.log(`Executable scan matched in ${current}: ${matches.length} candidate(s)`);
        return matches;
      }
    }

    level = nextLevel;
  }

  // Worth logging: the caller is about to store a blank exec path, and the
  // configured extension list is the usual reason.
  console.log(`Executable scan found nothing under ${dir}`);
  return [];
}

module.exports = { findExecutables };
