const { useState, useEffect } = window.React;

const getInstalledVersions = (versions = []) =>
  versions.filter((version) => version.isInstalled !== false);

const getDefaultVersion = (versions = []) => {
  const installedVersions = getInstalledVersions(versions);
  return installedVersions[0] || versions[0] || null;
};

const formatPlaytime = (minutes) => {
  const totalMinutes = Number(minutes || 0);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "Not played";
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hours <= 0) return `${mins}m played`;
  if (mins <= 0) return `${hours}h played`;
  return `${hours}h ${mins}m played`;
};

const GameDetailPage = ({ game, onBack, onRefresh }) => {
  const [previews, setPreviews] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [isRefreshingMedia, setIsRefreshingMedia] = useState(false);

  useEffect(() => {
    if (!game?.record_id) return;
    setSelectedVersion((current) => {
      const versions = game.versions || [];
      if (!current) return getDefaultVersion(versions);
      return (
        versions.find(
          (version) =>
            version.version === current.version &&
            version.game_path === current.game_path,
        ) || getDefaultVersion(versions)
      );
    });
    window.electronAPI
      .getPreviews(game.record_id)
      .then((urls) => setPreviews(Array.isArray(urls) ? urls : []))
      .catch((error) => {
        console.error("Failed to load previews:", error);
        setPreviews([]);
      });
  }, [game?.record_id, game?.versions]);

  const installedVersions = getInstalledVersions(game.versions || []);
  const actionVersion =
    selectedVersion && selectedVersion.isInstalled !== false
      ? selectedVersion
      : getDefaultVersion(installedVersions);
  const canLaunch = Boolean(
    actionVersion &&
      actionVersion.isInstalled !== false &&
      (actionVersion.exec_path || game.record_id),
  );
  const canOpenFolder = Boolean(
    actionVersion?.game_path && actionVersion.isInstalled !== false,
  );
  const latestVersion = game.latestVersion || game.latest_version || "";
  const localVersion =
    actionVersion?.version ||
    selectedVersion?.version ||
    game.versions?.[0]?.version ||
    game.version ||
    "";
  const hasInstalledVersion = game.hasInstalledVersion !== false;
  const versionOptions = game.versions || [];
  const metadataRows = [
    ["Status", game.status],
    ["Engine", game.engine],
    ["Category", game.category],
    ["Rating", game.rating],
    ["Likes", game.likes],
    ["Views", game.views],
    ["Language", game.language],
    ["Censored", game.censored],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  const launchSelectedGame = async () => {
    if (!canLaunch) return;
    await window.electronAPI.launchGame({
      recordId: game.record_id,
      version: actionVersion.version,
    });
    onRefresh?.(game.record_id);
  };

  const openSelectedFolder = async () => {
    if (!canOpenFolder) return;
    await window.electronAPI.openGameFolder({
      recordId: game.record_id,
      version: actionVersion.version,
    });
  };

  const openProperties = async () => {
    await window.electronAPI.openGameProperties(game.record_id);
  };

  const openWebsite = async () => {
    if (game.siteUrl) await window.electronAPI.openExternalUrl(game.siteUrl);
  };

  const refreshMetadataAndImages = async () => {
    if (!game?.record_id || isRefreshingMedia) return;
    setIsRefreshingMedia(true);
    try {
      const result = await window.electronAPI.refreshGameMedia(game.record_id);
      if (result?.success === false) {
        throw new Error(result.error || "Refresh failed");
      }
      if (Array.isArray(result?.previewUrls)) {
        setPreviews(result.previewUrls);
      }
      onRefresh?.(game.record_id);
    } catch (error) {
      console.error("Failed to refresh media links:", error);
      alert(`Failed to refresh media links: ${error.message}`);
    } finally {
      setIsRefreshingMedia(false);
    }
  };

  return (
    <div className="min-h-full bg-tertiary text-text">
      <div className="relative min-h-[320px] border-b border-border bg-secondary overflow-hidden">
        {game.banner_url ? (
          <img
            src={game.banner_url}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover opacity-35 ${hasInstalledVersion ? "" : "grayscale"}`}
          />
        ) : (
          <div className="absolute inset-0 bg-[#1d2734]"></div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-tertiary via-tertiary/75 to-primary/60"></div>
        <div className="relative p-6 pt-5 flex flex-col gap-5 min-h-[320px]">
          <button
            onClick={onBack}
            className="self-start text-xs text-text hover:text-highlight bg-primary/80 border border-border px-3 py-2"
          >
            <i className="fas fa-arrow-left mr-2"></i>
            Back to Library
          </button>

          <div className="mt-auto flex flex-col gap-4 max-w-[980px]">
            <div>
              <div className="text-sm text-highlight mb-1">
                {game.creator || "Unknown creator"}
              </div>
              <h1 className="text-[34px] leading-tight font-semibold">
                {game.title || "Untitled Game"}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {game.engine && (
                <span className="bg-accent px-2 py-1 text-white">
                  {game.engine}
                </span>
              )}
              {game.status && (
                <span className="bg-selected px-2 py-1">{game.status}</span>
              )}
              {!hasInstalledVersion && (
                <span className="bg-gray-700 border border-gray-500 px-2 py-1 text-gray-200">
                  Uninstalled
                </span>
              )}
              {localVersion && (
                <span className="bg-primary border border-border px-2 py-1">
                  Installed {localVersion}
                </span>
              )}
              {latestVersion && (
                <span className="bg-primary border border-border px-2 py-1">
                  Latest {latestVersion}
                </span>
              )}
              {game.isUpdateAvailable && (
                <button
                  onClick={openWebsite}
                  className="bg-blue-600 hover:bg-blue-700 px-2 py-1 text-white"
                >
                  Update Available
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={launchSelectedGame}
                disabled={!canLaunch}
                className="bg-green-700 hover:bg-green-800 disabled:bg-gray-700 disabled:text-gray-400 px-5 py-2 font-semibold"
              >
                <i className="fas fa-play mr-2"></i>
                Play
              </button>
              <button
                onClick={openSelectedFolder}
                disabled={!canOpenFolder}
                className="bg-primary hover:bg-selected disabled:bg-gray-700 disabled:text-gray-400 border border-border px-4 py-2"
              >
                <i className="fas fa-folder-open mr-2"></i>
                Open Folder
              </button>
              <button
                onClick={openProperties}
                className="bg-primary hover:bg-selected border border-border px-4 py-2"
              >
                <i className="fas fa-sliders-h mr-2"></i>
                Properties
              </button>
              <button
                onClick={refreshMetadataAndImages}
                disabled={isRefreshingMedia}
                className="bg-primary hover:bg-selected disabled:bg-gray-700 disabled:text-gray-400 border border-border px-4 py-2"
              >
                <i className="fas fa-sync-alt mr-2"></i>
                {isRefreshingMedia ? "Refreshing..." : "Refresh Media Links"}
              </button>
              {game.siteUrl && (
                <button
                  onClick={openWebsite}
                  className="bg-primary hover:bg-selected border border-border px-4 py-2"
                >
                  <i className="fas fa-external-link-alt mr-2"></i>
                  Website
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Previews</h2>
            <span className="text-xs text-gray-300">
              {previews.length} available
            </span>
          </div>
          {previews.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {previews.map((preview, index) => (
                <div
                  key={`${preview}-${index}`}
                  className="bg-secondary border border-border aspect-video overflow-hidden"
                >
                  <img
                    src={preview}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-secondary border border-border min-h-[160px] flex items-center justify-center text-gray-300">
              No previews available
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="bg-secondary border border-border p-4">
            <h2 className="text-lg font-semibold mb-3">Versions</h2>
            {versionOptions.length > 0 ? (
              <div className="space-y-2">
                {versionOptions.map((version) => {
                  const isSelected =
                    selectedVersion?.version === version.version &&
                    selectedVersion?.game_path === version.game_path;
                  const installed = version.isInstalled !== false;
                  return (
                    <button
                      key={`${version.version}-${version.game_path}`}
                      onClick={() => setSelectedVersion(version)}
                      className={`w-full text-left border p-3 ${
                        isSelected
                          ? "border-accent bg-selected"
                          : "border-border bg-primary hover:bg-selected"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {version.version || "Unknown version"}
                        </span>
                        <span
                          className={`text-xs ${
                            installed ? "text-green-300" : "text-red-300"
                          }`}
                        >
                          {installed ? "Installed" : "Missing"}
                        </span>
                      </div>
                      <div className="text-xs text-gray-300 mt-1">
                        {formatPlaytime(version.version_playtime)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 truncate">
                        {version.game_path || "No path set"}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-gray-300">No versions recorded</div>
            )}
          </section>

          <section className="bg-secondary border border-border p-4">
            <h2 className="text-lg font-semibold mb-3">Details</h2>
            <div className="space-y-2 text-sm">
              {metadataRows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-4 border-b border-border/60 pb-2"
                >
                  <span className="text-gray-300">{label}</span>
                  <span className="text-right">{value}</span>
                </div>
              ))}
              {metadataRows.length === 0 && (
                <div className="text-gray-300">No metadata available</div>
              )}
            </div>
          </section>

          {game.f95_tags && (
            <section className="bg-secondary border border-border p-4">
              <h2 className="text-lg font-semibold mb-3">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {game.f95_tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .slice(0, 32)
                  .map((tag) => (
                    <span
                      key={tag}
                      className="bg-primary border border-border px-2 py-1 text-xs"
                    >
                      {tag}
                    </span>
                  ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

window.GameDetailPage = GameDetailPage;
