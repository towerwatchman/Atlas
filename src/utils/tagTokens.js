// ── tag token helpers ────────────────────────────────────────────────────────
//
// Mirrored as electron/db/tagTokens.js (CJS). Keep the two identical by logic;
// a test asserts parity. Like searchFields.js, duplication is the cost of the
// ESM/CJS boundary.
//
// Library semantics are the oracle:
//   - splitListText: split on comma only (useFilters.js:642-643); `;`/`|` are
//     literal characters inside a token, never delimiters.
//   - normalizeTagText: lowercase, `-_` → space, collapse whitespace
//     (useFilters.js:645-646).
//   - buildTagsFilterValue: comma-split each source, trim, drop empties,
//     normalize each, drop post-normalize empties (e.g. " -_ " → ""), de-dupe
//     case-insensitively, join with `,` in first-seen order across sources.
//

const safeText = (value) => String(value ?? '')

// Lowercase, map `-`/`_` runs to a single space, collapse any whitespace.
// Mirrors useFilters.js:normalizeTagText exactly (including full Unicode
// toLowerCase, not SQLite's ASCII-only LOWER).
export const normalizeTagText = (value) =>
  safeText(value).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')

// DRY helper for the triplicate `toArray+normalize+filter` in catalogIndex/versions/useFilters
export const normalizeTagList = (value) => {
  const arr = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ''
      ? []
      : [String(value)]
  return arr
    .map((v) => normalizeTagText(v).trim())
    .filter(Boolean)
}

// Comma-split helper that mirrors getGameTagValues's splitListText semantics
// plus normalization and de-duplication. Used by the library oracle and as the
// building block for buildTagsFilterValue so catalog and library tokenize
// identically (`;`/`|` literal, comma is the only delimiter).
export const splitTagSources = (...rawValues) => {
  const tokens = []
  for (const raw of rawValues) {
    if (raw === null || raw === undefined || raw === '') continue
    const parts = String(raw).split(',')
    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const normalized = normalizeTagText(trimmed).trim()
      if (!normalized) continue
      tokens.push(normalized)
    }
  }
  const seen = new Set()
  const out = []
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token)
      out.push(token)
    }
  }
  return out
}

// Comma-joined normalized token string for the `tags_filter` column.
// Deterministic first-seen order across the fixed source order supplied by
// the caller (atlas → f95 → lc_tags → lc_prefixes, etc.).
export const buildTagsFilterValue = (...rawValues) => splitTagSources(...rawValues).join(',')
