import { useEffect, useRef, useState } from 'react'
import {
  PERSONAL_RATING_CATEGORIES,
  RATING_MAX,
  computeRatingAverage,
} from '../../utils/ratingCategories.js'

/**
 * Centered modal for scoring a game per category.
 *
 * Every category starts at 0, which means "not rated" rather than "scored
 * zero" — see the note rendered at the top. That distinction is the whole reason
 * the average is over rated categories only: dividing by all eight would punish
 * anyone who does not fill in every one.
 */
export default function RatingModal({
  open,
  title = '',
  ratings = {},
  busy = false,
  error = '',
  onSave,
  onCancel,
}) {
  const [draft, setDraft] = useState({})
  const prevOpenRef = useRef(false)
  const prevTitleRef = useRef(title)

  // Initialise the draft ONLY when the modal transitions from closed to open or
  // switches to a different title. Listening to prop changes directly while open
  // caused background metadata/library refreshes (which pass a new `ratings` prop
  // object reference) to overwrite the user's uncommitted slider adjustments.
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current
    const titleChanged = open && prevTitleRef.current !== title
    if (justOpened || titleChanged) {
      setDraft(
        Object.fromEntries(
          PERSONAL_RATING_CATEGORIES.map(({ key }) => [key, Number(ratings?.[key]) || 0]),
        ),
      )
    }
    prevOpenRef.current = Boolean(open)
    prevTitleRef.current = title
  }, [open, title, ratings])

  if (!open) return null

  const average = computeRatingAverage(draft)
  const ratedCount = PERSONAL_RATING_CATEGORIES.filter(({ key }) => (draft[key] || 0) > 0).length

  const setValue = (key, value) => {
    const number = Math.max(0, Math.min(RATING_MAX, Math.round(Number(value) || 0)))
    setDraft((current) => ({ ...current, [key]: number }))
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded border border-border bg-primary p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-text">Your Rating</h3>
          <span
            className="text-sm font-bold"
            style={{ color: average === null ? 'var(--color-muted)' : 'var(--color-warning)' }}
          >
            {average === null ? 'Unrated' : `${average}/${RATING_MAX}`}
          </span>
        </div>
        {title && <p className="mb-3 truncate text-xs text-muted">{title}</p>}

        {/* Requirement 4: the averaging rule has to be visible, or a 0 looks
            like a score of zero rather than "skip this category". */}
        <p className="mb-4 rounded border border-border bg-secondary p-2 text-xs text-muted">
          Only categories above 0 count towards the average. Leave a category at 0
          to skip it — it will not drag your score down.
        </p>

        <div className="space-y-2.5">
          {PERSONAL_RATING_CATEGORIES.map(({ key, label }) => {
            const value = draft[key] || 0
            return (
              <div key={key} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3">
                <span className="text-sm text-text">{label}</span>
                <input
                  type="range"
                  min="0"
                  max={RATING_MAX}
                  step="1"
                  value={value}
                  disabled={busy}
                  aria-label={label}
                  onChange={(event) => setValue(key, event.target.value)}
                  className="w-full accent-accent"
                />
                <span
                  className="text-right text-sm tabular-nums"
                  style={{ color: value > 0 ? 'var(--color-text)' : 'var(--color-muted)' }}
                >
                  {value > 0 ? value : '—'}
                </span>
              </div>
            )
          })}
        </div>

        <p className="mt-3 text-xs text-muted">
          {ratedCount === 0
            ? 'No categories rated yet.'
            : `Averaging ${ratedCount} of ${PERSONAL_RATING_CATEGORIES.length} categories.`}
        </p>

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <div className="mt-4 flex justify-between gap-2">
          <button
            type="button"
            onClick={() =>
              setDraft(Object.fromEntries(PERSONAL_RATING_CATEGORIES.map(({ key }) => [key, 0])))
            }
            disabled={busy || ratedCount === 0}
            className="rounded-buttonTheme bg-button px-3 py-1.5 text-sm text-text hover:bg-buttonHover disabled:opacity-40"
          >
            Clear all
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-buttonTheme bg-button px-3 py-1.5 text-sm text-text hover:bg-buttonHover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave?.(draft)}
              disabled={busy}
              className="rounded-buttonTheme bg-accent px-3 py-1.5 text-sm text-white hover:bg-accentHover disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
