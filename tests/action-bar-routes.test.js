import { describe, it, expect } from 'vitest'
import { resolveActionBarRoutes } from '../src/components/detail/page/gameDetailUtils.js'
import { resolveInstallSources, resolveInstallAction } from '../src/components/detail/page/installSources.js'

// Shorthand for the resolved source lists these routes consume.
const SOURCES = {
  steam: resolveInstallSources({ hasSteamInstall: true }),
  mirrors: resolveInstallSources({ hasMirrors: true }),
  both: resolveInstallSources({ hasMirrors: true, hasSteamInstall: true }),
}

// The regression: adding the mirror picker to the UPDATE button displaced the
// update/import panel, which was the only way to add a version from an archive
// or a local folder. Nothing broke visibly — the button still worked, it just did
// something else — so only an assertion catches it.

describe('resolveActionBarRoutes', () => {
  it('keeps the local import action reachable for an installed local title', () => {
    // The exact case that regressed: launchable, update available, mirror picker
    // wired. The panel must still have a route.
    const routes = resolveActionBarRoutes({
      canLaunch: true,
      canManageLocalTitle: true,
      hasOpenUpdate: true,
    })
    expect(routes.showLocalImportAction).toBe(true)
    expect(routes.updateRoute).toBe('mirrors')
  })

  it('routes a browse row\u2019s install button to the mirror picker', () => {
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: false,
      hasOpenUpdate: true,
    })
    expect(routes.installRoute).toBe('mirrors')
    expect(routes.installOpensMirrors).toBe(true)
    // No local record, so the LOCAL import action (add a version to an existing
    // record) has nothing to point at. That is not the same as having nothing to
    // offer -- see the manual install cases below.
    expect(routes.showLocalImportAction).toBe(false)
  })

  it('routes a local uninstalled title\u2019s install button to the local panel', () => {
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: true,
      hasOpenUpdate: true,
    })
    expect(routes.installRoute).toBe('localImport')
    expect(routes.showLocalImportAction).toBe(true)
  })

  // ── The Steam takeover ─────────────────────────────────────────────────────
  //
  // This block used to assert the opposite: 'lets Steam take the install button
  // when it owns the title'. That WAS the bug. A title with a Steam appid and
  // F95 mirrors could only be installed from Steam, and the mirrors were not
  // hidden or greyed -- they had no control left that reached them, because the
  // one that did now did something else under the same INSTALL label.
  //
  // The rule is the source COUNT, not which sources they are.

  it('sends the install button to the picker when a title has Steam AND mirrors', () => {
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: true,
      hasOpenUpdate: true,
      installSources: SOURCES.both,
    })
    expect(routes.installRoute).toBe('picker')
    expect(routes.installSources.map((s) => s.id).sort()).toEqual(['f95', 'steam'])
  })

  it('still goes straight to Steam when Steam is the only source', () => {
    // The part of the old behaviour that was right. One source is not a choice,
    // so it gets no dialog.
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: true,
      hasOpenUpdate: true,
      installSources: SOURCES.steam,
    })
    expect(routes.installRoute).toBe('steam')
  })

  it('goes straight to the mirrors when they are the only source', () => {
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: true,
      hasOpenUpdate: true,
      installSources: SOURCES.mirrors,
    })
    expect(routes.installRoute).toBe('mirrors')
  })

  it('never labels the button from a second copy of the rule', () => {
    // installSources is returned so ActionBar reads the label off the SAME
    // value that drives the click. The regression was two expressions of one
    // rule -- installRoute for the handler, a local steamInstallCta for the
    // glyph -- and only the second decided what the user saw.
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: true,
      hasOpenUpdate: true,
      installSources: SOURCES.both,
    })
    expect(routes.installSources).toBe(SOURCES.both)
  })

  it('falls back to the local panel when every source is disabled', () => {
    // A user who removed Steam and F95 from Settings > Metadata has no remote
    // source left. That must not become a dead button: the manual import panel
    // is still a real route, and it is the pre-existing no-mirrors behaviour.
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: true,
      hasOpenUpdate: true,
      installSources: resolveInstallSources({
        hasMirrors: true,
        hasSteamInstall: true,
        sourceOrder: '',
      }),
    })
    expect(routes.installRoute).toBe('localImport')
  })

})

describe('resolveInstallSources', () => {
  it('honours the order the user set in Settings > Metadata', () => {
    const sources = resolveInstallSources({
      hasMirrors: true,
      hasSteamInstall: true,
      sourceOrder: 'steam,f95',
    })
    expect(sources.map((s) => s.id)).toEqual(['steam', 'f95'])
  })

  it('drops a source the user removed, even when the game has it', () => {
    const sources = resolveInstallSources({
      hasMirrors: true,
      hasSteamInstall: true,
      sourceOrder: 'f95,lewdcorner',
    })
    expect(sources.map((s) => s.id)).toEqual(['f95'])
  })

  it('treats an unset order as every source but an empty one as none', () => {
    // Not the same thing. null is "never configured", '' is "removed them all",
    // and collapsing the two would either ignore a deliberate choice or hide
    // every source from someone who never made one.
    expect(resolveInstallSources({ hasMirrors: true, hasSteamInstall: true, sourceOrder: null }))
      .toHaveLength(2)
    expect(resolveInstallSources({ hasMirrors: true, hasSteamInstall: true, sourceOrder: '' }))
      .toHaveLength(0)
  })

  it('offers GOG only when there is a store page to open', () => {
    // There is no gog:// install protocol, so without a URL the entry would be
    // a button that does nothing.
    expect(resolveInstallSources({ gogStoreUrl: 'https://www.gog.com/game/x' }).map((s) => s.id))
      .toEqual(['gog'])
    expect(resolveInstallSources({ gogStoreUrl: '   ' })).toHaveLength(0)
  })

  it('never offers LewdCorner, which has no download path', () => {
    const sources = resolveInstallSources({
      hasMirrors: true,
      sourceOrder: 'lewdcorner,f95',
    })
    expect(sources.map((s) => s.id)).toEqual(['f95'])
  })
})

describe('resolveInstallAction', () => {
  it('asks only when there is something to ask about', () => {
    expect(resolveInstallAction([])).toBe('localImport')
    expect(resolveInstallAction([{ id: 'steam' }])).toBe('steam')
    expect(resolveInstallAction([{ id: 'steam' }, { id: 'f95' }])).toBe('picker')
  })
})

describe('resolveActionBarRoutes (continued)', () => {

  it('falls back to the website when no mirror picker is wired', () => {
    const routes = resolveActionBarRoutes({ canManageLocalTitle: true, hasOpenUpdate: false })
    expect(routes.updateRoute).toBe('website')
    // And the local action is still its own control rather than absorbing the
    // update button as it used to.
    expect(routes.showLocalImportAction).toBe(true)
  })

  it('launches when the title is playable', () => {
    expect(resolveActionBarRoutes({ canLaunch: true, canInstallFromDetail: true }).installRoute)
      .toBe('launch')
    expect(resolveActionBarRoutes({ canLaunch: true }).showInstallCta).toBe(false)
  })

  it('hides the local action when the caller wired no handler', () => {
    expect(resolveActionBarRoutes({ canManageLocalTitle: true, hasLocalImport: false })
      .showLocalImportAction).toBe(false)
  })
  // ── The install split button's caret ───────────────────────────────────────
  //
  // Manual install lives behind the caret. The import panel has had a full
  // 'catalog' mode all along and nothing opened it: the only trigger was gated on
  // canManageLocalTitle, false for every browse row. These assert the caret
  // appears exactly when the panel can serve it.

  it('shows the caret on a browse row that also has download mirrors', () => {
    // The case that was unreachable. INSTALL goes to the mirrors, so without its
    // own button the archive path has no route at all.
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: false,
      canManageWishlist: true,
      hasOpenUpdate: true,
    })
    expect(routes.installRoute).toBe('mirrors')
    expect(routes.showInstallMenu).toBe(true)
  })

  it('shows the caret on a browse row with no mirrors too', () => {
    // This case already worked, but by accident: INSTALL fell through to
    // 'localImport' and opened the panel. The caret is shown here as well even
    // though that makes it a duplicate route, because an affordance that comes
    // and goes with whether a game has mirrors is the same invisible-condition
    // problem the caret exists to fix.
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: false,
      canManageWishlist: true,
      hasOpenUpdate: false,
    })
    expect(routes.installOpensMirrors).toBe(false)
    expect(routes.showInstallMenu).toBe(true)
  })

  it('shows the caret on a local title too', () => {
    // The panel serves a library title as well, in its 'local' mode, off the same
    // handler. This is also the only case where the caret can be GREEN: it takes
    // the colour of the button it hangs from, and only a real PLAY button is
    // green.
    const routes = resolveActionBarRoutes({
      canLaunch: true,
      canManageLocalTitle: true,
      canManageWishlist: false,
      hasOpenUpdate: true,
    })
    expect(routes.showInstallMenu).toBe(true)
  })

  it('shows no caret on a metadata-only title', () => {
    // Both flags are false here, which is why the caret needs both rather than
    // one: a metadata-only title has no panel to open. It is also why the two
    // cannot be treated as each other's inverse, which is where the original bug
    // came from.
    const routes = resolveActionBarRoutes({
      canManageLocalTitle: false,
      canManageWishlist: false,
      hasOpenUpdate: true,
    })
    expect(routes.showInstallMenu).toBe(false)
    expect(routes.showLocalImportAction).toBe(false)
  })

  it('shows no caret when the caller wired no handler', () => {
    const routes = resolveActionBarRoutes({
      canManageLocalTitle: false,
      canManageWishlist: true,
      hasLocalImport: false,
    })
    expect(routes.showInstallMenu).toBe(false)
  })
})
