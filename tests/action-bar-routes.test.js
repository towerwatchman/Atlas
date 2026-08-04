import { describe, it, expect } from 'vitest'
import { resolveActionBarRoutes } from '../src/components/detail/page/gameDetailUtils.js'

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

  it('lets Steam take the install button when it owns the title', () => {
    const routes = resolveActionBarRoutes({
      canLaunch: false,
      canInstallFromDetail: true,
      canManageLocalTitle: true,
      hasOpenUpdate: true,
      hasSteamInstall: true,
    })
    expect(routes.installRoute).toBe('steam')
  })

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
