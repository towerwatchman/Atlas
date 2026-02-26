const { useState, useEffect, useMemo } = window.React;

const SearchSidebar = ({ isVisible, onFilterChange, onClose }) => {
  const [filter, setFilter] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [highlightedTagIndex, setHighlightedTagIndex] = useState(-1);
  const [selectedFilters, setSelectedFilters] = useState({
    category: [],
    engine: [],
    status: [],
    censored: [],
    language: [],
    tags: [],
    sort: "name",
    tagLogic: "AND",
    updateAvailable: false,
  });
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

  const currentFilters = useMemo(
    () => ({
      text: filter,
      ...selectedFilters,
    }),
    [filter, selectedFilters],
  );

  useEffect(() => {
    onFilterChange(currentFilters);
  }, [currentFilters, onFilterChange]);

  const handleCheckbox = (group, value) => {
    setSelectedFilters((prev) => {
      let newVals = [...prev[group]];
      if (newVals.includes(value)) {
        newVals = newVals.filter((v) => v !== value);
      } else {
        if (group === "tags" && newVals.length >= 10) {
          alert("Max 10 tags allowed.");
          return prev;
        }
        newVals.push(value);
      }
      return { ...prev, [group]: newVals };
    });
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
              setSelectedFilters({
                category: [],
                engine: [],
                status: [],
                censored: [],
                language: [],
                tags: [],
                sort: "name",
                tagLogic: "AND",
                updateAvailable: false,
              });
              setTagSearch("");
              setFilter("");
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
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-transparent outline-none text-text flex-1 px-3 py-2 focus:outline-none -webkit-app-region-no-drag"
            />
          </div>
        </div>

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
        <div className="mb-6 border-b border-border pb-4">
          <h4 className="font-bold mb-3">Sorting</h4>
          <div className="flex flex-wrap gap-2">
            {["name", "date", "likes", "views", "rating"].map((s) => (
              <button
                key={s}
                onClick={() =>
                  setSelectedFilters((prev) => ({ ...prev, sort: s }))
                }
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
              onClick={() =>
                setSelectedFilters((prev) => ({ ...prev, tagLogic: "AND" }))
              }
              className={`px-4 py-1 rounded text-sm ${
                selectedFilters.tagLogic === "AND"
                  ? "bg-accent text-white"
                  : "bg-tertiary hover:bg-highlight"
              }`}
            >
              AND
            </button>
            <button
              onClick={() =>
                setSelectedFilters((prev) => ({ ...prev, tagLogic: "OR" }))
              }
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
        <div className="mb-4">
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={selectedFilters.updateAvailable || false}
              onChange={() =>
                setSelectedFilters((prev) => ({
                  ...prev,
                  updateAvailable: !prev.updateAvailable,
                }))
              }
              className="-webkit-app-region-no-drag"
            />
            <span>Show only games with updates available</span>
          </label>
        </div>
      </div>
    </div>
  );
};

window.SearchSidebar = SearchSidebar;
