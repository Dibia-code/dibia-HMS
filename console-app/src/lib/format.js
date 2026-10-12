// Formatting helpers (naira + local dates). Kept in step with
// hospital-app/src/lib/format.js so both apps read the same.

const NGN = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0, // platform revenue is shown in whole naira
})

// ₦15,000 — ₦ glyph, grouped thousands.
export function naira(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '₦0'
  return NGN.format(n)
}

export function number(n) {
  return new Intl.NumberFormat('en-NG').format(Number(n) || 0)
}

const DATE = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })

// "3 Aug 2026"
export function formatDate(value) {
  const d = toDate(value)
  return d ? DATE.format(d) : '—'
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
