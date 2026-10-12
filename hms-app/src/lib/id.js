// Client-generated IDs. Used as primary keys AND as idempotency keys for the
// sync queue, so a write created offline keeps the same id when it reaches the
// server — replaying the queue can never create a duplicate row (§5).
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older browsers / non-secure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Short human-facing reference codes, e.g. sale receipts: "SALE-8F3K2".
export function refCode(prefix) {
  const s = uuid().replace(/-/g, '').slice(0, 5).toUpperCase()
  return `${prefix}-${s}`
}
