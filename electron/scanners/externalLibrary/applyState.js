"use strict";

// ── External library user state ──────────────────────────────────────────────
//
// Writes the USER's data from an external library manager onto a record that has
// already been created and matched. Runs after the version row and the source
// mappings exist, because most of it is keyed on the saved version.
//
// The guiding rule: nothing here may overwrite data the user already has in
// Atlas. An import is a source of new information, not an authority — someone
// re-running an import (or importing over a game they have already been playing)
// must not lose their own notes, ratings or tags. Every write below either fills
// a gap or merges.
//
// Deliberately NOT imported: forum metadata of any kind (status, type, catalog
// tags, description, changelog, community score). Atlas has all of it from its
// own catalog and it is refreshed on sync, so copying it in would create stale
// duplicates at best and get clobbered at worst.

const dbModule = require("../../db/index");
const {
  setGameNotes,
  setGamePlaystate,
  setVersionPlaystateByVersion,
  mergeGamePersonalRatings,
  recordGameLaunchStarted,
} = require("../../db/games");
const { bulkEditTags } = require("../../db/tagOverrides");
const {
  getCollections,
  createCollection,
  addGameToCollection,
} = require("../../db/collections");
const { RATING_MAX, COMMUNITY_TO_PERSONAL_FACTOR } = require("../../db/ratingCategories");

const getDb = () => dbModule.db;

const dbGet = (sql, params = []) =>
  new Promise((resolve) => {
    getDb().get(sql, params, (err, row) => resolve(err ? null : row || null));
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve) => {
    getDb().run(sql, params, function onRun(err) {
      resolve(err ? { changes: 0, error: err.message } : { changes: this.changes });
    });
  });

// F95Checker (and every other forum-derived tool) scores out of 5; Atlas's
// personal categories are out of 10. COMMUNITY_TO_PERSONAL_FACTOR is the same
// constant the card UI uses to show a community score on the personal scale, so
// the two conversions can never drift apart.
const toPersonalScale = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.max(1, Math.min(RATING_MAX, Math.round(number * COMMUNITY_TO_PERSONAL_FACTOR)));
};

// Collections are resolved by name, created on demand, and cached for the run so
// a 400-game import does not re-read the collection list 400 times.
const makeCollectionResolver = () => {
  let byName = null;
  return async (name) => {
    const clean = String(name || "").trim();
    if (!clean) return null;
    if (!byName) {
      const existing = await getCollections().catch(() => []);
      byName = new Map(
        (existing || []).map((row) => [String(row.name || "").toLowerCase(), row.id]),
      );
    }
    const key = clean.toLowerCase();
    if (byName.has(key)) return byName.get(key);
    const created = await createCollection({ name: clean });
    if (created?.success && created.id) {
      byName.set(key, created.id);
      return created.id;
    }
    // createCollection refuses duplicate names; if we raced or the cache was
    // stale, re-read once and use whatever is there now.
    const refreshed = await getCollections().catch(() => []);
    byName = new Map(
      (refreshed || []).map((row) => [String(row.name || "").toLowerCase(), row.id]),
    );
    return byName.get(key) || null;
  };
};

// Apply one row's user state.
//
// `savedVersion` is the version string the importer actually wrote, which can
// differ from the version we asked for (addVersion renames for uniqueness), so
// every version-keyed write uses it rather than the value off the source row.
const applyExternalLibraryState = async ({
  recordId,
  savedVersion,
  state,
  resolveCollection,
  options = {},
}) => {
  const id = Number.parseInt(recordId, 10);
  if (!Number.isInteger(id) || id <= 0 || !state) return { applied: [], notes: [] };

  const {
    importLabelsAsTags = true,
    importTabsAsCollections = true,
  } = options;

  const applied = [];
  const warnings = [];

  // ── Notes ─────────────────────────────────────────────────────────────────
  // Fill only. Someone re-importing must not lose notes they wrote in Atlas.
  if (state.notes) {
    const row = await dbGet(`SELECT notes FROM games WHERE record_id = ?`, [id]);
    const existing = String(row?.notes || "").trim();
    if (!existing) {
      const result = await setGameNotes(id, state.notes);
      if (result?.success) applied.push("notes");
    } else {
      warnings.push("notes-kept-existing");
    }
  }

  // ── Rating ────────────────────────────────────────────────────────────────
  // Lands in Story because Atlas has no single overall category. mergeGame-
  // PersonalRatings leaves every other category alone and lets an existing user
  // value win, so this can never erase a real rating.
  const scaledRating = toPersonalScale(state.rating);
  if (scaledRating !== null) {
    const result = await mergeGamePersonalRatings(id, { story: scaledRating });
    if (result?.success && !result.skipped) applied.push("rating");
  }

  // ── Last played ───────────────────────────────────────────────────────────
  // Reuses the launch recorder so games.last_played_r, games.last_played_version
  // and versions.last_played all move together, exactly as a real launch would.
  // No playtime is written: the external tools track a timestamp only.
  if (state.lastPlayed && savedVersion) {
    const result = await recordGameLaunchStarted(id, savedVersion, state.lastPlayed).catch(() => null);
    if (result?.success) applied.push("lastPlayed");
  }

  // ── Date added ────────────────────────────────────────────────────────────
  // Preserve when the user originally started tracking the game, rather than
  // stamping every row with the moment of import. Only moves the date backwards.
  if (state.dateAdded && savedVersion) {
    const result = await dbRun(
      `UPDATE versions SET date_added = ?
       WHERE record_id = ? AND version = ?
         AND (date_added IS NULL OR date_added = 0 OR date_added > ?)`,
      [state.dateAdded, id, savedVersion, state.dateAdded],
    );
    if (result.changes) applied.push("dateAdded");
  }

  // ── Finished ──────────────────────────────────────────────────────────────
  // The external tools record WHICH version was finished, and it is routinely an
  // older build than the installed one. Only the version we actually imported
  // can carry a per-version playstate, so:
  //   finished version == imported version -> mark that version finished
  //   finished version != imported version -> the finished build is not in
  //     Atlas, so mark the TITLE finished and report it, rather than silently
  //     attaching "finished" to a build the user never completed.
  if (state.isFinished && state.finishedVersion) {
    const finished = String(state.finishedVersion).trim();
    const matchesImported =
      savedVersion &&
      (finished === String(savedVersion).trim() ||
        finished === String(state.installedVersion || "").trim());
    if (matchesImported) {
      const result = await setVersionPlaystateByVersion(id, savedVersion, "finished");
      if (result?.success) applied.push("finishedVersion");
      else warnings.push("finished-version-not-found");
    } else {
      const result = await setGamePlaystate(id, "finished");
      if (result?.success) applied.push("finishedTitle");
      warnings.push("finished-older-version");
    }
  }

  // ── Labels -> user tags ───────────────────────────────────────────────────
  // bulkEditTags merges into the effective (catalog + user) list rather than
  // replacing it. Note the cost it documents: any tag edit writes an override
  // snapshot, and an override stops later catalog refreshes from updating the
  // tag list for that game. That is why this is opt-in in the import step.
  if (importLabelsAsTags && Array.isArray(state.labels) && state.labels.length > 0) {
    const result = await bulkEditTags([id], { add: state.labels }).catch(() => null);
    if (result?.success && result.changed) applied.push("labels");
  }

  // ── Tab -> collection ─────────────────────────────────────────────────────
  if (importTabsAsCollections && state.tab && typeof resolveCollection === "function") {
    const collectionId = await resolveCollection(state.tab);
    if (collectionId) {
      const result = await addGameToCollection(collectionId, id).catch(() => null);
      if (result?.success) applied.push("collection");
    }
  }

  return { applied, warnings };
};

module.exports = {
  applyExternalLibraryState,
  makeCollectionResolver,
  toPersonalScale,
};
