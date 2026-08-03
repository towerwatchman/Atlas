"use strict";

// Builds a throwaway XLibrary export with the same shape a real one has, then
// asserts the reader turns it into the rows the importer expects.
//
// The cases worth guarding, all of which are easy to get wrong from the JSON
// alone:
//
//   * `totalPlaytime` is in SECONDS while Atlas stores minutes. Reading it as
//     minutes inflates every figure sixtyfold.
//   * `journalEntries` mixes written notes and launch telemetry in one array,
//     separated only by `type: 'session'`. Session entries have an empty
//     `content`, so treating the array as notes pastes blank gaps between real
//     entries and loses the playtime.
//   * `completionStatus` is the USER's progress; the separate `status` field is
//     the forum's development status. Mapping the wrong one writes a playstate
//     that has nothing to do with the user.
//   * `categoryRatings.grindability` has no Atlas category and must be dropped
//     rather than folded into another one.
//   * The thread id appears in both `externalId` and the link URL, and they can
//     disagree.
//   * A game with launch configurations whose paths do not exist cannot become a
//     library record, so it has to reach the wishlist instead of being dropped.
//   * Multiple launch configurations in one folder are alternative executables
//     for one install; configurations in different folders are a second install
//     that one version row cannot represent.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  readXLibraryExport,
  locateDatabase,
  getCandidateDataDirs,
  getCandidatePaths,
  extractGames,
  LIVE_LIBRARY_FILENAME,
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
} = require("../electron/scanners/externalLibrary/xlibrary");

let assertions = 0;
const check = (fn) => {
  assertions += 1;
  fn();
};
const eq = (actual, expected, message) =>
  check(() => assert.strictEqual(actual, expected, message));
const deep = (actual, expected, message) =>
  check(() => assert.deepStrictEqual(actual, expected, message));
const ok = (value, message) => check(() => assert.ok(value, message));

const f95Link = (id, slug = "a-game") => ({
  providerId: "f95zone",
  externalId: String(id),
  url: `https://f95zone.to/threads/${slug}.${id}/`,
  addedAt: "2025-08-11T05:37:53.423Z",
  metadata: { f95: { rating: 4.29 } },
});

function buildFixture(dir) {
  // Real files on disk, because the reader stats every configured path.
  const installDir = path.join(dir, "Games", "Installed Game");
  fs.mkdirSync(installDir, { recursive: true });
  const mainExe = path.join(installDir, "Game.exe");
  const dlcExe = path.join(installDir, "GameXmas.exe");
  fs.writeFileSync(mainExe, "");
  fs.writeFileSync(dlcExe, "");

  const secondDir = path.join(dir, "Games", "Second Install");
  fs.mkdirSync(secondDir, { recursive: true });
  const secondExe = path.join(secondDir, "Game.exe");
  fs.writeFileSync(secondExe, "");

  const games = [
    // ── Fully populated, installed, played ────────────────────────────────
    {
      id: "uuid-installed",
      name: "Installed Game",
      developer: "Dev One",
      engine: "RenPy",
      version: "v1.3",
      installedVersion: "v1.2",
      rating: 4,
      categoryRatings: { story: 5, graphics: 4, gameplay: 3, grindability: 2 },
      completionStatus: "In Progress",
      // Forum development status. Must NOT become a playstate.
      status: "Completed",
      tags: ["3dcg", "incest"],
      customTags: ["recommend", "upcoming"],
      createdAt: "2025-08-11T05:37:53.423Z",
      lastPlayedAt: "2026-02-27T20:16:33.178Z",
      totalPlaytime: 5306,
      journalEntries: [
        {
          id: "j1",
          content: "On chapter 4, art is great.",
          createdAt: "2025-08-12T20:11:41.945Z",
          gameVersion: "v1.0",
          isPinned: false,
        },
        {
          id: "j2",
          type: "session",
          content: "",
          createdAt: "2026-02-27T20:15:04.418Z",
          gameVersion: "v1.2",
          sessionData: { duration: 5306, launcherName: "v1.2", startedAt: "2026-02-27T20:15:04.418Z" },
        },
        {
          id: "j3",
          content: "Pinned: use the walkthrough mod.",
          createdAt: "2026-01-01T00:00:00.000Z",
          gameVersion: "v1.2",
          isPinned: true,
        },
      ],
      launchSettings: {
        configurations: [
          { id: "c1", name: "Main", type: "exe", executablePath: mainExe },
          { id: "c2", name: "Christmas", type: "exe", executablePath: dlcExe },
        ],
        defaultConfigurationId: "c1",
      },
      primaryProvider: "f95zone",
      externalLinks: [
        f95Link(12345, "installed-game"),
        { providerId: "steam", externalId: "480", url: "https://store.steampowered.com/app/480/" },
        { providerId: "manual", externalId: "", url: "" },
      ],
      updateInfo: [{ providerId: "f95zone", hasUpdate: true, latestVersion: "v1.3" }],
    },

    // ── Tracked, never installed: the ordinary wishlist row ───────────────
    {
      id: "uuid-tracked",
      name: "Tracked Game",
      developer: "Dev Two",
      engine: "RPG Maker",
      version: "v0.1",
      completionStatus: "In Queue",
      customTags: [],
      createdAt: "2025-09-01T00:00:00.000Z",
      launchSettings: { configurations: [] },
      primaryProvider: "f95zone",
      externalLinks: [f95Link(22222, "tracked-game")],
      updateInfo: [],
    },

    // ── Configured but the path is gone: must NOT fall between both lists ──
    {
      id: "uuid-moved",
      name: "Moved Game",
      developer: "Dev Three",
      engine: "Unity",
      version: "v2.0",
      installedVersion: "v2.0",
      completionStatus: "Completed",
      createdAt: "2025-09-02T00:00:00.000Z",
      launchSettings: {
        configurations: [
          {
            id: "c1",
            name: "Main",
            type: "exe",
            executablePath: path.join(dir, "gone", "Missing.exe"),
          },
        ],
        defaultConfigurationId: "c1",
      },
      primaryProvider: "f95zone",
      externalLinks: [f95Link(33333, "moved-game")],
      updateInfo: [],
    },

    // ── Two installs of the same game, in different folders ────────────────
    {
      id: "uuid-two-installs",
      name: "Two Installs",
      developer: "Dev Four",
      engine: "Others",
      version: "v3.0",
      installedVersion: "v3.0",
      completionStatus: "Abandoned",
      createdAt: "2025-09-03T00:00:00.000Z",
      launchSettings: {
        configurations: [
          { id: "c1", name: "Primary", type: "exe", executablePath: mainExe },
          { id: "c2", name: "Elsewhere", type: "exe", executablePath: secondExe },
        ],
        defaultConfigurationId: "c1",
      },
      primaryProvider: "f95zone",
      externalLinks: [f95Link(44444, "two-installs")],
      updateInfo: [],
    },

    // ── Hand-made entry with no forum link at all ──────────────────────────
    {
      id: "uuid-manual",
      name: "Manual Entry",
      developer: "Dev Five",
      version: "v1.0",
      completionStatus: "Not Started",
      createdAt: "2025-09-04T00:00:00.000Z",
      launchSettings: { configurations: [] },
      primaryProvider: "manual",
      externalLinks: [{ providerId: "manual", externalId: "", url: "" }],
      updateInfo: [],
    },

    // ── externalId disagrees with the URL; the URL wins ────────────────────
    {
      id: "uuid-conflict",
      name: "Conflicted Ids",
      developer: "Dev Six",
      version: "v1.0",
      completionStatus: "Waiting for Update",
      createdAt: "2025-09-05T00:00:00.000Z",
      launchSettings: { configurations: [] },
      primaryProvider: "f95zone",
      externalLinks: [
        {
          providerId: "f95zone",
          externalId: "99999",
          url: "https://f95zone.to/threads/real-thread.55555/",
        },
      ],
      updateInfo: [],
    },

    // ── LewdCorner, and a status Atlas has no mapping for ──────────────────
    {
      id: "uuid-lc",
      name: "LewdCorner Game",
      developer: "Dev Seven",
      version: "v1.0",
      completionStatus: "Shelved Forever",
      createdAt: "2025-09-06T00:00:00.000Z",
      launchSettings: { configurations: [] },
      primaryProvider: "lewdcorner",
      externalLinks: [
        {
          providerId: "lewdcorner",
          externalId: "4242",
          url: "https://lewdcorner.com/threads/a-game.4242/",
        },
      ],
      updateInfo: [],
    },

    // ── Playtime below a minute: must round to nothing, not to one ─────────
    {
      id: "uuid-brief",
      name: "Barely Played",
      developer: "Dev Eight",
      version: "v1.0",
      completionStatus: "Not Started",
      createdAt: "2025-09-07T00:00:00.000Z",
      totalPlaytime: 7,
      journalEntries: [
        {
          id: "s1",
          type: "session",
          content: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          sessionData: { duration: 7 },
        },
      ],
      launchSettings: { configurations: [] },
      primaryProvider: "f95zone",
      externalLinks: [f95Link(66666, "barely-played")],
      updateInfo: [],
    },

    // ── No name: nothing to match on and nothing to show ──────────────────
    { id: "uuid-nameless", name: "   ", developer: "Dev Nine", launchSettings: {} },
  ];

  const exportPath = path.join(dir, "xlibrary-data-2026-07-27.json");
  fs.writeFileSync(
    exportPath,
    JSON.stringify({ games, settings: { schemaVersion: 4, theme: "dark" } }),
  );
  return { exportPath, installDir, mainExe, secondDir };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xlibrary-fixture-"));
  try {
    const { exportPath, installDir, mainExe } = buildFixture(dir);
    const result = await readXLibraryExport(exportPath);

    eq(result.success, true, "read should succeed");
    eq(result.source, "xlibrary");
    eq(result.schemaVersion, 4);
    eq(result.schemaNewerThanKnown, false);
    eq(result.journalPresent, false, "an export cannot be mid-write");
    deep(result.tabs, [], "XLibrary has no tabs concept");

    eq(result.summary.total, 9, "total counts every entry in the file");
    eq(result.summary.skipped, 1, "the nameless row is dropped");
    eq(result.rows.length, 8, "eight usable rows");

    const byTitle = new Map(result.rows.map((row) => [row.title, row]));

    // ── The installed row ──────────────────────────────────────────────────
    const installed = byTitle.get("Installed Game");
    eq(installed.f95Id, "12345", "thread id comes off the f95zone link");
    eq(installed.lcId, "", "no LewdCorner link");
    eq(installed.sourceType, "xlibrary");
    eq(installed.externalId, "uuid-installed", "the UUID is kept as-is");
    eq(installed.creator, "Dev One");
    eq(installed.engine, "Ren'Py", "RenPy is normalised to the Atlas spelling");
    eq(installed.version, "v1.2", "installed version wins over the thread's");
    eq(installed.latestVersion, "v1.3");
    eq(installed.folder, installDir);
    eq(installed.execPath, mainExe);
    eq(installed.singleExecutable, "Game.exe", "the default configuration wins");
    eq(installed.in_place, 1, "external imports stay in place");
    eq(installed.scanStatus, "pendingMatch");
    eq(installed.isInstalled, true);
    eq(installed.addToWishlist, false, "a launchable install goes to the library");

    // Two configurations in the same folder are two ways to launch one install,
    // so both are offered in the review table's picker.
    deep(
      installed.executables.map((entry) => entry.key).sort(),
      ["Game.exe", "GameXmas.exe"],
      "same-folder configurations become selectable executables",
    );
    eq(installed.selectedValue, "Game.exe");
    eq(installed.multipleVisible, "visible");
    eq(installed.otherFolderConfigs, 0);

    // A store link is read but must never become a Steam mapping.
    eq(installed.storeLinks.length, 1);
    eq(installed.storeLinks[0].provider, "steam");
    eq(installed.steamId, undefined, "a store link is not an owned Steam copy");

    // ── User state on the installed row ────────────────────────────────────
    const state = installed.externalState;
    eq(state.source, "xlibrary");
    eq(state.rating, 4, "the overall 1-5 score is passed through unscaled");
    deep(
      state.categoryRatings,
      { story: 5, graphics: 4, gameplay: 3 },
      "grindability has no Atlas category and is dropped",
    );
    eq(state.playstate, "played", "In Progress maps to played");
    eq(state.completionStatus, "In Progress");
    eq(state.isFinished, false);
    // 5306 seconds is 88 minutes. Read as minutes it would have been 5,306.
    eq(state.playtimeMinutes, 88, "seconds are converted to minutes");
    eq(state.lastPlayed, 1772223393, "ISO becomes unix seconds");
    eq(state.dateAdded, 1754890673);
    deep(state.labels, ["recommend", "upcoming"], "custom tags become labels");
    eq(state.tab, "", "no collections from XLibrary");

    // Notes: pinned first, then chronological, each stamped, sessions excluded.
    ok(state.notes.startsWith("[2026-01-01 · v1.2] Pinned:"), "pinned entry leads");
    ok(state.notes.includes("[2025-08-12 · v1.0] On chapter 4"), "written entries are kept");
    ok(!state.notes.includes("\n\n\n"), "no blank gap where a session was skipped");
    eq(state.notes.split("\n\n").length, 2, "only the two written entries");

    // ── The wishlist rows ─────────────────────────────────────────────────
    const tracked = byTitle.get("Tracked Game");
    eq(tracked.addToWishlist, true, "nothing on disk");
    eq(tracked.wishlistReason, "not-installed");
    eq(tracked.version, "v0.1", "falls back to the thread version");
    eq(tracked.externalState.playstate, "planned", "In Queue maps to planned");
    eq(tracked.engine, "RPGM", "RPG Maker is normalised");

    // The regression this whole rule exists for: a configured path that no
    // longer resolves cannot be imported, so it must reach the wishlist rather
    // than being dropped by both paths.
    const moved = byTitle.get("Moved Game");
    eq(moved.addToWishlist, true, "a broken install path must not be dropped");
    eq(moved.wishlistReason, "install-path-missing");
    eq(moved.installMissing, true);
    eq(moved.folder, "", "a path that does not resolve is not used");
    ok(moved.recordedInstallPath.endsWith("Missing.exe"), "the path tried is reported");
    eq(moved.externalState.playstate, "finished", "Completed maps to finished");
    eq(moved.externalState.isFinished, true);

    // ── Two installs in different folders ─────────────────────────────────
    const two = byTitle.get("Two Installs");
    eq(two.folder, installDir, "the default configuration decides the folder");
    eq(two.otherFolderConfigs, 1, "the other install is counted, not merged");
    eq(
      two.executables.length,
      1,
      "an executable in another folder is not offered as an alternative here",
    );
    eq(two.externalState.playstate, "dropped", "Abandoned maps to dropped");

    // ── Identification ────────────────────────────────────────────────────
    const manual = byTitle.get("Manual Entry");
    eq(manual.isCustomEntry, true, "a manual entry has no forum identity");
    eq(manual.f95Id, "");
    eq(manual.lcId, "");

    const conflict = byTitle.get("Conflicted Ids");
    eq(conflict.f95Id, "55555", "the id in the URL wins");
    eq(conflict.f95IdConflicted, true, "and the disagreement is reported");
    eq(conflict.f95DeclaredId, "99999");
    eq(conflict.externalState.playstate, "on_hold", "Waiting for Update maps to on_hold");

    const lc = byTitle.get("LewdCorner Game");
    eq(lc.lcId, "4242");
    eq(lc.f95Id, "", "a LewdCorner link is not an F95 id");
    eq(lc.unknownCompletionStatus, true, "an unmapped status is flagged");
    eq(lc.externalState.playstate, null, "and never guessed at");

    const brief = byTitle.get("Barely Played");
    eq(brief.externalState.playtimeMinutes, 0, "seven seconds is not a minute");

    // ── Every row belongs to exactly one destination ───────────────────────
    // The invariant the dropped-row bug violated. Asserted across the fixture
    // rather than row by row so a new row cannot quietly reintroduce it.
    for (const row of result.rows) {
      check(() =>
        assert.notStrictEqual(
          Boolean(row.singleExecutable) === Boolean(row.addToWishlist),
          true,
          `row '${row.title}' is in both or neither destination`,
        ));
    }

    // ── Summary ───────────────────────────────────────────────────────────
    eq(result.summary.installed, 2, "the two rows with a resolvable executable");
    eq(result.summary.wishlist, 6);
    eq(
      result.summary.installed + result.summary.wishlist,
      result.rows.length,
      "the two destinations account for every row",
    );
    eq(result.summary.missingInstall, 1);
    eq(result.summary.custom, 1, "only the manual entry");
    eq(result.summary.unidentified, 1);
    eq(result.summary.lewdCorner, 1);
    eq(result.summary.conflictedIds, 1);
    eq(result.summary.unknownCompletionStatus, 1);
    eq(result.summary.droppedRatingCategories, 1, "one grindability score");
    eq(result.summary.otherFolderConfigs, 1);
    eq(result.summary.withNotes, 1);
    eq(result.summary.withRating, 1);
    eq(result.summary.withCategoryRatings, 1);
    eq(
      result.summary.withPlaystate,
      5,
      "the two Not Started rows and the unmapped status carry no playstate",
    );
    eq(result.summary.withPlaytime, 1, "the seven-second row does not count");
    eq(result.summary.withLastPlayed, 1);
    eq(result.summary.withLabels, 1);
    eq(result.summary.withStoreLinks, 1);
    eq(result.summary.archived, 0, "no archive concept in an export");
    eq(result.summary.relativePaths, 0, "paths are absolute");
    ok(result.exportedAt, "the file's timestamp is reported as the snapshot date");

    // ── Mapping table ─────────────────────────────────────────────────────
    // Owned by the reader, rendered verbatim by the import step.
    ok(Array.isArray(result.mapping) && result.mapping.length > 0, "mapping rows exist");
    for (const row of result.mapping) {
      ok(row.from && row.to, "every mapping row names a source and a destination");
    }
    ok(
      result.mapping.some((row) => /wishlist/i.test(row.to)),
      "the wishlist destination is disclosed",
    );
    ok(
      result.mapping.some((row) => row.to === "Not imported"),
      "what is dropped is disclosed",
    );
    deep(
      (result.optionalMappings || []).map((option) => option.key),
      ["importLabelsAsTags"],
      "no collections toggle, because XLibrary has no tabs",
    );

    // ── Rejecting files that are not exports ──────────────────────────────
    const notJson = path.join(dir, "broken.json");
    fs.writeFileSync(notJson, "{ not json");
    await check(async () => {
      await assert.rejects(
        () => readXLibraryExport(notJson),
        /not valid JSON/,
        "a malformed file says so rather than throwing a parser error",
      );
    });

    const wrongShape = path.join(dir, "other.json");
    fs.writeFileSync(wrongShape, JSON.stringify({ items: [] }));
    await check(async () => {
      await assert.rejects(
        () => readXLibraryExport(wrongShape),
        /not an XLibrary library/,
        "a JSON file with no games list is identified as the wrong file",
      );
    });

    await check(async () => {
      await assert.rejects(
        () => readXLibraryExport(path.join(dir, "nope.json")),
        /not found/,
        "a missing file reports its path",
      );
    });

    // A BOM is what a Windows tool writing UTF-8 often produces, and JSON.parse
    // rejects it outright.
    const bom = path.join(dir, "bom.json");
    fs.writeFileSync(bom, `\uFEFF${JSON.stringify({ games: [], settings: {} })}`);
    const bomResult = await readXLibraryExport(bom);
    eq(bomResult.success, true, "a byte-order mark is tolerated");
    eq(bomResult.rows.length, 0);

    // ── Both accepted file shapes ─────────────────────────────────────────
    // The dated export wraps the list alongside `settings`; the live
    // canonical file may hold the bare array. Reading only one shape would make
    // Atlas report "not an XLibrary library" for a perfectly good file.
    const bareArray = path.join(dir, LIVE_LIBRARY_FILENAME);
    fs.writeFileSync(
      bareArray,
      JSON.stringify([
        {
          id: "uuid-bare",
          name: "Bare Array Game",
          developer: "Dev Ten",
          version: "v1.0",
          completionStatus: "Completed",
          launchSettings: { configurations: [] },
          primaryProvider: "f95zone",
          externalLinks: [f95Link(77777, "bare")],
        },
      ]),
    );
    const bareResult = await readXLibraryExport(bareArray);
    eq(bareResult.success, true, "a bare array is a valid library file");
    eq(bareResult.rows.length, 1);
    eq(bareResult.rows[0].title, "Bare Array Game");
    eq(bareResult.rows[0].externalState.playstate, "finished");
    eq(bareResult.schemaVersion, 0, "no settings block means no declared version");
    eq(
      bareResult.schemaNewerThanKnown,
      false,
      "an absent version must not read as newer than known",
    );

    // An empty library is a real state, not a wrong file.
    const emptyLive = path.join(dir, "empty.json");
    fs.writeFileSync(emptyLive, JSON.stringify([]));
    const emptyResult = await readXLibraryExport(emptyLive);
    eq(emptyResult.success, true, "an empty library reads successfully");
    eq(emptyResult.rows.length, 0);

    // Returns the list, which shape it came from, and the declared family. The
    // shape decides whether the staleness note applies and which schema constant
    // the version is compared against.
    deep(extractGames([{ name: "x" }]), {
      games: [{ name: "x" }], shape: "live", family: "", dropped: 0,
    });
    deep(extractGames({ games: [] }), { games: [], shape: "export", family: "", dropped: 0 });
    deep(extractGames({ data: [] }), { games: [], shape: "export", family: "", dropped: 0 });
    // null rather than [], so "wrong file" stays distinguishable from "empty
    // library" — an empty library is a real state and must not read as an error.
    deep(extractGames({ items: [] }), { games: null, shape: "", family: "", dropped: 0 });
    deep(extractGames(null), { games: null, shape: "", family: "", dropped: 0 });
    deep(extractGames("string"), { games: null, shape: "", family: "", dropped: 0 });

    // ── The live document store ───────────────────────────────────────────
    // The real library.games.json is not a bare array: it is a document store
    // whose entries are envelopes carrying store metadata, with the game one
    // level down in `data`. Reading it as a list of games finds nothing, which is
    // exactly how it presented — "the program is not picking it up".
    {
      const store = {
        family: "library.games",
        schemaVersion: 8,
        documents: [
          {
            id: "doc-1",
            family: "library.games",
            schemaVersion: 8,
            createdAt: "2025-12-27T08:26:21.102Z",
            updatedAt: "2026-07-08T00:00:14.393Z",
            revision: 3,
            data: {
              id: "doc-1",
              name: "Document Store Game",
              developer: "Dev Doc",
              engine: "RenPy",
              version: "v1.0",
              completionStatus: "Completed",
              // Present in the live file and absent from the export. Additive,
              // so it must not disturb anything.
              importSource: "F95Checker",
              url: "https://f95zone.to/threads/other.111/",
              launchSettings: { configurations: [] },
              primaryProvider: "f95zone",
              externalLinks: [f95Link(260665, "doc-game")],
            },
          },
          // An envelope with no payload must be dropped and counted, not turned
          // into an empty row.
          { id: "doc-2", family: "library.games", schemaVersion: 8 },
        ],
      };
      const unwrapped = extractGames(store);
      eq(unwrapped.shape, "documents");
      eq(unwrapped.family, "library.games");
      eq(unwrapped.games.length, 1, "the payload is unwrapped from the envelope");
      eq(unwrapped.dropped, 1, "the empty envelope is counted");
      eq(unwrapped.games[0].name, "Document Store Game");

      const storePath = path.join(dir, "library.games.json");
      fs.writeFileSync(storePath, JSON.stringify(store));
      const storeResult = await readXLibraryExport(storePath);
      eq(storeResult.success, true, "a document store reads successfully");
      eq(storeResult.rows.length, 1);
      eq(storeResult.summary.droppedDocuments, 1);
      eq(storeResult.rows[0].title, "Document Store Game");
      eq(storeResult.rows[0].f95Id, "260665", "ids still resolve inside an envelope");
      eq(storeResult.rows[0].engine, "Ren'Py", "and so does engine normalisation");
      eq(storeResult.rows[0].externalState.playstate, "finished");
      eq(storeResult.sourceShape, "documents");

      // The scales differ: the live store was at 8 while an export of the same
      // library reported 4. Comparing both against one constant would report a
      // current live file as newer than Atlas understands.
      eq(storeResult.schemaVersion, 8);
      eq(storeResult.knownSchemaVersion, 8, "compared against the live constant");
      eq(storeResult.schemaNewerThanKnown, false, "8 is current for a live store");
    }

    // A newer live store is still read, but flagged.
    {
      const newer = path.join(dir, "newer.json");
      fs.writeFileSync(newer, JSON.stringify({
        family: "library.games",
        schemaVersion: 99,
        documents: [{ data: { name: "Future Game", launchSettings: {} } }],
      }));
      const result = await readXLibraryExport(newer);
      eq(result.success, true, "a newer store is still read");
      eq(result.schemaNewerThanKnown, true, "and the mismatch is reported");
    }

    // The wrong store from the same folder is the likely mistake, so it is named
    // rather than reported as "no games".
    {
      const wrongFamily = path.join(dir, "library.collections.json");
      fs.writeFileSync(wrongFamily, JSON.stringify({
        family: "library.collections",
        schemaVersion: 2,
        documents: [{ data: { name: "Not a game" } }],
      }));
      await check(async () => {
        await assert.rejects(
          () => readXLibraryExport(wrongFamily),
          /library\.collections/,
          "the wrong store names the family it actually is",
        );
      });
    }

    // ── Auto-detection ────────────────────────────────────────────────────
    // Every platform must produce a candidate directory: returning none would
    // make the Settings card claim it looked somewhere while listing nothing.
    ok(getCandidateDataDirs().length > 0, "at least one candidate directory");
    for (const candidate of getCandidateDataDirs()) {
      ok(path.isAbsolute(candidate), `${candidate} is absolute`);
      ok(/xlibrary/i.test(candidate), `${candidate} names the app`);
    }
    // The paths reported to the UI must be the ones detection actually tests.
    // Reporting the data directory beside a bare filename describes a path that
    // was never tried, which sends the user looking in the wrong place.
    const candidatePaths = getCandidatePaths();
    eq(candidatePaths.length, getCandidateDataDirs().length, "one path per directory");
    for (const candidate of candidatePaths) {
      ok(path.isAbsolute(candidate), `${candidate} is absolute`);
      eq(path.basename(candidate), LIVE_LIBRARY_FILENAME, "each names the live file");
      ok(
        candidate.includes(`canonical${path.sep}`),
        `${candidate} includes the canonical subdirectory detection actually uses`,
      );
    }
    // Nothing is installed on a test box, so this must be null rather than
    // throwing on a directory that is not there.
    const located = locateDatabase();
    ok(located === null || typeof located === "string", "detection never throws");

    // ── Unit helpers ──────────────────────────────────────────────────────
    eq(secondsToMinutes(5306), 88);
    eq(secondsToMinutes(29), 0, "under half a minute is no minutes");
    eq(secondsToMinutes(30), 1);
    eq(secondsToMinutes(0), 0);
    eq(secondsToMinutes("not a number"), 0);
    eq(secondsToMinutes(-5), 0);

    eq(isoToUnixSeconds("2026-02-27T20:16:33.178Z"), 1772223393);
    eq(isoToUnixSeconds(""), null);
    eq(isoToUnixSeconds("not a date"), null);
    eq(isoToUnixSeconds(null), null);

    // The whole set, so a rename on their side shows up here rather than as a
    // silently missing playstate.
    eq(COMPLETION_TO_PLAYSTATE["not started"], null);
    eq(normalizeCompletionStatus("Completed").playstate, "finished");
    eq(normalizeCompletionStatus("completed").playstate, "finished", "case insensitive");
    eq(normalizeCompletionStatus("In Progress").playstate, "played");
    eq(normalizeCompletionStatus("In Queue").playstate, "planned");
    eq(normalizeCompletionStatus("Waiting for Update").playstate, "on_hold");
    eq(normalizeCompletionStatus("Abandoned").playstate, "dropped");
    eq(normalizeCompletionStatus("Not Started").playstate, null);
    eq(normalizeCompletionStatus("Not Started").known, true);
    eq(normalizeCompletionStatus("").known, true, "absent is not unknown");
    eq(normalizeCompletionStatus("Something Else").known, false);

    eq(normalizeEngine("RenPy"), "Ren'Py");
    eq(normalizeEngine("ren'py"), "Ren'Py");
    eq(normalizeEngine("RPGM"), "RPGM");
    eq(normalizeEngine("RPG Maker"), "RPGM");
    eq(normalizeEngine("Wolf RPG"), "Wolf RPG");
    eq(normalizeEngine("Others"), "Others");
    eq(normalizeEngine(""), "Unknown", "an absent engine is Unknown, not blank");
    eq(normalizeEngine("Godot"), "Godot", "an unknown engine passes through");

    eq(extractThreadId("https://f95zone.to/threads/12345", "f95zone"), "12345");
    eq(extractThreadId("https://f95zone.to/threads/a-slug.243406/post-9", "f95zone"), "243406");
    eq(extractThreadId("https://lewdcorner.com/threads/x.13917/", "lewdcorner"), "13917");
    eq(
      extractThreadId("https://lewdcorner.com/threads/x.13917/", "f95zone"),
      "",
      "cross-forum links must not leak into the wrong id",
    );

    // Id resolution between the two places XLibrary records it.
    deep(
      resolveProviderId({ externalId: "123", url: "https://f95zone.to/threads/s.123/" }, "f95zone"),
      { id: "123", conflicted: false, declaredId: "123" },
    );
    eq(
      resolveProviderId({ externalId: "", url: "https://f95zone.to/threads/s.456/" }, "f95zone").id,
      "456",
      "the URL alone is enough",
    );
    eq(
      resolveProviderId({ externalId: "789", url: "" }, "f95zone").id,
      "789",
      "the declared id alone is enough",
    );
    eq(
      resolveProviderId({ externalId: "not-a-number", url: "" }, "f95zone").id,
      "",
      "a non-numeric id is not a thread id",
    );
    eq(resolveProviderId(undefined, "f95zone").id, "", "a missing link yields nothing");

    // Category ratings.
    deep(buildCategoryRatings({ story: 5, grindability: 3 }), {
      ratings: { story: 5 },
      dropped: 1,
    });
    deep(buildCategoryRatings({ story: 0 }), { ratings: {}, dropped: 0 }, "0 means unrated");
    deep(buildCategoryRatings(null), { ratings: {}, dropped: 0 });

    // Notes and playtime helpers on their own.
    eq(buildNotes([]), "");
    eq(buildNotes(null), "");
    eq(
      buildNotes([{ type: "session", content: "", sessionData: { duration: 60 } }]),
      "",
      "a session is not a note",
    );
    eq(buildNotes([{ content: "  bare  ", createdAt: "" }]), "bare", "no stamp when undatable");
    eq(
      buildPlaytime({ journalEntries: [{ type: "session", sessionData: { duration: 120 } }] }),
      2,
      "sessions are summed when no total is recorded",
    );
    eq(buildPlaytime({ totalPlaytime: 120, journalEntries: [] }), 2);
    eq(buildPlaytime({}), 0);

    // Launch configurations on their own.
    deep(resolveLaunchConfigurations(null).executables, []);
    eq(resolveLaunchConfigurations({ configurations: [] }).missing, false);
    eq(
      resolveLaunchConfigurations({
        configurations: [{ id: "c1", executablePath: installDir }],
        defaultConfigurationId: "c1",
      }).missing,
      true,
      "a folder is not a launchable, so it counts as missing",
    );
    eq(
      resolveLaunchConfigurations({
        configurations: [{ id: "c1", executablePath: mainExe }],
        defaultConfigurationId: "missing-id",
      }).singleExecutable,
      "Game.exe",
      "an unknown default id falls back to the first configuration",
    );

    console.log(`XLibrary parser checks passed (${assertions} assertions)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
