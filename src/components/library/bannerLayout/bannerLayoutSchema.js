export const CLASSIC_BANNER_LAYOUT_ID = 'classic'
export const CUSTOM_BANNER_LAYOUT_ID = 'custom'
export const BANNER_PRESET_EXPORT_TYPE = 'atlas-banner-layout'
export const BANNER_PRESET_SCHEMA_VERSION = 1
// Oldest layout schema version this build can still load. Gallery submissions
// must satisfy BANNER_PRESET_SCHEMA_MIN <= version <= BANNER_PRESET_SCHEMA_VERSION
// on every release channel (see scripts/validate-submission.js).
export const BANNER_PRESET_SCHEMA_MIN = 1
export const BANNER_SIZE_LIMITS = {
  minWidth: 240,
  maxWidth: 720,
  minHeight: 140,
  maxHeight: 480,
}

export const BANNER_SIZE_PRESETS = [
  { id: 'compact', name: 'Compact', width: 360, height: 168, density: 'compact' },
  { id: 'classic', name: 'Classic', width: 537, height: 251, density: 'comfortable' },
  { id: 'large', name: 'Large', width: 640, height: 300, density: 'large' },
]

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
  'lastUpdated',
]

export const BANNER_FIELD_REGISTRY = [
  { id: 'title', label: 'Title', category: 'Basic', supportsBadge: false, defaultVisible: true, defaultSlot: 'bottom-center', defaultFontSize: 12, hideWhenEmpty: false },
  { id: 'creator', label: 'Creator', category: 'Basic', supportsBadge: false, defaultVisible: true, defaultSlot: 'top-left', defaultFontSize: 12, hideWhenEmpty: false },
  { id: 'engine', label: 'Engine', category: 'Basic', supportsBadge: true, defaultVisible: true, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: false },
  { id: 'status', label: 'Status', category: 'Basic', supportsBadge: true, defaultVisible: true, defaultSlot: 'bottom-right', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'version', label: 'Installed Version', category: 'Basic', supportsBadge: true, defaultVisible: true, defaultSlot: 'bottom-right', defaultFontSize: 10, hideWhenEmpty: false },
  { id: 'latestVersion', label: 'Latest Version', category: 'Basic', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-right', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'update', label: 'Update Available', category: 'State', supportsBadge: true, defaultVisible: true, defaultSlot: 'top-right', defaultFontSize: 10, hideWhenEmpty: true, conditions: { updateOnly: true } },
  { id: 'favorite', label: 'Favorite', category: 'State', supportsBadge: false, defaultVisible: true, defaultSlot: 'top-left-floating', defaultFontSize: 10, hideWhenEmpty: true, conditions: { favoriteOnly: true } },
  { id: 'wishlist', label: 'Wishlist', category: 'State', supportsBadge: false, defaultVisible: true, defaultSlot: 'top-right-floating', defaultFontSize: 10, hideWhenEmpty: true, conditions: { wishlistOnly: true } },
  { id: 'installedState', label: 'Installed State', category: 'State', supportsBadge: true, defaultVisible: false, defaultSlot: 'top-left-floating', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'sourceBadges', label: 'Source Badges', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'top-right', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'primarySource', label: 'Primary Source', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'top-right', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'atlasId', label: 'Atlas ID', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'f95Id', label: 'F95 ID', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true, conditions: { source: ['f95'] } },
  { id: 'steamId', label: 'Steam ID', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true, conditions: { source: ['steam'] } },
  { id: 'lewdCornerId', label: 'LewdCorner ID', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true, conditions: { source: ['lewdcorner'] } },
  { id: 'sourceRating', label: 'Source Rating', category: 'Ratings', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-right', defaultFontSize: 10, hideWhenEmpty: true, conditions: { browseOnly: true } },
  { id: 'personalRating', label: 'Personal Rating', category: 'Ratings', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-right', defaultFontSize: 10, hideWhenEmpty: true, conditions: { localOnly: true } },
  { id: 'playtime', label: 'Playtime', category: 'Activity', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true, conditions: { localOnly: true } },
  { id: 'lastPlayed', label: 'Last Played', category: 'Activity', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true, conditions: { localOnly: true } },
  { id: 'installedVersionCount', label: 'Installed Versions', category: 'Activity', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-right', defaultFontSize: 10, hideWhenEmpty: true, conditions: { localOnly: true } },
  { id: 'category', label: 'Category', category: 'Metadata', supportsBadge: true, defaultVisible: false, defaultSlot: 'center-left', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'tags', label: 'Tags', category: 'Metadata', supportsBadge: true, defaultVisible: false, defaultSlot: 'center', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'censored', label: 'Censored', category: 'Metadata', supportsBadge: true, defaultVisible: false, defaultSlot: 'center-right', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'language', label: 'Language', category: 'Metadata', supportsBadge: true, defaultVisible: false, defaultSlot: 'center-right', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'likes', label: 'Likes', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'views', label: 'Views', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'downloads', label: 'Downloads', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'comments', label: 'Comments', category: 'Source', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'platforms', label: 'Platforms', category: 'Metadata', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true },
  { id: 'lastUpdated', label: 'Last Updated', category: 'Activity', supportsBadge: true, defaultVisible: false, defaultSlot: 'bottom-left', defaultFontSize: 10, hideWhenEmpty: true },
]

export const BANNER_FIELD_CATEGORIES = ['Basic', 'Source', 'State', 'Ratings', 'Activity', 'Metadata']

// Panels are solid colored regions on any side of the image. When a panel
// is enabled, the image shrinks to the remaining middle area and the panel
// holds fields laid out as a vertical stack of rows (see region/row/align
// on fields). This is what lets a banner be larger than its image.
export const BANNER_PANEL_SIDES = ['top', 'right', 'bottom', 'left']
export const BANNER_PANEL_ALIGNMENTS = ['left', 'center', 'right', 'between']
export const BANNER_PANEL_SIZE_LIMITS = { min: 0, max: 400 }
export const BANNER_FIELD_REGIONS = ['image', 'top', 'right', 'bottom', 'left']

// The banner's outer size = image size (width/height) PLUS any enabled
// panels. Panels grow the banner outward; they never shrink the image. Use
// this for anything that sizes the outer banner box (renderer root, library
// grid cells, preview cards). width/height on the layout are the IMAGE size.
export const getBannerTotalSize = (layout) => {
  const width = Number(layout?.width) || 537
  const height = Number(layout?.height) || 251
  const panels = layout?.panels || {}
  const sideSize = (side) =>
    panels[side] && panels[side].enabled && panels[side].size > 0 ? Number(panels[side].size) || 0 : 0
  return {
    width: width + sideSize('left') + sideSize('right'),
    height: height + sideSize('top') + sideSize('bottom'),
  }
}

const slotSet = new Set(SUPPORTED_BANNER_SLOTS)
const regionSet = new Set(BANNER_FIELD_REGIONS)
const alignSet = new Set(BANNER_PANEL_ALIGNMENTS)
const fieldSet = new Set(SUPPORTED_BANNER_FIELD_IDS)
const fieldRegistryById = new Map(BANNER_FIELD_REGISTRY.map((field) => [field.id, field]))
const fitSet = new Set(['contain', 'cover'])
const densitySet = new Set(['compact', 'comfortable', 'large', 'poster'])
const imagePositionSet = new Set(['center', 'top', 'bottom', 'left', 'right'])
const fallbackBackgroundSet = new Set(['theme', 'dark'])
const imageBackgroundModeSet = new Set(['solid', 'image', 'blurred-fill'])
const sourceConditionSet = new Set(['atlas', 'f95', 'steam', 'lewdcorner'])

const DEFAULT_BLUR_BACKGROUND = {
  opacity: 0.6,
  blur: 20,
  scale: 1.1,
}

const clampNumber = (value, min, max, fallback) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

const clampInt = (value, min, max, fallback) => Math.round(clampNumber(value, min, max, fallback))

// Panel background/text accept any CSS color the banner editor produces; it's
// saved verbatim with the banner. We only guard against non-strings.
const sanitizeColor = (value) => {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v || null
}

const normalizePanelBorder = (border = {}, fallback = {}) => ({
  width: clampInt(border?.width, 0, 20, fallback.width ?? 0),
  color: sanitizeColor(border?.color) || fallback.color || '#000000',
  top: border?.top === true,
  right: border?.right === true,
  bottom: border?.bottom === true,
  left: border?.left === true,
})

const normalizePanel = (panel = {}, fallback = {}) => ({
  enabled: panel && panel.enabled === true,
  size: clampInt(panel?.size, BANNER_PANEL_SIZE_LIMITS.min, BANNER_PANEL_SIZE_LIMITS.max, fallback.size ?? 0),
  background: sanitizeColor(panel?.background) || fallback.background || '#0e1116',
  textColor: sanitizeColor(panel?.textColor) || fallback.textColor || '#ffffff',
  padding: clampInt(panel?.padding, 0, 48, fallback.padding ?? 10),
  gap: clampInt(panel?.gap, 0, 32, fallback.gap ?? 6),
  border: normalizePanelBorder(panel?.border, fallback.border),
})

const cloneLayout = (layout) => JSON.parse(JSON.stringify(layout))

export const sanitizeBannerPresetName = (name) => {
  const value = String(name || '').trim().replace(/\s+/g, ' ')
  return value || 'Untitled Layout'
}

const slugifyPresetName = (name) => sanitizeBannerPresetName(name)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'layout'

export const generateBannerPresetId = (name, existingIds = []) => {
  const used = new Set(existingIds)
  const base = `user-${slugifyPresetName(name)}`
  let candidate = base
  let index = 2
  while (used.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }
  return candidate
}

export const normalizeBannerLayoutId = (layoutId) => {
  if (layoutId === 'Default' || layoutId === 'default' || !layoutId) {
    return CLASSIC_BANNER_LAYOUT_ID
  }
  return String(layoutId)
}

export const normalizeBannerField = (field) => {
  if (!field || !fieldSet.has(field.id) || field.visible === false) return null
  const registry = fieldRegistryById.get(field.id) || {}
  return {
    ...field,
    slot: slotSet.has(field.slot) ? field.slot : registry.defaultSlot || 'bottom-left',
    region: regionSet.has(field.region) ? field.region : 'image',
    row: clampInt(field.row, 0, 30, 0),
    align: alignSet.has(field.align) ? field.align : 'left',
    order: clampInt(field.order, 0, 100, 0),
    offsetX: clampInt(field.offsetX, -400, 400, 0),
    offsetY: clampInt(field.offsetY, -400, 400, 0),
    textShadow: field.textShadow === true,
    bold: field.bold === true,
    italic: field.italic === true,
    border: {
      width: clampInt(field.border?.width, 0, 10, 0),
      color: sanitizeColor(field.border?.color) || '#000000',
    },
    textColor: sanitizeColor(field.textColor) || '',
    iconScale: clampNumber(field.iconScale, 0.5, 3, 1),
    fontSize: clampNumber(field.fontSize, 8, 24, registry.defaultFontSize || (field.badge ? 10 : 12)),
    badge: registry.supportsBadge === true && field.badge === true,
    hideWhenEmpty: field.hideWhenEmpty === true,
    conditions: normalizeFieldConditions(field.conditions),
  }
}

export const normalizeFieldConditions = (conditions = {}) => ({
  localOnly: conditions.localOnly === true,
  browseOnly: conditions.browseOnly === true,
  wishlistOnly: conditions.wishlistOnly === true,
  installedOnly: conditions.installedOnly === true,
  uninstalledOnly: conditions.uninstalledOnly === true,
  updateOnly: conditions.updateOnly === true,
  favoriteOnly: conditions.favoriteOnly === true,
  source: Array.isArray(conditions.source)
    ? conditions.source.map((source) => String(source).toLowerCase()).filter((source) => sourceConditionSet.has(source))
    : [],
})

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
    image: {
      ...base.image,
      ...overrides.image,
      blurBackground: {
        ...base.image?.blurBackground,
        ...overrides.image?.blurBackground,
      },
    },
    panels: {
      ...base.panels,
      ...overrides.panels,
      top: { ...base.panels?.top, ...overrides.panels?.top, border: { ...base.panels?.top?.border, ...overrides.panels?.top?.border } },
      right: { ...base.panels?.right, ...overrides.panels?.right, border: { ...base.panels?.right?.border, ...overrides.panels?.right?.border } },
      bottom: { ...base.panels?.bottom, ...overrides.panels?.bottom, border: { ...base.panels?.bottom?.border, ...overrides.panels?.bottom?.border } },
      left: { ...base.panels?.left, ...overrides.panels?.left, border: { ...base.panels?.left?.border, ...overrides.panels?.left?.border } },
    },
    border: { ...base.border, ...overrides.border },
    shadow: { ...base.shadow, ...overrides.shadow },
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
    const registry = fieldRegistryById.get(field.id) || {}
    fieldsById.set(field.id, {
      id: field.id,
      slot: slotSet.has(field.slot) ? field.slot : registry.defaultSlot || 'bottom-left',
      region: regionSet.has(field.region) ? field.region : 'image',
      row: clampInt(field.row, 0, 30, 0),
      align: alignSet.has(field.align) ? field.align : 'left',
      order: clampInt(field.order, 0, 100, 0),
      offsetX: clampInt(field.offsetX, -400, 400, 0),
      offsetY: clampInt(field.offsetY, -400, 400, 0),
      textShadow: field.textShadow === true,
      bold: field.bold === true,
      italic: field.italic === true,
      border: {
        width: clampInt(field.border?.width, 0, 10, 0),
        color: sanitizeColor(field.border?.color) || '#000000',
      },
      textColor: sanitizeColor(field.textColor) || '',
      iconScale: clampNumber(field.iconScale, 0.5, 3, 1),
      visible: field.visible !== false,
      fontSize: clampNumber(field.fontSize, 8, 24, registry.defaultFontSize || (field.badge ? 10 : 12)),
      badge: registry.supportsBadge === true && field.badge === true,
      hideWhenEmpty: field.hideWhenEmpty === true || registry.hideWhenEmpty === true,
      conditions: normalizeFieldConditions({ ...registry.conditions, ...field.conditions }),
    })
  }

  for (const registry of BANNER_FIELD_REGISTRY) {
    if (fieldsById.has(registry.id)) continue
    fieldsById.set(registry.id, {
      id: registry.id,
      slot: registry.defaultSlot || 'bottom-left',
      region: 'image',
      row: 0,
      align: 'left',
      order: 0,
      offsetX: 0,
      offsetY: 0,
      textShadow: false,
      bold: false,
      italic: false,
      border: { width: 0, color: '#000000' },
      textColor: '',
      iconScale: 1,
      visible: registry.defaultVisible === true,
      fontSize: registry.defaultFontSize || 12,
      badge: false,
      hideWhenEmpty: registry.hideWhenEmpty === true,
      conditions: normalizeFieldConditions(registry.conditions),
    })
  }

  const width = clampNumber(source.width, BANNER_SIZE_LIMITS.minWidth, BANNER_SIZE_LIMITS.maxWidth, fallbackLayout?.width || 537)
  const height = clampNumber(source.height, BANNER_SIZE_LIMITS.minHeight, BANNER_SIZE_LIMITS.maxHeight, fallbackLayout?.height || 251)
  const legacyImageFit = source.imageFit || fallbackLayout?.imageFit
  const backgroundMode = imageBackgroundModeSet.has(source.image?.backgroundMode)
    ? source.image.backgroundMode
    : imageBackgroundModeSet.has(fallbackLayout?.image?.backgroundMode)
      ? fallbackLayout.image.backgroundMode
      : 'image'
  const blurBackgroundSource = source.image?.blurBackground || fallbackLayout?.image?.blurBackground || {}
  const image = {
    visible: source.image?.visible !== false,
    fit: fitSet.has(source.image?.fit) ? source.image.fit : fitSet.has(legacyImageFit) ? legacyImageFit : 'contain',
    foregroundFit: fitSet.has(source.image?.foregroundFit) ? source.image.foregroundFit : fitSet.has(fallbackLayout?.image?.foregroundFit) ? fallbackLayout.image.foregroundFit : 'contain',
    position: imagePositionSet.has(source.image?.position) ? source.image.position : fallbackLayout?.image?.position || 'center',
    dimWhenMissing: source.image?.dimWhenMissing === true,
    fallbackBackground: fallbackBackgroundSet.has(source.image?.fallbackBackground)
      ? source.image.fallbackBackground
      : fallbackLayout?.image?.fallbackBackground || 'dark',
    backgroundMode,
    blurBackground: {
      opacity: clampNumber(blurBackgroundSource.opacity, 0, 1, DEFAULT_BLUR_BACKGROUND.opacity),
      blur: clampNumber(blurBackgroundSource.blur, 0, 40, DEFAULT_BLUR_BACKGROUND.blur),
      scale: clampNumber(blurBackgroundSource.scale, 1, 1.3, DEFAULT_BLUR_BACKGROUND.scale),
    },
  }

  const previewCycleSource = source.previewCycle || fallbackLayout?.previewCycle || {}
  const previewCycle = {
    enabled: previewCycleSource.enabled === true,
    intervalMs: clampNumber(previewCycleSource.intervalMs, 250, 15000, 2000),
  }

  return {
    id: source.id || fallbackLayout?.id || CLASSIC_BANNER_LAYOUT_ID,
    name: source.name || fallbackLayout?.name || 'Classic',
    basePresetId: normalizeBannerLayoutId(source.basePresetId || fallbackLayout?.basePresetId || fallbackLayout?.id),
    width,
    height,
    minWidth: BANNER_SIZE_LIMITS.minWidth,
    maxWidth: BANNER_SIZE_LIMITS.maxWidth,
    aspectRatio: `${width} / ${height}`,
    density: densitySet.has(source.density) ? source.density : fallbackLayout?.density || 'comfortable',
    image,
    imageFit: image.fit,
    previewCycle,
    hoverEffect: ['classic-tilt', 'zoom', 'none'].includes(source.hoverEffect)
      ? source.hoverEffect
      : ['classic-tilt', 'zoom', 'none'].includes(fallbackLayout?.hoverEffect)
        ? fallbackLayout.hoverEffect
        : 'classic-tilt',
    hoverScale: clampNumber(source.hoverScale, 1, 1.5, fallbackLayout?.hoverScale ?? 1.02),
    shadow: {
      enabled: source.shadow?.enabled === true,
      color: sanitizeColor(source.shadow?.color) || fallbackLayout?.shadow?.color || 'rgba(0,0,0,0.5)',
    },
    iconColor: sanitizeColor(source.iconColor) || fallbackLayout?.iconColor || '',
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
    panels: {
      top: normalizePanel(source.panels?.top, fallbackLayout?.panels?.top),
      right: normalizePanel(source.panels?.right, fallbackLayout?.panels?.right),
      bottom: normalizePanel(source.panels?.bottom, fallbackLayout?.panels?.bottom),
      left: normalizePanel(source.panels?.left, fallbackLayout?.panels?.left),
    },
    border: {
      // Default to the classic 1px black border every banner used to have
      // (before it became configurable). Set width to 0 on a layout to remove it.
      width: clampInt(source.border?.width, 0, 20, fallbackLayout?.border?.width ?? 1),
      color: sanitizeColor(source.border?.color) || fallbackLayout?.border?.color || '#000000',
      radius: clampInt(source.border?.radius, 0, 80, fallbackLayout?.border?.radius ?? 0),
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
  if (layout.image?.fit && !fitSet.has(layout.image.fit)) errors.push(`Invalid image fit ${layout.image.fit}`)
  if (layout.image?.foregroundFit && !fitSet.has(layout.image.foregroundFit)) errors.push(`Invalid foreground image fit ${layout.image.foregroundFit}`)
  if (layout.image?.position && !imagePositionSet.has(layout.image.position)) errors.push(`Invalid image position ${layout.image.position}`)
  if (layout.image?.backgroundMode && !imageBackgroundModeSet.has(layout.image.backgroundMode)) errors.push(`Invalid image background mode ${layout.image.backgroundMode}`)
  if (layout.density && !densitySet.has(layout.density)) errors.push(`Invalid density ${layout.density}`)

  for (const field of layout.fields || []) {
    if (!fieldSet.has(field.id)) errors.push(`Invalid field id ${field.id}`)
    const region = field.region || 'image'
    if (!regionSet.has(region)) errors.push(`Invalid region ${region}`)
    // Only image-region fields require a corner slot; panel fields use row/align.
    if (region === 'image' && !slotSet.has(field.slot)) errors.push(`Invalid slot ${field.slot}`)
    if (region !== 'image' && field.align && !alignSet.has(field.align)) errors.push(`Invalid align ${field.align}`)
    const fontSize = Number(field.fontSize)
    if (Number.isFinite(fontSize) && (fontSize < 8 || fontSize > 24)) {
      errors.push(`Field ${field.id} font size is outside the safe range`)
    }
  }

  return errors
}

export const normalizeBannerPreset = (preset, fallbackLayout, existingIds = []) => {
  if (!preset || typeof preset !== 'object') return null
  const name = sanitizeBannerPresetName(preset.name || preset.layout?.name)
  const now = Date.now()
  const layoutId = preset.id && String(preset.id).startsWith('user-')
    ? String(preset.id)
    : generateBannerPresetId(name, existingIds)
  const layout = normalizeBannerLayout(
    {
      ...(preset.layout || {}),
      id: layoutId,
      name,
      basePresetId: preset.layout?.basePresetId || preset.basePresetId,
    },
    fallbackLayout,
  )
  if (!layout) return null
  return {
    id: layoutId,
    name,
    source: 'user',
    createdAt: Number(preset.createdAt) || now,
    updatedAt: Number(preset.updatedAt) || now,
    layout: {
      ...layout,
      id: layoutId,
      name,
    },
  }
}

export const validateBannerPreset = (preset) => {
  const errors = []
  if (!preset || typeof preset !== 'object') return ['Banner preset must be an object']
  if (!sanitizeBannerPresetName(preset.name)) errors.push('Banner preset needs a name')
  if (preset.source && preset.source !== 'user' && preset.source !== 'builtin') {
    errors.push(`Invalid preset source ${preset.source}`)
  }
  return [...errors, ...validateBannerLayout(preset.layout)]
}

export const createUserPresetFromLayout = (layout, name, fallbackLayout, existingIds = []) => {
  const safeName = sanitizeBannerPresetName(name)
  const id = generateBannerPresetId(safeName, existingIds)
  const now = Date.now()
  const normalizedLayout = normalizeBannerLayout(
    {
      ...layout,
      id,
      name: safeName,
    },
    fallbackLayout,
  )
  return {
    id,
    name: safeName,
    source: 'user',
    createdAt: now,
    updatedAt: now,
    layout: {
      ...normalizedLayout,
      id,
      name: safeName,
    },
  }
}

export const createBannerPresetExport = (presetOrLayout, name) => {
  const layout = presetOrLayout?.layout || presetOrLayout
  return {
    schemaVersion: BANNER_PRESET_SCHEMA_VERSION,
    type: BANNER_PRESET_EXPORT_TYPE,
    name: sanitizeBannerPresetName(name || presetOrLayout?.name || layout?.name),
    layout: {
      basePresetId: layout?.basePresetId,
      width: clampNumber(layout?.width, BANNER_SIZE_LIMITS.minWidth, BANNER_SIZE_LIMITS.maxWidth, 537),
      height: clampNumber(layout?.height, BANNER_SIZE_LIMITS.minHeight, BANNER_SIZE_LIMITS.maxHeight, 251),
      minWidth: BANNER_SIZE_LIMITS.minWidth,
      maxWidth: BANNER_SIZE_LIMITS.maxWidth,
      density: densitySet.has(layout?.density) ? layout.density : 'comfortable',
      image: {
        visible: layout?.image?.visible !== false,
        fit: fitSet.has(layout?.image?.fit || layout?.imageFit) ? (layout?.image?.fit || layout?.imageFit) : 'contain',
        foregroundFit: fitSet.has(layout?.image?.foregroundFit) ? layout.image.foregroundFit : 'contain',
        position: imagePositionSet.has(layout?.image?.position) ? layout.image.position : 'center',
        dimWhenMissing: layout?.image?.dimWhenMissing === true,
        fallbackBackground: fallbackBackgroundSet.has(layout?.image?.fallbackBackground) ? layout.image.fallbackBackground : 'dark',
        backgroundMode: imageBackgroundModeSet.has(layout?.image?.backgroundMode) ? layout.image.backgroundMode : 'image',
        blurBackground: {
          opacity: clampNumber(layout?.image?.blurBackground?.opacity, 0, 1, DEFAULT_BLUR_BACKGROUND.opacity),
          blur: clampNumber(layout?.image?.blurBackground?.blur, 0, 40, DEFAULT_BLUR_BACKGROUND.blur),
          scale: clampNumber(layout?.image?.blurBackground?.scale, 1, 1.3, DEFAULT_BLUR_BACKGROUND.scale),
        },
      },
      imageFit: fitSet.has(layout?.image?.fit || layout?.imageFit) ? (layout?.image?.fit || layout?.imageFit) : 'contain',
      previewCycle: {
        enabled: layout?.previewCycle?.enabled === true,
        intervalMs: clampNumber(layout?.previewCycle?.intervalMs, 250, 15000, 2000),
      },
      hoverEffect: layout?.hoverEffect || 'classic-tilt',
      overlays: layout?.overlays || {},
      fields: Array.isArray(layout?.fields) ? layout.fields : [],
    },
  }
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
      const region = field.region || 'image'
      if (region === 'image' && !slotSet.has(field.slot)) errors.push(`${layout.id} has invalid slot ${field.slot}`)
    }
  }

  return errors
}
