'use strict'

// ── Config sanitizer ─────────────────────────────────────────────────────────
//
// Runs before the config is used, on every launch. Its job is to stop a
// config.ini that has been carried forward since 0.7 from accumulating keys no
// build has read in years, while never destroying anything it cannot positively
// identify as dead.
//
// The rules, in order of caution:
//
//   1. A key is removed ONLY if it appears in DEPRECATED_KEYS for its section,
//      or its whole section appears in DEPRECATED_SECTIONS. Anything else —
//      including keys this build has never heard of — is kept, because an
//      unrecognised key is just as likely to come from a NEWER build as an
//      older one, and silently deleting it would downgrade the user's settings.
//   2. Keys in a dynamic section (WindowBounds) are always kept when they match
//      that section's key pattern.
//   3. Nothing is written unless something actually changed, and when it does,
//      config.ini is copied to config.ini.bak first. The removed values are also
//      returned in the report so they can be shown to the user rather than
//      vanishing silently.
//
// The report is surfaced in Settings -> Database -> Client Check rather than as
// a startup toast: it is information about the user's own file, and they should
// be able to look at it on their own schedule instead of having it flash past.

const fs = require('fs')
const path = require('path')
const {
  CONFIG_VERSION,
  DEPRECATED_KEYS,
  DEPRECATED_SECTIONS,
  MIGRATED_KEYS,
  isDynamicSectionKey,
  buildDefaultConfig,
} = require('./configSchema')

const emptyReport = () => ({
  ran: false,
  changed: false,
  configVersionBefore: null,
  configVersionAfter: CONFIG_VERSION,
  removedSections: [],
  removedKeys: [],
  // Keys present on disk that this build's schema does not define and that are
  // not on any deprecation list. Reported, never removed — an unrecognised key
  // is as likely to come from a newer build as an older one. This exists because
  // the first version of the deprecation list was written from guesswork and
  // matched nothing on a real config; surfacing the truth from the user's own
  // file is more reliable than predicting what past versions wrote.
  unknownKeys: [],
  unknownSections: [],
  backupPath: null,
  error: null,
})

// Pure: takes a parsed ini object, returns a cleaned copy plus what it removed.
// Split out from the file I/O so it can be tested without touching disk.
const sanitizeParsedConfig = (parsed, dataDir = '') => {
  const report = emptyReport()
  report.ran = true
  const schema = buildDefaultConfig(dataDir)

  if (!parsed || typeof parsed !== 'object') {
    return { config: {}, report }
  }

  const rawVersion = Number(parsed?.Meta?.configVersion)
  report.configVersionBefore = Number.isFinite(rawVersion) ? rawVersion : null

  const cleaned = {}

  for (const section of Object.keys(parsed)) {
    const value = parsed[section]
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      // ini.parse() only produces nested objects for [sections]; a bare
      // top-level scalar is malformed. Keep it rather than guess.
      cleaned[section] = value
      continue
    }

    if (!(section in schema)) {
      report.unknownSections.push({ section, keys: Object.keys(value).length })
    }

    if (DEPRECATED_SECTIONS.includes(section)) {
      report.removedSections.push({
        section,
        keys: Object.keys(value).length,
      })
      report.changed = true
      continue
    }

    const deprecated = DEPRECATED_KEYS[section] || []
    const nextSection = {}
    for (const key of Object.keys(value)) {
      if (isDynamicSectionKey(section, key)) {
        nextSection[key] = value[key]
        continue
      }
      if (deprecated.includes(key)) {
        report.removedKeys.push({ section, key, value: String(value[key] ?? '') })
        report.changed = true
        continue
      }
      // Recognised-but-elsewhere: owned by a dedicated migration, so neither
      // removed here nor reported as unrecognised.
      const migrated = MIGRATED_KEYS[section] || []
      const known = schema[section] ? key in schema[section] : false
      if (!known && !migrated.includes(key)) {
        const text = String(value[key] ?? '')
        report.unknownKeys.push({
          section, key,
          bytes: text.length,
          // Long values (embedded JSON) are clipped so the panel stays readable.
          preview: text.length > 120 ? `${text.slice(0, 120)}…` : text,
        })
      }
      nextSection[key] = value[key]
    }
    cleaned[section] = nextSection
  }

  // Stamp the version so the next launch can tell how old this file is. A file
  // that had no marker at all is by definition pre-0.9.
  if (report.configVersionBefore !== CONFIG_VERSION) {
    cleaned.Meta = { ...(cleaned.Meta || {}), configVersion: CONFIG_VERSION }
    report.changed = true
  }

  return { config: cleaned, report }
}

// Reads config.ini, sanitizes it, and writes it back only if something changed —
// taking a .bak first. `ini` is injected rather than required here so this module
// stays dependency-light and testable.
const sanitizeConfigFile = (configPath, ini, dataDir = '') => {
  const report = emptyReport()
  try {
    if (!configPath || !fs.existsSync(configPath)) return report

    const original = fs.readFileSync(configPath, 'utf-8')
    const parsed = ini.parse(original)
    const { config, report: inner } = sanitizeParsedConfig(parsed, dataDir)
    Object.assign(report, inner)

    if (report.unknownKeys.length > 0) {
      console.log(
        `config: ${report.unknownKeys.length} unrecognised key(s) left in place ` +
        `(reported in Settings -> Database -> Full client check)`,
      )
      for (const entry of report.unknownKeys) {
        console.log(`  ? [${entry.section}] ${entry.key} (${entry.bytes} bytes)`)
      }
    }

    // Unrecognised keys are informational only, so they must not cause a rewrite.
    if (!report.changed) return report

    const backupPath = `${configPath}.bak`
    try {
      fs.writeFileSync(backupPath, original, 'utf-8')
      report.backupPath = backupPath
    } catch (backupErr) {
      // If the backup cannot be written, do NOT proceed with the removal —
      // an unrecoverable prune is worse than a stale key.
      report.error = `Backup failed, config left unchanged: ${backupErr.message}`
      report.changed = false
      return report
    }

    fs.writeFileSync(configPath, ini.stringify(config), 'utf-8')

    const removedCount = report.removedKeys.length
    const sectionCount = report.removedSections.length
    if (removedCount || sectionCount) {
      console.log(
        `config sanitize: removed ${removedCount} stale key(s) and ${sectionCount} ` +
        `stale section(s); backup at ${path.basename(backupPath)}`,
      )
      for (const entry of report.removedKeys) {
        console.log(`  - [${entry.section}] ${entry.key}`)
      }
      for (const entry of report.removedSections) {
        console.log(`  - [${entry.section}] (whole section, ${entry.keys} key(s))`)
      }
    }
    if (report.configVersionBefore !== CONFIG_VERSION) {
      console.log(
        `config version ${report.configVersionBefore ?? '(none)'} -> ${CONFIG_VERSION}`,
      )
    }
    return report
  } catch (err) {
    console.warn('Config sanitize failed (continuing with the file as-is):', err.message)
    report.error = err.message
    report.changed = false
    return report
  }
}

module.exports = {
  sanitizeParsedConfig,
  sanitizeConfigFile,
}
