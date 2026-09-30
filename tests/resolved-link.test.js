"use strict";

// Regression coverage for the Buzzheavier "Could not read a file id" crash.
//
// The browser resolve returns a direct CDN URL (ts.bzzhr.to/d/<id>?v=...). When
// that URL is enqueued as a fresh download, the manager used to re-read a file
// id from the /d/ path and fail fatally. The fix: recognise an already-resolved
// direct link and transfer it as-is. These tests fail against the old behaviour
// (a CDN /d/ link was neither "already resolved" nor probed as a passthrough)
// and pass after it.

const { isResolvedDirectLink } = require("../electron/downloads/resolvedLink");
const buzzheavier = require("../electron/downloads/hosts/buzzheavier");

describe("isResolvedDirectLink", () => {
  it("treats a share link on a gate host as NOT already resolved", () => {
    expect(isResolvedDirectLink("https://bzzhr.to/uld7h6izau9t", buzzheavier)).toBe(false);
  });

  it("treats the CDN /d/ link from the browser resolve as already resolved", () => {
    expect(
      isResolvedDirectLink("https://ts.bzzhr.to/d/uld7h6izau9t?v=token", buzzheavier),
    ).toBe(true);
  });

  it("treats any host outside gateHosts as already resolved (CDN, no /d/)", () => {
    expect(isResolvedDirectLink("https://cdn.example/d/uld7h6izau9t", buzzheavier)).toBe(true);
  });

  it("is false for an empty/unparseable url", () => {
    expect(isResolvedDirectLink("", buzzheavier)).toBe(false);
    expect(isResolvedDirectLink(null, buzzheavier)).toBe(false);
  });
});

describe("buzzheavier already-resolved CDN link", () => {
  it("fileIdFrom still reads the id from a /d/ CDN link for diagnostics", () => {
    expect(buzzheavier.fileIdFrom("https://ts.bzzhr.to/d/uld7h6izau9t")).toBe("uld7h6izau9t");
  });

  it("probe passes a /d/ CDN link through instead of re-resolving", async () => {
    const result = await buzzheavier.probe("https://ts.bzzhr.to/d/uld7h6izau9t?v=token");
    expect(result.ok).toBe(true);
    expect(result.passthrough).toBe(true);
    expect(result.directUrl).toBe("https://ts.bzzhr.to/d/uld7h6izau9t");
  });

  it("probe still resolves a genuine share link", async () => {
    // No network hit: this only asserts the /d/ short-circuit does not swallow
    // real share links. probe() returns fatal (no fetch stub) but NOT passthrough.
    const result = await buzzheavier.probe("https://bzzhr.to/uld7h6izau9t");
    expect(result.passthrough).not.toBe(true);
  });
});
