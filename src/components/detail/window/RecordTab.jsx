// The Record tab of the game properties window.
//
// Every field here except Title / Engine / Developer resolves through
// game_metadata_overrides: if the user has set a custom value it wins, otherwise
// the value comes from Atlas, Steam or GOG. This tab makes that distinction
// visible — a custom field is marked, shows the source value it is replacing,
// and can be reset on its own — so it is always clear which data is the user's
// and which came from a source.

const LEFT_FIELDS = [
  { name: 'title', label: 'Title', source: false },
  { name: 'mappings', label: 'Mappings', disabled: true, source: false },
  { name: 'platform', label: 'Platform' },
  { name: 'engine', label: 'Engine', source: false },
  { name: 'developer', label: 'Developer', source: false },
  { name: 'publisher', label: 'Publisher' },
  { name: 'status', label: 'Status' },
]

const RIGHT_FIELDS = [
  { name: 'category', label: 'Category' },
  { name: 'latest_version', label: 'Last Update' },
  { name: 'censored', label: 'Censored' },
  { name: 'language', label: 'Language' },
  { name: 'translations', label: 'Translations' },
  { name: 'genre', label: 'Genre' },
  { name: 'voice', label: 'Voice' },
  { name: 'rating', label: 'Rating' },
]

const INPUT_BASE =
  'w-full min-w-0 bg-tertiary border p-1 rounded focus:outline-none focus:ring-1 focus:ring-accent'

// Small "Custom" marker with a reset control. Sits beside the field label so the
// row reads: what the field is, whether it is yours, how to put it back.
function CustomBadge({ label, onReset }) {
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <span
        className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-accentMuted text-accent border border-accent/40"
        title={`${label} uses your custom value instead of the source data`}
      >
        Custom
      </span>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          title={`Reset ${label} to the source value`}
          aria-label={`Reset ${label} to the source value`}
          className="p-0.5 rounded text-muted hover:text-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <i className="fas fa-rotate-left text-[10px]" aria-hidden="true"></i>
        </button>
      )}
    </span>
  )
}

// One label + input row. Stacks on narrow windows, sits inline from `sm` up.
function Field({ field, value, override, onChange, onReset }) {
  const { name, label, disabled } = field
  const isCustom = Boolean(override?.overridden)
  const inherited = override?.inherited || ''

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
      <div className="flex items-center justify-between gap-2 sm:w-28 sm:shrink-0 sm:pt-1">
        <label htmlFor={`record-${name}`} className="text-sm">{label}</label>
        {isCustom && <CustomBadge label={label} onReset={onReset} />}
      </div>
      <div className="flex-1 min-w-0">
        <input
          id={`record-${name}`}
          name={name}
          value={value ?? ''}
          onChange={onChange}
          disabled={disabled}
          type={name === 'release_date' ? 'date' : 'text'}
          className={`${INPUT_BASE} ${
            isCustom ? 'border-accent' : 'border-border'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        />
        {/* Show the value the field would fall back to, so custom data is always
            legible next to the data it replaced. */}
        {isCustom && (
          <p className="mt-0.5 text-[11px] text-muted break-words">
            {inherited
              ? <>Source value: <span className="text-text">{inherited}</span></>
              : 'No source value — this field is empty without your custom value.'}
          </p>
        )}
      </div>
    </div>
  )
}

export default function RecordTab({
  formData,
  overrides = null,
  onChange,
  onRevertField,
  onClearAllOverrides,
}) {
  const byFormKey = new Map((overrides?.fields || []).map((f) => [f.formKey, f]))
  const customCount = overrides?.overriddenCount || 0

  const renderField = (field) => (
    <Field
      key={field.name}
      field={field}
      value={formData[field.name]}
      override={field.source === false ? null : byFormKey.get(field.name)}
      onChange={onChange}
      onReset={onRevertField ? () => onRevertField(field.name) : null}
    />
  )

  const descriptionOverride = byFormKey.get('description')
  const descriptionIsCustom = Boolean(descriptionOverride?.overridden)

  return (
    <div className="space-y-4">
      {/* Summary strip: how much of this record is the user's own data, plus the
          single action that undoes all of it. */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border">
        <p className="text-xs text-muted">
          {customCount > 0
            ? `${customCount} field${customCount === 1 ? '' : 's'} use your custom values. The rest come from Atlas, Steam or GOG.`
            : 'All fields come from Atlas, Steam or GOG. Edit any field to set your own value.'}
        </p>
        {onClearAllOverrides && (
          <button
            type="button"
            onClick={onClearAllOverrides}
            disabled={customCount === 0}
            title={customCount > 0
              ? `Reset all ${customCount} custom field${customCount === 1 ? '' : 's'} to their source values`
              : 'No custom field values to reset'}
            /* Always rendered, disabled when there is nothing to clear, so the
               affordance is discoverable rather than appearing only once a
               record already has custom data. */
            className="px-2.5 py-1 rounded text-xs border whitespace-nowrap focus:outline-none focus:ring-1 focus:ring-danger
              enabled:border-border enabled:text-muted enabled:hover:text-danger enabled:hover:border-danger
              disabled:border-border/50 disabled:text-muted/40 disabled:cursor-not-allowed"
          >
            <i className="fas fa-eraser mr-1.5" aria-hidden="true"></i>
            Reset all fields
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
        <div className="space-y-2 min-w-0">
          {LEFT_FIELDS.map(renderField)}
          {renderField({ name: 'release_date', label: 'Release Date' })}
        </div>

        <div className="space-y-2 min-w-0">
          {RIGHT_FIELDS.map(renderField)}
        </div>

        <div className="md:col-span-2 space-y-2 mt-2 min-w-0">
          <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
            <label htmlFor="record-tags" className="text-sm sm:w-28 sm:shrink-0 sm:pt-1" title="Coming soon">
              Tags
            </label>
            <textarea
              id="record-tags"
              name="tags"
              value={formData.tags ?? ''}
              disabled
              className={`${INPUT_BASE} border-border h-24 cursor-not-allowed opacity-60`}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
            <div className="flex items-center justify-between gap-2 sm:w-28 sm:shrink-0 sm:pt-1">
              <label htmlFor="record-description" className="text-sm">Description</label>
              {descriptionIsCustom && (
                <CustomBadge
                  label="Description"
                  onReset={onRevertField ? () => onRevertField('description') : null}
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <textarea
                id="record-description"
                name="description"
                value={formData.description ?? ''}
                onChange={onChange}
                className={`${INPUT_BASE} h-48 ${descriptionIsCustom ? 'border-accent' : 'border-border'}`}
              />
              {descriptionIsCustom && (
                <p className="mt-0.5 text-[11px] text-muted">
                  {descriptionOverride?.inherited
                    ? 'A source description is available — reset this field to use it.'
                    : 'No source description — this field is empty without your custom value.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted">
        Clearing a field and saving also resets it to the source value.
      </p>
    </div>
  )
}
