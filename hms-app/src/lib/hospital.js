export const TIERS = [
  { key: 'freemium', name: 'Freemium', min: 0, max: 300, fee: 0 },
  { key: 'small', name: 'Small', min: 301, max: 2000, fee: 25000 },
  { key: 'medium', name: 'Medium', min: 2001, max: 10000, fee: 150000 },
  { key: 'large', name: 'Large', min: 10001, max: Infinity, fee: 600000 },
]

export function tierFor(usageDays) {
  return TIERS.find((t) => usageDays >= t.min && usageDays <= t.max) || TIERS[0]
}

export function nextTier(tier) {
  const i = TIERS.findIndex((t) => t.key === tier.key)
  return TIERS[i + 1] || null
}

export function defaultHospitalConfig() {
  return {
    admission: { fee: 5000, bedPerDay: 8000 },
    expiryWindows: [30, 60, 90, 180, 365],
    notifyLowStock: false,
    paymentMethods: { cash: true, pos: true, transfer: true, hmo: true },
    receipt: { footer: 'Thank you', showAddress: true, showPhone: true },
    offline: { syncIntervalSec: 15 },
    departments: [
      { id: 'dept_gop', name: 'General outpatient', fee: 3000 },
      { id: 'dept_paed', name: 'Paediatrics', fee: 4000 },
      { id: 'dept_ante', name: 'Antenatal', fee: 5000 },
      { id: 'dept_emerg', name: 'Emergency', fee: 6000 },
    ],
    levy: { enabled: true, name: 'Hospital levy', amount: 500, showOnBill: true, appliesTo: 'both' },
    vat: { enabled: true, rate: 7.5, mode: 'exclusive' },
  }
}

export function hospitalConfig(hospital) {
  const base = defaultHospitalConfig()
  return {
    departments: hospital?.departments?.length ? hospital.departments : base.departments,
    admission: { ...base.admission, ...(hospital?.admission || {}) },
    expiryWindows: hospital?.expiryWindows?.length ? hospital.expiryWindows : base.expiryWindows,
    notifyLowStock: hospital?.notifyLowStock ?? base.notifyLowStock,
    paymentMethods: { ...base.paymentMethods, ...(hospital?.paymentMethods || {}) },
    receipt: { ...base.receipt, ...(hospital?.receipt || {}) },
    offline: { ...base.offline, ...(hospital?.offline || {}) },
    levy: { ...base.levy, ...(hospital?.levy || {}) },
    vat: { ...base.vat, ...(hospital?.vat || {}) },
  }
}

export const QUEUE_STATUSES = [
  { key: 'waiting', label: 'Waiting', tone: 'pending', row: 'warn' },
  { key: 'with_doctor', label: 'With doctor', tone: 'active', row: 'ok' },
  { key: 'at_pharmacy', label: 'At pharmacy', tone: 'info', row: 'info' },
  { key: 'at_cashier', label: 'At cashier', tone: 'pending', row: 'warn' },
  { key: 'pending_discharge', label: 'Pending discharge', tone: 'inactive', row: null },
]

export const STATUS_BY_KEY = Object.fromEntries(QUEUE_STATUSES.map((s) => [s.key, s]))

export const CLOSE_REASONS = [
  { key: 'discharged', label: 'Discharged' },
  { key: 'left', label: 'Left without completing' },
  { key: 'referred', label: 'Referred elsewhere' },
]
