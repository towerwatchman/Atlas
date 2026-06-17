export const parseTimestamp = (value) => {
  if (value === undefined || value === null || value === '') return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null
    return value < 100000000000 ? value * 1000 : value
  }

  const normalized = String(value).trim()
  if (!normalized) return null

  if (/^\d+$/.test(normalized)) {
    const numericValue = Number(normalized)
    if (!Number.isFinite(numericValue) || numericValue <= 0) return null
    return numericValue < 100000000000 ? numericValue * 1000 : numericValue
  }

  const parsed = new Date(normalized).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const absoluteFormatter = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const formatRelativeTime = (timestampMs, nowMs = Date.now()) => {
  const diffMs = nowMs - timestampMs
  const future = diffMs < 0
  const absMs = Math.abs(diffMs)

  if (absMs < 60000) return 'Just now'

  const units = [
    ['year', 365 * 86400000],
    ['month', 30 * 86400000],
    ['week', 7 * 86400000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ]

  const [unit, unitMs] = units.find(([, ms]) => absMs >= ms) || units[units.length - 1]
  const amount = Math.max(1, Math.floor(absMs / unitMs))
  const label = `${amount} ${unit}${amount === 1 ? '' : 's'}`
  return future ? `in ${label}` : `${label} ago`
}

export const formatVersionDate = (value, emptyLabel = 'Unknown') => {
  const timestampMs = parseTimestamp(value)
  if (timestampMs === null) {
    return {
      relative: emptyLabel,
      absolute: '',
      display: emptyLabel,
      isValid: false,
    }
  }

  const absolute = absoluteFormatter.format(new Date(timestampMs))
  const relative = formatRelativeTime(timestampMs)
  return {
    relative,
    absolute,
    display: relative,
    isValid: true,
  }
}
