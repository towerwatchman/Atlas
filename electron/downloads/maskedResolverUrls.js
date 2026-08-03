"use strict";

// ── Masked resolver: URL decisions ───────────────────────────────────────────
//
// Split out from maskedResolver.js so it carries no Electron dependency. The
// window needs a real runtime, but these functions decide whether a resolve is
// USABLE, and that judgement is worth testing on any machine - including CI
// boxes with no Electron installed.
//
// The consequential one is pickBestCandidate. Mega's decryption key lives in
// the URL fragment, and a resolve that returns the right URL minus "#key"
// looks completely successful: it downloads several gigabytes and yields a
// file nobody can decrypt. Fragments are never sent to servers, so a
// network-level observation can never carry one while a renderer-level
// navigation can - which means "first observation wins" is exactly the wrong
// rule, and the fragment-bearing candidate has to win regardless of arrival
// order.

const F95_HOST = "f95zone.to";

/**
 * Still on the gate, rather than at the destination host.
 *
 * `gateHosts` defaults to F95 because that was the first use, but the window is
 * not F95-specific: any host that answers a download request with a redirect -
 * including one behind a Cloudflare challenge - is the same problem, and a real
 * browser is the thing that solves it.
 */
function isGateUrl(url, gateHosts = [F95_HOST]) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return gateHosts.some((gate) => host === gate || host.endsWith(`.${gate}`));
  } catch {
    // Unparseable: treat as not-yet-resolved rather than accidentally
    // accepting it as a destination.
    return true;
  }
}

/** about:blank, devtools:, data: and friends are navigation noise. */
function isNavigableHttp(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

/** A trailing bare "#" carries no key and does not count. */
function hasFragment(url) {
  const text = String(url || "");
  const index = text.indexOf("#");
  return index !== -1 && index < text.length - 1;
}

/**
 * Choose the usable destination from everything observed.
 *
 * Off-site and http(s) only; a fragment-bearing candidate always beats one
 * without, even if the fragmentless one arrived first. Otherwise earliest wins.
 */
function pickBestCandidate(candidates, gateHosts) {
  const usable = (candidates || []).filter(
    (entry) => entry && isNavigableHttp(entry.url) && !isGateUrl(entry.url, gateHosts),
  );
  if (usable.length === 0) return null;
  const withFragment = usable.filter((entry) => hasFragment(entry.url));
  return (withFragment.length > 0 ? withFragment : usable)[0];
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

module.exports = {
  F95_HOST,
  isGateUrl,
  isNavigableHttp,
  hasFragment,
  pickBestCandidate,
  hostOf,
};
