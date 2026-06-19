export const CLASSIC_BANNER_LAYOUT_ID = 'classic'
export const CUSTOM_BANNER_LAYOUT_ID = 'custom'

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
const fitSet = new Set(['contain', 'cover'])

const clampNumber = (value, min, max, fallback) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

const cloneLayout = (layout) => JSON.parse(JSON.stringify(layout))

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
    fontSize: clampNumber(field.fontSize, 8, 24, field.badge ? 10 : 12),
    badge: field.badge === true,
  }
}

export const getBannerLayoutById = (layouts, layoutId, customLayout = null) => {
  const normalizedId = normalizeBannerLayoutId(layoutId)
  if (normalizedId === CUSTOM_BANNER_LAYOUT_ID && customLayout) {
    const classicLayout = layouts.find((layout) => layout.id === CLASSIC_BANNER_LAYOUT_ID)
    return normalizeBannerLayout(customLayout, classicLayout)
  }
  return (
    layouts.find((layout) => layout.id === normalizedId) ||
    layouts.find((layout) => layout.id === CLASSIC_BANNER_LAYOUT_ID)
  )
}

export const mergeBannerLayout = (baseLayout, overrides = {}) => {
  const base = cloneLayout(baseLayout || {})
  return {
    ...base,
    ...overrides,
    overlays: {
      ...base.overlays,
      ...overrides.overlays,
      top: { ...base.overlays?.top, ...overrides.overlays?.top },
      bottom: { ...base.overlays?.bottom, ...overrides.overlays?.bottom },
    },
    fields: Array.isArray(overrides.fields) ? overrides.fields : base.fields,
  }
}

export const normalizeBannerLayout = (layout, fallbackLayout = null) => {
  const source = layout && typeof layout === 'object' ? layout : fallbackLayout
  if (!source || typeof source !== 'object') return null
  const fallbackFields = Array.isArray(fallbackLayout?.fields) ? fallbackLayout.fields : []
  const sourceFields = Array.isArray(source.fields) ? source.fields : []
  const fieldsById = new Map()

  for (const field of [...fallbackFields, ...sourceFields]) {
    if (!fieldSet.has(field?.id)) continue
    fieldsById.set(field.id, {
      id: field.id,
      slot: slotSet.has(field.slot) ? field.slot : 'bottom-left',
      visible: field.visible !== false,
      fontSize: clampNumber(field.fontSize, 8, 24, field.badge ? 10 : 12),
      badge: field.badge === true,
    })
  }

  for (const fieldId of SUPPORTED_BANNER_FIELD_IDS) {
    if (fieldsById.has(fieldId)) continue
    fieldsById.set(fieldId, {
      id: fieldId,
      slot: 'bottom-left',
      visible: false,
      fontSize: 12,
      badge: false,
    })
  }

  return {
    id: source.id || fallbackLayout?.id || CLASSIC_BANNER_LAYOUT_ID,
    name: source.name || fallbackLayout?.name || 'Classic',
    basePresetId: normalizeBannerLayoutId(source.basePresetId || fallbackLayout?.basePresetId || fallbackLayout?.id),
    width: 537,
    height: 251,
    imageFit: fitSet.has(source.imageFit) ? source.imageFit : fallbackLayout?.imageFit || 'contain',
    hoverEffect: source.hoverEffect || fallbackLayout?.hoverEffect || 'classic-tilt',
    overlays: {
      top: {
        visible: source.overlays?.top?.visible !== false,
        opacity: clampNumber(source.overlays?.top?.opacity, 0, 1, fallbackLayout?.overlays?.top?.opacity ?? 0.8),
      },
      bottom: {
        visible: source.overlays?.bottom?.visible !== false,
        opacity: clampNumber(source.overlays?.bottom?.opacity, 0, 1, fallbackLayout?.overlays?.bottom?.opacity ?? 0.8),
      },
    },
    fields: Array.from(fieldsById.values()),
  }
}

export const validateBannerLayout = (layout) => {
  const errors = []
  if (!layout || typeof layout !== 'object') return ['Banner layout must be an object']
  if (!layout.id) errors.push('Banner layout is missing an id')
  if (!Array.isArray(layout.fields)) errors.push('Banner layout fields must be an array')
  if (layout.imageFit && !fitSet.has(layout.imageFit)) errors.push(`Invalid image fit ${layout.imageFit}`)

  for (const field of layout.fields || []) {
    if (!fieldSet.has(field.id)) errors.push(`Invalid field id ${field.id}`)
    if (!slotSet.has(field.slot)) errors.push(`Invalid slot ${field.slot}`)
    const fontSize = Number(field.fontSize)
    if (Number.isFinite(fontSize) && (fontSize < 8 || fontSize > 24)) {
      errors.push(`Field ${field.id} font size is outside the safe range`)
    }
  }

  return errors
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
