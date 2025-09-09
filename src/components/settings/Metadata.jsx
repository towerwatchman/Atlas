const Metadata = () => {
  const [downloadPreviews, setDownloadPreviews] = React.useState(false);

  return (
    <div className="p-5 text-text">
      <div className="flex items-center mb-2">
        <label className="flex-1">Download Image Previews</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={downloadPreviews}
          onChange={() => setDownloadPreviews(!downloadPreviews)}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">This will grab all preview images when adding or updating existing games.</p>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

window.Metadata = Metadata;