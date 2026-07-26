'use strict'

// ── Active banner layout store ───────────────────────────────────────────────
//
// The user's active ("custom") banner layout used to be stringified into
// config.ini as Appearance.customBannerLayout. On a real config that value was
// 18,421 bytes — 89% of the whole file — which made config.ini unreadable and
// un-editable by hand, and meant every settings save rewrote all of it.
//
// Themes already do this the right way: Appearance.themeId holds a short id and
// the definition lives in templates/theme/*.json. Banner layouts now match that
// pattern: Appearance.bannerTemplate keeps the short id, the layout itself lives
// in a file.
//
// WHERE the file lives matters. It is deliberately NOT inside
// templates/banner-layout/, because set-user-banner-layouts prunes every .json
// in that directory that is not part of the incoming preset set — the active
// layout would be deleted the next time the user saved a preset. The preset
// files are also shaped { id, name, layout: {...} } whereas this value is a bare
// layout object, so they are not interchangeable. It therefore sits alongside
// that directory instead.

const fs = require('fs')
const path = require('path')

const ACTIVE_LAYOUT_FILENAME = 'banner-layout-active.json'

const activeLayoutPath = (dataDir) =>
  path.join(dataDir, 'templates', ACTIVE_LAYOUT_FILENAME)

const parseLayout = (raw) => {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// File first, config second. The config fallback is kept deliberately: it means
// a build without this change (a downgrade, or a user restoring an older
// config.ini) still finds the layout, and it covers the window between an
// upgrade and the migration completing.
const readActiveLayout = (dataDir, appConfig) => {
  try {
    const file = activeLayoutPath(dataDir)
    if (fs.existsSync(file)) {
      const parsed = parseLayout(fs.readFileSync(file, 'utf8'))
      if (parsed) return parsed
      console.warn(`${ACTIVE_LAYOUT_FILENAME} is not valid JSON; falling back to config`)
    }
  } catch (err) {
    console.warn(`Could not read ${ACTIVE_LAYOUT_FILENAME}:`, err.message)
  }
  return parseLayout(appConfig?.Appearance?.customBannerLayout)
}

const writeActiveLayout = (dataDir, layout) => {
  const file = activeLayoutPath(dataDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(layout || {}, null, 2)}\n`, 'utf8')
  return file
}

// One-time move out of config.ini. Order matters: the file is written and read
// back and compared BEFORE the ini key is dropped, so a failed or partial write
// can never lose a layout the user spent real effort on. If anything goes wrong
// the config key is left exactly as it was and the next launch retries.
//
// Returns a report for the Client Check panel.
const migrateActiveLayoutToFile = (dataDir, appConfig, configPath, ini) => {
  const report = { ran: false, migrated: false, bytesMoved: 0, filePath: null, error: null }

  const raw = appConfig?.Appearance?.customBannerLayout
  if (!raw || String(raw).trim() === '') return report
  report.ran = true

  const layout = parseLayout(raw)
  if (!layout) {
    report.error = 'Appearance.customBannerLayout is not valid JSON; left in place for inspection.'
    return report
  }

  try {
    const file = writeActiveLayout(dataDir, layout)
    report.filePath = file

    // Verify by reading back and comparing, not by trusting the write.
    const readBack = parseLayout(fs.readFileSync(file, 'utf8'))
    if (!readBack || JSON.stringify(readBack) !== JSON.stringify(layout)) {
      report.error = 'Layout file did not read back identically; config key left in place.'
      return report
    }

    const next = {
      ...appConfig,
      Appearance: { ...(appConfig.Appearance || {}) },
    }
    delete next.Appearance.customBannerLayout
    fs.writeFileSync(configPath, ini.stringify(next), 'utf-8')

    report.migrated = true
    report.bytesMoved = String(raw).length
    console.log(
      `banner layout moved out of config.ini: ${report.bytesMoved} bytes -> ` +
      `templates/${ACTIVE_LAYOUT_FILENAME}`,
    )
    return { ...report, config: next }
  } catch (err) {
    report.error = err.message
    console.warn('Banner layout migration failed (config left unchanged):', err.message)
    return report
  }
}

module.exports = {
  ACTIVE_LAYOUT_FILENAME,
  activeLayoutPath,
  readActiveLayout,
  writeActiveLayout,
  migrateActiveLayoutToFile,
}
