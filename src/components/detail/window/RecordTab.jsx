export default function RecordTab({ formData, onChange, onFindGame, onRemoveTitle, onDeleteTitleAndFiles }) {
  const fields = [
    { name: 'title', label: 'Title' },
    { name: 'mappings', label: 'Mappings', disabled: true },
    { name: 'platform', label: 'Platform' },
    { name: 'engine', label: 'Engine' },
    { name: 'developer', label: 'Developer' },
    { name: 'publisher', label: 'Publisher' },
    { name: 'status', label: 'Status' },
  ]

  const fieldsRight = [
    { name: 'category', label: 'Category' },
    { name: 'latest_version', label: 'Last Update' },
    { name: 'censored', label: 'Censored' },
    { name: 'language', label: 'Language' },
    { name: 'translations', label: 'Translations' },
    { name: 'genre', label: 'Genre' },
    { name: 'voice', label: 'Voice' },
    { name: 'rating', label: 'Rating' },
  ]

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        {fields.map(({ name, label, disabled }) => (
          <div key={name} className="flex items-center">
            <label className="w-24">{label}</label>
            <input
              name={name}
              value={formData[name]}
              onChange={onChange}
              disabled={disabled}
              className={`flex-grow bg-tertiary border border-border p-1 rounded ${disabled ? 'cursor-not-allowed' : ''}`}
            />
          </div>
        ))}
        <div className="flex items-center">
          <label className="w-24">Release Date</label>
          <input
            name="release_date"
            value={formData.release_date}
            onChange={onChange}
            type="date"
            className="flex-grow bg-tertiary border border-border p-1 rounded"
          />
        </div>
      </div>

      <div className="space-y-2">
        {fieldsRight.map(({ name, label }) => (
          <div key={name} className="flex items-center">
            <label className="w-24">{label}</label>
            <input
              name={name}
              value={formData[name]}
              onChange={onChange}
              className="flex-grow bg-tertiary border border-border p-1 rounded"
            />
          </div>
        ))}
      </div>

      <div className="col-span-2 space-y-2 mt-4">
        <div className="flex" title="Coming soon">
          <label className="w-24">Tags</label>
          <textarea
            name="tags"
            value={formData.tags}
            disabled
            className="flex-grow h-24 bg-tertiary border border-border p-1 rounded cursor-not-allowed opacity-60"
          />
        </div>
        <div className="flex">
          <label className="w-24">Description</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={onChange}
            className="flex-grow h-48 bg-tertiary border border-border p-1 rounded"
          />
        </div>
        <div className="flex justify-end">
          <button onClick={onFindGame} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">
            Find Game
          </button>
        </div>
        <div className="border-t border-border pt-3 mt-3">
          <div className="text-sm font-semibold text-danger mb-2">Title Actions</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onRemoveTitle} className="px-4 py-1 bg-danger hover:bg-dangerHover text-white rounded">
              Remove Title from Library
            </button>
            <button onClick={onDeleteTitleAndFiles} className="px-4 py-1 bg-dangerStrong hover:bg-danger text-white rounded">
              Delete Title and Files
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
