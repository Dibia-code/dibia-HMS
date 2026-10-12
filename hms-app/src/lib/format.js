// Formatting helpers. Nigerian naira + local date/time conventions.

const NGN = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
})

// ₦12,500.00 — the mockups show the ₦ glyph and grouped thousands throughout.
export function naira(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '₦0.00'
  return NGN.format(n)
}

// Compact form for stat cards: ₦1.2m, ₦840k.
export function nairaCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
  if (abs >= 1_000) return `₦${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return naira(n)
}

export function number(n) {
  return new Intl.NumberFormat('en-NG').format(Number(n) || 0)
}

const DATE = new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('en-NG', { hour: '2-digit', minute: '2-digit' })

export function formatDate(value) {
  const d = toDate(value)
  return d ? DATE.format(d) : '—'
}

export function formatDateTime(value) {
  const d = toDate(value)
  return d ? `${DATE.format(d)} · ${TIME.format(d)}` : '—'
}

// "just now", "3m ago", "2h ago", "yesterday" — used on sync/activity rows.
export function relativeTime(value, now = new Date()) {
  const d = toDate(value)
  if (!d) return '—'
  const secs = Math.round((now - d) / 1000)
  if (secs < 45) return 'just now'
  if (secs < 90) return '1m ago'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return formatDate(d)
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}
