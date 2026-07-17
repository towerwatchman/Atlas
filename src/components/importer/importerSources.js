import atlasLogo from '../../assets/icons/atlas_logo.svg'

export const IMPORTER_SOURCE_IDS = {
  ATLAS: 'atlas',
  STEAM: 'steam',
  GOG: 'gog',
  RENPY: 'renpy',
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
    iconType: 'font',
    icon: 'fab fa-gg',
  },
  {
    id: IMPORTER_SOURCE_IDS.RENPY,
    label: "Ren'Py Save Importer",
    description: "Import Ren'Py save folders",
    iconType: 'font',
    icon: 'fas fa-save',
  },
]

export function normalizeImporterSource(source) {
  const value = String(source || '').trim().toLowerCase()
  return importerSources.some((item) => item.id === value)
    ? value
    : IMPORTER_SOURCE_IDS.ATLAS
}
