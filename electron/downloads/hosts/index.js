"use strict";

// ── Host plugin registry ─────────────────────────────────────────────────────
//
// One place that knows which file hosts Atlas can actually download from.
//
// A resolved link is a WEB PAGE, not a file. https://pixeldrain.com/u/UPND8Ncr
// renders HTML; the bytes live at /api/file/UPND8Ncr. Fetching the page URL
// directly is how a "successful" download produces a 4KB html file with a
// game's name on it. A plugin's job is that translation, and nothing else.
//
// ── Contract ─────────────────────────────────────────────────────────────────
//
//   id                  stable key, matches the credential store entry
//   label               display name
//   supportsAnonymous   can it work with no credentials
//   matches(url)        is this host mine
//   probe(url, creds)   -> { ok, directUrl, fileName, fileSize, headers }
//                          or { ok:false, kind, error }
//   validate(creds)     credential check for the Settings screen
//   classifyError(err, { status, body }) -> quota | auth | transient | fatal
//
// Plugins do NOT transfer bytes. downloadManager already handles resumable
// transfers, redirects, progress throttling and cancellation; duplicating that
// per host would be four copies of the hardest code in the feature. A plugin
// returns a URL and the headers to send with it, and the manager takes over.
//
// classifyError is per-plugin because "you have hit your limit" looks different
// on every host - a status code on one, a JSON field on another. The queue
// runner acts on the classification, never on the raw error.

const pixeldrain = require("./pixeldrain");

// Order matters only for overlapping matchers, which there currently are none
// of. Add Gofile and Mega here as they land.
const plugins = [pixeldrain];

/** The plugin that handles this URL, or null when nothing does. */
function pluginFor(url) {
  const text = String(url || "");
  if (!text) return null;
  return plugins.find((plugin) => {
    try {
      return plugin.matches(text);
    } catch {
      return false;
    }
  }) || null;
}

function getPlugin(pluginId) {
  const key = String(pluginId || "").trim().toLowerCase();
  return plugins.find((plugin) => plugin.id === key) || null;
}

/** Host ids with a working plugin - drives which mirrors the update modal offers. */
function supportedHostIds() {
  return plugins.map((plugin) => plugin.id);
}

function listPlugins() {
  return plugins.map((plugin) => ({
    id: plugin.id,
    label: plugin.label,
    supportsAnonymous: plugin.supportsAnonymous !== false,
  }));
}

/**
 * Resolve a page URL into something fetchable.
 *
 * Returns the input unchanged when no plugin claims the host, so a direct file
 * URL still works and an unsupported host degrades to the old behaviour rather
 * than failing outright.
 */
async function resolveDirectUrl(url, credentialsByPlugin = {}) {
  const plugin = pluginFor(url);
  if (!plugin) {
    return { ok: true, directUrl: url, passthrough: true };
  }
  try {
    const result = await plugin.probe(url, credentialsByPlugin[plugin.id] || {});
    return { ...result, plugin: plugin.id };
  } catch (err) {
    return {
      ok: false,
      plugin: plugin.id,
      kind: plugin.classifyError(err) || "transient",
      error: err.message || String(err),
    };
  }
}

module.exports = {
  plugins,
  pluginFor,
  getPlugin,
  listPlugins,
  supportedHostIds,
  resolveDirectUrl,
};
