import { useEffect, useState } from 'react'
import { saveLibrarySettings } from '../../utils/librarySettings.js'

// ── How installed games are laid out on disk ─────────────────────────────────
//
// Library.libraryFolderStructure defaults to '{creator}/{title}/{version}',
// which is a real decision applied silently: it nests every install three levels
// deep. Someone who wanted a flat layout found out after their library was
// already built the other way, and by then the setting only affects what comes
// next.
//
// Shown once, at the first install, and never again — Library.structurePrompted
// records that it happened. Deliberately not at first launch: the layout is
// abstract until something is about to be written, and a prompt during the
// opening minute of an app is one more thing to dismiss without reading.
//
// Separate from LibraryFolderModal even though they are adjacent. That one is a
// blocker with a single correct answer, this one is a preference with a
// defensible default, and stacking them would turn a required step into a
// two-part questionnaire. The install flow shows the folder prompt first when
// both are due.
//
// The preview is doing more work than it looks like it is. '{creator}/{title}'
// and '{title}' read as near-identical strings; the folder trees they produce do
// not, and the tree is what the user is actually choosing between.

const PRESETS = [
  {
    id: 'creator-title-version',
    value: '{creator}/{title}/{version}',
    label: 'By creator, then version',
    blurb: 'The default. Keeps every version of a game side by side under its creator.',
  },
  {
    id: 'title-version',
    value: '{title}/{version}',
    label: 'By title, then version',
    blurb: 'Skips the creator level. Good if you mostly go looking by name.',
  },
  {
    id: 'flat',
    value: '{title}',
    label: 'Flat',
    blurb:
      'One folder per game. Installing a second version replaces the folder rather '
      + 'than sitting beside it, so pick this only if you keep one build at a time.',
  },
]

// Stand-ins that make the shape obvious without pretending to know the game.
const SAMPLE = { creator: 'Studio', title: 'Game Title', version: 'v1.2' }

const previewPath = (pattern) =>
  String(pattern || '')
    .split('/')
    .map((segment) =>
      segment
        .replace(/\{creator\}/g, SAMPLE.creator)
        .replace(/\{title\}/g, SAMPLE.title)
        .replace(/\{version\}/g, SAMPLE.version)
        .replace(/\{engine\}/g, 'RenPy')
        .replace(/\{f95Id\}/g, '12345'),
    )
    .filter(Boolean)

export default function LibraryStructureModal({ open, gameFolder = '', onDone }) {
  const [selected, setSelected] = useState(PRESETS[0].value)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setSelected(PRESETS[0].value)
  }, [open])

  if (!open) return null

  // Both keys in one save. Two saveLibrarySetting calls would each re-read the
  // config, and the second read can land before the first write does — leaving
  // the flag set and the structure reverted, which is the one combination that
  // makes this unrecoverable without editing config.ini by hand.
  const commit = async (structure) => {
    setSaving(true)
    try {
      await saveLibrarySettings({
        libraryFolderStructure: structure,
        structurePrompted: true,
      })
    } finally {
      setSaving(false)
      onDone?.(structure)
    }
  }

  const segments = previewPath(selected)

  return (
    <div className="fixed inset-0 z-[1600] bg-black/60 flex items-center justify-center p-4">
      {/* Taller than the other install dialogs, so it scrolls rather than
          overflowing on a short window. */}
      <div className="w-full max-w-md max-h-[90vh] flex flex-col rounded-lg border border-border bg-primary shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-base text-text">How should your library be organised?</h2>
          <p className="text-[11px] text-muted mt-0.5">
            Asked once, before your first install. You can change it later in
            Settings &rsaquo; Library.
          </p>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {PRESETS.map((preset) => (
            <label
              key={preset.id}
              className={`flex items-start gap-2 cursor-pointer rounded border p-3 transition-colors ${
                selected === preset.value
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:bg-selected'
              }`}
            >
              <input
                type="radio"
                name="library-structure"
                checked={selected === preset.value}
                onChange={() => setSelected(preset.value)}
                className="mt-0.5 accent-accent"
              />
              <span className="text-xs min-w-0">
                <span className="block text-text">{preset.label}</span>
                <span className="block text-muted mt-0.5">{preset.blurb}</span>
                <span className="block text-[11px] text-muted font-mono mt-1 break-all">
                  {preset.value}
                </span>
              </span>
            </label>
          ))}

          <div className="rounded border border-border bg-tertiary/40 p-3">
            <p className="text-[11px] text-muted mb-1.5">A game would land here:</p>
            <p className="text-[11px] font-mono text-muted break-all">
              {gameFolder || '<your game folder>'}
            </p>
            {segments.map((segment, index) => (
              <p
                key={segment}
                className="text-[11px] font-mono text-text break-all"
                style={{ paddingLeft: `${(index + 1) * 12}px` }}
              >
                &#9492;&#9472; {segment}
              </p>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {/* No cancel. There is no state in which this question goes
              unanswered — dismissing it would just apply the default silently,
              which is the behaviour this modal exists to end. "Keep the default"
              is an answer, and it sets structurePrompted like any other. */}
          <button
            type="button"
            onClick={() => commit(PRESETS[0].value)}
            disabled={saving}
            className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text disabled:opacity-50"
          >
            Keep the default
          </button>
          <button
            type="button"
            onClick={() => commit(selected)}
            disabled={saving}
            className="h-8 px-4 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white disabled:opacity-50"
          >
            {saving ? 'Saving\u2026' : 'Use this layout'}
          </button>
        </div>
      </div>
    </div>
  )
}
