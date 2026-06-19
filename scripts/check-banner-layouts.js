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
  'update',
  'favorite',
  'wishlist',
  'installedState',
])

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
    if (!validSlots.has(field.slot)) {
      errors.push(`${layout.id} has invalid slot ${field.slot}`)
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
