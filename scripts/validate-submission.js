#!/usr/bin/env node
'use strict'

/**
 * Gallery submission validator.
 *
 * Validates a shared theme or banner-layout JSON file against THIS branch's
 * schema. It is intentionally self-contained (CommonJS, no build step, no deps)
 * and derives its rules from the actual source files in this checkout, so it
 * always reflects the schema of whatever branch it runs on.
 *
 * The gallery CI runs this once per release channel (main + nightly) by checking
 * out the app repo at each branch and running its copy of this script. A
 * submission is only accepted when it passes on EVERY channel — so an item that
 * targets a newer (nightly-only) schema version is rejected until the stable
 * (main) build can load it too.
 *
 * Usage:  node scripts/validate-submission.js <file.json> [<file2.json> ...]
 * Exit:   0 = all valid, 1 = one or more invalid (details on stderr).
 */

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = process.cwd()
const THEMES_SRC = path.join(root, 'src', 'theme', 'themes.js')
const BANNER_SRC = path.join(root, 'src', 'components', 'library', 'bannerLayout', 'bannerLayoutSchema.js')

// ── Rule extraction from source (single source of truth per branch) ──────────
function readSource(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`Unable to read ${path.relative(root, file)}: ${err.message}`)
  }
}
function extractArray(source, name) {
  const match = source.match(new RegExp(`export const ${name} = (\\[[\\s\\S]*?\\])`))
  if (!match) throw new Error(`Could not find ${name} in source`)
  return vm.runInNewContext(`(${match[1]})`)
}
function extractInt(source, name) {
  const match = source.match(new RegExp(`export const ${name} = (\\d+)`))
  if (!match) throw new Error(`Could not find ${name} in source`)
  return Number(match[1])
}
function extractString(source, name) {
  const match = source.match(new RegExp(`export const ${name} = '([^']*)'`))
  if (!match) throw new Error(`Could not find ${name} in source`)
  return match[1]
}

const themesSource = readSource(THEMES_SRC)
const bannerSource = readSource(BANNER_SRC)

const RULES = {
  theme: {
    type: extractString(themesSource, 'THEME_EXPORT_TYPE'),
    version: extractInt(themesSource, 'THEME_SCHEMA_VERSION'),
    min: extractInt(themesSource, 'THEME_SCHEMA_MIN'),
    colorKeys: new Set(extractArray(themesSource, 'THEME_COLOR_KEYS')),
    gradientKeys: new Set(extractArray(themesSource, 'GRADIENT_ELIGIBLE_KEYS')),
    radiusOptions: new Set(extractArray(themesSource, 'RADIUS_OPTIONS')),
  },
  layout: {
    type: extractString(bannerSource, 'BANNER_PRESET_EXPORT_TYPE'),
    version: extractInt(bannerSource, 'BANNER_PRESET_SCHEMA_VERSION'),
    min: extractInt(bannerSource, 'BANNER_PRESET_SCHEMA_MIN'),
    fieldIds: new Set(extractArray(bannerSource, 'SUPPORTED_BANNER_FIELD_IDS')),
    slots: new Set(extractArray(bannerSource, 'SUPPORTED_BANNER_SLOTS')),
    panelSides: new Set(extractArray(bannerSource, 'BANNER_PANEL_SIDES')),
    aligns: new Set(extractArray(bannerSource, 'BANNER_PANEL_ALIGNMENTS')),
    regions: new Set(['image', 'top', 'right', 'bottom', 'left']),
  },
}

// ── Shared metadata (manifest) rules ─────────────────────────────────────────
const MAX_NAME = 80
const MAX_DESC = 500
const MAX_TAGS = 12

// ── Security: reject CSS-injection / breakout in any submitted string ────────
// Colors legitimately contain "(" and "," (rgba/hsl), so we don't ban those
// wholesale — we ban the tokens that enable breakout, and separately require
// color-bearing fields to match a strict color grammar.
const INJECTION = /url\s*\(|expression\s*\(|javascript:|@import|<|>|\{|\}|;|\/\*|\*\/|\\/i
const SAFE_COLOR =
  /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)|[a-z]+)$/i

function isSafeColor(value) {
  return typeof value === 'string' && SAFE_COLOR.test(value.trim())
}

function scanForInjection(value, keyPath, errors) {
  if (typeof value === 'string') {
    if (INJECTION.test(value)) errors.push(`Unsafe characters in "${keyPath}": ${JSON.stringify(value)}`)
    if (value.length > 2000) errors.push(`Value too long at "${keyPath}"`)
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => scanForInjection(item, `${keyPath}[${i}]`, errors))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) scanForInjection(v, keyPath ? `${keyPath}.${k}` : k, errors)
  }
}

// ── Manifest ─────────────────────────────────────────────────────────────────
function validateManifest(obj, errors) {
  if (!obj || typeof obj !== 'object') {
    errors.push('File is not a JSON object')
    return null
  }
  const type = obj.type
  if (type !== RULES.theme.type && type !== RULES.layout.type) {
    errors.push(`"type" must be "${RULES.theme.type}" or "${RULES.layout.type}" (got ${JSON.stringify(type)})`)
    return null
  }
  const kind = type === RULES.theme.type ? 'theme' : 'layout'
  const rule = RULES[kind]

  const version = obj.schemaVersion
  if (!Number.isInteger(version)) {
    errors.push('"schemaVersion" must be an integer')
  } else if (version < rule.min || version > rule.version) {
    errors.push(
      `"schemaVersion" ${version} is not supported by this build ` +
        `(supports ${rule.min}..${rule.version}). ` +
        `Items must load on every release channel; target the stable version.`,
    )
  }

  // Required metadata
  if (typeof obj.name !== 'string' || !obj.name.trim()) errors.push('"name" is required')
  else if (obj.name.length > MAX_NAME) errors.push(`"name" exceeds ${MAX_NAME} chars`)
  if (typeof obj.author !== 'string' || !obj.author.trim()) errors.push('"author" is required')

  // Recommended metadata (warnings, not failures)
  const warnings = []
  if (typeof obj.description !== 'string' || !obj.description.trim()) warnings.push('missing "description"')
  else if (obj.description.length > MAX_DESC) errors.push(`"description" exceeds ${MAX_DESC} chars`)
  if (!Array.isArray(obj.tags) || obj.tags.length === 0) warnings.push('missing "tags"')
  else if (obj.tags.length > MAX_TAGS) errors.push(`too many tags (max ${MAX_TAGS})`)
  if (typeof obj.license !== 'string' || !obj.license.trim()) warnings.push('missing "license"')
  if (typeof obj.nsfw !== 'boolean') warnings.push('missing "nsfw" boolean flag')

  return { kind, rule, warnings }
}

// ── Theme payload ────────────────────────────────────────────────────────────
function validateThemePayload(payload, rule, errors) {
  if (!payload || typeof payload !== 'object') {
    errors.push('theme payload (obj.theme) is missing or not an object')
    return
  }
  if (!payload.colors || typeof payload.colors !== 'object') {
    errors.push('theme must have a "colors" object')
    return
  }
  for (const [key, value] of Object.entries(payload.colors)) {
    if (!rule.colorKeys.has(key)) {
      errors.push(`unknown color key "${key}"`)
      continue
    }
    if (value && typeof value === 'object') {
      // Gradient object — only allowed on gradient-eligible surfaces.
      if (!rule.gradientKeys.has(key)) {
        errors.push(`color "${key}" may not be a gradient`)
        continue
      }
      if (value.type !== 'linear') errors.push(`gradient "${key}" type must be "linear"`)
      if (!Array.isArray(value.stops) || value.stops.length < 2) errors.push(`gradient "${key}" needs 2+ stops`)
      else value.stops.forEach((stop, i) => {
        if (!isSafeColor(stop)) errors.push(`gradient "${key}" stop ${i} is not a valid color: ${JSON.stringify(stop)}`)
      })
      if (value.angle !== undefined && !Number.isFinite(Number(value.angle))) errors.push(`gradient "${key}" angle must be a number`)
    } else if (!isSafeColor(value)) {
      errors.push(`color "${key}" is not a valid color: ${JSON.stringify(value)}`)
    }
  }
  for (const radiusKey of ['buttonRadius', 'cardRadius', 'radius']) {
    if (payload[radiusKey] !== undefined && !rule.radiusOptions.has(payload[radiusKey])) {
      errors.push(`"${radiusKey}" must be one of ${[...rule.radiusOptions].join(', ')}`)
    }
  }
  if (payload.font !== undefined && (typeof payload.font !== 'string' || INJECTION.test(payload.font))) {
    errors.push('"font" must be a safe font-family string')
  }
}

// ── Layout payload ───────────────────────────────────────────────────────────
function validateLayoutPayload(payload, rule, errors) {
  if (!payload || typeof payload !== 'object') {
    errors.push('layout payload (obj.layout) is missing or not an object')
    return
  }
  const num = (v, min, max, label) => {
    if (v === undefined) return
    const n = Number(v)
    if (!Number.isFinite(n) || n < min || n > max) errors.push(`${label} must be a number in ${min}..${max}`)
  }
  num(payload.width, 1, 4000, 'width')
  num(payload.height, 1, 4000, 'height')

  const fields = Array.isArray(payload.fields) ? payload.fields : []
  for (const field of fields) {
    if (!field || typeof field !== 'object') { errors.push('a field entry is not an object'); continue }
    if (field.type === 'divider') {
      if (field.orientation !== undefined && !['horizontal', 'vertical'].includes(field.orientation)) {
        errors.push(`divider has invalid orientation "${field.orientation}"`)
      }
      if (field.lineColor !== undefined && !isSafeColor(field.lineColor)) {
        errors.push(`divider lineColor is not a valid color: ${JSON.stringify(field.lineColor)}`)
      }
      num(field.lineSize, 1, 20, 'divider lineSize')
      continue
    }
    if (!rule.fieldIds.has(field.id)) errors.push(`unknown field id "${field.id}"`)
    const region = field.region || 'image'
    if (!rule.regions.has(region)) errors.push(`field "${field.id}" has invalid region "${region}"`)
    if (region === 'image') {
      if (field.slot !== undefined && !rule.slots.has(field.slot)) errors.push(`field "${field.id}" has invalid slot "${field.slot}"`)
    } else if (field.align !== undefined && !rule.aligns.has(field.align)) {
      errors.push(`field "${field.id}" has invalid align "${field.align}"`)
    }
    num(field.fontSize, 4, 48, `field "${field.id}" fontSize`)
    if (field.border && isColorField(field.border.color) === false) {
      errors.push(`field "${field.id}" border color is not a valid color`)
    }
  }

  const panels = payload.panels || {}
  for (const side of Object.keys(panels)) {
    if (!rule.panelSides.has(side)) errors.push(`invalid panel side "${side}"`)
    const panel = panels[side] || {}
    num(panel.size, 0, 400, `panel "${side}" size`)
    for (const [k, v] of [['background', panel.background], ['textColor', panel.textColor]]) {
      if (v !== undefined && !isSafeColor(v)) errors.push(`panel "${side}" ${k} is not a valid color: ${JSON.stringify(v)}`)
    }
    if (panel.border && panel.border.color !== undefined && !isSafeColor(panel.border.color)) {
      errors.push(`panel "${side}" border color is not a valid color`)
    }
  }

  if (payload.shadow && payload.shadow.color !== undefined && !isSafeColor(payload.shadow.color)) {
    errors.push('shadow color is not a valid color')
  }
  if (payload.iconColor !== undefined && payload.iconColor !== '' && !isSafeColor(payload.iconColor)) {
    errors.push('iconColor is not a valid color')
  }
  if (payload.border && payload.border.color !== undefined && !isSafeColor(payload.border.color)) {
    errors.push('banner border color is not a valid color')
  }
}
function isColorField(v) {
  return v === undefined ? null : isSafeColor(v)
}

// ── Per-file driver ──────────────────────────────────────────────────────────
function validateFile(file) {
  const errors = []
  let warnings = []
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return { file, errors: [`cannot read file: ${err.message}`], warnings }
  }
  let obj
  try {
    obj = JSON.parse(raw)
  } catch (err) {
    return { file, errors: [`invalid JSON: ${err.message}`], warnings }
  }

  scanForInjection(obj, '', errors)

  const manifest = validateManifest(obj, errors)
  if (manifest) {
    warnings = manifest.warnings
    if (manifest.kind === 'theme') {
      validateThemePayload(obj.theme || obj.payload, manifest.rule, errors)
    } else {
      validateLayoutPayload(obj.layout || obj.payload, manifest.rule, errors)
    }
  }
  return { file, errors, warnings }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Usage: node scripts/validate-submission.js <file.json> [...]')
  process.exit(2)
}

let failed = 0
for (const file of files) {
  const rel = path.relative(root, file) || file
  const { errors, warnings } = validateFile(file)
  if (errors.length > 0) {
    failed += 1
    console.error(`✗ ${rel}`)
    for (const e of errors) console.error(`    ERROR: ${e}`)
    for (const w of warnings) console.error(`    warn:  ${w}`)
  } else {
    console.log(`✓ ${rel}${warnings.length ? ` (${warnings.length} warning(s))` : ''}`)
    for (const w of warnings) console.log(`    warn:  ${w}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} submission(s) failed validation.`)
  process.exit(1)
}
console.log(`\nAll ${files.length} submission(s) valid.`)
