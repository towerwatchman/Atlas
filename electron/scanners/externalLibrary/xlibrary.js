"use strict";

// ── XLibrary library reader ──────────────────────────────────────────────────
//
// Reads an XLibrary JSON export and turns it into importer rows in the same
// shape f95scanner.js and f95checker.js emit, so the scan review table, match
// resolution and import writer all work unchanged.
//
// ── Two inputs, one reader ───────────────────────────────────────────────────
//
// XLibrary keeps its library as JSON in two places, and both are read here
// because a user will reach for whichever they have:
//
//   1. The LIVE file, at %APPDATA%/xlibrary/canonical/library.games.json. This
//      is what `locate()` looks for, so the usual case needs no file picker.
//   2. An EXPORT the user asks XLibrary to write, named
//      `xlibrary-data-<date>.json`, which is what someone hands over when the
//      library is on another machine.
//
// The two differ only in wrapping: the export is `{ games: [...], settings: {} }`
// while the canonical file is the games array on its own. Both shapes are
// accepted and which one was read is reported back, because the difference
// changes what "up to date" means and the UI should not have to guess.
//
// Neither is transactional. Unlike the F95Checker path there is no journal
// sidecar to tell us a write was in progress, so a file caught mid-write parses
// as malformed JSON — which is reported as exactly that rather than as an empty
// library. The file's own mtime is the only staleness signal there is, so it is
// read and surfaced.
//
// ── Shape, verified against a real 2,348-game export (schemaVersion 4) ───────
//
//   games[].id                 A UUID, not a forum id. Never usable as an f95_id.
//   games[].externalLinks[]    { providerId, externalId, url, addedAt, metadata }.
//                              providerId is one of f95zone / lewdcorner /
//                              steam / itch / dlsite / manual. The f95zone
//                              entry's externalId IS the thread id, and its url
//                              carries it too, so the id is cross-checked
//                              against the url rather than trusted blind.
//   games[].primaryProvider    Which of those links the user considers canonical.
//                              'manual' means a hand-made entry, so it plays the
//                              same role F95Checker's `custom` column does.
//   games[].launchSettings     { configurations: [{ id, name, type,
//                              executablePath, launchParameters, useSandboxie,
//                              sandboxName }], defaultConfigurationId }.
//                              Paths are absolute. `type` was 'exe' for all 277
//                              configurations in the reference export.
//   games[].version            Latest version known from the thread.
//   games[].installedVersion   What the user has on disk.
//   games[].completionStatus   Not Started / In Progress / Completed / In Queue /
//                              Waiting for Update / Abandoned. This is the
//                              user's own progress and maps onto Atlas's
//                              playstate — NOT to be confused with `status`,
//                              which is the FORUM's development status
//                              (Completed / Abandoned / Onhold) and is catalog
//                              metadata Atlas already has.
//   games[].rating             The user's overall score, 1-5.
//   games[].categoryRatings    { story, graphics, gameplay, grindability }, 1-5.
//                              Three of those four are Atlas categories by name.
//   games[].totalPlaytime      SECONDS. See the note on units below.
//   games[].journalEntries[]   Two kinds in one array, separated by `type`:
//                              'session' entries are launch telemetry carrying
//                              sessionData.duration, everything else is a note
//                              the user wrote. Mixing them into notes would
//                              paste empty strings between real entries.
//   games[].versionHistory[]   { version, lastPlayedAt } per played build.
//   games[].customTags[]       The user's own tags. The separate `tags` array is
//                              forum tags and is NOT imported.
//   games[].lastPlayedAt       ISO 8601 string, not a unix timestamp.
//   games[].createdAt          When the user added it — becomes date added.
//
// ── Playtime units ──────────────────────────────────────────────────────────
//
// `totalPlaytime` is in SECONDS, and this is worth being explicit about because
// reading it as minutes inflates every figure sixtyfold. Evidence from the
// reference export: totalPlaytime equals the sum of that game's session
// durations in all 22 cases, and one game records two sessions whose
// `startedAt` values are six seconds apart with durations of 88 and 82 —
// impossible as minutes. Atlas stores minutes, so values are converted, and
// anything under thirty seconds rounds to zero and is skipped rather than
// written as a bogus one-minute play.
//
// ── Deliberately NOT imported ───────────────────────────────────────────────
//
// Forum metadata of every kind: `tags`, `status`, `description`, `cover`,
// `screenshots`, `releaseDate`, `engine` beyond a spelling normalisation, and
// the community rating inside externalLinks[].metadata.f95.rating. Atlas has all
// of it from its own catalog and refreshes it, so copying it in would create
// stale duplicates. Same policy as the F95Checker reader.
//
// `steam` / `itch` / `dlsite` links are read for identification only and are
// NOT turned into a steamId. A store link the user pasted is not evidence of an
// owned, installed Steam copy, and emitting a steamId would divert the row down
// the importer's Steam mapping path (`isSteamImportRow`), which mounts the game
// as a Steam version in place. The link is preserved on the row so it can still
// be shown.

const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

// Not a fixed filename — XLibrary stamps the export with its date. Used only as
// placeholder text in the picker and the Settings card.
const EXPORT_FILENAME_HINT = "xlibrary-data-<date>.json";

// The schema this reader was written against. A newer export is still read (the
// fields below are additive in practice) but the mismatch is reported so an
// unexpected shape is attributable instead of mysterious.
const KNOWN_SCHEMA_VERSION = 4;

// ── Vocabulary mapping ──────────────────────────────────────────────────────

// XLibrary's completionStatus -> Atlas playstate. Atlas's set is
// finished/played/dropped/on_hold/planned (see db/playstates.js), plus null for
// "no playstate", which is what "Not Started" means: the user has not started
// it, which is not the same as having deliberately shelved it.
const COMPLETION_TO_PLAYSTATE = {
  "not started": null,
  "in progress": "played",
  completed: "finished",
  "in queue": "planned",
  "waiting for update": "on_hold",
  abandoned: "dropped",
};

// Engine spellings. XLibrary's values come from F95 threads so they mostly match
// Atlas already; this only reconciles the handful that do not. Engine matters
// only for rows that fail to match the catalog — a matched row takes the
// catalog's engine — but `isBadScanRow` requires the field to be non-empty, so
// passing a real value through is what keeps an unmatched row importable.
const ENGINE_ALIASES = {
  renpy: "Ren'Py",
  "ren'py": "Ren'Py",
  "ren py": "Ren'Py",
  rpgm: "RPGM",
  "rpg maker": "RPGM",
  "rpgmaker": "RPGM",
  unity: "Unity",
  unreal: "Unreal Engine",
  "unreal engine": "Unreal Engine",
  html: "HTML",
  webgl: "WebGL",
  flash: "Flash",
  qsp: "QSP",
  "wolf rpg": "Wolf RPG",
  wolfrpg: "Wolf RPG",
  java: "Java",
  tads: "Tads",
  // Their catch-all. Atlas uses "Others" too, so it passes through unchanged.
  others: "Others",
  other: "Others",
};

const normalizeEngine = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "Unknown";
  return ENGINE_ALIASES[text.toLowerCase()] || text;
};

const normalizeCompletionStatus = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  // An unrecognised status is left alone rather than guessed at: writing the
  // wrong playstate is worse than writing none, and `undefined` here is
  // distinguishable from a deliberate null.
  if (!key) return { playstate: null, known: true };
  if (!(key in COMPLETION_TO_PLAYSTATE)) return { playstate: null, known: false };
  return { playstate: COMPLETION_TO_PLAYSTATE[key], known: true };
};

// ── Small helpers ───────────────────────────────────────────────────────────

const cleanText = (value) => String(value ?? "").trim();

const toPositiveInt = (value) => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
};

/** ISO 8601 -> unix SECONDS, to match what the F95Checker path already emits. */
const isoToUnixSeconds = (value) => {
  const text = cleanText(value);
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  const seconds = Math.floor(ms / 1000);
  return seconds > 0 ? seconds : null;
};

/** Seconds -> whole minutes. Anything under 30s is not a minute of play. */
const secondsToMinutes = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds / 60);
};

// Thread ids out of a source URL, same XenForo shapes the F95Checker reader
// handles: /threads/12345 or /threads/some-slug.12345/ with an optional trailing
// /post-N.
const THREAD_ID_PATTERNS = {
  f95zone: /(?:^|\/\/|\.)f95zone\.to\/threads\/(?:[^/?#]*\.)?(\d+)/i,
  lewdcorner: /(?:^|\/\/|\.)lewdcorner\.com\/threads\/(?:[^/?#]*\.)?(\d+)/i,
};

const extractThreadId = (url, provider) => {
  const match = THREAD_ID_PATTERNS[provider]?.exec(String(url ?? ""));
  const id = match ? Number.parseInt(match[1], 10) : NaN;
  return Number.isInteger(id) && id > 0 ? String(id) : "";
};

/**
 * The forum id for one provider, cross-checked between the two places XLibrary
 * records it.
 *
 * `externalId` and the id inside `url` should agree. When they disagree the URL
 * wins and the disagreement is reported: the URL is what the user can click and
 * verify, whereas externalId is a field an importer wrote and could have
 * mangled. When only one is present, that one is used.
 */
const resolveProviderId = (link, provider) => {
  const declared = cleanText(link?.externalId);
  const fromUrl = extractThreadId(link?.url, provider);
  const declaredValid = /^\d+$/.test(declared) && toPositiveInt(declared) !== null;
  if (declaredValid && fromUrl && declared !== fromUrl) {
    return { id: fromUrl, conflicted: true, declaredId: declared };
  }
  return { id: fromUrl || (declaredValid ? declared : ""), conflicted: false, declaredId: declared };
};

const linksByProvider = (externalLinks) => {
  const out = new Map();
  for (const link of Array.isArray(externalLinks) ? externalLinks : []) {
    const provider = cleanText(link?.providerId).toLowerCase();
    if (!provider) continue;
    // First link per provider wins. No game in the reference export had two of
    // the same provider, and if one ever does, the earliest is the one the user
    // added deliberately rather than a later duplicate.
    if (!out.has(provider)) out.set(provider, link);
  }
  return out;
};

// ── Launch configurations ───────────────────────────────────────────────────

/**
 * Turn XLibrary's launch configurations into the one folder + executable an
 * Atlas version row can hold.
 *
 * The default configuration decides the folder. Other configurations in that
 * SAME folder become alternatives in the review table's executable picker —
 * "Heart Problems" ships a main build and a Christmas special side by side, and
 * both are legitimate launch targets for one install. Configurations pointing
 * somewhere else entirely describe a second install of the same game, which one
 * version row cannot represent; those are counted and reported rather than
 * silently picked between.
 *
 * A configuration whose path does not resolve on disk is treated exactly as the
 * F95Checker reader treats a missing executable: the resolved path is kept so
 * the UI can say what was looked for, and the row goes to the wishlist instead
 * of importing as a broken install.
 */
const resolveLaunchConfigurations = (launchSettings) => {
  const configurations = Array.isArray(launchSettings?.configurations)
    ? launchSettings.configurations.filter(Boolean)
    : [];
  const empty = {
    folder: "",
    execPath: "",
    singleExecutable: "",
    executables: [],
    selectedValue: "",
    missing: false,
    recordedPath: "",
    otherFolderConfigs: 0,
    configurationCount: configurations.length,
  };
  if (configurations.length === 0) return empty;

  const defaultId = cleanText(launchSettings?.defaultConfigurationId);
  const preferred =
    configurations.find((config) => cleanText(config.id) === defaultId) || configurations[0];
  const preferredPath = cleanText(preferred?.executablePath);
  if (!preferredPath) return { ...empty, configurationCount: configurations.length };

  const stat = (target) => {
    try {
      return fs.statSync(target);
    } catch {
      return null;
    }
  };

  const preferredStat = stat(preferredPath);
  if (!preferredStat) {
    return {
      ...empty,
      missing: true,
      recordedPath: preferredPath,
      configurationCount: configurations.length,
    };
  }

  // A configuration may point at a folder rather than an executable. Atlas needs
  // a launchable to create a version row, so this is reported as missing rather
  // than accepted as an install — the same outcome the F95Checker reader
  // produces for a directory entry with no executable beneath it.
  if (preferredStat.isDirectory()) {
    return {
      ...empty,
      missing: true,
      recordedPath: preferredPath,
      configurationCount: configurations.length,
    };
  }

  const folder = path.dirname(preferredPath);
  const singleExecutable = path.basename(preferredPath);

  // Siblings in the same folder that also exist on disk.
  const siblings = [];
  let otherFolderConfigs = 0;
  for (const config of configurations) {
    const candidate = cleanText(config.executablePath);
    if (!candidate || candidate === preferredPath) continue;
    if (path.dirname(candidate) !== folder) {
      otherFolderConfigs += 1;
      continue;
    }
    if (!stat(candidate)?.isFile()) continue;
    const name = path.basename(candidate);
    if (name !== singleExecutable && !siblings.includes(name)) siblings.push(name);
  }

  const executableNames = [singleExecutable, ...siblings];
  return {
    folder,
    execPath: preferredPath,
    singleExecutable,
    // Same {key, value} shape the folder scanner emits, so the review table's
    // executable dropdown works without knowing where the row came from.
    executables: executableNames.map((name) => ({ key: name, value: name })),
    selectedValue: singleExecutable,
    missing: false,
    recordedPath: preferredPath,
    otherFolderConfigs,
    configurationCount: configurations.length,
  };
};

// ── Journal entries ─────────────────────────────────────────────────────────

const isSessionEntry = (entry) => cleanText(entry?.type).toLowerCase() === "session";

/**
 * The user's written entries, flattened into one notes string.
 *
 * Atlas has a single notes field per game and XLibrary has a dated, versioned,
 * optionally-pinned list, so something has to be lost. What is kept is the date
 * and the version each note was written against, because a note reading "the
 * art is amazing, on chapter 4" is only meaningful next to the build it
 * describes. Pinned entries lead, then chronological order.
 */
const buildNotes = (journalEntries) => {
  const written = (Array.isArray(journalEntries) ? journalEntries : [])
    .filter((entry) => entry && !isSessionEntry(entry) && cleanText(entry.content));
  if (written.length === 0) return "";

  const stamp = (entry) => {
    const seconds = isoToUnixSeconds(entry.createdAt);
    const date = seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : "";
    const version = cleanText(entry.gameVersion);
    if (date && version) return `[${date} · ${version}]`;
    if (date) return `[${date}]`;
    if (version) return `[${version}]`;
    return "";
  };

  const sorted = [...written].sort((a, b) => {
    // Pinned first — the user marked those as the ones worth seeing.
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
    return (isoToUnixSeconds(a.createdAt) || 0) - (isoToUnixSeconds(b.createdAt) || 0);
  });

  return sorted
    .map((entry) => {
      const prefix = stamp(entry);
      const body = cleanText(entry.content);
      return prefix ? `${prefix} ${body}` : body;
    })
    .join("\n\n");
};

/** Total recorded play, in minutes, preferring the explicit total. */
const buildPlaytime = (game) => {
  const declared = Number(game?.totalPlaytime);
  if (Number.isFinite(declared) && declared > 0) return secondsToMinutes(declared);
  // No total recorded: fall back to summing the session entries, which is where
  // the total comes from anyway.
  const sessions = (Array.isArray(game?.journalEntries) ? game.journalEntries : [])
    .filter(isSessionEntry)
    .reduce((sum, entry) => sum + (Number(entry?.sessionData?.duration) || 0), 0);
  return secondsToMinutes(sessions);
};

/**
 * Category ratings that have an Atlas home.
 *
 * story / graphics / gameplay map by name. `grindability` has no Atlas category
 * — the one it would have fitted, "fappability", is retired (see
 * db/ratingCategories.js) — so it is dropped and counted, not silently folded
 * into another category where it would skew the average.
 */
const ATLAS_RATING_CATEGORIES = ["story", "graphics", "gameplay"];

const buildCategoryRatings = (categoryRatings) => {
  const source = categoryRatings && typeof categoryRatings === "object" ? categoryRatings : {};
  const out = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(source)) {
    const score = Number(value);
    if (!Number.isFinite(score) || score <= 0) continue;
    if (ATLAS_RATING_CATEGORIES.includes(key)) out[key] = score;
    else dropped += 1;
  }
  return { ratings: out, dropped };
};

// ── Row construction ────────────────────────────────────────────────────────

const buildImportRow = (game) => {
  const links = linksByProvider(game?.externalLinks);
  const f95 = resolveProviderId(links.get("f95zone"), "f95zone");
  const lc = resolveProviderId(links.get("lewdcorner"), "lewdcorner");
  const f95Id = f95.id;
  const lcId = lc.id;

  const primaryProvider = cleanText(game?.primaryProvider).toLowerCase();
  // A hand-made entry, in the same sense as F95Checker's `custom` column: no
  // forum thread behind it, so its identity has to come from title + creator.
  const isCustom = primaryProvider === "manual" || (!f95Id && !lcId);

  const sourceUrl =
    cleanText(links.get("f95zone")?.url)
    || cleanText(links.get("lewdcorner")?.url)
    || cleanText(links.get(primaryProvider)?.url)
    || "";

  const install = resolveLaunchConfigurations(game?.launchSettings);

  const installedVersion = cleanText(game?.installedVersion);
  const updateInfo = Array.isArray(game?.updateInfo) ? game.updateInfo : [];
  const declaredLatest = cleanText(updateInfo.find((entry) => cleanText(entry?.latestVersion))?.latestVersion);
  const threadVersion = cleanText(game?.version);
  const latestVersion = declaredLatest || threadVersion;
  // Prefer what the user actually has on disk, exactly as the F95Checker reader
  // does, so a version row describes the build that is there.
  const version = installedVersion || threadVersion;

  const title = cleanText(game?.name) || "Unknown";
  const creator = cleanText(game?.developer) || "Unknown";

  const { playstate, known: playstateKnown } = normalizeCompletionStatus(game?.completionStatus);
  const { ratings: categoryRatings, dropped: droppedCategories } =
    buildCategoryRatings(game?.categoryRatings);
  const playtimeMinutes = buildPlaytime(game);
  const notes = buildNotes(game?.journalEntries);
  const customTags = (Array.isArray(game?.customTags) ? game.customTags : [])
    .map(cleanText)
    .filter(Boolean);

  const rating = Number.parseInt(game?.rating, 10) || 0;
  const lastPlayed = isoToUnixSeconds(game?.lastPlayedAt);
  const dateAdded = isoToUnixSeconds(game?.createdAt);

  // Nothing launchable on disk means this is not a game the user owns here —
  // it is one they are tracking. Same rule as the F95Checker reader: a row with
  // no resolvable executable cannot become a library record (the importer
  // rejects it for having no launchable), so it goes to the wishlist instead of
  // being dropped by both paths.
  const hasLaunchable = Boolean(install.singleExecutable);

  return {
    sourceType: "xlibrary",
    externalSource: "xlibrary",
    // A UUID. Kept for traceability but never usable as a forum id.
    externalId: cleanText(game?.id),
    isCustomEntry: isCustom,

    atlasId: "",
    f95Id,
    // XLibrary records the thread id in two places; set when they disagreed and
    // the URL was believed, so the review table can show why.
    f95IdConflicted: f95.conflicted,
    f95DeclaredId: f95.conflicted ? f95.declaredId : "",
    lcId,
    lewdCornerId: lcId,
    sourceUrl,
    siteUrl: sourceUrl,
    // Store links, for display only. Deliberately not steamId — see the header.
    storeLinks: ["steam", "itch", "dlsite"]
      .map((provider) => {
        const link = links.get(provider);
        const url = cleanText(link?.url);
        return url ? { provider, url, externalId: cleanText(link?.externalId) } : null;
      })
      .filter(Boolean),
    title,
    lookupTitle: title,
    creator,
    engine: normalizeEngine(game?.engine),
    version,
    latestVersion,

    singleExecutable: install.singleExecutable,
    execPath: install.execPath,
    executables: install.executables,
    selectedValue: install.selectedValue,
    singleVisible: install.executables.length === 1 ? "visible" : "hidden",
    multipleVisible: install.executables.length > 1 ? "visible" : "hidden",
    folder: install.folder,
    // An external library import never moves or extracts anything.
    in_place: 1,
    inPlace: true,
    isArchive: false,

    results: [],
    resultSelectedValue: "",
    resultVisibility: "hidden",
    recordExist: false,
    existingRecordId: "",

    // Matching is deferred to resolve-import-matches, which tries the thread id
    // first and falls back to title + creator.
    scanStatus: "pendingMatch",
    // The review table computes the visible label from whether the row
    // carries an id; this is the fallback for anywhere else it surfaces.
    scanMessage: "Matching against the catalog",

    externalState: {
      source: "xlibrary",
      externalId: cleanText(game?.id),
      notes,
      // 1-5 here, 0-10 in Atlas. Converted at write time by the shared
      // community-scale helper rather than a hardcoded doubling.
      rating: rating > 0 ? rating : null,
      // Per-category, same 1-5 scale, converted the same way.
      categoryRatings,
      lastPlayed,
      dateAdded,
      installedVersion,
      // XLibrary tracks progress as one status per game rather than per version,
      // so this is a title-level playstate. `finished` is just the Completed
      // case of it — there is no separate "finished at version X" field to
      // reconcile the way F95Checker needs.
      playstate,
      completionStatus: cleanText(game?.completionStatus),
      isFinished: playstate === "finished",
      // Minutes. See the playtime note in the header for why this is not the
      // raw value.
      playtimeMinutes,
      // Their `customTags` are the equivalent of F95Checker's labels; the key is
      // named `labels` so applyExternalLibraryState needs no per-provider branch.
      labels: customTags,
      // XLibrary has no tabs concept, so nothing becomes a collection.
      tab: "",
    },

    // Surfaced by the import step so a broken install path is visible before
    // anything is written.
    installMissing: install.missing,
    recordedInstallPath: install.recordedPath || "",
    recordedRawInstallPath: install.recordedPath || "",
    installPathWasRelative: false,
    // Configurations that point outside the chosen folder: a second install of
    // the same game, which one version row cannot hold.
    otherFolderConfigs: install.otherFolderConfigs,
    launchConfigurationCount: install.configurationCount,
    droppedRatingCategories: droppedCategories,
    unknownCompletionStatus: !playstateKnown,

    // ── Wishlist ────────────────────────────────────────────────────────────
    isInstalled: hasLaunchable,
    wishlistCandidate: !hasLaunchable,
    addToWishlist: !hasLaunchable,
    wishlistReason: hasLaunchable
      ? ""
      : install.missing
        ? "install-path-missing"
        : install.configurationCount > 0
          ? "no-launchable"
          : "not-installed",
  };
};

// ── Mapping table for the import step ───────────────────────────────────────

// What goes where, with counts off the user's own export. Built here rather than
// in the UI so the step stays provider-agnostic and each reader describes its
// own mapping — including the parts it drops, since leaving those out would be
// the same as hiding them.
const buildMapping = (summary) => [
  {
    from: "Name + developer",
    to: "Title and creator",
    detail: "Matched against the Atlas catalog by thread ID where there is one",
    count: summary.imported,
  },
  {
    from: "Launch configurations",
    to: "Version, game path, executable",
    detail: "Left where they are on disk — nothing is moved or copied",
    count: summary.installed,
  },
  {
    from: "Completion status",
    to: "Playstate",
    detail: "Completed, In Progress, Abandoned, In Queue and Waiting for Update all map across",
    count: summary.withPlaystate,
  },
  {
    from: "Playtime + play sessions",
    to: "Total and per-version playtime",
    detail: "Converted from seconds to minutes; under half a minute counts as none",
    count: summary.withPlaytime,
  },
  {
    from: "Last played",
    to: "Last played",
    count: summary.withLastPlayed,
  },
  {
    from: "Rating (1-5)",
    to: "Story rating (0-10)",
    detail: "Doubled to the Atlas scale — see the note below",
    count: summary.withRating,
  },
  {
    from: "Category ratings",
    to: "Story, Graphics, Gameplay",
    detail: summary.droppedRatingCategories
      ? `Grindability has no Atlas category and is not imported (${summary.droppedRatingCategories} value${summary.droppedRatingCategories === 1 ? "" : "s"})`
      : "Mapped by name onto the matching Atlas categories",
    count: summary.withCategoryRatings,
  },
  {
    from: "Journal entries",
    to: "Notes",
    detail: "Written entries only, each kept with its date and version. Play sessions are read as playtime, not notes",
    count: summary.withNotes,
  },
  {
    from: "Custom tags",
    to: "Tags",
    detail: "Added alongside the catalog tags, not replacing them",
    count: summary.withLabels,
  },
  {
    from: "Nothing launchable on disk",
    to: "Wishlist",
    detail: "Pre-ticked on the review screen — untick any you want as library records",
    count: summary.wishlist,
  },
  {
    from: "Forum tags, status, description, cover, screenshots",
    to: "Not imported",
    detail: "Atlas already has these from its own catalog and keeps them updated",
    count: null,
    muted: true,
  },
  {
    from: "Steam / itch / DLsite links",
    to: "Read for matching only",
    detail: "A store link is not an owned Steam copy, so no Steam mapping is created",
    count: summary.withStoreLinks,
    muted: true,
  },
];

// ── Entry points ────────────────────────────────────────────────────────────

// The live library file, relative to the app's own data directory. XLibrary is
// an Electron app, so its data directory follows Electron's userData convention
// per platform; the Windows path is the confirmed one and the other two are the
// same convention applied, which is the best available guess for a library
// copied off another machine.
const LIVE_LIBRARY_SUBPATH = path.join("canonical", "library.games.json");
const LIVE_LIBRARY_FILENAME = "library.games.json";

const getCandidateDataDirs = () => {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "xlibrary")];
  }
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "xlibrary")];
  }
  return [path.join(home, ".config", "xlibrary")];
};

/**
 * The exact file paths detection tests, in order.
 *
 * Reported to the UI so a failed detection can say what it actually looked for.
 * The candidate DIRECTORY is not enough on its own: the live file sits one level
 * further down in `canonical/`, so showing the data directory beside the bare
 * filename describes a path that was never tried, and a user comparing it
 * against their own disk would reasonably conclude Atlas looked in the wrong
 * place.
 */
const getCandidatePaths = () =>
  getCandidateDataDirs().map((dir) => path.join(dir, LIVE_LIBRARY_SUBPATH));

// First existing library.games.json across the candidate paths, or null.
const locateDatabase = () => {
  for (const candidate of getCandidatePaths()) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not there — try the next candidate.
    }
  }
  return null;
};

/**
 * Pull the games array out of whichever of the two shapes this file is.
 *
 * The export wraps it in an object alongside `settings`; the live canonical file
 * is the bare array. `data` is accepted as a third spelling because it costs
 * nothing and is the obvious alternative name for the same wrapper.
 */
const extractGames = (parsed) => {
  if (Array.isArray(parsed)) return { games: parsed, shape: "live" };
  if (Array.isArray(parsed?.games)) return { games: parsed.games, shape: "export" };
  if (Array.isArray(parsed?.data)) return { games: parsed.data, shape: "export" };
  return { games: null, shape: "" };
};

/** Read an XLibrary export into importer rows. */
const readXLibraryExport = async (filePath) => {
  const resolved = path.resolve(cleanText(filePath));
  const stat = await fsp.stat(resolved).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`XLibrary export not found at ${resolved}`);
  }

  const raw = await fsp.readFile(resolved, "utf8");
  let parsed;
  try {
    // Strip a UTF-8 BOM: JSON.parse rejects it, and an export written by a
    // Windows tool can carry one.
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new Error(
      `That file is not valid JSON (${err.message}). Export again from XLibrary and pick the new file.`,
    );
  }

  const { games, shape } = extractGames(parsed);
  if (!games) {
    throw new Error(
      "That JSON file is not an XLibrary library: it is neither a list of games nor "
      + `an object with a "games" list. Look for ${LIVE_LIBRARY_FILENAME} in `
      + "XLibrary's data folder, or a file named xlibrary-data-<date>.json.",
    );
  }

  // Only the export carries settings, so the live file reports no version. Zero
  // therefore means "not stated", not "version zero", and must never read as
  // older or newer than what this reader knows.
  const schemaVersion = Number.parseInt(parsed?.settings?.schemaVersion, 10) || 0;

  const rows = [];
  let installedCount = 0;
  let missingInstallCount = 0;
  let customCount = 0;
  let unidentifiedCount = 0;
  let lewdCornerCount = 0;
  let wishlistCount = 0;
  let conflictedIdCount = 0;
  let unknownStatusCount = 0;
  let droppedRatingCategories = 0;
  let otherFolderConfigCount = 0;
  let skippedCount = 0;

  for (const game of games) {
    // A row with no name has nothing to match on and nothing to show; it would
    // arrive in the review table as "Unknown" with no way to act on it.
    if (!game || !cleanText(game.name)) {
      skippedCount += 1;
      continue;
    }
    const built = buildImportRow(game);
    if (built.folder) installedCount += 1;
    if (built.installMissing) missingInstallCount += 1;
    if (built.isCustomEntry) customCount += 1;
    if (!built.f95Id && !built.lcId) unidentifiedCount += 1;
    if (built.lcId) lewdCornerCount += 1;
    if (built.addToWishlist) wishlistCount += 1;
    if (built.f95IdConflicted) conflictedIdCount += 1;
    if (built.unknownCompletionStatus) unknownStatusCount += 1;
    droppedRatingCategories += built.droppedRatingCategories;
    if (built.otherFolderConfigs > 0) otherFolderConfigCount += 1;
    rows.push(built);
  }

  const summary = {
    total: games.length,
    imported: rows.length,
    // No archive concept in an XLibrary export; reported as zero so the shared
    // summary pills read the same for both providers.
    archived: 0,
    skipped: skippedCount,
    custom: customCount,
    installed: installedCount,
    missingInstall: missingInstallCount,
    // No relative-path scheme: XLibrary stores absolute executable paths.
    relativePaths: 0,
    recoveredIds: 0,
    conflictedIds: conflictedIdCount,
    lewdCorner: lewdCornerCount,
    unidentified: unidentifiedCount,
    wishlist: wishlistCount,
    otherFolderConfigs: otherFolderConfigCount,
    unknownCompletionStatus: unknownStatusCount,
    droppedRatingCategories,
    withNotes: rows.filter((row) => row.externalState.notes).length,
    withRating: rows.filter((row) => row.externalState.rating).length,
    withCategoryRatings: rows.filter(
      (row) => Object.keys(row.externalState.categoryRatings || {}).length > 0,
    ).length,
    withPlaystate: rows.filter((row) => row.externalState.playstate).length,
    withPlaytime: rows.filter((row) => row.externalState.playtimeMinutes > 0).length,
    withLastPlayed: rows.filter((row) => row.externalState.lastPlayed).length,
    withFinished: rows.filter((row) => row.externalState.isFinished).length,
    withLabels: rows.filter((row) => row.externalState.labels.length > 0).length,
    withTab: 0,
    withStoreLinks: rows.filter((row) => row.storeLinks.length > 0).length,
  };

  return {
    success: true,
    source: "xlibrary",
    dbPath: resolved,
    rows,
    summary,
    mapping: buildMapping(summary),
    // Which optional mappings the step should offer. Only the one with a lasting
    // side effect is optional; XLibrary has no tabs, so no collections toggle.
    optionalMappings: [
      {
        key: "importLabelsAsTags",
        label: "Import custom tags as tags",
        detail:
          "Custom tags are added alongside the catalog tags. Because editing a game's "
          + "tags marks the list as yours, those games will stop picking up new tags "
          + "from catalog updates.",
        default: true,
      },
    ],
    // Neither shape is transactional and neither records when it was written, so
    // the file's mtime is the only staleness signal available. Reported so the
    // step can show it rather than implying the read is necessarily current.
    exportedAt: stat.mtime ? stat.mtime.toISOString() : "",
    // Which of the two inputs this was: "live" for the canonical file XLibrary
    // maintains, "export" for a file the user asked it to write.
    sourceShape: shape,
    schemaVersion,
    // A live file states no version, so it can never be reported as newer.
    schemaNewerThanKnown: schemaVersion > 0 && schemaVersion > KNOWN_SCHEMA_VERSION,
    knownSchemaVersion: KNOWN_SCHEMA_VERSION,
    // No live database, so nothing can be mid-write.
    journalPresent: false,
    tabs: [],
  };
};

module.exports = {
  EXPORT_FILENAME_HINT,
  LIVE_LIBRARY_FILENAME,
  LIVE_LIBRARY_SUBPATH,
  KNOWN_SCHEMA_VERSION,
  getCandidateDataDirs,
  getCandidatePaths,
  locateDatabase,
  readXLibraryExport,
  // Exported for scripts/check-xlibrary-parser.js
  buildImportRow,
  buildMapping,
  extractGames,
  buildNotes,
  buildPlaytime,
  buildCategoryRatings,
  resolveLaunchConfigurations,
  resolveProviderId,
  normalizeCompletionStatus,
  normalizeEngine,
  isoToUnixSeconds,
  secondsToMinutes,
  extractThreadId,
  COMPLETION_TO_PLAYSTATE,
};
