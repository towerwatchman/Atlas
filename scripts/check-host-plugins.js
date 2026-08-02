"use strict";

// Tests for the host plugin layer.
//
// This layer exists because of a specific, observed failure: a correctly
// resolved link (https://pixeldrain.com/u/UPND8Ncr) was fetched directly and
// produced a 4,202-byte HTML page named after the game. The bytes were always
// at /api/file/UPND8Ncr. Everything here guards that translation.
//
// Network calls are stubbed. What is being verified is URL handling, error
// classification and the registry contract - the parts that decide whether a
// download is even attempted, and whether a failure is retried or given up on.

const assert = require("assert");
const pixeldrain = require("../electron/downloads/hosts/pixeldrain");
const registry = require("../electron/downloads/hosts");
const { selectDownloadableLinks } = require("../electron/downloads/groupClassifier");

let checks = 0;
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };

(async () => {
  // ── URL recognition ─────────────────────────────────────────────────────────
  ok(pixeldrain.matches("https://pixeldrain.com/u/UPND8Ncr"), "share page matched");
  ok(pixeldrain.matches("https://pixeldrain.com/api/file/UPND8Ncr"), "api url matched");
  ok(!pixeldrain.matches("https://mega.nz/file/abc#key"), "mega not claimed");
  ok(!pixeldrain.matches("https://notpixeldrain.example.com/u/x"), "lookalike not claimed");

  // The real id from the observed failure.
  eq(pixeldrain.fileIdFrom("https://pixeldrain.com/u/UPND8Ncr"), "UPND8Ncr", "id from share page");
  eq(pixeldrain.fileIdFrom("https://pixeldrain.com/api/file/UPND8Ncr"), "UPND8Ncr", "id from api url");
  eq(pixeldrain.fileIdFrom("https://pixeldrain.com/l/abc123"), null, "list is not a file id");
  eq(pixeldrain.listIdFrom("https://pixeldrain.com/l/abc123"), "abc123", "list id extracted");

  // ── Albums are refused, not guessed at ──────────────────────────────────────
  {
    // A list is N files and the queue models one item as one file. Taking the
    // first entry would look like success and deliver a fraction of the game.
    const result = await (pixeldrain.probe("https://pixeldrain.com/l/abc123"));
    eq(result.ok, false, "album refused");
    eq(result.kind, "fatal", "not worth retrying");
    ok(/album/i.test(result.error), "explains why");
  }
  {
    const result = await (pixeldrain.probe("https://pixeldrain.com/"));
    eq(result.ok, false, "bare host refused");
  }

  // ── Auth header shape ───────────────────────────────────────────────────────
  // Pixeldrain uses HTTP Basic with an EMPTY username and the key as password.
  {
    const headers = pixeldrain.authHeaders({ apiKey: "secret" });
    const decoded = Buffer.from(headers.authorization.replace("Basic ", ""), "base64").toString();
    eq(decoded, ":secret", "empty username, key as password");
  }
  eq(Object.keys(pixeldrain.authHeaders({})).length, 0, "anonymous sends no auth header");

  // ── Error classification drives the retry policy ────────────────────────────
  // Getting these wrong means either spinning on a wall or giving up on a blip.
  eq(pixeldrain.classifyError(null, { status: 429 }), "quota", "429 is quota");
  eq(pixeldrain.classifyError(null, { body: { value: "file_rate_limited_captcha_required" } }),
     "quota", "rate limit value is quota");
  eq(pixeldrain.classifyError(null, { status: 401 }), "auth", "401 is auth");
  eq(pixeldrain.classifyError(null, { status: 404 }), "fatal", "404 is fatal");
  eq(pixeldrain.classifyError(null, { body: { value: "file_not_found" } }), "fatal", "not_found is fatal");
  eq(pixeldrain.classifyError(null, { status: 503 }), "transient", "5xx is transient");
  eq(pixeldrain.classifyError(new Error("ECONNRESET")), "transient", "socket error is transient");
  // Unknown failures retry rather than dying - a wasted retry beats a false give-up.
  eq(pixeldrain.classifyError(new Error("something odd")), "transient", "unknown defaults to transient");

  // ── Registry ────────────────────────────────────────────────────────────────
  eq(registry.pluginFor("https://pixeldrain.com/u/UPND8Ncr")?.id, "pixeldrain", "routed");
  eq(registry.pluginFor("https://mega.nz/file/abc"), null, "no plugin for mega yet");
  ok(registry.supportedHostIds().includes("pixeldrain"), "listed as supported");

  // An unclaimed url passes through unchanged, so a direct file link still works
  // and an unsupported host degrades rather than failing outright.
  {
    const result = await (registry.resolveDirectUrl("https://example.com/game.zip"));
    eq(result.ok, true, "passthrough ok");
    eq(result.passthrough, true, "flagged as passthrough");
    eq(result.directUrl, "https://example.com/game.zip", "url unchanged");
  }

  // ── The gating contract between classifier and registry ─────────────────────
  // groupClassifier reduces "pixeldrain.com" to "pixeldrain" before matching
  // against supported hosts. If plugin ids and that reduction ever disagree,
  // every mirror silently disappears from the update modal.
  {
    const supported = new Set(registry.supportedHostIds());
    const links = [
      { host: "pixeldrain.com", group: "Win/Linux", type: "game" },
      { host: "mega.nz", group: "Win/Linux", type: "game" },
      { host: "workupload.com", group: "Win/Linux", type: "game" },
    ];
    const result = selectDownloadableLinks(links, { supportedHosts: supported });
    eq(result.singles.length, 1, "only the host with a plugin is offered");
    eq(result.singles[0].link.host, "pixeldrain.com", "and it is pixeldrain");
    ok(result.rejected.some((entry) => /no plugin for mega/.test(entry.verdict.reason)),
       "mega rejected with a reason");
  }

  console.log(`Host plugin checks passed (${checks} assertions)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
