// Subscription tiers from the PRD (section 10.1). Hospitals pay by usage-days:
// one patient seen or documented on one calendar day. Fees are monthly, in naira.
export const TIERS = [
  { key: 'Freemium', min: 0, max: 300, fee: 0, note: 'Early capture' },
  { key: 'Small', min: 301, max: 2000, fee: 25000, note: 'Primary early revenue target' },
  { key: 'Medium', min: 2001, max: 10000, fee: 150000, note: 'Main revenue engine' },
  { key: 'Large', min: 10001, max: Infinity, fee: 600000, note: '600,000 or negotiated' },
]

const LEGACY = { Starter: 'Freemium', Trial: 'Freemium', Growth: 'Small', Standard: 'Small', Enterprise: 'Large' }

export function normalisePlan(plan) {
  if (TIERS.some((t) => t.key === plan)) return plan
  return LEGACY[plan] || 'Freemium'
}

export function tierByName(plan) {
  return TIERS.find((t) => t.key === normalisePlan(plan)) || TIERS[0]
}

export function tierForUsage(days) {
  return TIERS.find((t) => days >= t.min && days <= t.max) || TIERS[0]
}

export function planPrice(plan) {
  return tierByName(plan).fee
}

// Demo usage-days for registry rows that have none recorded yet.
const DEMO_USAGE = {
  hosp_dibia_general: 1420, hosp_wellcare: 640, hosp_northgate: 1880, hosp_riverside: 210, hosp_harmony: 4900,
  hosp_bluecross: 95, hosp_citycare: 780, hosp_grace: 0, hosp_sunrise: 0,
}

export function usageDaysOf(hospital) {
  return hospital.usageDays ?? DEMO_USAGE[hospital.id] ?? 0
}

export function usageLevel(hospital) {
  const days = usageDaysOf(hospital)
  const tier = tierByName(hospital.plan)
  if (tier.max === Infinity) return { days, tier, pct: 0, level: 'ok' }
  const pct = Math.round((days / tier.max) * 100)
  return { days, tier, pct, level: pct >= 100 ? 'crit' : pct >= 80 ? 'warn' : 'ok' }
}
