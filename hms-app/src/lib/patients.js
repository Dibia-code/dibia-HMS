const clean = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const digits = (s) => String(s || '').replace(/\D/g, '')

export function phoneKey(s) {
  const d = digits(s)
  return d.length >= 10 ? d.slice(-10) : d
}

function distance(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

function tokenMatches(qt, nt) {
  if (nt.startsWith(qt)) return true
  if (qt.length >= 4 && distance(qt, nt.slice(0, qt.length)) <= 1) return true
  if (qt.length >= 4 && nt.length >= 4 && distance(qt, nt) <= 1) return true
  return false
}

export function searchPatients(patients, query, limit = 6) {
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const qDigits = digits(q)
  const qName = clean(q)
  const tokens = qName.split(' ').filter(Boolean)
  const code = q.toUpperCase().replace(/\s/g, '')

  const scored = []
  for (const p of patients) {
    let score = 0
    if (p.dibiaId && code.length >= 3 && p.dibiaId.replace(/-/g, '').includes(code.replace(/-/g, ''))) score += 10
    if (qDigits.length >= 4 && digits(p.phone).includes(qDigits)) score += 8
    if (tokens.length) {
      const nameTokens = clean(p.fullName).split(' ').filter(Boolean)
      const hits = tokens.filter((qt) => nameTokens.some((nt) => tokenMatches(qt, nt))).length
      if (hits === tokens.length) score += 6 + hits
      else if (hits > 0 && tokens.length > 1) score += hits
    }
    if (score > 0) scored.push({ patient: p, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.patient)
}

export function findPossibleDuplicates(patients, { fullName, firstName, surname, otherNames, phone }) {
  fullName = fullName || [firstName, surname, otherNames].filter(Boolean).join(' ')
  const name = clean(fullName)
  const key = phoneKey(phone)
  if (name.length < 3) return []
  const nameTokens = name.split(' ').filter(Boolean).sort()
  const joined = nameTokens.join(' ')

  return patients.filter((p) => {
    const pn = clean(p.fullName).split(' ').filter(Boolean).sort().join(' ')
    const closeName = pn === joined || distance(pn, joined) <= Math.max(1, Math.floor(joined.length * 0.15))
    const samePhone = key.length >= 7 && phoneKey(p.phone) === key
    if (samePhone && (closeName || nameTokens.some((t) => pn.includes(t)))) return true
    return closeName && nameTokens.length > 1
  })
}

export function ageFrom(dob, fallbackAge) {
  const fallback = fallbackAge === '' || fallbackAge == null ? null : Number(fallbackAge)
  const validFallback = Number.isInteger(fallback) && fallback >= 0 && fallback <= 130 ? fallback : null
  if (!dob) return validFallback
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return validFallback
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1
  return age
}
