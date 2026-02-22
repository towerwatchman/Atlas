const { useState } = window.React;

const SearchBox = ({ onToggleSidebar }) => {
  const [filter, setFilter] = useState("");

  return (
    <div className="flex justify-center w-full">
      <div className="flex bg-secondary h-10 w-[400px] items-center rounded mt-[20px] border border-border hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent relative">
        <i className="fas fa-search w-6 h-6 text-text pl-2 flex items-center justify-center"></i>
        <input
          type="text"
          placeholder="Search Atlas"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-transparent outline-none text-text flex-1 px-2 focus:outline-none -webkit-app-region-no-drag"
        />
        <button
          onClick={onToggleSidebar}  // Now toggles the right sidebar
          className="w-10 h-10 flex items-center justify-center text-text hover:text-highlight focus:outline-none -webkit-app-region-no-drag"
        >
          <i className="fas fa-sliders"></i>
        </button>
      </div>
    </div>
  );
};

window.SearchBox = SearchBox;