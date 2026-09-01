"use strict";

// Regression coverage for the Cloudflare challenge detector used by the
// hidden-resolve window.
//
// A host that requires a browser (Buzzheavier / Cloudflare) cannot clear its
// challenge while the window is hidden. The window stays hidden for clean
// downloads and only reveals when the poll detects a Cloudflare challenge (or,
// as a backstop, after the headlessTimeoutMs timeout).
//
// maskedResolver.js pulls in Electron at load time, so it is mocked here; the
// functions under test are pure and Electron-free.

vi.mock("electron", () => ({
  BrowserWindow: class {},
  session: { fromPartition: () => ({ clearStorageData() {} }) },
}));

const {
  isCloudflareChallenge,
  isCloudflareCookie,
} = require("../electron/downloads/maskedResolver");

describe("isCloudflareChallenge", () => {
  it("detects Cloudflare interstitial text", () => {
    expect(isCloudflareChallenge("Checking your browser before accessing Buzzheavier.")).toBe(true);
    expect(isCloudflareChallenge("Verify you are human")).toBe(true);
    expect(isCloudflareChallenge("Just a moment...")).toBe(true);
  });

  it("ignores ordinary page text", () => {
    expect(isCloudflareChallenge("Download starting now")).toBe(false);
    expect(isCloudflareChallenge("")).toBe(false);
    expect(isCloudflareChallenge(undefined)).toBe(false);
  });
});

describe("isCloudflareCookie", () => {
  it("keeps Cloudflare challenge cookies", () => {
    expect(isCloudflareCookie("cf_clearance")).toBe(true);
    expect(isCloudflareCookie("__cf_bm")).toBe(true);
    expect(isCloudflareCookie("__cfruid")).toBe(true);
    expect(isCloudflareCookie("cf_chl_opt")).toBe(true);
  });

  it("does not match ordinary or site-specific cookies", () => {
    expect(isCloudflareCookie("xf_session")).toBe(false);
    expect(isCloudflareCookie("xf_user")).toBe(false);
    expect(isCloudflareCookie("PHPSESSID")).toBe(false);
    expect(isCloudflareCookie("")).toBe(false);
    expect(isCloudflareCookie(undefined)).toBe(false);
  });
});

describe("isCloudflareCookie precision", () => {
  // The first version tested /^_?_?cf_/, which kept ANY cookie beginning cf_.
  // The partition is persistent, so whatever this keeps survives every later
  // resolve -- a site's own cf_-prefixed cookie leaking across resolves is
  // exactly the throwaway semantics the strip exists to preserve.
  it("strips a site's own cf_-prefixed cookies", () => {
    expect(isCloudflareCookie("cf_language")).toBe(false);
    expect(isCloudflareCookie("cf_tracking")).toBe(false);
    expect(isCloudflareCookie("cfduid_legacy")).toBe(false);
  });

  it("keeps the versioned challenge cookies Cloudflare actually sets", () => {
    expect(isCloudflareCookie("cf_chl_2")).toBe(true);
    expect(isCloudflareCookie("cf_chl_prog")).toBe(true);
    expect(isCloudflareCookie("cf_use_ob")).toBe(true);
    expect(isCloudflareCookie("__cfwaitingroom")).toBe(true);
  });
});

describe("resolveMaskedLink serialization", () => {
  // The partition went from throwaway-per-resolve to one shared persistent
  // session. session.webRequest.onBeforeRequest / onHeadersReceived take a
  // SINGLE listener each, so a second concurrent resolve would replace the
  // first one's capture and leave it hanging to timeout; the cookie strip at
  // the end of one resolve would also wipe cookies applyCookies() had just
  // installed for another. downloadManager runs two transfers at once, so this
  // is reachable. Resolves are therefore queued rather than overlapped.
  it("does not start a second resolve until the first settles", async () => {
    const { resolveMaskedLink } = require("../electron/downloads/maskedResolver");
    const order = [];
    // Not navigable -> the impl resolves immediately without touching Electron,
    // which is enough to observe ordering through the chain.
    const a = resolveMaskedLink("not-a-url").then(() => order.push("a"));
    const b = resolveMaskedLink("also-not-a-url").then(() => order.push("b"));
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });

  it("a failed resolve does not poison the queue for the next one", async () => {
    const { resolveMaskedLink } = require("../electron/downloads/maskedResolver");
    const first = await resolveMaskedLink("not-a-url");
    expect(first.ok).toBe(false);
    const second = await resolveMaskedLink("still-not-a-url");
    expect(second.ok).toBe(false);
  });
});
