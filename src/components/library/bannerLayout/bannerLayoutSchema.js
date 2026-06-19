export const CLASSIC_BANNER_LAYOUT_ID = 'classic'

export const SUPPORTED_BANNER_SLOTS = [
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
]

export const SUPPORTED_BANNER_FIELD_IDS = [
  'title',
  'creator',
  'engine',
  'status',
  'version',
  'update',
  'favorite',
  'wishlist',
  'installedState',
]

const slotSet = new Set(SUPPORTED_BANNER_SLOTS)
const fieldSet = new Set(SUPPORTED_BANNER_FIELD_IDS)

export const normalizeBannerLayoutId = (layoutId) => {
  if (layoutId === 'Default' || layoutId === 'default' || !layoutId) {
    return CLASSIC_BANNER_LAYOUT_ID
  }
  return String(layoutId)
}

export const normalizeBannerField = (field) => {
  if (!field || !fieldSet.has(field.id) || field.visible === false) return null
  return {
    ...field,
    slot: slotSet.has(field.slot) ? field.slot : 'bottom-left',
  }
}

export const getBannerLayoutById = (layouts, layoutId) => {
  const normalizedId = normalizeBannerLayoutId(layoutId)
  return (
    layouts.find((layout) => layout.id === normalizedId) ||
    layouts.find((layout) => layout.id === CLASSIC_BANNER_LAYOUT_ID)
  )
}

export const validateBannerLayouts = (layouts) => {
  const errors = []
  if (!Array.isArray(layouts)) return ['Banner layouts must be an array']
  if (!layouts.some((layout) => layout.id === CLASSIC_BANNER_LAYOUT_ID)) {
    errors.push('Missing classic banner layout')
  }

  for (const layout of layouts) {
    if (!layout?.id) errors.push('Banner layout is missing an id')
    for (const field of layout?.fields || []) {
      if (!fieldSet.has(field.id)) errors.push(`${layout.id} has invalid field id ${field.id}`)
      if (!slotSet.has(field.slot)) errors.push(`${layout.id} has invalid slot ${field.slot}`)
    }
  }

  return errors
}

