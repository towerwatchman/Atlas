// @vitest-environment jsdom
import { test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import HeroBanner from '../src/components/detail/page/HeroBanner.jsx'

// The hero background already re-resolves per selected season (heroOverride);
// the title logo overlay did not, so Seasons 2+ wore Season 1's logo over
// their own heroes. logoOverride puts the season's logo first while keeping
// the record chain as fallback.

afterEach(cleanup)

const S1_LOGO = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1607130/logo.png'
const S2_LOGO = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1754870/logo.png'

const renderBanner = (props = {}) =>
  render(
    <HeroBanner
      game={{ title: 'Test Game', creator: 'C', logo_candidates: [S1_LOGO] }}
      bannerRef={{ current: null }}
      bannerDimsRef={{ current: null }}
      bannerMask={{ image: 'none' }}
      onLoad={() => {}}
      onBack={() => {}}
      showBack={false}
      {...props}
    />,
  )

test('a season logo override leads the logo chain', () => {
  renderBanner({ logoOverride: S2_LOGO })
  expect(screen.getByAltText('Test Game').getAttribute('src')).toBe(S2_LOGO)
})

test('no override keeps the record logo', () => {
  renderBanner({})
  expect(screen.getByAltText('Test Game').getAttribute('src')).toBe(S1_LOGO)
})
