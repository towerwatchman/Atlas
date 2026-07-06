const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = process.cwd()
const layoutsPath = path.join(
  root,
  'src',
  'components',
  'library',
  'bannerLayout',
  'defaultBannerLayouts.js',
)

const source = fs.readFileSync(layoutsPath, 'utf8')
const match = source.match(/export const defaultBannerLayouts = (\[[\s\S]*?\n\])/)
if (!match) {
  throw new Error('Unable to find defaultBannerLayouts export')
}

const layouts = vm.runInNewContext(`(${match[1]})`)
const validSlots = new Set([
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'top-left-floating',
  'top-right-floating',
])
const validFieldIds = new Set([
  'title',
  'creator',
  'engine',
  'status',
  'version',
  'latestVersion',
  'update',
  'favorite',
  'wishlist',
  'installedState',
  'sourceBadges',
  'primarySource',
  'atlasId',
  'f95Id',
  'steamId',
  'lewdCornerId',
  'sourceRating',
  'personalRating',
  'playtime',
  'lastPlayed',
  'installedVersionCount',
  'category',
  'tags',
  'censored',
  'language',
  'likes',
  'views',
  'downloads',
  'comments',
  'platforms',
])

const validRegions = new Set(['image', 'top', 'right', 'bottom', 'left'])
const validAligns = new Set(['left', 'center', 'right', 'between'])

const errors = []
if (!layouts.some((layout) => layout.id === 'classic')) {
  errors.push('Missing classic banner layout')
}

for (const layout of layouts) {
  if (!layout.id) errors.push('Banner layout is missing an id')
  for (const field of layout.fields || []) {
    if (!validFieldIds.has(field.id)) {
      errors.push(`${layout.id} has invalid field id ${field.id}`)
    }
    const region = field.region || 'image'
    if (!validRegions.has(region)) {
      errors.push(`${layout.id} has invalid region ${region}`)
    }
    if (region === 'image') {
      // Image-region fields are positioned by corner slot.
      if (!validSlots.has(field.slot)) {
        errors.push(`${layout.id} has invalid slot ${field.slot}`)
      }
    } else {
      // Panel fields are positioned by row/align; slot is not required.
      if (field.align && !validAligns.has(field.align)) {
        errors.push(`${layout.id} has invalid align ${field.align}`)
      }
    }
  }
  const panels = layout.panels || {}
  for (const side of Object.keys(panels)) {
    if (!['top', 'right', 'bottom', 'left'].includes(side)) {
      errors.push(`${layout.id} has invalid panel side ${side}`)
    }
    const panel = panels[side] || {}
    if (panel.size !== undefined && typeof panel.size !== 'number') {
      errors.push(`${layout.id} panel ${side} has non-numeric size`)
    }
  }
}

const getBannerLayoutById = (layoutId) => {
  const normalized = layoutId === 'Default' || layoutId === 'default' || !layoutId
    ? 'classic'
    : String(layoutId)
  return layouts.find((layout) => layout.id === normalized) ||
    layouts.find((layout) => layout.id === 'classic')
}

if (getBannerLayoutById('Default')?.id !== 'classic') {
  errors.push('Default does not map to classic')
}
if (getBannerLayoutById('definitely-invalid')?.id !== 'classic') {
  errors.push('Invalid layout id does not fall back to classic')
}

if (errors.length > 0) {
  throw new Error(errors.join('\n'))
}

console.log('banner layout preset checks passed')
