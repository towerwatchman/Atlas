// The Record tab of the game properties window.
//
// Every field here except Title / Engine / Developer resolves through
// game_metadata_overrides: if the user has set a custom value it wins, otherwise
// the value comes from Atlas, Steam or GOG. This tab makes that distinction
// visible — a custom field is marked, shows the source value it is replacing,
// and can be reset on its own — so it is always clear which data is the user's
// and which came from a source.

import TagEditor from '../../tags/TagEditor.jsx'

const LEFT_FIELDS = [
  { name: 'title', label: 'Title' },
  { name: 'mappings', label: 'Mappings', disabled: true, source: false },
  { name: 'platform', label: 'Platform' },
  { name: 'engine', label: 'Engine' },
  { name: 'developer', label: 'Developer' },
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

// Marks a field as holding the user's own value, with a reset control beside it.
// The pencil is the indicator (this field was edited); the arrow is the action
// (put it back). Sits next to the field label so the row reads: what the field
// is, whether it is yours, how to undo it.
function CustomBadge({ label, onReset, base = false, resettable = true }) {
  // Base games columns (Title/Engine/Developer) have no override row, so all we
  // can say is that the stored value differs from the source — not that it is a
  // deliberate custom value. Wording stays honest about that distinction.
  const marker = base
    ? `${label} differs from the source value`
    : `${label} uses your custom value instead of the source data`
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      <span className="inline-flex items-center text-accent" title={marker}>
        <i className="fas fa-pencil text-[10px]" aria-hidden="true"></i>
        {/* The icon carries meaning, so give assistive tech the words too. */}
        <span className="sr-only">{marker}</span>
      </span>
      {onReset && resettable && (
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
        {isCustom && (
          <CustomBadge
            label={label}
            onReset={onReset}
            base={Boolean(override?.base)}
            resettable={override?.resettable !== false}
          />
        )}
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
            {inherited ? (
              <>
                {/* For Title/Engine/Developer the revert target may be the value
                    recorded before the edit rather than a live source value —
                    label it for what it actually is. */}
                {override?.inheritedFrom === 'original' ? 'Before your edit: ' : 'Source value: '}
                <span className="text-text">{inherited}</span>
              </>
            ) : override?.base ? (
              'No source value to compare against.'
            ) : (
              'No source value — this field is empty without your custom value.'
            )}
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
  tagState = null,
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
        {/* Naming the marker here is what makes the pencil icon legible the
            first time someone sees it. */}
        <p className="text-xs text-muted">
          {customCount > 0 ? (
            <>
              <i className="fas fa-pencil text-accent mx-0.5" aria-hidden="true"></i>
              {` marks the ${customCount} field${customCount === 1 ? '' : 's'} using your custom value${customCount === 1 ? '' : 's'}. The rest come from Atlas, Steam or GOG.`}
            </>
          ) : (
            'All fields come from Atlas, Steam or GOG. Edit any field to set your own value.'
          )}
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
            <div className="flex items-center justify-between gap-2 sm:w-28 sm:shrink-0 sm:pt-1">
              <label className="text-sm">Tags</label>
              {tagState?.overridden && (
                <CustomBadge label="Custom" onReset={tagState.resetTags} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {/* Its own editor rather than a text field: tags are a list, and
                  the catalog / added / removed distinction cannot be shown in a
                  textarea. Saves on every change, so it is not part of formData
                  and does not go through the window's Save button. */}
              <TagEditor
                tags={tagState?.tags || []}
                catalogTags={tagState?.catalogTags || []}
                overridden={Boolean(tagState?.overridden)}
                busy={Boolean(tagState?.busy)}
                onChange={tagState?.applyTags}
                onReset={tagState?.resetTags}
              />
              {tagState?.error && (
                <p className="mt-1 text-xs text-danger">{tagState.error}</p>
              )}
            </div>
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

          {/* Notes are purely the user's own text: there is no source value, so
              no override, no CustomBadge and nothing to reset to. Sits beside
              Description because that is the other long-form field, and this is
              where notes brought in from an external library import land. */}
          <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
            <div className="flex items-center gap-2 sm:w-28 sm:shrink-0 sm:pt-1">
              <label htmlFor="record-notes" className="text-sm">Notes</label>
            </div>
            <div className="flex-1 min-w-0">
              <textarea
                id="record-notes"
                name="notes"
                value={formData.notes ?? ''}
                onChange={onChange}
                placeholder="Your own notes about this game"
                className={`${INPUT_BASE} h-24 border-border`}
              />
              <p className="mt-0.5 text-[11px] text-muted">
                Only ever yours — notes are never overwritten by catalog updates
                or by importing a library again.
              </p>
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
