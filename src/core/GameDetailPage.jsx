const { useState, useEffect, useRef } = window.React;

const getInstalledVersions = (versions = []) =>
  versions.filter((version) => version.isInstalled !== false);

const getDefaultVersion = (versions = []) => {
  const installedVersions = getInstalledVersions(versions);
  return installedVersions[0] || versions[0] || null;
};

// Normalize a URL for comparison: drop query/hash, trim, lowercase.
const normalizeUrl = (url) => {
  if (!url) return "";
  return String(url).split(/[?#]/)[0].trim().toLowerCase().replace(/\/+$/, "");
};

// Previews sometimes include the same image used as the banner. Drop any
// preview that matches the banner by full URL or by filename.
const filterOutBanner = (urls = [], bannerUrl) => {
  const list = Array.isArray(urls) ? urls : [];
  const banner = normalizeUrl(bannerUrl);
  if (!banner) return list;
  const bannerName = banner.split("/").pop();
  return list.filter((u) => {
    const n = normalizeUrl(u);
    if (!n) return false;
    if (n === banner) return false;
    const name = n.split("/").pop();
    if (bannerName && name && name === bannerName) return false;
    return true;
  });
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

const LAUNCH_STATE = { IDLE: "idle", LAUNCHING: "launching", RUNNING: "running" };

// Steam-accurate button colors — bottom-left to top-right
const STEAM_GREEN  = "linear-gradient(to top right, #3d6b07 0%, #a4d007 100%)";
const STEAM_BLUE   = "linear-gradient(to top right, #1a3f7a 0%, #5b8bd4 100%)";
const STEAM_YELLOW = "linear-gradient(to top right, #6b5200 0%, #c4a400 100%)";
const STEAM_GRAY   = "linear-gradient(to top right, #222 0%, #555 100%)";

// Shared button shape styles
const ACTION_BTN = {
  height: 36,
  padding: "0 16px",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: "0.05em",
  color: "#d2e885",
  border: "none",
  borderRadius: 2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  textShadow: "1px 1px 0px rgba(0,0,0,0.5)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), 0 1px 3px rgba(0,0,0,0.5)",
  cursor: "pointer",
  transition: "filter 0.15s",
};

const GameDetailPage = ({ game, onBack, onRefresh }) => {
  const [previews, setPreviews]           = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [isRefreshingMedia, setIsRefreshingMedia] = useState(false);
  const [launchState, setLaunchState]     = useState(LAUNCH_STATE.IDLE);
  const [showInfo, setShowInfo]           = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const isRunningRef  = useRef(false);

  useEffect(() => {
    if (!game?.record_id) return;
    setSelectedVersion((current) => {
      const versions = game.versions || [];
      if (!current) return getDefaultVersion(versions);
      return (
        versions.find(
          (v) => v.version === current.version && v.game_path === current.game_path,
        ) || getDefaultVersion(versions)
      );
    });
    window.electronAPI
      .getPreviews(game.record_id)
      .then((urls) => setPreviews(filterOutBanner(urls, game.banner_url)))
      .catch((err) => { console.error("Failed to load previews:", err); setPreviews([]); });
  }, [game?.record_id, game?.versions]);

  // Reset on game change
  useEffect(() => {
    setLaunchState(LAUNCH_STATE.IDLE);
    setShowInfo(false);
    setLightboxIndex(null);
    isRunningRef.current = false;
  }, [game?.record_id]);

  // Lightbox keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") showPrevPreview();
      else if (e.key === "ArrowRight") showNextPreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, previews.length]);

  // Track game-updated to detect process close
  useEffect(() => {
    if (!game?.record_id) return;
    const handleGameUpdated = (event, payload) => {
      const updatedId = typeof payload === "object" ? payload?.record_id : payload;
      if (updatedId !== game.record_id) return;
      if (isRunningRef.current) {
        isRunningRef.current = false;
        setLaunchState(LAUNCH_STATE.IDLE);
        onRefresh?.(game.record_id);
      }
    };
    window.electronAPI.onGameUpdated(handleGameUpdated);
    return () => { window.electronAPI.removeAllListeners?.("game-updated"); };
  }, [game?.record_id, launchState]);

  const installedVersions = getInstalledVersions(game.versions || []);
  // The selected version is the source of truth for Play / Open Folder.
  // If the user selects a missing version, Play disables (canLaunch=false)
  // rather than silently launching a different one.
  const actionVersion = selectedVersion || getDefaultVersion(installedVersions);
  const canLaunch = Boolean(
    actionVersion &&
      actionVersion.isInstalled !== false &&
      (actionVersion.exec_path || game.record_id),
  );
  const canOpenFolder  = Boolean(actionVersion?.game_path && actionVersion.isInstalled !== false);
  const latestVersion  = game.latestVersion || game.latest_version || "";
  const localVersion   =
    actionVersion?.version ||
    selectedVersion?.version ||
    game.versions?.[0]?.version ||
    game.version || "";
  const hasInstalledVersion = game.hasInstalledVersion !== false;
  const versionOptions = game.versions || [];
  const metadataRows   = [
    ["Status",       game.status],
    ["Engine",       game.engine],
    ["Category",     game.category],
    ["Rating",       game.rating],
    ["Likes",        game.likes],
    ["Views",        game.views],
    ["Language",     game.language],
    ["Censored",     game.censored],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  // Info dropdown rows — everything not already shown prominently
  const infoRows = [
    ["Installed Version", localVersion],
    ["Latest Version",    latestVersion],
    ["Developer",         game.creator],
    ["Publisher",         game.publisher],
    ["Release Date",      game.release_date
      ? new Date(parseInt(game.release_date) * 1000).toISOString().split("T")[0]
      : null],
    ["Status",            game.status],
    ["Engine",            game.engine],
    ["Category",          game.category],
    ["Language",          game.language],
    ["Translations",      game.translations],
    ["Genre",             game.genre],
    ["Voice",             game.voice],
    ["Rating",            game.rating],
    ["Censored",          game.censored],
    ["Likes",             game.likes],
    ["Views",             game.views],
    ["F95 ID",            game.f95_id],
    ["Atlas ID",          game.atlas_id],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  const launchSelectedGame = async () => {
    if (!canLaunch || launchState !== LAUNCH_STATE.IDLE) return;
    setLaunchState(LAUNCH_STATE.LAUNCHING);
    try {
      await window.electronAPI.launchGame({
        recordId: game.record_id,
        version: actionVersion.version,
      });
      isRunningRef.current = true;
      setLaunchState(LAUNCH_STATE.RUNNING);
    } catch (err) {
      console.error("Launch failed:", err);
      setLaunchState(LAUNCH_STATE.IDLE);
      isRunningRef.current = false;
    }
  };

  const openSelectedFolder = async () => {
    if (!canOpenFolder) return;
    await window.electronAPI.openGameFolder({ recordId: game.record_id, version: actionVersion.version });
  };
  const openProperties = async () => { await window.electronAPI.openGameProperties(game.record_id); };
  const openWebsite    = async () => { if (game.siteUrl) await window.electronAPI.openExternalUrl(game.siteUrl); };
  const openPreview    = (index)    => { setLightboxIndex(index); };
  const closeLightbox  = ()         => { setLightboxIndex(null); };
  const showPrevPreview = () =>
    setLightboxIndex((i) => (i === null ? i : (i - 1 + previews.length) % previews.length));
  const showNextPreview = () =>
    setLightboxIndex((i) => (i === null ? i : (i + 1) % previews.length));

  const refreshMetadataAndImages = async () => {
    if (!game?.record_id || isRefreshingMedia) return;
    setIsRefreshingMedia(true);
    try {
      const result = await window.electronAPI.refreshGameMedia(game.record_id);
      if (result?.success === false) throw new Error(result.error || "Refresh failed");
      if (Array.isArray(result?.previewUrls)) setPreviews(filterOutBanner(result.previewUrls, game.banner_url));
      onRefresh?.(game.record_id);
    } catch (error) {
      console.error("Failed to refresh media links:", error);
      alert(`Failed to refresh media links: ${error.message}`);
    } finally {
      setIsRefreshingMedia(false);
    }
  };

  // Play button
  const playBg = launchState === LAUNCH_STATE.LAUNCHING ? STEAM_YELLOW
               : launchState === LAUNCH_STATE.RUNNING   ? STEAM_BLUE
               : !canLaunch                             ? STEAM_GRAY
               :                                          STEAM_GREEN;

  const playColor = launchState === LAUNCH_STATE.RUNNING ? "#8ab4f8"
                  : !canLaunch                           ? "#888"
                  :                                        "#d2e885";

  const playLabel = launchState === LAUNCH_STATE.LAUNCHING
    ? <span style={{ display:"flex", alignItems:"center", gap:7 }}><i className="fas fa-circle-notch fa-spin" style={{ fontSize:11 }}></i>LAUNCHING</span>
    : launchState === LAUNCH_STATE.RUNNING
    ? <span style={{ display:"flex", alignItems:"center", gap:7 }}><i className="fas fa-circle" style={{ fontSize:9, color:"#4ade80" }}></i>RUNNING</span>
    : <span style={{ display:"flex", alignItems:"center", gap:7 }}><i className="fas fa-play" style={{ fontSize:11 }}></i>PLAY</span>;

  // Icon button style helper
  const iconBtn = (disabled) => ({
    width: 34, height: 34,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 2,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.3 : 1,
    color: "inherit",
    transition: "background 0.15s, border-color 0.15s",
  });

  return (
    <div className="min-h-full bg-tertiary text-text flex flex-col">

      {/* ── Hero Banner ── */}
      <div style={{ position:"relative", height:370, flexShrink:0, overflow:"hidden", backgroundColor:"#1a1f2e" }}>
        {/* Blurred background fill */}
        {game.banner_url && (
          <img src={game.banner_url} alt="" style={{
            position:"absolute", inset:0, width:"100%", height:"100%",
            objectFit:"cover",
            filter:`blur(20px) ${hasInstalledVersion ? "" : "grayscale(1)"}`,
            transform:"scale(1.1)", opacity:0.6,
          }} />
        )}
        {!game.banner_url && <div style={{ position:"absolute", inset:0, background:"#1d2734" }} />}

        {/* Foreground — contain so whichever axis fills first is flush; mask feathers the letterbox edges */}
        {game.banner_url && (
          <img src={game.banner_url} alt="" style={{
            position:"absolute", inset:0, width:"100%", height:"100%",
            objectFit:"contain",
            filter: hasInstalledVersion ? "none" : "grayscale(1)",
            WebkitMaskImage:[
              "linear-gradient(to right,  transparent 0%, black 8%, black 92%, transparent 100%)",
              "linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)",
            ].join(", "),
            maskImage:[
              "linear-gradient(to right,  transparent 0%, black 8%, black 92%, transparent 100%)",
              "linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)",
            ].join(", "),
            WebkitMaskComposite:"source-in",
            maskComposite:"intersect",
          }} />
        )}

        {/* Bottom fade */}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, transparent 30%, var(--color-tertiary,#12161f) 100%)" }} />

        {/* Back */}
        <div style={{ position:"absolute", top:14, left:14 }}>
          <button onClick={onBack}
            className="text-xs text-text hover:text-highlight bg-primary/80 border border-border px-3 py-2"
            style={{ backdropFilter:"blur(4px)" }}>
            <i className="fas fa-arrow-left" style={{ marginRight:6 }}></i>Back to Library
          </button>
        </div>

        {/* Title */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"0 24px 16px" }}>
          <div className="text-sm text-highlight" style={{ marginBottom:2, opacity:0.9 }}>
            {game.creator || "Unknown creator"}
          </div>
          <h1 style={{ fontSize:32, fontWeight:700, lineHeight:1.2, textShadow:"0 2px 8px rgba(0,0,0,0.8)" }}>
            {game.title || "Untitled Game"}
          </h1>
        </div>
      </div>

      {/* ── Sticky Action Bar ── */}
      <div className="sticky top-0 z-30 bg-primary border-b border-border"
        style={{ boxShadow:"0 2px 12px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 16px" }}>

          {/* PLAY — leftmost */}
          <button
            onClick={launchSelectedGame}
            disabled={!canLaunch && launchState === LAUNCH_STATE.IDLE}
            style={{ ...ACTION_BTN, minWidth:130, background:playBg, color:playColor,
              cursor: launchState === LAUNCH_STATE.LAUNCHING ? "wait"
                    : launchState === LAUNCH_STATE.RUNNING   ? "default"
                    : !canLaunch                             ? "not-allowed"
                    :                                          "pointer",
              opacity: !canLaunch && launchState === LAUNCH_STATE.IDLE ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (canLaunch || launchState !== LAUNCH_STATE.IDLE) e.currentTarget.style.filter = "brightness(1.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
          >
            {playLabel}
          </button>

          {/* UPDATE — same size as PLAY, only shown when update available */}
          {game.isUpdateAvailable && (
            <button
              onClick={openWebsite}
              style={{ ...ACTION_BTN, minWidth:130,
                background:"linear-gradient(to top right, #1a3f7a 0%, #4a90d9 100%)",
                color:"#c8e0ff",
              }}
              onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
            >
              <span style={{ display:"flex", alignItems:"center", gap:7 }}>
                <i className="fas fa-arrow-up" style={{ fontSize:11 }}></i>UPDATE
              </span>
            </button>
          )}

          {/* Selected version indicator — sits to the right of PLAY / UPDATE */}
          {actionVersion && (
            <div style={{ display:"flex", flexDirection:"column", justifyContent:"center", lineHeight:1.25, marginLeft:6, minWidth:0 }}>
              <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.08em", color:"#7a8aa0", textTransform:"uppercase" }}>
                Selected Version
              </span>
              <span style={{ fontSize:13, fontWeight:600, color: actionVersion.isInstalled !== false ? "#d1d5db" : "#fca5a5", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {actionVersion.version || "Unknown"}
                {actionVersion.isInstalled === false && (
                  <span style={{ fontSize:10, color:"#fca5a5", marginLeft:6 }}>(missing)</span>
                )}
              </span>
            </div>
          )}

          <div style={{ flex:1 }} />

          {/* Icon buttons + info — right side */}
          <div style={{ display:"flex", alignItems:"center", gap:2, position:"relative" }}>
            <button onClick={openSelectedFolder} disabled={!canOpenFolder} title="Open Folder"
              style={iconBtn(!canOpenFolder)}
              className="hover:bg-secondary hover:border-border">
              <i className="fas fa-folder-open" style={{ fontSize:13 }}></i>
            </button>
            <button onClick={openProperties} title="Properties"
              style={iconBtn(false)}
              className="hover:bg-secondary hover:border-border">
              <i className="fas fa-sliders-h" style={{ fontSize:13 }}></i>
            </button>
            <button onClick={refreshMetadataAndImages} disabled={isRefreshingMedia} title="Refresh Media"
              style={iconBtn(isRefreshingMedia)}
              className="hover:bg-secondary hover:border-border">
              <i className={`fas fa-sync-alt ${isRefreshingMedia ? "fa-spin" : ""}`} style={{ fontSize:13 }}></i>
            </button>
            {game.siteUrl && (
              <button onClick={openWebsite} title="Website"
                style={iconBtn(false)}
                className="hover:bg-secondary hover:border-border">
                <i className="fas fa-external-link-alt" style={{ fontSize:13 }}></i>
              </button>
            )}

            {/* Divider */}
            <div style={{ width:1, height:22, background:"rgba(255,255,255,0.15)", margin:"0 4px" }} />

            {/* Info toggle button */}
            <button
              onClick={() => setShowInfo(s => !s)}
              title="Game Info"
              style={{ ...iconBtn(false), background: showInfo ? "rgba(255,255,255,0.08)" : "transparent" }}
              className="hover:bg-secondary hover:border-border">
              <i className="fas fa-info-circle" style={{ fontSize:14 }}></i>
            </button>
          </div>
        </div>
      </div>

      {/* ── Info Panel — inline, pushes content down ── */}
      {showInfo && (
        <div className="bg-secondary border-b border-border" style={{ padding:"16px 24px" }}>
          {game.isUpdateAvailable && (
            <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, marginBottom:12, padding:"8px 12px", background:"rgba(74,144,217,0.15)", border:"1px solid rgba(74,144,217,0.3)", borderRadius:2 }}>
              <i className="fas fa-arrow-circle-up" style={{ color:"#4a90d9" }}></i>
              <span style={{ color:"#c8e0ff" }}>Update available — {latestVersion}</span>
            </div>
          )}
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", color:"#7a9cc4", textTransform:"uppercase", marginBottom:10 }}>
            Game Information
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:"6px 32px" }}>
            {infoRows.map(([label, value]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.06)", fontSize:12 }}>
                <span style={{ color:"#7a9cc4", flexShrink:0 }}>{label}</span>
                <span style={{ color:"#d1d5db", textAlign:"right", wordBreak:"break-word" }}>{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="p-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">

        {/* Previews — full panel border including header */}
        <section className="border border-border bg-secondary" style={{ padding:12 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <h2 className="text-lg font-semibold">Previews</h2>
            <span style={{ fontSize:11, color:"#9ca3af" }}>{previews.length} available</span>
          </div>
          {previews.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {previews.map((preview, index) => (
                <div
                  key={`${preview}-${index}`}
                  className="border border-border overflow-hidden aspect-video cursor-pointer hover:border-accent transition-colors"
                  style={{ maxWidth:600 }}
                  onClick={() => openPreview(index)}
                  title="Click to view"
                >
                  <img src={preview} alt={`Preview ${index + 1}`}
                    style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ minHeight:140, display:"flex", alignItems:"center", justifyContent:"center", color:"#9ca3af" }}>
              No previews available
            </div>
          )}
        </section>

        {/* Sidebar */}
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
                      className={`w-full text-left border p-3 transition-colors ${
                        isSelected ? "border-accent bg-selected" : "border-border bg-primary hover:bg-selected"
                      }`}
                    >
                      <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
                        <span style={{ fontWeight:600, display:"flex", alignItems:"center", gap:7 }}>
                          {isSelected && <i className="fas fa-play" style={{ fontSize:9, color:"var(--color-accent,#86a8e7)" }}></i>}
                          {version.version || "Unknown version"}
                        </span>
                        <span style={{ fontSize:11, color: installed ? "#86efac" : "#fca5a5" }}>
                          {installed ? "Installed" : "Missing"}
                        </span>
                      </div>
                      <div style={{ fontSize:11, color:"#d1d5db", marginTop:3 }}>
                        {formatPlaytime(version.version_playtime)}
                      </div>
                      <div style={{ fontSize:11, color:"#9ca3af", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {version.game_path || "No path set"}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ color:"#9ca3af" }}>No versions recorded</div>
            )}
          </section>

          <section className="bg-secondary border border-border p-4">
            <h2 className="text-lg font-semibold mb-3">Details</h2>
            <div className="space-y-2 text-sm">
              {metadataRows.map(([label, value]) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between", gap:16, borderBottom:"1px solid rgba(255,255,255,0.08)", paddingBottom:6 }}>
                  <span style={{ color:"#9ca3af" }}>{label}</span>
                  <span style={{ textAlign:"right" }}>{value}</span>
                </div>
              ))}
              {metadataRows.length === 0 && <div style={{ color:"#9ca3af" }}>No metadata available</div>}
            </div>
          </section>

          {game.f95_tags && (
            <section className="bg-secondary border border-border p-4">
              <h2 className="text-lg font-semibold mb-3">Tags</h2>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {game.f95_tags.split(",").map(t => t.trim()).filter(Boolean).slice(0, 32).map(tag => (
                  <span key={tag} className="bg-primary border border-border px-2 py-1 text-xs">{tag}</span>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      {/* ── Preview Lightbox — in-app modal ── */}
      {lightboxIndex !== null && previews[lightboxIndex] && (
        <div
          onClick={closeLightbox}
          style={{
            position:"fixed", inset:0, zIndex:100,
            display:"flex", alignItems:"center", justifyContent:"center",
            background:"rgba(8,10,15,0.92)", backdropFilter:"blur(6px)",
          }}
        >
          {/* Top bar: counter + close */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position:"absolute", top:0, left:0, right:0, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 18px" }}
          >
            <span style={{ fontSize:12, fontWeight:600, color:"#9ca3af" }}>
              {lightboxIndex + 1} / {previews.length}
            </span>
            <button
              onClick={closeLightbox}
              title="Close (Esc)"
              style={{
                width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center",
                background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)",
                borderRadius:2, color:"#d1d5db", cursor:"pointer", transition:"background 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            >
              <i className="fas fa-times" style={{ fontSize:15 }}></i>
            </button>
          </div>

          {/* Prev */}
          {previews.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); showPrevPreview(); }}
              title="Previous (←)"
              style={{
                position:"absolute", left:18, top:"50%", transform:"translateY(-50%)",
                width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center",
                background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)",
                borderRadius:2, color:"#d1d5db", cursor:"pointer", transition:"background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            >
              <i className="fas fa-chevron-left" style={{ fontSize:16 }}></i>
            </button>
          )}

          {/* Image */}
          <img
            src={previews[lightboxIndex]}
            alt={`Preview ${lightboxIndex + 1}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth:"90vw", maxHeight:"85vh", objectFit:"contain",
              border:"1px solid rgba(255,255,255,0.12)",
              boxShadow:"0 8px 40px rgba(0,0,0,0.6)",
            }}
          />

          {/* Next */}
          {previews.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); showNextPreview(); }}
              title="Next (→)"
              style={{
                position:"absolute", right:18, top:"50%", transform:"translateY(-50%)",
                width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center",
                background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)",
                borderRadius:2, color:"#d1d5db", cursor:"pointer", transition:"background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            >
              <i className="fas fa-chevron-right" style={{ fontSize:16 }}></i>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

window.GameDetailPage = GameDetailPage;