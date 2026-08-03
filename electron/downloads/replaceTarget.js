"use strict";

// ── Replace-target selection ─────────────────────────────────────────────────
//
// Which existing version an installing download should replace.
//
// This is separated out and pure because getting it wrong DELETES A GAME
// DIRECTORY. It previously lived inline in the downloads-install handler, where
// it could not be tested, and it was wrong in a way that no amount of reading
// revealed: it filtered on `entry.is_installed`, and the version objects
// returned by getGame() carry `isInstalled`. `undefined !== false` is true, so
// every row passed the filter and the "installed version" was simply the first
// row in table order. On a single-version game that is right by luck; on a
// multi-version game it targets an arbitrary build.
//
// The rules, in order:
//
//   1. An explicit version id from the user wins. The install modal now asks,
//      so an inferred answer is only a fallback for a caller that did not.
//   2. Otherwise the record's selected version, which is the build the detail
//      page shows as current.
//   3. Otherwise the sole installed version, if there is exactly one.
//   4. Otherwise nothing, and say why. Guessing between several installed
//      builds is precisely the case that must ask rather than pick.
//
// Every outcome carries a `reason`. The caller reports it: a replace that
// silently does not happen is the failure mode this whole module exists to end.

/** True when a version object from getGame() is installed on disk. */
const isInstalledVersion = (entry) => {
  if (!entry) return false;
  // Accept both spellings. `isInstalled` is what mapVersionRow emits; the
  // snake_case form is accepted so a raw database row also works rather than
  // silently reading as installed.
  if (typeof entry.isInstalled === "boolean") return entry.isInstalled;
  if (typeof entry.is_installed === "boolean") return entry.is_installed;
  if (entry.installState) return entry.installState === "installed";
  // No installed flag at all: fall back to having a path, which is what
  // "installed" means everywhere else in the schema.
  return Boolean(entry.game_path || entry.gamePath);
};

const versionIdOf = (entry) => {
  const id = Number.parseInt(entry?.version_id ?? entry?.versionId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const versionNameOf = (entry) => String(entry?.version ?? "").trim();

/**
 * Choose the version a download should replace.
 *
 * @param {object} params
 * @param {Array}  params.versions        getGame().versions
 * @param {number|string|null} [params.selectedVersionId]  record.selected_version_id
 * @param {number|string|null} [params.requestedVersionId] the user's explicit choice
 * @returns {{version:string, versionId:number|null, reason:string, ambiguous?:boolean,
 *            candidates?:Array<{versionId:number|null, version:string}>}}
 */
function chooseReplaceTarget({
  versions = [],
  selectedVersionId = null,
  requestedVersionId = null,
} = {}) {
  const rows = (Array.isArray(versions) ? versions : []).filter(
    (entry) => entry && versionNameOf(entry),
  );
  const none = (reason, extra = {}) => ({ version: "", versionId: null, reason, ...extra });

  if (rows.length === 0) return none("no-versions");

  // 1. The user's explicit choice. Validated against the record rather than
  //    trusted, so a stale id from a modal opened before the list changed
  //    cannot point at another game's row.
  const requested = Number.parseInt(requestedVersionId, 10);
  if (Number.isInteger(requested) && requested > 0) {
    const match = rows.find((entry) => versionIdOf(entry) === requested);
    if (!match) return none("requested-version-not-found");
    return {
      version: versionNameOf(match),
      versionId: versionIdOf(match),
      reason: "user-selected",
    };
  }

  const installed = rows.filter(isInstalledVersion);

  // 2. The record's selected version, if it is one of the installed ones. A
  //    selected-but-missing version has no files to replace.
  const selected = Number.parseInt(selectedVersionId, 10);
  if (Number.isInteger(selected) && selected > 0) {
    const match = installed.find((entry) => versionIdOf(entry) === selected);
    if (match) {
      return {
        version: versionNameOf(match),
        versionId: versionIdOf(match),
        reason: "record-selected-version",
      };
    }
  }

  // 3. Exactly one installed build: unambiguous.
  if (installed.length === 1) {
    return {
      version: versionNameOf(installed[0]),
      versionId: versionIdOf(installed[0]),
      reason: "only-installed-version",
    };
  }

  if (installed.length === 0) {
    return none("no-installed-version");
  }

  // 4. Several installed builds and nothing to disambiguate them. Picking one
  //    would delete a directory the user never chose.
  return none("ambiguous", {
    ambiguous: true,
    candidates: installed.map((entry) => ({
      versionId: versionIdOf(entry),
      version: versionNameOf(entry),
    })),
  });
}

// Why a replace did not happen, in words a user can act on. The handler used to
// discard these entirely — it only caught thrown errors, and every one of these
// outcomes returns rather than throws, so all of them were invisible.
const REPLACE_SKIP_MESSAGES = {
  "no-versions": "This game has no other versions, so there was nothing to replace. The download was added as a new version.",
  "no-installed-version": "No installed version was found to replace, so the download was added as a new version.",
  "requested-version-not-found": "The version you chose to replace no longer exists. The download was added as a new version instead.",
  ambiguous: "This game has more than one installed version, so Atlas did not guess which to replace. The download was added as a new version — remove the old one from the game's Versions tab.",
  "same-version-label": "The new version has the same name as the one it would replace, so the old build was left in place.",
  "same-path": "The new files landed in the same folder as the version being replaced, so nothing was removed.",
  "version-not-found": "The version to replace was not found in the database, so nothing was removed.",
  "not-allowed": "Atlas would not delete the old version's folder because it is not recorded against this game.",
};

/** A user-facing sentence for a replace outcome, or '' when it succeeded. */
function describeReplaceOutcome(outcome = {}) {
  if (outcome.replaced) return "";
  const key = outcome.reason || "";
  if (REPLACE_SKIP_MESSAGES[key]) return REPLACE_SKIP_MESSAGES[key];
  // An unmapped reason is still reported rather than swallowed: an unexplained
  // skip is what made this undiagnosable in the first place.
  return key
    ? `The old version was not removed (${key}).`
    : "The old version was not removed.";
}

module.exports = {
  chooseReplaceTarget,
  describeReplaceOutcome,
  isInstalledVersion,
  REPLACE_SKIP_MESSAGES,
};
