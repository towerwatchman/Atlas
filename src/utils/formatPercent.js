export const formatPercent = (value, { clamp = true } = {}) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return '0%'

  const clampedValue = clamp
    ? Math.min(100, Math.max(0, numericValue))
    : numericValue
  const roundedValue = Math.ceil(clampedValue * 10) / 10
  const displayValue = Number.isInteger(roundedValue)
    ? String(roundedValue)
    : roundedValue.toFixed(1)

  return `${displayValue}%`
}
