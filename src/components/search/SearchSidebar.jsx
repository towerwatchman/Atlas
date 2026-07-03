import { useState, useEffect, useMemo } from 'react'
import { builtInSavedFilters, getDefaultSortDirectionForSort, normalizeFilterState } from '../../hooks/useFilters.js'

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
      if (group === "tags" && newVals.length >= 10) {
        setTagError("Max 10 tags allowed.");
        return;
      }
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

    if (!exists && targetGroup === "tags" && nextValues.length > 10) {
      setTagError("Max 10 tags allowed.");
      return;
    }
    if (!exists && targetGroup === "excludedTags" && nextValues.length > 10) {
      setTagError("Max 10 excluded tags allowed.");
      return;
    }
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
      <div className="inline-flex rounded overflow-hidden border border-border">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePairedFilter(includeGroup, excludeGroup, value, "include");
          }}
          className={`px-2 py-1 text-xs ${included ? "bg-accent text-white" : "bg-tertiary hover:bg-highlight"}`}
          title={`Include ${value}`}
        >
          +
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePairedFilter(includeGroup, excludeGroup, value, "exclude");
          }}
          className={`px-2 py-1 text-xs ${excluded ? "bg-danger text-white" : "bg-tertiary hover:bg-highlight"}`}
          title={`Exclude ${value}`}
        >
          -
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
    <div className={containerClassName} style={containerStyle}>
      {/* Fixed-height sticky header */}
      <div className="h-[52px] bg-secondary border-b border-border flex items-center justify-between px-3 sticky top-0 z-10">
        <span className="text-base font-bold">
          <i className="fas fa-filter mr-2"></i>Filters
        </span>
        <div className="flex space-x-3">
          <button
            onClick={() => {
              setTagSearch("");
              setHighlightedTagIndex(-1);
              onResetFilters?.();
            }}
            className="text-text hover:text-accent text-sm flex items-center"
          >
            <i className="fas fa-undo-alt mr-1"></i> Reset
          </button>
          <button
            onClick={onClose}
            className="text-text hover:text-accent text-sm flex items-center"
          >
            <i className="fas fa-times mr-1"></i> Close
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="h-[calc(100%-52px)] overflow-y-auto p-3 [&>div]:!mb-4 [&>div]:!pb-3 [&_h4]:!mb-2 [&_.space-y-3]:space-y-2">
        {/* Search Input */}
        <div className="mb-6">
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
            <select
              value={selectedFilters.type}
              onChange={(e) => updateFilters({ type: e.target.value })}
              className="bg-primary border-l border-border text-text text-xs px-2 py-2 outline-none -webkit-app-region-no-drag"
              title="Search mode"
            >
              <option value="all">All</option>
              <option value="title">Title</option>
              <option value="creator">Creator</option>
              <option value="anyId">Any ID</option>
              <option value="atlasId">Atlas ID</option>
              <option value="f95Id">F95 ID</option>
              <option value="lewdcornerId">LewdCorner ID</option>
              <option value="steamId">Steam ID</option>
            </select>
          </div>
        </div>

        {/* Saved filters */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-2">Saved Filters</h4>
          <p className="text-xs text-muted mb-3">
            View and apply saved filters from the left sidebar.
          </p>
          {!isSaveFormOpen ? (
            <button
              onClick={() => {
                setIsSaveFormOpen(true);
                setSaveName("");
                setSaveError("");
              }}
              className="px-3 py-1 rounded text-sm bg-tertiary hover:bg-highlight"
            >
              Save Current
            </button>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                value={saveName}
                autoFocus
                placeholder="Filter name"
                onChange={(e) => {
                  setSaveName(e.target.value);
                  setSaveError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveCurrentFilter();
                  if (e.key === "Escape") closeSaveForm();
                }}
                className="w-full p-2 bg-tertiary border border-border rounded text-sm -webkit-app-region-no-drag"
                disabled={saveBusy}
              />
              {saveError && (
                <div className="text-xs text-danger">{saveError}</div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleSaveCurrentFilter()}
                  disabled={saveBusy}
                  className="px-3 py-1 rounded text-sm bg-accent text-white disabled:opacity-50"
                >
                  Save
                </button>
                {saveError === "A saved filter with this name already exists." && (
                  <button
                    onClick={() => handleSaveCurrentFilter({ overwrite: true })}
                    disabled={saveBusy}
                    className="px-3 py-1 rounded text-sm bg-tertiary hover:bg-highlight disabled:opacity-50"
                  >
                    Overwrite
                  </button>
                )}
                <button
                  onClick={closeSaveForm}
                  disabled={saveBusy}
                  className="px-3 py-1 rounded text-sm bg-tertiary hover:bg-highlight disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {isCatalogMode && (
          <div className="mb-6 border-b border-border pb-4">
            <h4 className="font-bold mb-3">Browse</h4>
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
          </div>
        )}

        {/* Dates */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Dates</h4>
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
            <label className="block text-sm">
              <span className="block mb-1">Date range</span>
              <select
                className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                value={selectedFilters.dateRange}
                onChange={(e) => handleDateRangeChange(e.target.value)}
                disabled={selectedFilters.dateField === "none"}
              >
                <option value="any">Any time</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="year">This year</option>
                <option value="custom">Custom range</option>
              </select>
            </label>
            {selectedFilters.dateRange === "custom" && selectedFilters.dateField !== "none" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  <span className="block mb-1">From</span>
                  <input
                    type="date"
                    className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                    value={selectedFilters.dateFrom}
                    onChange={(e) => updateFilters({ dateFrom: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">To</span>
                  <input
                    type="date"
                    className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                    value={selectedFilters.dateTo}
                    onChange={(e) => updateFilters({ dateTo: e.target.value })}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Steam mapping */}
        <div className="mb-6 border-b border-border pb-4">
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={selectedFilters.steamMapped || false}
              onChange={() =>
                updateFilters({
                  steamMapped: !selectedFilters.steamMapped,
                })
              }
              className="-webkit-app-region-no-drag"
            />
            <span>Has Steam mapping</span>
          </label>
        </div>

        {/* Category */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Category</h4>
          <div className="flex flex-wrap gap-2">
            {options.categories.map((cat) => (
              <span key={cat} className="inline-flex items-center gap-1 bg-primary border border-border rounded px-2 py-1 text-sm">
                <span>{cat}</span>
                {renderIncludeExcludeButtons("category", "excludedCategories", cat)}
              </span>
            ))}
          </div>
        </div>

        {/* Sorting */}
        {!isCatalogMode && (
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Sorting</h4>
          <div className="flex gap-2">
            <select
              className="min-w-0 flex-1 p-2 bg-tertiary border border-border rounded text-sm"
              value={selectedFilters.sort}
              onChange={(e) => {
                const sort = e.target.value
                updateFilters({ sort, sortDirection: getDefaultSortDirectionForSort(sort) })
              }}
            >
              <option value="name">Title</option>
              <option value="creator">Creator</option>
              <option value="date">Release Date</option>
              <option value="likes">Likes</option>
              <option value="views">Views</option>
              <option value="rating">Rating</option>
              <option value="installedVersionCount">Number of Versions</option>
              <option value="newlyInstalled">Install Date</option>
              <option value="newlyPlayed">Last Played</option>
              <option value="playtime">Playtime</option>
              <option value="fileSize">File Size</option>
              <option value="personalRating">Personal Rating</option>
            </select>
            <button
              type="button"
              onClick={() => updateFilters({
                sortDirection: selectedFilters.sortDirection === "asc" ? "desc" : "asc",
              })}
              className="w-[112px] px-3 py-2 rounded text-sm bg-tertiary hover:bg-highlight border border-border"
              title="Toggle sort direction"
            >
              {selectedFilters.sortDirection === "asc" ? "Ascending" : "Descending"}
            </button>
          </div>
        </div>
        )}

        {/* Ratings */}
        {!isCatalogMode && (
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Ratings</h4>
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="block mb-1">Personal rating</span>
              <select
                className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                value={selectedFilters.personalRatingStatus === 'unrated'
                  ? 'unrated'
                  : selectedFilters.personalRatingMin > 0
                    ? String(selectedFilters.personalRatingMin)
                    : selectedFilters.personalRatingStatus === 'rated'
                      ? 'rated'
                      : 'any'}
                onChange={(e) => {
                  const value = e.target.value
                  const personalRatingMin = /^\d+$/.test(value) ? Number(value) : 0
                  const personalRatingStatus = value === 'unrated' ? 'unrated' : value === 'any' ? 'any' : 'rated'
                  updateFilters({
                    personalRatingMin,
                    personalRatingStatus,
                    personalRatingRatedOnly: personalRatingStatus === 'rated',
                  })
                }}
              >
                <option value={0}>Any</option>
                <option value="rated">Rated only</option>
                <option value="unrated">Unrated only</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((rating) => (
                  <option key={rating} value={rating}>{rating}+</option>
                ))}
                <option value={10}>10</option>
              </select>
            </label>
          </div>
        </div>
        )}

        {/* Tags */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3 flex justify-between items-center">
            Tags (Max 10)
            <span className="text-sm font-normal text-muted">
              {selectedFilters.tagLogic}
            </span>
          </h4>
          <div className="flex gap-4 mb-3">
            <button
              onClick={() => updateFilters({ tagLogic: "AND" })}
              className={`px-4 py-1 rounded text-sm ${
                selectedFilters.tagLogic === "AND"
                  ? "bg-accent text-white"
                  : "bg-tertiary hover:bg-highlight"
              }`}
            >
              AND
            </button>
            <button
              onClick={() => updateFilters({ tagLogic: "OR" })}
              className={`px-4 py-1 rounded text-sm ${
                selectedFilters.tagLogic === "OR"
                  ? "bg-accent text-white"
                  : "bg-tertiary hover:bg-highlight"
              }`}
            >
              OR
            </button>
          </div>
          <input
            type="text"
            placeholder="Search tags... (↑↓ highlight, Enter select)"
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
            className="w-full p-2 bg-tertiary border border-border rounded mb-3 text-sm -webkit-app-region-no-drag"
          />
          <div className="flex flex-wrap gap-2 mb-3">
            {selectedFilters.tags.map((tag) => (
              <span
                key={tag}
                className="bg-accent px-3 py-1 rounded text-sm flex items-center"
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
                className="bg-danger px-3 py-1 rounded text-sm flex items-center"
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
          {tagError && <div className="text-xs text-danger mb-2">{tagError}</div>}
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {filteredTags.length === 0 ? (
              <p className="text-sm text-muted">No tags found</p>
            ) : (
              filteredTags.map((tag, index) => (
                <label
                  key={tag}
                  className={`flex items-center space-x-2 py-1 text-sm block px-1 rounded cursor-pointer ${
                    index === highlightedTagIndex
                      ? "bg-accent text-white"
                      : "hover:bg-highlight"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.tags.includes(tag)}
                    onChange={() => togglePairedFilter("tags", "excludedTags", tag, "include")}
                    disabled={
                      selectedFilters.tags.length >= 10 &&
                      !selectedFilters.tags.includes(tag)
                    }
                    className="-webkit-app-region-no-drag"
                  />
                  <span className="flex-1">{tag}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      togglePairedFilter("tags", "excludedTags", tag, "exclude");
                    }}
                    className={`px-2 py-0.5 rounded text-xs ${
                      selectedFilters.excludedTags.includes(tag)
                        ? "bg-danger text-white"
                        : "bg-primary hover:bg-selected"
                    }`}
                    title={`Exclude ${tag}`}
                  >
                    -
                  </button>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Engine */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Engine</h4>
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {options.engines.length === 0 ? (
              <p className="text-sm text-muted">No engines found</p>
            ) : (
              options.engines.map((engine) => (
                <label
                  key={engine}
                  className="flex items-center gap-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.engine.includes(engine)}
                    onChange={() => togglePairedFilter("engine", "excludedEngines", engine, "include")}
                    className="-webkit-app-region-no-drag"
                  />
                  <span className="flex-1">{engine}</span>
                  {renderIncludeExcludeButtons("engine", "excludedEngines", engine)}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Status */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Status</h4>
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {options.statuses.length === 0 ? (
              <p className="text-sm text-muted">No statuses found</p>
            ) : (
              options.statuses.map((status) => (
                <label
                  key={status}
                  className="flex items-center gap-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.status.includes(status)}
                    onChange={() => togglePairedFilter("status", "excludedStatuses", status, "include")}
                    className="-webkit-app-region-no-drag"
                  />
                  <span className="flex-1">{status}</span>
                  {renderIncludeExcludeButtons("status", "excludedStatuses", status)}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Update Available */}
        {!isCatalogMode && (
        <div className="mb-4">
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={selectedFilters.updateAvailable || false}
              onChange={() =>
                updateFilters({
                  updateAvailable: !selectedFilters.updateAvailable,
                })
              }
              className="-webkit-app-region-no-drag"
            />
            <span>Show only games with updates available</span>
          </label>
        </div>
        )}

        {!isCatalogMode && (
          <div className="mb-4">
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

        {/* Favorites */}
        {!isCatalogMode && (
        <div className="mb-4">
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={selectedFilters.favoritesOnly || false}
              onChange={() =>
                updateFilters({
                  favoritesOnly: !selectedFilters.favoritesOnly,
                })
              }
              className="-webkit-app-region-no-drag"
            />
            <span>Favorites only</span>
          </label>
        </div>
        )}

        {/* Multiple installed versions */}
        {!isCatalogMode && (
        <div className="mb-4">
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={selectedFilters.multipleInstalledVersions || false}
              onChange={() =>
                updateFilters({
                  multipleInstalledVersions:
                    !selectedFilters.multipleInstalledVersions,
                })
              }
              className="-webkit-app-region-no-drag"
            />
            <span>Show games with multiple installed versions</span>
          </label>
        </div>
        )}
      </div>
    </div>
  );
};

export default SearchSidebar
