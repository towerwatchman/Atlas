// Media-source → icon asset map.
//
// This is the single place to point a source at a logo. To use a downloaded
// logo, drop the file into this folder (src/assets/icons) and set the import
// plus the map entry below, e.g.
//
//   import lewdcornerLogo from './lewdcorner.svg'
//   ...
//   lewdcorner: lewdcornerLogo,
//
// Entries left as `null` fall back to a generic icon in SourceIcon, so the
// build never breaks while a logo is missing.

import f95Logo from '../images/f95_full.png'
import lcLogo from '../images/lc_logo.webp'
import atlasLogo from './atlas_logo_full.svg'
import gogLogo from './gog_logo.svg'
import steamLogo from './steam_icon_logo.svg'
import customLogo from './custom.svg'

export const SHOW_LOCATION_BADGES = {
  remote: true,
  local: false,
  custom: false,
}

export const SOURCE_ICON_MAP = {
  f95: f95Logo,
  atlas: atlasLogo,
  gog: gogLogo,
  steam: steamLogo,
  lewdcorner: lcLogo,
  custom: customLogo,
}
