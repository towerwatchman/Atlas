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
const buzzheavier = require("../electron/downloads/hosts/buzzheavier");
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
    // Two offered now that MEGA has a plugin. This assertion previously proved the
    // opposite -- that mega.nz was rejected for having none -- so its inversion is
    // what demonstrates MEGA links actually reach the mirror list.
    eq(result.singles.length, 2, "both hosts with a plugin are offered");
    const offered = result.singles.map((entry) => entry.link.host).sort();
    eq(offered.join(","), "mega.nz,pixeldrain.com", "pixeldrain and mega");
    ok(result.rejected.some((entry) => /no plugin for workupload/.test(entry.verdict.reason)),
       "a host with no plugin is still rejected with a reason");
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

  // ── Buzzheavier ───────────────────────────────────────────────────────────
  //
  // Its resolve path is inferred from the site running on htmx rather than from
  // their docs, so these tests pin the inference itself: the request shape sent,
  // the header read, and what happens when neither is what we expected.

  // Link recognition, including their short domain and their own site routes.
  ok(buzzheavier.matches("https://buzzheavier.com/abc123"), "main domain matched");
  ok(buzzheavier.matches("https://bzzhr.co/abc123"), "short domain matched");
  ok(!buzzheavier.matches("https://pixeldrain.com/u/x"), "other hosts not claimed");
  eq(buzzheavier.fileIdFrom("https://buzzheavier.com/abc123xyz"), "abc123xyz", "id extracted");
  eq(buzzheavier.fileIdFrom("https://bzzhr.co/abc123xyz"), "abc123xyz", "id from short domain");
  // A site page is not a share, and treating one as an id would queue nonsense.
  eq(buzzheavier.fileIdFrom("https://buzzheavier.com/pricing"), null, "site route is not a file id");
  eq(buzzheavier.fileIdFrom("https://buzzheavier.com/api/account"), null, "api route is not a file id");

  // Bearer, per their documented Authorization header.
  eq(buzzheavier.authHeaders({ accountId: "acc-1" }).authorization, "Bearer acc-1",
     "account id sent as a bearer token");
  eq(Object.keys(buzzheavier.authHeaders({})).length, 0, "anonymous sends no auth");

  // Cloudflare fronts this host, so a challenge is "not right now" rather than
  // a permanent failure - retrying later is reasonable, giving up is not.
  // A Cloudflare challenge is its own kind. It was previously folded into
  // quota, which told the user to wait or add an account - neither of which
  // does anything about a browser check. cf-mitigated is set explicitly by
  // Cloudflare, so it is a reliable signal to match on.
  eq(buzzheavier.classifyError(null, { body: { message: "Just a moment..." } }), "challenge",
     "cloudflare challenge is its own kind, not quota");
  eq(buzzheavier.classifyError(null, { body: { message: "cf-mitigated: challenge" } }), "challenge",
     "the cf-mitigated header value is recognised");
  // The plugin declares it needs a real browser, which is what routes it to
  // the Electron window instead of a fetch.
  ok(buzzheavier.requiresBrowser === true, "declares that it requires a browser");
  ok(buzzheavier.gateHosts.includes("bzzhr.to"), "short domain counts as the gate");
  eq(buzzheavier.browserPath("abc123"), "/abc123/download", "browser path built from the id");
  eq(buzzheavier.classifyError(null, { status: 429 }), "quota", "429 is quota");
  eq(buzzheavier.classifyError(null, { status: 401 }), "auth", "401 is auth");
  eq(buzzheavier.classifyError(null, { status: 404 }), "fatal", "404 is fatal");
  eq(buzzheavier.classifyError(new Error("ETIMEDOUT")), "transient", "timeout retries");

  try {
    // ── probe: htmx answers with HX-Redirect rather than a 3xx ──────────────
    {
      let seen = null;
      stub(async (url, init) => {
        seen = { url, headers: init?.headers, redirect: init?.redirect };
        return {
          ok: true,
          status: 200,
          headers: new Map([["hx-redirect", "https://cdn.buzzheavier.com/f/game-v1.zip"]]),
        };
      });
      // fetch's Headers has .get(); a Map does too, which is why it stands in.
      const result = await buzzheavier.probe("https://buzzheavier.com/abc123");
      eq(result.ok, true, "probe resolves");
      eq(seen.url, "https://buzzheavier.com/abc123/download", "hits the download route");
      eq(seen.headers["hx-request"], "true", "identifies as an htmx request");
      eq(seen.redirect, "manual", "does not follow - the header IS the answer");
      eq(result.directUrl, "https://cdn.buzzheavier.com/f/game-v1.zip", "direct url taken from the header");
      eq(result.fileName, "game-v1.zip", "filename derived from the resolved url");
      eq(result.headers.referer, "https://buzzheavier.com/abc123", "referer carried to the transfer");
    }

    // THE bug: requests must go to the origin the link was posted on. Asking
    // buzzheavier.com for a bzzhr.to id is a cross-domain request that
    // Cloudflare answers with a challenge, which surfaced to the user as
    // "transfer limit reached" - a wrong conclusion from a wrong request.
    {
      let seen = null;
      stub(async (url, init) => {
        seen = { url, headers: init?.headers };
        return { ok: true, status: 200,
          headers: new Map([["hx-redirect", "https://cdn.bzzhr.to/f/g.zip"]]) };
      });
      await buzzheavier.probe("https://bzzhr.to/zo4x4mws69ix");
      eq(seen.url, "https://bzzhr.to/zo4x4mws69ix/download",
         "short-domain link is requested on the short domain");
      eq(seen.headers.referer, "https://bzzhr.to/zo4x4mws69ix",
         "and the referer matches that origin");
    }
    {
      let seen = null;
      stub(async (url) => {
        seen = url;
        return { ok: true, status: 200,
          headers: new Map([["hx-redirect", "https://cdn.buzzheavier.com/f/g.zip"]]) };
      });
      await buzzheavier.probe("https://buzzheavier.com/abc123");
      eq(seen, "https://buzzheavier.com/abc123/download", "main domain unaffected");
    }
    // A relative redirect resolves against the link's own origin, not the
    // main domain - otherwise a bzzhr.to download points at buzzheavier.com.
    {
      stub(async () => ({ ok: true, status: 200,
        headers: new Map([["hx-redirect", "/dl/xyz/game.zip"]]) }));
      const result = await buzzheavier.probe("https://bzzhr.to/abc123");
      eq(result.directUrl, "https://bzzhr.to/dl/xyz/game.zip",
         "relative redirect stays on the short domain");
    }
    // A failed probe must say which URL it asked for.
    {
      stub(async () => ({ ok: true, status: 200, headers: new Map(),
        text: async () => "<html>nothing useful</html>" }));
      const result = await buzzheavier.probe("https://bzzhr.to/abc123");
      eq(result.diagnostic.requested, "https://bzzhr.to/abc123/download",
         "diagnostic names the request that failed");
    }

    // A relative location must be resolved against the site, not queued as-is.
    {
      stub(async () => ({ ok: true, status: 200,
        headers: new Map([["hx-redirect", "/dl/xyz/game.zip"]]) }));
      const result = await buzzheavier.probe("https://buzzheavier.com/abc123");
      eq(result.directUrl, "https://buzzheavier.com/dl/xyz/game.zip", "relative redirect made absolute");
    }

    // ── The inference being wrong is an expected outcome, not a crash ────────
    {
      stub(async () => ({
        ok: true, status: 200, headers: new Map(),
        text: async () => "<html><head><title>Just a moment...</title>cf-chl",
      }));
      const result = await buzzheavier.probe("https://buzzheavier.com/abc123");
      eq(result.ok, false, "challenge page fails");
      eq(result.kind, "quota", "and is retryable rather than terminal");
      ok(/challenge/i.test(result.error), "says what happened");
    }
    {
      // No redirect and no challenge means the route shape changed. The
      // diagnostic is the point: one failed run should say what to fix.
      stub(async () => ({
        ok: true, status: 200, headers: new Map([["content-type", "text/html"]]),
        text: async () => "<html>a normal page</html>",
      }));
      const result = await buzzheavier.probe("https://buzzheavier.com/abc123");
      eq(result.ok, false, "no location fails");
      ok(result.diagnostic, "and carries a diagnostic");
      eq(result.diagnostic.status, 200, "with the status");
      ok(result.diagnostic.headers["content-type"], "and the response headers");
      ok(result.diagnostic.bodyStart.length > 0, "and the start of the body");
    }
    {
      stub(async () => { throw new Error("ECONNRESET"); });
      const result = await buzzheavier.probe("https://buzzheavier.com/abc123");
      eq(result.kind, "transient", "network failure retries");
    }
    {
      const result = await buzzheavier.probe("https://buzzheavier.com/pricing");
      eq(result.ok, false, "a site page is refused");
      eq(result.kind, "fatal", "without a pointless retry");
    }

    // ── validate ────────────────────────────────────────────────────────────
    {
      const result = await buzzheavier.validate({});
      eq(result.ok, true, "no account is valid - public links need none");
      eq(result.anonymous, true, "reported as anonymous");
    }
    {
      stub(async () => jsonResponse({ username: "tower", plan: "pro" }));
      const result = await buzzheavier.validate({ accountId: "good" });
      eq(result.ok, true, "good account accepted");
      eq(result.username, "tower", "username surfaced");
    }
    {
      stub(async () => jsonResponse({}, 401));
      const result = await buzzheavier.validate({ accountId: "bad" });
      eq(result.ok, false, "bad account rejected before storage");
    }
    {
      // An unpublished schema must not fail a working account.
      stub(async () => ({ ok: true, status: 200, json: async () => { throw new Error("x"); } }));
      const result = await buzzheavier.validate({ accountId: "good" });
      eq(result.ok, true, "unparseable body still counts as valid");
    }

    // ── Registry ────────────────────────────────────────────────────────────
    // Still routable: a download already in the queue has to be able to finish.
    // Removing the plugin instead would fail it with "no plugin for this host" on
    // a link the user cannot obtain again.
    eq(registry.pluginFor("https://buzzheavier.com/abc123")?.id, "buzzheavier", "still routed");
    eq(registry.getPlugin("buzzheavier")?.id, "buzzheavier", "still resolvable by id");
    // Now offered: supportedHostIds gates the mirror list, so its presence here
    // is what makes every Buzzheavier link reach the update modal.
    ok(registry.supportedHostIds().includes("buzzheavier"), "offered as a mirror");
    ok(registry.supportedHostIds().includes("bzzhr"), "offered under its short alias");
    ok(registry.listPlugins().some((p) => p.id === "buzzheavier"), "visible in Settings");
    // buzz.to was never offered: the gate matches the FIRST LABEL of the host, so
    // it would need "buzz" in the supported set, and no plugin has ever claimed
    // it. Asserted so a future alias cannot reintroduce it by accident.
    ok(!registry.supportedHostIds().includes("buzz"), "buzz.to is not offered either");
    // pixeldrain, mega, and buzzheavier (with its bzzhr alias).
    eq(registry.supportedHostIds().length, 4, "four offered host labels");
    ok(registry.supportedHostIds().includes("mega"), "mega is offered");
  } finally {
    global.fetch = realFetch;
  }

  console.log(`Host plugin checks passed (${checks} assertions)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
