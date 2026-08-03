import atlasLogo from '../../assets/icons/atlas_logo.svg'

export const IMPORTER_SOURCE_IDS = {
  ATLAS: 'atlas',
  STEAM: 'steam',
  GOG: 'gog',
  RENPY: 'renpy',
  MANUAL: 'manual',
  F95CHECKER: 'f95checker',
  XLIBRARY: 'xlibrary',
}

export const importerSources = [
  {
    id: IMPORTER_SOURCE_IDS.ATLAS,
    label: 'Atlas Game Importer',
    description: 'Scan local folders and archives',
    iconType: 'image',
    icon: atlasLogo,
  },
  {
    id: IMPORTER_SOURCE_IDS.STEAM,
    label: 'Steam Library',
    description: 'Scan installed Steam games',
    iconType: 'font',
    icon: 'fab fa-steam',
  },
  {
    id: IMPORTER_SOURCE_IDS.GOG,
    label: 'GOG Library',
    description: 'Scan installed GOG / Galaxy games',
    iconType: 'gog',
    icon: null,
  },
  {
    id: IMPORTER_SOURCE_IDS.MANUAL,
    label: 'Add Game Manually',
    // Needed because neither automatic path is complete: Steam omits free titles
    // from its owned-games API, and the disk scan only sees installed games.
    description: 'Search Steam or GOG, or add by store ID',
    iconType: 'font',
    icon: 'fas fa-plus',
  },
  {
    id: IMPORTER_SOURCE_IDS.RENPY,
    label: "Ren'Py Save Importer",
    description: "Import Ren'Py save folders",
    iconType: 'font',
    icon: 'fas fa-save',
  },
  {
    id: IMPORTER_SOURCE_IDS.F95CHECKER,
    label: 'F95Checker Library',
    description: 'Import a F95Checker library',
    iconType: 'font',
    icon: 'fas fa-file-import',
    // Deliberately absent from the + dropdown. External library imports are a
    // one-time migration, not something you reach for while adding a game, and
    // the whole point of routing them through Settings is to keep the importer's
    // own source list short. The entry still lives here so the id validates in
    // normalizeImporterSource and the source reaches the same importer window.
    menu: false,
    externalLibrary: true,
  },
  {
    id: IMPORTER_SOURCE_IDS.XLIBRARY,
    label: 'XLibrary',
    description: 'Import an XLibrary export',
    iconType: 'font',
    icon: 'fas fa-file-import',
    // Same reasoning as F95Checker above: reachable from Settings -> Import only,
    // not from the + dropdown.
    menu: false,
    externalLibrary: true,
  },
]

// Sources handled by the external-library reader registry in
// electron/scanners/externalLibrary. Derived rather than hand-listed so the
// importer can route all of them with one check instead of a branch per tool.
export const EXTERNAL_LIBRARY_SOURCE_IDS = importerSources
  .filter((item) => item.externalLibrary === true)
  .map((item) => item.id)

// Sources offered in the + dropdown. Anything flagged `menu: false` is reachable
// only from where it belongs (Settings -> Import) but is still a valid source id.
export const menuImporterSources = importerSources.filter((item) => item.menu !== false)

export function normalizeImporterSource(source) {
  const value = String(source || '').trim().toLowerCase()
  return importerSources.some((item) => item.id === value)
    ? value
    : IMPORTER_SOURCE_IDS.ATLAS
}
