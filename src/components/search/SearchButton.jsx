/**
 * Icon-only search trigger for the topnav header layout. Unlike
 * SearchBox.jsx (a full text-input search bar, used in sidebar layout),
 * this just opens the existing SearchSidebar/filter panel — matching how
 * the reference XLibrary design keeps a single search affordance in its
 * top bar rather than a full inline search field next to the logo.
 */
export default function SearchButton({ onToggleSidebar }) {
  return (
    <button
      onClick={onToggleSidebar}
      className="w-9 h-9 flex items-center justify-center text-text hover:text-highlight focus:outline-none -webkit-app-region-no-drag"
      title="Search & Filters"
      aria-label="Search & Filters"
    >
      <i className="fas fa-search"></i>
    </button>
  )
}
