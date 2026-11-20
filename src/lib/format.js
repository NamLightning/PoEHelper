export const CHAOS_PER_DIV = 153.6

export function formatDiv(value) {
  return (Math.round(value * 10) / 10).toFixed(1)
}

export function formatChaos(div) {
  return Math.round(div * CHAOS_PER_DIV).toLocaleString('en-US')
}

export function formatRate(gain, sessionMs) {
  const hours = sessionMs / 3_600_000
  if (hours <= 0) return '0.0'
  return (gain / hours).toFixed(1)
}

export function formatDuration(sessionMs) {
  const total = Math.max(0, Math.round(sessionMs / 60_000))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${hours}h ${minutes}m`
}

export function formatAgo(from, now) {
  const sec = Math.max(0, Math.round((now - from) / 1000))
  if (sec < 20) return 'just now'
  if (sec < 60) return `${sec} sec ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hours = Math.floor(min / 60)
  const rem = min % 60
  return rem ? `${hours}h ${rem}m ago` : `${hours}h ago`
}

export function matchesQuery(query, ...parts) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return parts.some((part) => String(part ?? '').toLowerCase().includes(needle))
}
