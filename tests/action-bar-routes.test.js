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
    // No local record, so there is no local import panel to offer.
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
})
