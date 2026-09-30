import { describe, it, expect } from 'vitest'
import {
  defaultFilters,
  normalizeFilterState,
  makeCatalogSearch,
  catalogParamsKey,
  resolveSearchFieldIds,
} from '../src/hooks/useFilters.js'

// ── Browse entry must not fetch twice ────────────────────────────────────────
//
// App.jsx guards the debounced catalog reset effect with a stringified
// {search, filters} key: browseCatalog pre-marks the key it just dispatched,
// and the effect returns early when its own key matches. The guard is only a
// guard if both sides build the object the same way.
//
// They did not. browseCatalog built `{text, type}`; the effect built
// `{text, type, fields}` from the same filters. The keys could never match, so
// every entry into Browse dispatched an immediate fetch and then, 300ms later,
// a second RESET fetch - and fetchCatalogGames({reset:true}) calls
// setCatalogGames([]) and setCatalogLoading(true). That is the reported
// symptom exactly: banners render, the whole pane becomes a spinner, the same
// banners render again.
//
// These assertions reconstruct both sides rather than rendering App, because
// the bug lives in the key construction and nowhere else.

/** What the debounced reset effect computes from state. */
const effectKey = (activeFilters) =>
  catalogParamsKey(makeCatalogSearch(activeFilters), activeFilters)

/** The filters browseCatalog resets to when Browse is entered freshly. */
const browseFilters = () =>
  normalizeFilterState({
    ...defaultFilters,
    includeUninstalled: true,
    installState: 'all',
  })

describe('catalog params key', () => {
  it('matches between browse entry and the reset effect', () => {
    const filters = browseFilters()
    // browseCatalog's side, built through the shared helper.
    const marked = catalogParamsKey(makeCatalogSearch(filters), filters)
    // handleFilterChange re-normalizes what it is handed before storing it, so
    // activeFilters is the round-tripped value, not the object passed in.
    const activeFilters = normalizeFilterState({ ...filters })

    expect(marked).toBe(effectKey(activeFilters))
  })

  it('carries the resolved search fields, not just text and type', () => {
    // The missing `fields` key IS the bug. A search that omits it also queries
    // the wrong columns, so this is not merely about string equality.
    const search = makeCatalogSearch(browseFilters())
    expect(search).toHaveProperty('fields')
    expect(search.fields).toEqual(resolveSearchFieldIds(browseFilters()))
  })

  it('is stable across rebuilds of the same filters', () => {
    // The effect re-runs whenever catalogTotal changes - which it does the
    // moment the first fetch resolves. If the key were unstable, that alone
    // would refetch.
    const a = browseFilters()
    const b = browseFilters()
    expect(catalogParamsKey(makeCatalogSearch(a), a))
      .toBe(catalogParamsKey(makeCatalogSearch(b), b))
  })

  it('is stable when searchFields is a new-but-equal array', () => {
    const base = browseFilters()
    const withFields = normalizeFilterState({ ...base, searchFields: ['title', 'creator'] })
    const again = normalizeFilterState({ ...base, searchFields: ['title', 'creator'] })
    expect(catalogParamsKey(makeCatalogSearch(withFields), withFields))
      .toBe(catalogParamsKey(makeCatalogSearch(again), again))
  })

  it('still changes when the search actually changes', () => {
    // A guard that never lets anything through would be the opposite failure:
    // typing in the search box has to refetch.
    const base = browseFilters()
    const searched = normalizeFilterState({ ...base, text: 'sorcery' })
    expect(catalogParamsKey(makeCatalogSearch(base), base))
      .not.toBe(catalogParamsKey(makeCatalogSearch(searched), searched))
  })

  it('still changes when only the search fields change', () => {
    const base = browseFilters()
    const titleOnly = normalizeFilterState({ ...base, searchFields: ['title'] })
    expect(catalogParamsKey(makeCatalogSearch(base), base))
      .not.toBe(catalogParamsKey(makeCatalogSearch(titleOnly), titleOnly))
  })
})
