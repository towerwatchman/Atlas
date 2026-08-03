"use strict";

// ── Download manager IPC ─────────────────────────────────────────────────────
//
// Thin layer: the queue lives in db/downloads.js and the transfer logic in
// downloads/downloadManager.js. This wires them to the renderer and broadcasts
// state changes to every open window, so the bottom-right status button and the
// downloads panel stay in step without polling.
//
// The downloads folder resolves from config (Library.downloadsFolder) and falls
// back to a `downloads` directory beside the games folder, so the feature works
// before the user has been anywhere near a settings page.

const path = require("path");
const { ipcMain, shell, BrowserWindow, app, dialog } = require("electron");

const downloadsDb = require("../db/downloads");
const manager = require("../downloads/downloadManager");
const credentialStore = require("../downloads/credentialStore");
const { getPlugin, listPlugins } = require("../downloads/hosts");
const { resolveMaskedLink } = require("../downloads/maskedResolver");
const accountStore = require("../accounts/accountStore");

let handlerCtx = null;

const getLiveConfig = () => handlerCtx?.appConfig || {};

// Downloads never live inside the library folder. That folder holds installed
// games and gets scanned as such, so parking in-progress archives there means
// a scan picks up half-written files as titles. When the user has not chosen a
// location we use the OS downloads directory, which is somewhere they already
// expect downloads to appear.
const resolveDownloadsDir = () => {
  const config = getLiveConfig();
  const explicit = String(config?.Library?.downloadsFolder || "").trim();
  if (explicit) return explicit;
  return path.join(app.getPath("downloads"), "Atlas");
};

const broadcast = (channel, payload) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  });
};

// Sent alongside every item change so the status button can render a badge and a
// combined progress figure without fetching the whole list itself.
const broadcastSummary = async () => {
  try {
    const items = await downloadsDb.listDownloads({ includeFinished: false });
    const running = items.filter((item) => item.state === "downloading");
    const totalBytes = running.reduce((sum, item) => sum + (item.totalBytes || 0), 0);
    const receivedBytes = running.reduce((sum, item) => sum + (item.receivedBytes || 0), 0);
    broadcast("downloads-summary", {
      active: items.length,
      running: running.length,
      awaitingFile: items.filter((item) => item.state === "awaiting_file").length,
      // Downloads sitting at the confirmation step. Surfaced separately so the
      // footer can say "N ready to install" rather than lumping them in with
      // queued items still waiting on bytes.
      ready: items.filter((item) => item.state === "ready").length,
      failed: items.filter((item) => item.state === "failed").length,
      percent: totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : null,
    });
  } catch (err) {
    console.warn("Could not broadcast downloads summary:", err.message);
  }
};

function registerDownloadsHandlers(ctx = {}) {
  handlerCtx = ctx;

  manager.configure({
    resolveDownloadsDir,
    // Per-host credentials keyed by plugin id, read fresh each time so a key
    // added in Settings takes effect without a restart. Anonymous is still a
    // valid state: every current plugin works without an account.
    resolveHostCredentials: () => credentialStore.getAllCredentials(),
    // Host plugins that declare requiresBrowser resolve through the same
    // Electron window the F95 masked links use. It is not F95-specific: it
    // loads a url and reports where the browser landed, which is exactly
    // what a Cloudflare-challenged host needs.
    browserResolver: (url, options) => resolveMaskedLink(url, options),
    onEvent: (type, payload) => {
      broadcast(type, payload);
      broadcastSummary();
    },

  });

  // Resolve one F95 masked link by opening it in a visible window carrying the
  // user's own session. The user clicks through; Atlas reads the address bar.
  // Nothing is clicked on their behalf - see maskedResolver.js.
  //
  // The diagnostics come back with the result and are logged deliberately: we
  // could not verify offline which Electron navigation event preserves the
  // URL fragment, and Mega's decryption key lives there. The first real
  // resolve tells us which source to trust.
  ipcMain.handle("downloads-resolve-masked", async (event, { url, title = "" } = {}) => {
    try {
      if (!url) return { ok: false, error: "No URL supplied" };
      // Refresh first so an expired cookie fails here, with a clear message,
      // rather than as a mystery captcha loop in the window.
      // Same shape as updateLinks: ensureFreshCookies is async,
      // getCookieHeaderForUrl is SYNCHRONOUS and returns a string. Neither is a
      // thenable, so neither can be .catch()'d - that mistake is what produced
      // ".catch is not a function" at runtime.
      try {
        await accountStore.ensureFreshCookies("f95");
      } catch (err) {
        console.warn("Could not refresh F95 cookies:", err.message);
      }
      const cookieHeader = accountStore.getCookieHeaderForUrl(url) || "";
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const result = await resolveMaskedLink(url, { parentWindow, cookieHeader, title });
      if (result?.diagnostics) {
        console.log("[masked-resolve]", JSON.stringify({
          ok: result.ok,
          host: result.host,
          hasFragment: result.hasFragment,
          source: result.source,
          ...result.diagnostics,
        }));
      }
      return result;
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Version suggestion for the install prompt. Lives here rather than in the
  // renderer because it reconciles the archive filename against the catalog's
  // version, and the parser and the record both sit on this side.
  ipcMain.handle("downloads-suggest-version", async (event, { id } = {}) => {
    try {
      const item = await downloadsDb.getDownload(id);
      if (!item) return { ok: false, error: "Download not found" };
      const { suggestVersion } = require("../downloads/versionFromFile");
      const { isInstalledVersion } = require("../downloads/replaceTarget");
      let catalogVersion = item.version || "";
      // The versions this download could replace, so the install modal can ask
      // instead of leaving the main process to infer it. Inference chose a
      // directory to delete with nothing on screen saying which.
      let versions = [];
      let selectedVersionId = null;
      if (item.recordId) {
        try {
          const record = await require("../db/versions").getGame(item.recordId);
          catalogVersion = record?.latestVersion || record?.latest_version || catalogVersion;
          selectedVersionId = record?.selected_version_id ?? null;
          versions = (Array.isArray(record?.versions) ? record.versions : [])
            .filter((entry) => entry && String(entry.version || "").trim())
            .map((entry) => ({
              versionId: entry.version_id ?? null,
              version: String(entry.version).trim(),
              installed: isInstalledVersion(entry),
              gamePath: entry.game_path || "",
            }));
        } catch {
          // Falling back to the queued version is fine; the field is editable
          // and the picker simply has nothing to offer.
        }
      }
      return {
        ok: true,
        ...suggestVersion(item.fileName || "", catalogVersion),
        versions,
        selectedVersionId,
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // ── Host accounts ────────────────────────────────────────────────────────
  // Metadata only crosses to the renderer. Secrets are decrypted in the main
  // process at the moment a download needs them and never sent anywhere.

  ipcMain.handle("hosts-list", async () => ({
    ok: true,
    available: credentialStore.isAvailable(),
    plugins: listPlugins().map((plugin) => {
      const full = getPlugin(plugin.id);
      return {
        ...plugin,
        credentialFields: full?.credentialFields || [],
        hasAccount: credentialStore.hasCredentials(plugin.id),
      };
    }),
    accounts: credentialStore.listAccounts(),
  }));

  // Credentials are verified against the host BEFORE being stored, so a typo
  // surfaces immediately rather than as a failed download later.
  ipcMain.handle("hosts-save-account", async (event, { hostId, secrets = {}, meta = {} } = {}) => {
    try {
      const plugin = getPlugin(hostId);
      if (!plugin) return { ok: false, error: `Unknown host: ${hostId}` };
      const check = await plugin.validate(secrets);
      if (!check?.ok) {
        return { ok: false, error: check?.error || "Those details were rejected" };
      }
      const saved = credentialStore.saveCredentials(hostId, secrets, {
        ...meta,
        username: check.username || meta.username || "",
        label: check.plan || meta.label || "",
      });
      return saved.ok ? { ...saved, validated: check } : saved;
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("hosts-remove-account", async (event, { hostId } = {}) => {
    try {
      return credentialStore.removeCredentials(hostId);
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Transfer allowance, when the host reports one. Drives the Settings readout
  // and gives the quota failure state something concrete to say.
  ipcMain.handle("hosts-quota", async (event, { hostId } = {}) => {
    try {
      const plugin = getPlugin(hostId);
      if (!plugin?.getQuota) return { ok: false, error: "This host does not report a quota" };
      return await plugin.getQuota(credentialStore.getCredentials(hostId));
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("downloads-list", async (event, options = {}) => {
    try {
      return { success: true, items: await downloadsDb.listDownloads(options) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("downloads-enqueue", async (event, payload = {}) => {
    try {
      const result = await manager.enqueue(payload);
      await broadcastSummary();
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // One action handler rather than six near-identical ones. The manager owns the
  // legality of each transition and reports why when it refuses.
  const actions = {
    pause: (id) => manager.pause(id),
    resume: (id) => manager.resume(id),
    cancel: (id) => manager.cancel(id),
    retry: (id) => manager.retry(id),
  };
  ipcMain.handle("downloads-action", async (event, { action, id } = {}) => {
    const handler = actions[action];
    if (!handler) return { success: false, error: `Unknown action: ${action}` };
    try {
      const result = await handler(id);
      await broadcastSummary();
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("downloads-remove", async (event, { id, deleteFile = false } = {}) => {
    try {
      const result = await manager.remove(id, { deleteFile });
      await broadcastSummary();
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("downloads-reorder", async (event, { ids = [] } = {}) => {
    try {
      return await manager.reorder(ids);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("downloads-clear-finished", async () => {
    try {
      await downloadsDb.clearFinishedDownloads();
      broadcast("downloads-changed", {});
      await broadcastSummary();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Reveal the file in the OS file manager — the usual escape hatch when someone
  // wants to do something with the archive Atlas did not anticipate.
  ipcMain.handle("downloads-reveal", async (event, { id } = {}) => {
    try {
      const item = await downloadsDb.getDownload(id);
      if (!item?.filePath) return { success: false, error: "No file for this download" };
      shell.showItemInFolder(item.filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("downloads-folder", async () => {
    const dir = resolveDownloadsDir();
    return { success: true, path: dir };
  });

  ipcMain.handle("downloads-open-folder", async () => {
    try {
      await shell.openPath(resolveDownloadsDir());
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Manual adoption: point Atlas at a file it did not download. Used when the
  // watch folder missed it, or when the file was saved somewhere else entirely.
  ipcMain.handle("downloads-attach-file", async (event, { id } = {}) => {
    try {
      const item = await downloadsDb.getDownload(id);
      if (!item) return { success: false, error: "Download not found" };
      const parent = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showOpenDialog(parent, {
        title: `Select the downloaded file for ${item.title}`,
        properties: ["openFile"],
      });
      if (picked.canceled || !picked.filePaths?.length) {
        return { success: false, canceled: true };
      }
      const filePath = picked.filePaths[0];
      await downloadsDb.updateDownload(id, {
        filePath,
        fileName: path.basename(filePath),
        source: "manual",
      });
      // Reuse the normal completion path so a manually attached file goes through
      // the same verify -> extract -> attach steps as a fetched one.
      const adopted = await manager.adoptFile(filePath);
      if (adopted == null) {
        // The matcher is conservative and may not tie the file to this item, but
        // the user explicitly chose it, so force it through.
        await manager.retry(id).catch(() => {});
      }
      await broadcastSummary();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Boot the queue after handlers exist, so a resumed transfer's first progress
  // event has somewhere to go.
  manager
    .start()
    .then(() => broadcastSummary())
    .catch((err) => console.error("Could not start the download manager:", err.message));
}

module.exports = registerDownloadsHandlers;
module.exports.resolveDownloadsDir = resolveDownloadsDir;
module.exports.broadcastDownloadsSummary = broadcastSummary;
