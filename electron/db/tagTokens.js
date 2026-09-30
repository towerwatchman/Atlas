'use strict'

// CJS mirror of src/utils/tagTokens.js — see that file for full rationale.

const safeText = (value) => String(value ?? '')

const normalizeTagText = (value) =>
  safeText(value).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')

const normalizeTagList = (value) => {
  const arr = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ''
      ? []
      : [String(value)]
  return arr.map((v) => normalizeTagText(v).trim()).filter(Boolean)
}

const splitTagSources = (...rawValues) => {
  const tokens = []
  for (const raw of rawValues) {
    if (raw === null || raw === undefined || raw === '') continue
    const parts = String(raw).split(',')
    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const normalized = normalizeTagText(trimmed).trim()
      if (!normalized) continue
      tokens.push(normalized)
    }
  }
  const seen = new Set()
  const out = []
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token)
      out.push(token)
    }
  }
  return out
}

const buildTagsFilterValue = (...rawValues) => splitTagSources(...rawValues).join(',')

module.exports = { normalizeTagText, splitTagSources, buildTagsFilterValue, normalizeTagList }
