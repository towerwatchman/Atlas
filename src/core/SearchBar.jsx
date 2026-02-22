const { useState, useEffect } = window.React;

const SearchBar = ({ onFilterChange }) => {
  const [filter, setFilter] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchType, setSearchType] = useState("title"); // "title" or "creator"
  const [categories, setCategories] = useState([]);
  const [engines, setEngines] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [censored, setCensored] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedFilters, setSelectedFilters] = useState({
    category: [], // multi-select
    engine: [], // multi-select
    status: [], // multi-select
    censored: [], // multi-select
    language: [], // multi-select
    tags: [], // multi-select, max 10
    sort: "date", // single: date, likes, views, name, rating
    dateLimit: 0, // 0 = anytime, >0 = days back
    tagLogic: "AND", // AND/OR for tags
  });
  const [tagSearch, setTagSearch] = useState(""); // for filtering tag options
  const [accordionOpen, setAccordionOpen] = useState({
    engine: false,
    other: false,
    status: false,
  });

  useEffect(() => {
    // Fetch unique filter options from DB on mount
    window.electronAPI
      .getUniqueFilterOptions()
      .then((options) => {
        setCategories(options.categories || []);
        setEngines(options.engines || []);
        setStatuses(options.statuses || []);
        setCensored(options.censored || []);
        setLanguages(options.languages || []);
        setTags(options.tags || []);
      })
      .catch((err) => {
        console.error("Failed to load filter options:", err);
      });

    // Trigger initial filter change
    onFilterChange({ text: filter, ...selectedFilters });
  }, []);

  // Whenever filters change, call parent callback
  useEffect(() => {
    onFilterChange({ text: filter, type: searchType, ...selectedFilters });
  }, [filter, searchType, selectedFilters]);

  const handleCheckboxChange = (group, value) => {
    setSelectedFilters((prev) => {
      let newGroup = [...prev[group]];
      if (newGroup.includes(value)) {
        newGroup = newGroup.filter((v) => v !== value);
      } else {
        if (group === "tags" && newGroup.length >= 10) {
          alert("Max 10 tags allowed.");
          return prev;
        }
        newGroup.push(value);
      }
      return { ...prev, [group]: newGroup };
    });
  };

  const toggleAccordion = (key) => {
    setAccordionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredTags = tags.filter((tag) =>
    tag.toLowerCase().includes(tagSearch.toLowerCase()),
  );

  return (
    <div className="flex justify-center w-full">
      <div className="flex bg-secondary h-10 w-[400px] items-center rounded mt-[20px] border border-border hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent relative">
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
          <div className="absolute top-full left-0 mt-2 w-[400px] bg-secondary border border-border rounded shadow-lg z-50 p-2">
            {/* Filters Layout - Similar to provided HTML */}
            <div className="content-block_filter">
              <h3 className="content-block_filter-title flex justify-between">
                <div>
                  <i className="fas fa-filter"></i> Filters
                </div>
                <div className="button-group-small">
                  <a
                    onClick={() => {
                      setSelectedFilters({
                        category: [],
                        engine: [],
                        status: [],
                        censored: [],
                        language: [],
                        tags: [],
                        sort: "date",
                        dateLimit: 0,
                        tagLogic: "AND",
                      });
                    }}
                    className="button-icon cursor-pointer"
                  >
                    <i className="fas fa-undo-alt"></i>
                  </a>
                  <a
                    onClick={() => setIsMenuOpen(false)}
                    className="button-icon cursor-pointer"
                  >
                    <i className="fas fa-times"></i>
                  </a>
                </div>
              </h3>

              {/* Category - Button Group */}
              <div className="filter-block">
                <h4 className="filter-block_title">Category</h4>
                <div className="filter-block_content filter-block_h flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <div key={cat} className="filter-block_button-wrap">
                      <a
                        onClick={() => handleCheckboxChange("category", cat)}
                        className={`filter-block_button cursor-pointer ${selectedFilters.category.includes(cat) ? "filter-selected" : ""}`}
                      >
                        <i className="fas fa-gamepad"></i>{" "}
                        {/* Icon placeholder - adjust per cat */}
                      </a>
                      <div className="filter-block_button-label">{cat}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sorting - Button Group */}
              <div className="filter-block">
                <h4 className="filter-block_title">Sorting</h4>
                <div className="filter-block_content filter-block_h flex flex-wrap gap-2">
                  {["date", "likes", "views", "name", "rating"].map((sort) => (
                    <div key={sort} className="filter-block_button-wrap">
                      <a
                        onClick={() =>
                          setSelectedFilters((prev) => ({ ...prev, sort }))
                        }
                        className={`filter-block_button cursor-pointer ${selectedFilters.sort === sort ? "filter-selected" : ""}`}
                      >
                        <i className="fas fa-clock"></i>{" "}
                        {/* Icon placeholder - adjust per sort */}
                      </a>
                      <div className="filter-block_button-label">
                        {sort.charAt(0).toUpperCase() + sort.slice(1)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Date Limit - Slider */}
              <div className="filter-block range-slider_wrap">
                <h4 className="filter-block_title">Date Limit</h4>
                <div className="range-slider_value">
                  {selectedFilters.dateLimit === 0
                    ? "Anytime"
                    : `Last ${selectedFilters.dateLimit} days`}
                </div>
                <input
                  type="range"
                  min="0"
                  max="365"
                  step="1"
                  value={selectedFilters.dateLimit}
                  onChange={(e) =>
                    setSelectedFilters((prev) => ({
                      ...prev,
                      dateLimit: parseInt(e.target.value),
                    }))
                  }
                  className="w-full"
                />
              </div>

              {/* Search Type Toggle */}
              <div className="filter-block">
                <h4 className="filter-block_title">Search</h4>
                <a
                  onClick={() =>
                    setSearchType(searchType === "title" ? "creator" : "title")
                  }
                  className="filter-toggle_title cursor-pointer"
                >
                  <span
                    className={`filter-search_type-creator ${searchType === "creator" ? "on" : "off"}`}
                  >
                    Creator
                  </span>
                  <span className="divider">/</span>
                  <span
                    className={`filter-search_type-title ${searchType === "title" ? "on" : "off"}`}
                  >
                    Title
                  </span>
                </a>
              </div>

              {/* Tags - Multi-select with search, max 10, AND/OR toggle */}
              <div className="filter-block">
                <h4 className="filter-block_title">Tags (Max 10)</h4>
                <a
                  onClick={() =>
                    setSelectedFilters((prev) => ({
                      ...prev,
                      tagLogic: prev.tagLogic === "AND" ? "OR" : "AND",
                    }))
                  }
                  className="filter-toggle_title cursor-pointer"
                >
                  <span
                    className={`filter-tag_type-or ${selectedFilters.tagLogic === "OR" ? "on" : "off"}`}
                  >
                    OR
                  </span>
                  <span className="divider">/</span>
                  <span
                    className={`filter-tag_type-and ${selectedFilters.tagLogic === "AND" ? "on" : "off"}`}
                  >
                    AND
                  </span>
                </a>
                <div className="filter-block_content">
                  <input
                    type="text"
                    placeholder="Search tags..."
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    className="w-full p-1 bg-transparent border border-border rounded text-[11px] text-text mb-2"
                  />
                  <div className="filter-tags-selected-wrap">
                    {selectedFilters.tags.map((tag) => (
                      <span
                        key={tag}
                        className="selected-tag bg-accent px-2 py-1 rounded mr-1 mb-1"
                      >
                        {tag}{" "}
                        <i
                          className="fas fa-times cursor-pointer"
                          onClick={() => handleCheckboxChange("tags", tag)}
                        ></i>
                      </span>
                    ))}
                  </div>
                  <div className="max-h-32 overflow-y-auto">
                    {filteredTags.map((tag) => (
                      <label
                        key={tag}
                        className="flex items-center space-x-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFilters.tags.includes(tag)}
                          onChange={() => handleCheckboxChange("tags", tag)}
                          disabled={
                            selectedFilters.tags.length >= 10 &&
                            !selectedFilters.tags.includes(tag)
                          }
                        />
                        <span>{tag}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Prefixes - Accordions */}
              <div className="filter-block accordion-block">
                <h4
                  className="filter-block_title accordion-toggle cursor-pointer"
                  onClick={() => toggleAccordion("engine")}
                >
                  Prefix: Engine {accordionOpen.engine ? "-" : "+"}
                </h4>
                {accordionOpen.engine && (
                  <div className="filter-block_content accordion-content flex flex-col gap-1">
                    {engines.map((engine) => (
                      <label
                        key={engine}
                        className="flex items-center space-x-2"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFilters.engine.includes(engine)}
                          onChange={() =>
                            handleCheckboxChange("engine", engine)
                          }
                        />
                        <span>{engine}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Similar accordions for Other (use category or other fields), Status */}
              <div className="filter-block accordion-block">
                <h4
                  className="filter-block_title accordion-toggle cursor-pointer"
                  onClick={() => toggleAccordion("status")}
                >
                  Prefix: Status {accordionOpen.status ? "-" : "+"}
                </h4>
                {accordionOpen.status && (
                  <div className="filter-block_content accordion-content flex flex-col gap-1">
                    {statuses.map((status) => (
                      <label
                        key={status}
                        className="flex items-center space-x-2"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFilters.status.includes(status)}
                          onChange={() =>
                            handleCheckboxChange("status", status)
                          }
                        />
                        <span>{status}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Add more accordions as needed, e.g. for Censored, Language */}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

window.SearchBar = SearchBar;
