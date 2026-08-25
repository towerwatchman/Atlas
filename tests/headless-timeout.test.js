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
