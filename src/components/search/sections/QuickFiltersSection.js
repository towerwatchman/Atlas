const changeLibraryScope = (installState, { updateFilters }) => {
  updateFilters({
    installState,
    includeUninstalled: ['all', 'uninstalled'].includes(installState),
  })
}

export const quickFiltersList = [
  {
    type: 'dropdown',
    field: 'installState',
    label: 'Library scope',
    options: [
      { value: 'installed', label: 'Installed titles' },
      { value: 'all', label: 'Installed and uninstalled' },
      { value: 'uninstalled', label: 'Uninstalled only' },
    ],
    onChange: changeLibraryScope,
  },
  {
    excludeModes: ['catalog'],
    type: 'checkbox',
    field: 'updateAvailable',
    label: 'Show only games with updates available',
  },
  {
    excludeModes: ['catalog'],
    type: 'checkbox',
    field: 'favoritesOnly',
    label: 'Favorites only',
  },
  {
    excludeModes: ['catalog'],
    type: 'checkbox',
    field: 'multipleInstalledVersions',
    label: 'Show games with multiple installed versions',
  },
]
