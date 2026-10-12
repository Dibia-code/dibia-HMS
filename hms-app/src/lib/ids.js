const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomChars(n) {
  const bytes = new Uint8Array(n)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('')
}

export function newDibiaId() {
  return `DBA-${randomChars(4)}-${randomChars(4)}`
}

export function newVisitNo(date = new Date()) {
  const y = String(date.getFullYear()).slice(2)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `V-${y}${m}${d}-${randomChars(4)}`
}

export function newReceiptNo() {
  return `RCP-${randomChars(6)}`
}

export function newClaimNo() {
  return `CLM-${randomChars(6)}`
}

export function newToken() {
  return randomChars(24)
}
