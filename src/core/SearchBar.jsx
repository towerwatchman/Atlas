const { useState, useEffect, useMemo } = window.React;

const SearchBar = ({ onFilterChange }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [accordionOpen, setAccordionOpen] = useState({
    engine: true, // expanded by default
    status: true, // expanded by default
    other: false,
  });
  const [tagSearch, setTagSearch] = useState("");
  const [selectedFilters, setSelectedFilters] = useState({
    category: [],
    engine: [],
    status: [],
    censored: [],
    language: [],
    tags: [],
    sort: "date",
    tagLogic: "AND",
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
      .then((data) => {
        setOptions(data);
      })
      .catch((err) => console.error("Failed to load filter options:", err));
  }, []);

  // Stable filter object to prevent infinite loop
  const currentFilters = useMemo(
    () => ({
      text: filter,
      ...selectedFilters,
    }),
    [filter, selectedFilters], // only recompute when these change
  );

  useEffect(() => {
    onFilterChange(currentFilters);
  }, [currentFilters, onFilterChange]); // safe deps

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

  const toggleAccordion = (key) => {
    setAccordionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Sort tags alphabetically (case-insensitive)
  const sortedTags = [...options.tags].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );

  // Filter the sorted list
  const filteredTags = sortedTags.filter((tag) =>
    tag.toLowerCase().includes(tagSearch.toLowerCase()),
  );

  return (
    <div className="flex justify-center w-full">
      <div className="flex bg-secondary h-10 w-[400px] items-center rounded mt-[20px] border border-border hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent relative -webkit-app-region-no-drag">
        <i className="fas fa-search w-6 h-6 text-text pl-2 flex items-center justify-center"></i>
        <input
          type="text"
          placeholder="Search Atlas"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-transparent outline-none text-text flex-1 px-2 focus:outline-none"
        />
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="w-10 h-10 flex items-center justify-center text-text hover:text-highlight focus:outline-none"
        >
          <i className="fas fa-sliders"></i>
        </button>

        {isMenuOpen && (
          <div className="absolute top-full left-0 mt-2 w-[400px] bg-secondary border border-border rounded shadow-lg z-50 max-h-[70vh] overflow-y-auto -webkit-app-region-no-drag">
            <div className="content-block_filter p-4">
              <h3 className="content-block_filter-title flex justify-between items-center mb-4 sticky top-0 bg-secondary z-10 pb-2 border-b border-border">
                <div className="text-lg font-bold">
                  <i className="fas fa-filter mr-2"></i>Filters
                </div>
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
                        sort: "date",
                        tagLogic: "AND",
                      });
                      setTagSearch("");
                    }}
                    className="text-text hover:text-accent flex items-center text-sm"
                  >
                    <i className="fas fa-undo-alt mr-1"></i> Reset
                  </button>
                  <button
                    onClick={() => setIsMenuOpen(false)}
                    className="text-text hover:text-accent flex items-center text-sm"
                  >
                    <i className="fas fa-times mr-1"></i> Close
                  </button>
                </div>
              </h3>

              {/* Category */}
              <div className="filter-block mb-4 border border-border rounded-md p-3 bg-primary">
                <h4 className="font-bold mb-2">Category</h4>
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
              <div className="filter-block mb-4 border border-border rounded-md p-3 bg-primary">
                <h4 className="font-bold mb-2">Sorting</h4>
                <div className="flex flex-wrap gap-2">
                  {["date", "likes", "views", "name", "rating"].map((s) => (
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
              <div className="filter-block mb-4 border border-border rounded-md p-3 bg-primary">
                <h4 className="font-bold mb-2 flex justify-between items-center">
                  Tags (Max 10)
                  <span className="text-sm font-normal text-gray-400">
                    {selectedFilters.tagLogic}
                  </span>
                </h4>
                <div className="flex gap-4 mb-3">
                  <button
                    onClick={() =>
                      setSelectedFilters((prev) => ({
                        ...prev,
                        tagLogic: "AND",
                      }))
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
                      setSelectedFilters((prev) => ({
                        ...prev,
                        tagLogic: "OR",
                      }))
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
                  placeholder="Search tags..."
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className="w-full p-2 bg-tertiary border border-border rounded mb-3 text-sm"
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
                    filteredTags.map((tag) => (
                      <label
                        key={tag}
                        className="flex items-center space-x-2 py-1 text-sm block hover:bg-highlight px-1 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFilters.tags.includes(tag)}
                          onChange={() => handleCheckbox("tags", tag)}
                          disabled={
                            selectedFilters.tags.length >= 10 &&
                            !selectedFilters.tags.includes(tag)
                          }
                        />
                        <span>{tag}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Engine - Expanded */}
              <div className="filter-block mb-4 border border-border rounded-md p-3 bg-primary">
                <h4
                  className="font-bold mb-2 cursor-pointer flex justify-between items-center"
                  onClick={() => toggleAccordion("engine")}
                >
                  Engine Prefix {accordionOpen.engine ? "▲" : "▼"}
                </h4>
                {accordionOpen.engine && (
                  <div className="grid grid-cols-2 gap-2">
                    {options.engines.map((engine) => (
                      <label
                        key={engine}
                        className="flex items-center space-x-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFilters.engine.includes(engine)}
                          onChange={() => handleCheckbox("engine", engine)}
                        />
                        <span>{engine}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Status - Expanded */}
              <div className="filter-block mb-4 border border-border rounded-md p-3 bg-primary">
                <h4
                  className="font-bold mb-2 cursor-pointer flex justify-between items-center"
                  onClick={() => toggleAccordion("status")}
                >
                  Status {accordionOpen.status ? "▲" : "▼"}
                </h4>
                {accordionOpen.status && (
                  <div className="grid grid-cols-2 gap-2">
                    {options.statuses.map((status) => (
                      <label
                        key={status}
                        className="flex items-center space-x-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFilters.status.includes(status)}
                          onChange={() => handleCheckbox("status", status)}
                        />
                        <span>{status}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Optional: Add Language, Censored, etc. here in similar bordered blocks */}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

window.SearchBar = SearchBar;
