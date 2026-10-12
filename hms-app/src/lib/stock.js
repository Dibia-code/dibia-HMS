const DAY = 86_400_000

export const DEFAULT_EXPIRY_WINDOWS = [30, 60, 90, 180, 365]

export function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function daysLeft(expiry) {
  if (!expiry) return Infinity
  const t = new Date(expiry)
  t.setHours(0, 0, 0, 0)
  return Math.round((t.getTime() - startOfToday()) / DAY)
}

export function isExpired(batch) {
  return !!batch.expiry && daysLeft(batch.expiry) < 0
}

export function fefoOrder(batches) {
  return batches
    .filter((b) => (b.balance || 0) > 0 && !isExpired(b))
    .sort((a, b) => {
      if (!a.expiry && !b.expiry) return new Date(a.receivedAt) - new Date(b.receivedAt)
      if (!a.expiry) return 1
      if (!b.expiry) return -1
      return new Date(a.expiry) - new Date(b.expiry)
    })
}

export function expiredWithStock(batches) {
  return batches.filter((b) => (b.balance || 0) > 0 && isExpired(b))
}

export function thresholdOf(product) {
  if (product.thresholdOverride != null && product.thresholdOverride !== '') return Number(product.thresholdOverride)
  const base = product.initialStock ?? product.quantity ?? 0
  return Math.ceil(base * 0.25)
}

export function expiryWindowLabel(days, windows = DEFAULT_EXPIRY_WINDOWS) {
  if (days < 0) return 'Expired'
  const sorted = [...windows].sort((a, b) => a - b)
  const w = sorted.find((x) => days <= x)
  if (!w) return null
  if (w >= 365) return `Within ${Math.round(w / 365)} year`
  if (w >= 180) return `Within ${Math.round(w / 30)} months`
  return `Within ${w} days`
}

// Roll a product's batches up into what the screens need.
export function summarise(product, batches, windows = DEFAULT_EXPIRY_WINDOWS) {
  const mine = batches.filter((b) => b.productId === product.id)
  const live = mine.filter((b) => (b.balance || 0) > 0)
  const fefo = fefoOrder(mine)
  const sellable = fefo.reduce((s, b) => s + b.balance, 0)
  const expiredQty = expiredWithStock(mine).reduce((s, b) => s + b.balance, 0)
  const total = live.reduce((s, b) => s + b.balance, 0)
  const nearest = fefo.find((b) => b.expiry) || null
  const threshold = thresholdOf(product)
  const nearestDays = nearest ? daysLeft(nearest.expiry) : Infinity
  const widest = Math.max(...windows)

  let status = 'in'
  if (sellable <= 0) status = expiredQty > 0 ? 'expired' : 'out'
  else if (sellable <= threshold) status = 'low'
  else if (nearestDays <= Math.min(...windows)) status = 'expiring'

  return {
    batches: mine,
    liveBatches: live,
    fefo,
    total,
    sellable,
    expiredQty,
    nearest,
    nearestDays,
    threshold,
    status,
    expiringSoon: nearestDays <= widest && sellable > 0,
    criticality: threshold > 0 ? sellable / threshold : sellable,
  }
}

export const STATUS_META = {
  in: { label: 'In stock', tone: 'active', border: 'ok' },
  low: { label: 'Low stock', tone: 'pending', border: 'warn' },
  expiring: { label: 'Expiring soon', tone: 'expiry', border: 'expiry' },
  out: { label: 'Out of stock', tone: 'failed', border: 'crit' },
  expired: { label: 'Expired', tone: 'failed', border: 'crit' },
}

export function unitsFrom(qty, unit, product) {
  const n = Number(qty) || 0
  const pack = Number(product?.packSize) || 1
  const carton = Number(product?.cartonSize) || 1
  if (unit === 'carton') return n * carton * pack
  if (unit === 'pack') return n * pack
  return n
}
