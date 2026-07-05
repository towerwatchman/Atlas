import { useState, useEffect, useMemo } from 'react'
import { builtInSavedFilters, getDefaultSortDirectionForSort, normalizeFilterState } from '../../hooks/useFilters.js'
import SavedFiltersPanel from './SavedFiltersPanel.jsx'

// Collapsible accordion section — keeps the long filter list scannable so
// the panel isn't one endless scroll (matches the grouped/accordion layout
// of the reference filter sidebars). Each section owns its own open state
// and starts closed unless defaultOpen is set; the most-used sections open
// by default. An optional badge shows a count/summary next to the title.
function Collapsible({ title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-3 text-left -webkit-app-region-no-drag"
      >
        <span className="font-bold text-sm flex items-center gap-2">
          {title}
          {badge != null && badge !== "" && (
            <span className="text-[11px] font-normal text-muted">{badge}</span>
          )}
        </span>
        <i className={`fas fa-chevron-down text-xs text-muted transition-transform ${open ? "rotate-180" : ""}`}></i>
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

// Sort options shown as the always-visible icon row. Kept intentionally
// small (Title / Creator / Last Updated / Likes / Rating). "Last Updated"
// sorts by thread_updated (see useFilters 'lastUpdated').
const SORT_OPTIONS = [
  { value: 'name', label: 'Title', icon: 'fa-arrow-down-a-z' },
  { value: 'creator', label: 'Creator', icon: 'fa-user' },
  { value: 'lastUpdated', label: 'Last Updated', icon: 'fa-clock' },
  { value: 'likes', label: 'Likes', icon: 'fa-thumbs-up' },
  { value: 'rating', label: 'Rating', icon: 'fa-star' },
  { value: 'newlyInstalled', label: 'Install Date', icon: 'fa-download' },
  { value: 'newlyPlayed', label: 'Last Played', icon: 'fa-play' },
  { value: 'playtime', label: 'Playtime', icon: 'fa-stopwatch' },
  { value: 'fileSize', label: 'File Size', icon: 'fa-hard-drive' },
  { value: 'date', label: 'Release Date', icon: 'fa-calendar-day' },
]

const SearchSidebar = ({
  isVisible,
  searchText = "",
  activeFilters = {},
  isCatalogMode = false,
  userSavedFilters = [],
  onSavedFilterSaved,
  onSearchChange,
  onFilterChange,
  onResetFilters,
  onClose,
  activeSavedFilterId = '',
  savedFilterCounts = {},
  savedFilterDeleteStateById = {},
  onApplySavedFilter,
  onDeleteSavedFilter,
  // mode: 'overlay' (default, original behavior) floats fixed on top of
  // the library grid without affecting its layout. 'inline' instead
  // renders as a normal block — App.jsx places it as a flex sibling of
  // #gameGrid in that case (before it for side='left', after it for
  // side='right'), so the grid shrinks to share space rather than being
  // covered. side: which edge it's associated with — affects which
  // corners are rounded and (in overlay mode) which edge it's pinned to.
  mode = "overlay",
  side = "right",
}) => {
  const [tagSearch, setTagSearch] = useState("");
  const [highlightedTagIndex, setHighlightedTagIndex] = useState(-1);
  const [isSaveFormOpen, setIsSaveFormOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [tagError, setTagError] = useState("");
  const [showSavedView, setShowSavedView] = useState(false);
  const selectedFilters = normalizeFilterState(activeFilters);
  const [options, setOptions] = useState({
    categories: [],
    engines: [],
    statuses: [],
    censored: [],
    languages: [],
    tags: [],
  });

  useEffect(() => {
    window.electronAPI
      .getUniqueFilterOptions()
      .then((data) => setOptions(data))
      .catch((err) => console.error("Failed to load filter options:", err));
  }, []);

  const updateFilters = (changes) => {
    onFilterChange?.({ ...selectedFilters, ...changes });
  };

  const handleSortClick = (value) => {
    if (selectedFilters.sort === value) {
      updateFilters({ sortDirection: selectedFilters.sortDirection === "asc" ? "desc" : "asc" });
    } else {
      updateFilters({ sort: value, sortDirection: getDefaultSortDirectionForSort(value) });
    }
  };

  // Date slider drives the existing "custom" range as a rolling "last N days"
  // window (0 = Any time). Derived from dateFrom so it stays in sync.
  const dateSliderDays = useMemo(() => {
    if (selectedFilters.dateRange === "custom" && selectedFilters.dateFrom && !selectedFilters.dateTo) {
      const fromMs = Date.parse(`${selectedFilters.dateFrom}T00:00:00`);
      if (Number.isFinite(fromMs)) {
        return Math.max(0, Math.min(365, Math.round((Date.now() - fromMs) / 86400000)));
      }
    }
    return 0;
  }, [selectedFilters.dateRange, selectedFilters.dateFrom, selectedFilters.dateTo]);

  const handleDateSlider = (days) => {
    if (!days || days <= 0) {
      updateFilters({ dateRange: "any", dateFrom: "", dateTo: "" });
      return;
    }
    const iso = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    updateFilters({
      dateField: selectedFilters.dateField === "none" ? "releaseDate" : selectedFilters.dateField,
      dateRange: "custom",
      dateFrom: iso,
      dateTo: "",
    });
  };

  const handleInputKeyDown = (event) => {
    event.stopPropagation();
  };

  const closeSaveForm = () => {
    setIsSaveFormOpen(false);
    setSaveName("");
    setSaveError("");
  };

  const handleSaveCurrentFilter = async ({ overwrite = false } = {}) => {
    const name = String(saveName || "").trim();
    setSaveError("");
    if (!name) {
      setSaveError("Enter a filter name.");
      return;
    }

    if (builtInSavedFilters.some((filter) => filter.name.toLowerCase() === name.toLowerCase())) {
      setSaveError("That name is used by a built-in filter.");
      return;
    }

    const existing = userSavedFilters.find(
      (filter) => filter.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing && !overwrite) {
      setSaveError("A saved filter with this name already exists.");
      return;
    }

    const filterToSave = {
      id: existing?.id,
      name,
      filters: normalizeFilterState({ ...selectedFilters, text: searchText }),
    };
    setSaveBusy(true);
    try {
      const result = await window.electronAPI.saveSavedFilter?.(filterToSave);
      if (!result?.success) {
        setSaveError(`Failed to save filter: ${result?.error || "Unknown error"}`);
        console.error("Failed to save filter:", result?.error);
        return;
      }
      onSavedFilterSaved?.(result.filter);
      closeSaveForm();
    } catch (err) {
      setSaveError(`Failed to save filter: ${err.message || "Unknown error"}`);
      console.error("Failed to save filter:", err);
    } finally {
      setSaveBusy(false);
    }
  };

  const handleCheckbox = (group, value) => {
    const currentValues = Array.isArray(selectedFilters[group])
      ? selectedFilters[group]
      : [];
    let newVals = [...currentValues];
    if (newVals.includes(value)) {
      newVals = newVals.filter((v) => v !== value);
    } else {
      newVals.push(value);
    }
    if (group === "tags") setTagError("");
    updateFilters({ [group]: newVals });
  };

  const togglePairedFilter = (includeGroup, excludeGroup, value, mode) => {
    const targetGroup = mode === "exclude" ? excludeGroup : includeGroup;
    const otherGroup = mode === "exclude" ? includeGroup : excludeGroup;
    const currentValues = Array.isArray(selectedFilters[targetGroup])
      ? selectedFilters[targetGroup]
      : [];
    const otherValues = Array.isArray(selectedFilters[otherGroup])
      ? selectedFilters[otherGroup]
      : [];
    const exists = currentValues.includes(value);
    const nextValues = exists
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];

    if (includeGroup === "tags") setTagError("");

    updateFilters({
      [targetGroup]: nextValues,
      [otherGroup]: exists ? otherValues : otherValues.filter((item) => item !== value),
    });
  };

  const renderIncludeExcludeButtons = (includeGroup, excludeGroup, value) => {
    const included = selectedFilters[includeGroup].includes(value);
    const excluded = selectedFilters[excludeGroup].includes(value);
    return (
      <div className="inline-flex rounded overflow-hidden border border-border shrink-0">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePairedFilter(includeGroup, excludeGroup, value, "include");
          }}
          className={`w-7 h-7 flex items-center justify-center text-xs ${included ? "bg-accent text-white" : "bg-tertiary hover:bg-highlight text-muted"}`}
          title={`Include ${value}`}
          aria-label={`Include ${value}`}
        >
          <i className="fas fa-check"></i>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePairedFilter(includeGroup, excludeGroup, value, "exclude");
          }}
          className={`w-7 h-7 flex items-center justify-center text-xs border-l border-border ${excluded ? "bg-danger text-white" : "bg-tertiary hover:bg-highlight text-muted"}`}
          title={`Exclude ${value}`}
          aria-label={`Exclude ${value}`}
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
    );
  };

  const sortedTags = useMemo(
    () =>
      [...options.tags].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      ),
    [options.tags],
  );

  const filteredTags = sortedTags.filter((tag) =>
    tag.toLowerCase().includes(tagSearch.toLowerCase()),
  );

  const dateFieldOptions = isCatalogMode
    ? [
        ["none", "No date filter"],
        ["latestUpdate", "Latest Update"],
        ["threadPublished", "Thread Published"],
        ["releaseDate", "Release Date"],
      ]
    : [
        ["none", "No date filter"],
        ["releaseDate", "Release Date"],
        ["lastInstalled", "Last Installed"],
        ["lastPlayed", "Last Played"],
        ["wishlistAdded", "Wishlist Added"],
      ];

  const handleDateFieldChange = (value) => {
    updateFilters({ dateField: value });
  };

  const handleDateRangeChange = (value) => {
    updateFilters({
      dateRange: value,
      browseDateRange: value === "custom" ? "any" : value,
    });
  };

  useEffect(() => {
    setHighlightedTagIndex(-1);
  }, [tagSearch]);

  if (!isVisible) return null;

  const isOverlay = mode !== "inline";
  const isLeft = side === "left";

  // The only thing that differs between overlay and inline is the
  // positioning mechanism: overlay is `fixed` and pinned to an edge so it
  // floats above the grid; inline is a normal in-flow block (a flex
  // sibling of #gameGrid in App.jsx) that the grid shares space with
  // instead. Border, border-radius, drop shadow, and margin are the same
  // in both — this is the same panel, just docked differently.
  const containerClassName = [
    "w-[320px] bg-secondary border border-accent overflow-hidden shadow-2xl -webkit-app-region-no-drag flex-shrink-0",
    isOverlay ? "fixed" : "relative",
    isOverlay && isLeft ? "left-0" : "",
    isOverlay && !isLeft ? "right-0" : "",
  ].filter(Boolean).join(" ");

  const containerStyle = isOverlay
    ? {
        margin: isLeft ? "10px 0 50px 10px" : "10px 10px 50px 10px",
        borderRadius: "8px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        height: "calc(100% - 70px - 60px)", // header (70px) + bottom buffer (60px)
        top: "70px",
        bottom: "auto",
      }
    : {
        // Inline mode lives inside App.jsx's main-content flex row, which
        // is already top:70px/bottom:40px-bounded, so no top/bottom
        // positioning is needed here — but margin/radius/shadow stay
        // identical to overlay mode so the panel looks the same either
        // way, just docked instead of floating.
        margin: isLeft ? "10px 0 10px 10px" : "10px 10px 10px 0",
        borderRadius: "8px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        height: "calc(100% - 20px)", // fill the row, minus the 10px top/bottom margin
      };

  return (
    <>
    <div className={containerClassName} style={containerStyle}>
      {/* Fixed-height sticky header */}
      <div className="h-[52px] bg-secondary border-b border-border flex items-center justify-between px-3 sticky top-0 z-10">
        <span className="text-base font-bold flex items-center gap-2">
          <i className={`fas ${showSavedView ? 'fa-bookmark' : 'fa-filter'}`}></i>
          {showSavedView ? 'Saved Filters' : 'Filters'}
        </span>
        <div className="flex items-center gap-1">
          {!showSavedView && (
            <button
              onClick={() => { setIsSaveFormOpen(true); setSaveName(""); setSaveError(""); }}
              className="w-8 h-8 flex items-center justify-center rounded text-text hover:bg-tertiary hover:text-accent -webkit-app-region-no-drag"
              title="Save current filters"
              aria-label="Save current filters"
            >
              <i className="fas fa-floppy-disk"></i>
            </button>
          )}
          <button
            onClick={() => setShowSavedView((v) => !v)}
            className="w-8 h-8 flex items-center justify-center rounded text-text hover:bg-tertiary hover:text-accent -webkit-app-region-no-drag"
            title={showSavedView ? 'Back to filters' : 'Saved filters'}
            aria-label={showSavedView ? 'Back to filters' : 'Saved filters'}
          >
            <i className={`fas ${showSavedView ? 'fa-filter' : 'fa-bookmark'}`}></i>
          </button>
          <button
            onClick={() => { setTagSearch(""); setHighlightedTagIndex(-1); onResetFilters?.(); }}
            className="w-8 h-8 flex items-center justify-center rounded text-text hover:bg-tertiary hover:text-accent -webkit-app-region-no-drag"
            title="Reset filters"
            aria-label="Reset filters"
          >
            <i className="fas fa-undo-alt"></i>
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded text-text hover:bg-tertiary hover:text-accent -webkit-app-region-no-drag"
            title="Close"
            aria-label="Close"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="h-[calc(100%-52px)] overflow-y-auto -webkit-app-region-no-drag">
        {showSavedView ? (
          <div className="p-1">
            <SavedFiltersPanel
              userSavedFilters={userSavedFilters}
              activeSavedFilterId={activeSavedFilterId}
              counts={savedFilterCounts}
              deleteStateById={savedFilterDeleteStateById}
              onApplyFilter={onApplySavedFilter}
              onDeleteFilter={onDeleteSavedFilter}
            />
          </div>
        ) : (
          <>
        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center border border-border rounded bg-tertiary overflow-hidden -webkit-app-region-no-drag">
            <i className="fas fa-search w-6 h-6 text-text pl-3 flex items-center justify-center"></i>
            <input
              type="text"
              placeholder="Search Atlas"
              value={searchText}
              onChange={(e) => {
                onSearchChange?.(e.target.value);
              }}
              onKeyDown={handleInputKeyDown}
              className="bg-transparent outline-none text-text flex-1 px-3 py-2 focus:outline-none -webkit-app-region-no-drag"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => onSearchChange?.("")}
                title="Clear search"
                aria-label="Clear search"
                className="w-8 h-8 flex items-center justify-center text-muted hover:text-text focus:outline-none -webkit-app-region-no-drag"
              >
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>
        </div>

        <div className="px-3">
          {/* Sorting — always visible icon row */}
          {!isCatalogMode && (
            <div className="pt-3 pb-4 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">Sorting</span>
                <span className="text-[11px] text-muted">
                  {selectedFilters.sortDirection === "asc" ? "Ascending" : "Descending"}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {SORT_OPTIONS.map((opt) => {
                  const active = selectedFilters.sort === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleSortClick(opt.value)}
                      title={active ? `${opt.label} — ${selectedFilters.sortDirection === "asc" ? "Ascending" : "Descending"} (click to flip)` : opt.label}
                      aria-label={opt.label}
                      className={`h-9 flex items-center justify-center gap-1 rounded border text-sm ${active ? "bg-accent text-white border-accent" : "bg-tertiary hover:bg-highlight border-border text-text"}`}
                    >
                      <i className={`fas ${opt.icon}`}></i>
                      {active && <i className={`fas ${selectedFilters.sortDirection === "asc" ? "fa-caret-up" : "fa-caret-down"} text-xs`}></i>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Browse (catalog mode) */}
          {isCatalogMode && (
            <Collapsible title="Browse" defaultOpen>
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="block mb-1">Source</span>
                  <select
                    className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                    value={selectedFilters.browseSource}
                    onChange={(e) => updateFilters({ browseSource: e.target.value })}
                  >
                    <option value="all">All sources</option>
                    <option value="f95">F95</option>
                    <option value="lewdcorner">LewdCorner</option>
                    <option value="steam">Steam</option>
                    <option value="atlas">AtlasDB</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">Sort</span>
                  <select
                    className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                    value={selectedFilters.browseSort}
                    onChange={(e) => updateFilters({ browseSort: e.target.value })}
                  >
                    <option value="titleAsc">Title A/Z</option>
                    <option value="titleDesc">Title Z/A</option>
                    <option value="threadUpdatedDesc">Latest update</option>
                    <option value="threadUpdatedAsc">Oldest update</option>
                    <option value="threadPublishedDesc">Thread published newest</option>
                    <option value="threadPublishedAsc">Thread published oldest</option>
                    <option value="releaseDateDesc">Release date newest</option>
                    <option value="releaseDateAsc">Release date oldest</option>
                    <option value="f95LatestOrderDesc">F95 latest page order</option>
                    <option value="f95LatestOrderAsc">F95 oldest page order</option>
                  </select>
                  <p className="text-xs text-muted mt-1">
                    Latest update uses AtlasDB thread_updated. Entries without a known thread update date sort last and are excluded from date-range filters.
                  </p>
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">Minimum F95/LewdCorner rating</span>
                  <select
                    className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                    value={selectedFilters.communityRatingMin}
                    onChange={(e) => updateFilters({ communityRatingMin: Number(e.target.value) })}
                  >
                    <option value={0}>Any</option>
                    {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((rating) => (
                      <option key={rating} value={rating}>{rating}+</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted mt-1">
                    Uses the community rating from the source site — works across the whole catalog, not just installed titles.
                  </p>
                </label>
              </div>
            </Collapsible>
          )}

          {/* Dates */}
          <Collapsible title="Dates">
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="block mb-1">Date field</span>
                <select
                  className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                  value={selectedFilters.dateField}
                  onChange={(e) => handleDateFieldChange(e.target.value)}
                >
                  {dateFieldOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {isCatalogMode && selectedFilters.dateField === "latestUpdate" && (
                  <p className="text-xs text-muted mt-1">
                    Latest Update depends on AtlasDB thread update data. Some records may not appear until the database has finished updating.
                  </p>
                )}
              </label>
              <div className="text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span>Date limit</span>
                  <span className="text-[11px] text-muted">
                    {dateSliderDays === 0 ? "Any time" : `Last ${dateSliderDays} days`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="365"
                  step="1"
                  value={dateSliderDays}
                  onChange={(e) => handleDateSlider(Number(e.target.value))}
                  disabled={selectedFilters.dateField === "none"}
                  className="w-full accent-accent -webkit-app-region-no-drag"
                />
                {selectedFilters.dateField === "none" && (
                  <p className="text-[11px] text-muted mt-1">Choose a date field to enable.</p>
                )}
              </div>
            </div>
          </Collapsible>

          {/* Tags */}
          <Collapsible title="Tags">
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                placeholder="Search tags..."
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (filteredTags.length === 0) return;

                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightedTagIndex((prev) =>
                      prev < filteredTags.length - 1 ? prev + 1 : 0,
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightedTagIndex((prev) =>
                      prev > 0 ? prev - 1 : filteredTags.length - 1,
                    );
                  } else if (e.key === "Enter" && highlightedTagIndex >= 0) {
                    e.preventDefault();
                    const selectedTag = filteredTags[highlightedTagIndex];
                    togglePairedFilter("tags", "excludedTags", selectedTag, "include");
                    setTagSearch("");
                    setHighlightedTagIndex(-1);
                  }
                }}
                className="flex-1 min-w-0 p-2 bg-tertiary border border-border rounded text-sm -webkit-app-region-no-drag"
              />
              <div className="inline-flex rounded overflow-hidden border border-border shrink-0">
                <button
                  type="button"
                  onClick={() => updateFilters({ tagLogic: "AND" })}
                  className={`px-3 py-2 text-xs ${selectedFilters.tagLogic === "AND" ? "bg-accent text-white" : "bg-tertiary hover:bg-highlight"}`}
                  title="Match all selected tags"
                >
                  AND
                </button>
                <button
                  type="button"
                  onClick={() => updateFilters({ tagLogic: "OR" })}
                  className={`px-3 py-2 text-xs border-l border-border ${selectedFilters.tagLogic === "OR" ? "bg-accent text-white" : "bg-tertiary hover:bg-highlight"}`}
                  title="Match any selected tag"
                >
                  OR
                </button>
              </div>
            </div>
            {(selectedFilters.tags.length > 0 || selectedFilters.excludedTags.length > 0) && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedFilters.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-accent px-3 py-1 rounded text-sm flex items-center text-white"
                  >
                    {tag}
                    <button
                      onClick={() => handleCheckbox("tags", tag)}
                      className="ml-2 text-white text-xs"
                    >
                      x
                    </button>
                  </span>
                ))}
                {selectedFilters.excludedTags.map((tag) => (
                  <span
                    key={`excluded-${tag}`}
                    className="bg-danger px-3 py-1 rounded text-sm flex items-center text-white"
                  >
                    -{tag}
                    <button
                      onClick={() => togglePairedFilter("tags", "excludedTags", tag, "exclude")}
                      className="ml-2 text-white text-xs"
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
            {tagError && <div className="text-xs text-danger mb-2">{tagError}</div>}
            <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
              {filteredTags.length === 0 ? (
                <p className="text-sm text-muted">No tags found</p>
              ) : (
                filteredTags.map((tag, index) => (
                  <div
                    key={tag}
                    className={`flex items-center gap-2 py-1 text-sm px-1 rounded ${
                      index === highlightedTagIndex
                        ? "bg-accent text-white"
                        : "hover:bg-highlight"
                    }`}
                  >
                    <span className="flex-1">{tag}</span>
                    {renderIncludeExcludeButtons("tags", "excludedTags", tag)}
                  </div>
                ))
              )}
            </div>
          </Collapsible>

          {/* Category */}
          <Collapsible title="Category" defaultOpen>
            <div className="border border-border p-2 rounded bg-tertiary">
              {options.categories.length === 0 ? (
                <p className="text-sm text-muted">No categories found</p>
              ) : (
                options.categories.map((cat) => (
                  <div
                    key={cat}
                    className="flex items-center gap-2 py-1 text-sm hover:bg-highlight px-1 rounded"
                  >
                    <span className="flex-1">{cat}</span>
                    {renderIncludeExcludeButtons("category", "excludedCategories", cat)}
                  </div>
                ))
              )}
            </div>
          </Collapsible>

          {/* Engine */}
          <Collapsible
            title="Engine"
            badge={selectedFilters.engine.length ? String(selectedFilters.engine.length) : ""}
          >
            <div className="border border-border p-2 rounded bg-tertiary">
              {options.engines.length === 0 ? (
                <p className="text-sm text-muted">No engines found</p>
              ) : (
                options.engines.map((engine) => (
                  <div
                    key={engine}
                    className="flex items-center gap-2 py-1 text-sm hover:bg-highlight px-1 rounded"
                  >
                    <span className="flex-1">{engine}</span>
                    {renderIncludeExcludeButtons("engine", "excludedEngines", engine)}
                  </div>
                ))
              )}
            </div>
          </Collapsible>

          {/* Status */}
          <Collapsible
            title="Status"
            badge={selectedFilters.status.length ? String(selectedFilters.status.length) : ""}
          >
            <div className="border border-border p-2 rounded bg-tertiary">
              {options.statuses.length === 0 ? (
                <p className="text-sm text-muted">No statuses found</p>
              ) : (
                options.statuses.map((status) => (
                  <div
                    key={status}
                    className="flex items-center gap-2 py-1 text-sm hover:bg-highlight px-1 rounded"
                  >
                    <span className="flex-1">{status}</span>
                    {renderIncludeExcludeButtons("status", "excludedStatuses", status)}
                  </div>
                ))
              )}
            </div>
          </Collapsible>

          {/* Ratings */}
          {!isCatalogMode && (
            <Collapsible title="Ratings">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded overflow-hidden border border-border shrink-0">
                    {[["lt", "<"], ["eq", "="], ["gt", ">"]].map(([op, label]) => {
                      const active = selectedFilters.personalRatingStatus === "rated" && selectedFilters.personalRatingOp === op
                      return (
                        <button
                          key={op}
                          type="button"
                          onClick={() => {
                            if (active) {
                              updateFilters({ personalRatingStatus: "any", personalRatingRatedOnly: false })
                            } else {
                              updateFilters({ personalRatingStatus: "rated", personalRatingRatedOnly: true, personalRatingOp: op })
                            }
                          }}
                          className={`w-8 h-8 flex items-center justify-center text-sm ${op !== "lt" ? "border-l border-border" : ""} ${active ? "bg-accent text-white" : "bg-tertiary hover:bg-highlight"}`}
                          title={op === "lt" ? "Less than" : op === "gt" ? "Greater than" : "Equals"}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="1"
                    value={selectedFilters.personalRatingMin}
                    onChange={(e) => updateFilters({ personalRatingMin: Number(e.target.value) })}
                    disabled={selectedFilters.personalRatingStatus !== "rated"}
                    className="flex-1 min-w-0 accent-accent -webkit-app-region-no-drag"
                  />
                  <span className="text-sm w-5 text-right tabular-nums">{selectedFilters.personalRatingMin}</span>
                </div>
                <p className="text-[11px] text-muted">
                  {selectedFilters.personalRatingStatus === "rated"
                    ? `Personal rating ${selectedFilters.personalRatingOp === "lt" ? "<" : selectedFilters.personalRatingOp === "gt" ? ">" : "="} ${selectedFilters.personalRatingMin}`
                    : "Pick an operator to filter by your rating"}
                </p>
              </div>
            </Collapsible>
          )}

          {/* Quick Filters — grouped toggles + library scope */}
          <Collapsible title="Quick Filters" defaultOpen>
            <div className="space-y-3">
              {!isCatalogMode && (
                <div>
                  <label className="block text-sm mb-1">Library scope</label>
                  <select
                    className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                    value={selectedFilters.installState}
                    onChange={(e) => {
                      const installState = e.target.value;
                      updateFilters({
                        installState,
                        includeUninstalled: ['all', 'uninstalled'].includes(installState),
                      });
                    }}
                  >
                    <option value="installed">Installed titles</option>
                    <option value="all">Installed and uninstalled</option>
                    <option value="uninstalled">Uninstalled only</option>
                  </select>
                </div>
              )}
              {!isCatalogMode && (
                <label className="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedFilters.updateAvailable || false}
                    onChange={() => updateFilters({ updateAvailable: !selectedFilters.updateAvailable })}
                    className="accent-accent -webkit-app-region-no-drag"
                  />
                  <span>Show only games with updates available</span>
                </label>
              )}
              {!isCatalogMode && (
                <label className="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedFilters.favoritesOnly || false}
                    onChange={() => updateFilters({ favoritesOnly: !selectedFilters.favoritesOnly })}
                    className="accent-accent -webkit-app-region-no-drag"
                  />
                  <span>Favorites only</span>
                </label>
              )}
              {!isCatalogMode && (
                <label className="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedFilters.multipleInstalledVersions || false}
                    onChange={() => updateFilters({ multipleInstalledVersions: !selectedFilters.multipleInstalledVersions })}
                    className="accent-accent -webkit-app-region-no-drag"
                  />
                  <span>Show games with multiple installed versions</span>
                </label>
              )}
              <label className="flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedFilters.steamMapped || false}
                  onChange={() => updateFilters({ steamMapped: !selectedFilters.steamMapped })}
                  className="accent-accent -webkit-app-region-no-drag"
                />
                <span>Has Steam mapping</span>
              </label>
            </div>
          </Collapsible>

        </div>
          </>
        )}
      </div>
    </div>

    {isSaveFormOpen && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 -webkit-app-region-no-drag"
        onClick={closeSaveForm}
      >
        <div
          className="w-[360px] max-w-[90vw] bg-secondary border border-accent rounded-lg shadow-2xl p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold text-base">Save filter</span>
            <button
              onClick={closeSaveForm}
              disabled={saveBusy}
              className="w-7 h-7 flex items-center justify-center rounded text-muted hover:bg-tertiary hover:text-text disabled:opacity-50"
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          <label className="block text-xs text-muted mb-1">Save current filters as…</label>
          <input
            type="text"
            value={saveName}
            autoFocus
            placeholder="Filter name"
            onChange={(e) => { setSaveName(e.target.value); setSaveError(""); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") handleSaveCurrentFilter();
              if (e.key === "Escape") closeSaveForm();
            }}
            className="w-full p-2 bg-tertiary border border-border rounded text-sm -webkit-app-region-no-drag"
            disabled={saveBusy}
          />
          {saveError && <div className="text-xs text-danger mt-2">{saveError}</div>}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={closeSaveForm} disabled={saveBusy} className="px-3 py-1.5 rounded text-sm bg-tertiary hover:bg-highlight disabled:opacity-50">Cancel</button>
            {saveError === "A saved filter with this name already exists." && (
              <button onClick={() => handleSaveCurrentFilter({ overwrite: true })} disabled={saveBusy} className="px-3 py-1.5 rounded text-sm bg-tertiary hover:bg-highlight disabled:opacity-50">Overwrite</button>
            )}
            <button onClick={() => handleSaveCurrentFilter()} disabled={saveBusy} className="px-3 py-1.5 rounded text-sm bg-accent text-white disabled:opacity-50">Save</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default SearchSidebar
