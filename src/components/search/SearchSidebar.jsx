import { useState, useEffect, useMemo } from 'react'
import { builtInSavedFilters, defaultFilters, normalizeFilterState } from '../../hooks/useFilters.js'

const SearchSidebar = ({
  isVisible,
  searchText = "",
  activeFilters = {},
  isCatalogMode = false,
  userSavedFilters = [],
  onSavedFilterSaved,
  onSearchChange,
  onFilterChange,
  onClose,
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

  useEffect(() => {
    setHighlightedTagIndex(-1);
  }, [tagSearch]);

  if (!isVisible) return null;

  return (
    <div
      className="w-[320px] bg-secondary border border-accent overflow-hidden shadow-2xl -webkit-app-region-no-drag fixed right-0 top-[70px] bottom-[50px]"
      style={{
        margin: "10px 10px 50px 10px", // 10px top/right/left, 50px bottom (footer + margin)
        borderRadius: "8px", // full rounded corners
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        height: "calc(100% - 70px - 60px)", // header (70px) + bottom buffer (60px)
        top: "70px",
        bottom: "auto",
      }}
    >
      {/* Fixed-height sticky header */}
      <div className="h-[60px] bg-secondary border-b border-border flex items-center justify-between px-4 sticky top-0 z-10">
        <span className="text-lg font-bold">
          <i className="fas fa-filter mr-2"></i>Filters
        </span>
        <div className="flex space-x-3">
          <button
            onClick={() => {
              onFilterChange?.(defaultFilters);
              setTagSearch("");
              onSearchChange?.("");
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
      <div className="h-[calc(100%-60px)] overflow-y-auto p-4">
        {/* Search Input */}
        <div className="mb-6">
          <div className="flex items-center border border-border rounded bg-tertiary">
            <i className="fas fa-search w-6 h-6 text-text pl-3 flex items-center justify-center"></i>
            <input
              type="text"
              placeholder="Search Atlas"
              value={searchText}
              onChange={(e) => {
                onSearchChange?.(e.target.value);
              }}
              className="bg-transparent outline-none text-text flex-1 px-3 py-2 focus:outline-none -webkit-app-region-no-drag"
            />
          </div>
        </div>

        {/* Saved filters */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-2">Saved Filters</h4>
          <p className="text-xs text-gray-400 mb-3">
            Browse and apply saved filters from the left sidebar.
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
                <div className="text-xs text-red-400">{saveError}</div>
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
                </select>
              </label>
              <label className="block text-sm">
                <span className="block mb-1">Date field</span>
                <select
                  className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                  value={selectedFilters.browseDateBasis}
                  onChange={(e) => updateFilters({ browseDateBasis: e.target.value })}
                >
                  <option value="thread_updated">Latest Update</option>
                  <option value="thread_publish_date">Thread Published</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Latest Update depends on AtlasDB thread update data. Some records may not appear until the database has finished updating.
                </p>
              </label>
              <label className="block text-sm">
                <span className="block mb-1">Date Range</span>
                <select
                  className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                  value={selectedFilters.browseDateRange}
                  onChange={(e) => updateFilters({ browseDateRange: e.target.value })}
                >
                  <option value="any">Any time</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="90d">Last 90 days</option>
                  <option value="year">This year</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="block mb-1">Sort</span>
                <select
                  className="w-full p-2 bg-tertiary border border-border rounded text-sm"
                  value={selectedFilters.browseSort}
                  onChange={(e) => updateFilters({ browseSort: e.target.value })}
                >
                  <option value="nameAsc">Title A/Z</option>
                  <option value="nameDesc">Title Z/A</option>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {/* Category */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Category</h4>
          <div className="flex flex-wrap gap-2">
            {options.categories.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCheckbox("category", cat)}
                className={`px-3 py-1 rounded text-sm ${
                  selectedFilters.category.includes(cat)
                    ? "bg-accent text-white"
                    : "bg-tertiary hover:bg-highlight"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Sorting */}
        {!isCatalogMode && (
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Sorting</h4>
          <div className="flex flex-wrap gap-2">
            {["name", "date", "likes", "views", "rating"].map((s) => (
              <button
                key={s}
                onClick={() => updateFilters({ sort: s })}
                className={`px-3 py-1 rounded text-sm ${
                  selectedFilters.sort === s
                    ? "bg-accent text-white"
                    : "bg-tertiary hover:bg-highlight"
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Tags */}
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3 flex justify-between items-center">
            Tags (Max 10)
            <span className="text-sm font-normal text-gray-400">
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
                handleCheckbox("tags", selectedTag);
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
                  ×
                </button>
              </span>
            ))}
          </div>
          {tagError && <div className="text-xs text-red-400 mb-2">{tagError}</div>}
          <div className="max-h-40 overflow-y-auto border border-border p-2 rounded bg-tertiary">
            {filteredTags.length === 0 ? (
              <p className="text-sm text-gray-500">No tags found</p>
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
                    onChange={() => handleCheckbox("tags", tag)}
                    disabled={
                      selectedFilters.tags.length >= 10 &&
                      !selectedFilters.tags.includes(tag)
                    }
                    className="-webkit-app-region-no-drag"
                  />
                  <span>{tag}</span>
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
              <p className="text-sm text-gray-500">No engines found</p>
            ) : (
              options.engines.map((engine) => (
                <label
                  key={engine}
                  className="flex items-center space-x-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.engine.includes(engine)}
                    onChange={() => handleCheckbox("engine", engine)}
                    className="-webkit-app-region-no-drag"
                  />
                  <span>{engine}</span>
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
              <p className="text-sm text-gray-500">No statuses found</p>
            ) : (
              options.statuses.map((status) => (
                <label
                  key={status}
                  className="flex items-center space-x-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFilters.status.includes(status)}
                    onChange={() => handleCheckbox("status", status)}
                    className="-webkit-app-region-no-drag"
                  />
                  <span>{status}</span>
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
