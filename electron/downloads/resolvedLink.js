"use strict";

// ── Already-resolved direct-link detection ──────────────────────────────────
//
// A requiresBrowser host may resolve a share link into a DIRECT CDN file URL.
// Buzzheavier's hx-redirect answers with https://ts.bzzhr.to/d/<id>?v=...; the
// token is a signed, one-shot access grant for the file itself. When that URL
// is enqueued as a fresh download, re-running the browser resolve would try to
// read a file id from a /d/ CDN path (which fileIdFrom refuses) and crash with
// "Could not read a file id from this link". If the URL is already past the
// gate, the download manager should transfer it as-is.
//
// Kept free of Electron so it can be unit-tested without a window.

/**
 * True when `url` is already a resolved direct file link for `plugin`, so the
 * manager should skip the file-id read and browser resolve and transfer it
 * directly.
 *
 * A URL is "already resolved" when EITHER:
 *   - its host is NOT one of the plugin's gate hosts (it has left the share
 *     domain for the CDN), OR
 *   - its path is the host's CDN file path (/d/<id>).
 *
 * Both signals are conservative: a genuine share link lives on a gate host and
 * carries no /d/ segment.
 *
 * @param {string} url
 * @param {{gateHosts?:string[], requiresBrowser?:boolean}} plugin
 * @returns {boolean}
 */
function isResolvedDirectLink(url, plugin) {
  const text = String(url || "");
  if (!text) return false;
  try {
    const host = new URL(text).host;
    if (Array.isArray(plugin?.gateHosts) && !plugin.gateHosts.includes(host)) {
      return true;
    }
  } catch {
    // Not a URL we can parse; let the normal resolution path decide.
  }
  return /\/d\/[a-zA-Z0-9]/.test(text);
}

module.exports = { isResolvedDirectLink };
