import { isSearchableDetailField, splitDetailValue, detailFieldForLabel, searchTooltip } from '../../../utils/metadataSearch.js'
import { isLanguageSummary } from './gameDetailUtils.js'

// One Details-row value: plain text unless the row has index coverage, in
// which case one search button per token. Covered-row rules live in
// metadataSearch.js; this only decides how they render. A summarized
// language list is display-only (searching it matches nothing), so it stays
// plain text too.
export default function SearchableDetailValue({ label, value, align = 'right', defaultSearchMode = 'browse', onSearch }) {
  if (!isSearchableDetailField(label) || isLanguageSummary(value)) {
    return (
      <span style={{ textAlign: align, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
        {String(value)}
      </span>
    )
  }
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 4, minWidth: 0 }}>
      {splitDetailValue(label, value).map((token, i) => (
        <button
          key={`${token}-${i}`}
          type="button"
          onClick={(event) => onSearch?.(label, token, event)}
          title={searchTooltip(detailFieldForLabel(label), token, defaultSearchMode)}
          style={{ textAlign: align, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          className="hover:text-accent hover:underline"
        >
          {token}
        </button>
      ))}
    </span>
  )
}
