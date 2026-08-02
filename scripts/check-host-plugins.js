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

  // ── probe / validate / getQuota, with fetch stubbed ───────────────────────
  //
  // These were previously untested because they make network calls, which left
  // the three most consequential functions in the plugin unverified: probe
  // decides whether any bytes move at all, and getQuota reads a field whose
  // documented meaning is easy to get backwards.

  const realFetch = global.fetch;
  const stub = (handler) => { global.fetch = handler; };
  const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  try {
    // ── probe: the happy path ───────────────────────────────────────────────
    // The real failure this whole layer exists for: /u/{id} is an HTML page,
    // the bytes live at /api/file/{id}.
    {
      let requested = null;
      stub(async (url) => {
        requested = url;
        return jsonResponse({ id: "UPND8Ncr", name: "AFamilyVenture-0.09.zip",
                              size: 1234567, mime_type: "application/zip" });
      });
      const result = await pixeldrain.probe("https://pixeldrain.com/u/UPND8Ncr");
      eq(result.ok, true, "probe succeeds");
      eq(requested, "https://pixeldrain.com/api/file/UPND8Ncr/info", "hits the info endpoint");
      eq(result.directUrl, "https://pixeldrain.com/api/file/UPND8Ncr?download",
         "share page becomes a direct file url");
      eq(result.fileName, "AFamilyVenture-0.09.zip", "real filename from the host");
      eq(result.fileSize, 1234567, "size for an honest progress bar");
    }

    // An api key must reach the info call AND come back for the transfer, since
    // the limit applies to the download too, not just the lookup.
    {
      let sentAuth = null;
      stub(async (url, init) => {
        sentAuth = init?.headers?.authorization;
        return jsonResponse({ id: "abc", name: "g.zip", size: 1 });
      });
      const result = await pixeldrain.probe("https://pixeldrain.com/u/abc", { apiKey: "k" });
      ok(sentAuth?.startsWith("Basic "), "probe sends auth when a key is present");
      eq(result.headers.authorization, sentAuth, "and returns it for the transfer");
    }

    // ── probe: failures classify correctly ──────────────────────────────────
    {
      stub(async () => jsonResponse(
        { success: false, value: "file_not_found", message: "gone" }, 404));
      const result = await pixeldrain.probe("https://pixeldrain.com/u/missing");
      eq(result.ok, false, "404 fails");
      eq(result.kind, "fatal", "a missing file is not worth retrying");
    }
    {
      // 403 + rate-limit value. Per the docs this fires on hotlinking, which a
      // direct api fetch IS - so free users will meet it on popular files.
      stub(async () => jsonResponse(
        { success: false, value: "file_rate_limited_captcha_required" }, 403));
      const result = await pixeldrain.probe("https://pixeldrain.com/u/hot");
      eq(result.kind, "quota", "rate limiting is quota, not auth, despite the 403");
    }
    {
      // The other 403. Same status, completely different meaning, and it must
      // NOT be treated as a quota the user can wait out.
      stub(async () => jsonResponse(
        { success: false, value: "virus_detected_captcha_required" }, 403));
      const result = await pixeldrain.probe("https://pixeldrain.com/u/bad");
      eq(result.kind, "blocked", "a malware flag is terminal and distinct from quota");
    }
    {
      stub(async () => { throw new Error("ECONNRESET"); });
      const result = await pixeldrain.probe("https://pixeldrain.com/u/x");
      eq(result.ok, false, "network error fails");
      eq(result.kind, "transient", "and is retryable");
    }
    {
      // A non-JSON body means something intercepted the request.
      stub(async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }));
      const result = await pixeldrain.probe("https://pixeldrain.com/u/x");
      eq(result.ok, false, "unparseable response is a failure, not a silent pass");
    }

    // ── getQuota ────────────────────────────────────────────────────────────
    {
      stub(async () => jsonResponse({
        username: "tower",
        monthly_transfer_used: 5_000_000,
        monthly_transfer_cap: 20_000_000,
        subscription: { name: "Pro" },
      }));
      const result = await pixeldrain.getQuota({ apiKey: "k" });
      eq(result.ok, true, "quota read");
      eq(result.used, 5_000_000, "documented field name monthly_transfer_used");
      eq(result.cap, 20_000_000, "documented field name monthly_transfer_cap");
      eq(result.remaining, 15_000_000, "remaining computed");
      eq(result.plan, "Pro", "plan reported");
    }
    {
      // THE one worth pinning. The docs state a cap of 0 means NO custom cap.
      // Reading it as a literal limit reported "0 of 0 bytes" to every user who
      // had not configured one.
      stub(async () => jsonResponse({
        monthly_transfer_used: 5_000_000, monthly_transfer_cap: 0,
      }));
      const result = await pixeldrain.getQuota({ apiKey: "k" });
      eq(result.cap, null, "a cap of 0 is not a cap");
      eq(result.unlimited, true, "it means unlimited");
      eq(result.remaining, null, "so nothing is 'remaining'");
      eq(result.used, 5_000_000, "usage still reported");
    }

    // ── validate ────────────────────────────────────────────────────────────
    {
      // No key is a valid state: downloads work anonymously.
      const result = await pixeldrain.validate({});
      eq(result.ok, true, "no key validates as anonymous");
      eq(result.anonymous, true, "and says so");
    }
    {
      stub(async () => jsonResponse({ username: "tower", subscription: { name: "Pro" } }));
      const result = await pixeldrain.validate({ apiKey: "good" });
      eq(result.ok, true, "good key accepted");
      eq(result.username, "tower", "username surfaced for the settings row");
      eq(result.plan, "Pro", "plan surfaced");
    }
    {
      stub(async () => jsonResponse({ success: false }, 401));
      const result = await pixeldrain.validate({ apiKey: "bad" });
      eq(result.ok, false, "bad key rejected before being stored");
      ok(/rejected/i.test(result.error), "with a message the user can act on");
    }
    {
      // A shape change must not report a working key as broken.
      stub(async () => ({ ok: true, status: 200, json: async () => { throw new Error("x"); } }));
      const result = await pixeldrain.validate({ apiKey: "good" });
      eq(result.ok, true, "unparseable body still counts as a valid key");
      eq(result.username, "", "just with nothing to describe it");
    }

    // ── resolveDirectUrl end to end through the registry ────────────────────
    {
      stub(async () => jsonResponse({ id: "z", name: "game.zip", size: 42 }));
      const result = await registry.resolveDirectUrl("https://pixeldrain.com/u/z");
      eq(result.ok, true, "registry routes to the plugin");
      eq(result.plugin, "pixeldrain", "and reports which one");
      eq(result.directUrl, "https://pixeldrain.com/api/file/z?download", "translated");
      eq(result.passthrough, undefined, "not a passthrough");
    }
  } finally {
    global.fetch = realFetch;
  }

  console.log(`Host plugin checks passed (${checks} assertions)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
