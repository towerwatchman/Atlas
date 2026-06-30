// Builds a single anchored regex (with named capture groups) from a token
// folder-structure template such as "{creator}/{title}/{version}". The
// generated pattern mirrors how the scanner parses structured folders and is
// shown (read-only) in the importer's Scan Scheme section. When the user opts
// to edit it, their custom regex is sent to the scanner instead.
//
// Token -> capture-group name mapping. Group names must be valid identifiers,
// so ids are normalized to lowercase alphanumerics (e.g. {f95Id} -> f95id).
const TOKEN_GROUP = {
  creator: 'creator',
  title: 'title',
  version: 'version',
  engine: 'engine',
  f95id: 'f95id',
  f95: 'f95id',
  lcid: 'lcid',
  lc: 'lcid',
  atlasid: 'atlasid',
  atlas: 'atlasid',
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const normalizeToken = (raw) =>
  String(raw || '').replace(/[{}]/g, '').trim().toLowerCase()

export function buildFolderRegex(format) {
  const template = String(format || '').replace(/\\/g, '/').trim()
  if (!template) return ''

  let pattern = '^'
  let cursor = 0
  const tokenPattern = /\{([^}]+)\}/g
  const usedNames = {}
  let match

  while ((match = tokenPattern.exec(template)) !== null) {
    pattern += escapeRegex(template.slice(cursor, match.index))
    const token = normalizeToken(match[1])
    const base = TOKEN_GROUP[token] || token.replace(/[^a-z0-9]/g, '') || 'field'
    const safeBase = /^[a-z]/.test(base) ? base : `f_${base}`
    let name = safeBase
    if (usedNames[safeBase]) {
      usedNames[safeBase] += 1
      name = `${safeBase}${usedNames[safeBase]}`
    } else {
      usedNames[safeBase] = 1
    }
    pattern += `(?<${name}>.+?)`
    cursor = match.index + match[0].length
  }

  pattern += `${escapeRegex(template.slice(cursor))}$`
  return pattern
}
