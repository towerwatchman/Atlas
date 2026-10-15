import { useState } from 'react'
import TagEditor from '../../tags/TagEditor.jsx'
import { searchTooltip } from '../../../utils/metadataSearch.js'

// Tags panel for the game detail page.
//
// Read-only by default so the whole chip is a search link: a search click can
// never delete a tag by accident. The pencil toggles the TagEditor (x
// buttons, input, reset) for the rare edit. Browse rows are never editable,
// so they never get the pencil.
export default function DetailTagsPanel({
  editable,
  tags = [],
  catalogTags = [],
  overridden = false,
  busy = false,
  loading = false,
  error = '',
  onApplyTags,
  onResetTags,
  readOnlyTags = [],
  onSearchTag,
  defaultSearchMode = 'browse',
}) {
  const [editing, setEditing] = useState(false)
  const showEditor = editable && editing
  const chips = editable ? tags : readOnlyTags

  return (
    <section className="bg-secondary border border-border p-2">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Tags</h2>
        <div className="flex items-center gap-2">
          {editable && overridden && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
              Custom
            </span>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              title={showEditor ? 'Done editing' : 'Edit tags'}
              aria-label={showEditor ? 'Done editing' : 'Edit tags'}
              aria-pressed={showEditor}
              className={`rounded px-2 py-1 text-xs ${showEditor ? 'bg-accent text-white' : 'bg-button text-text hover:bg-buttonHover'}`}
            >
              <i className="fas fa-pen" aria-hidden="true"></i>
            </button>
          )}
        </div>
      </div>
      {showEditor ? (
        loading ? (
          <p className="text-xs text-muted">Loading tags…</p>
        ) : (
          <TagEditor
            tags={tags}
            catalogTags={catalogTags}
            overridden={overridden}
            busy={busy}
            onChange={onApplyTags}
            onReset={onResetTags}
          />
        )
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[...new Set(chips)].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={(event) => onSearchTag?.(tag, event)}
              title={searchTooltip('tag', tag, defaultSearchMode)}
              className="bg-primary border border-border px-2 py-1 text-xs text-left hover:border-accent hover:text-accent"
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      {showEditor && error && (
        <p className="mt-1 text-xs text-danger">{error}</p>
      )}
    </section>
  )
}
