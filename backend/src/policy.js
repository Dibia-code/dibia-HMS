const ALL = new Set([
  'dashboard.view', 'dashboard.admin', 'patients.manage', 'queue.view', 'queue.manage',
  'billing.collect', 'billing.view', 'billing.refund', 'pharmacy.dispense', 'pharmacy.approve',
  'audit.view', 'hmo.manage', 'pos.sell', 'pos.refund', 'report.submit', 'inventory.view',
  'inventory.manage', 'purchasing.manage', 'branches.manage', 'warehouse.manage', 'staff.manage',
  'stocktaking.manage', 'stocktaking.approve', 'expenses.manage', 'customers.view', 'customers.manage',
  'reports.view', 'settings.devices', 'settings.manage', 'subscription.manage', 'ceo.view',
])

const ROLE_PERMISSIONS = {
  facility_admin: ALL,
  ceo_owner: ALL,
  super_admin: ALL,
  branch_manager: new Set(['pharmacy.dispense', 'audit.view', 'hmo.manage', 'dashboard.view', 'patients.manage', 'queue.view', 'queue.manage', 'billing.view', 'billing.collect', 'billing.refund', 'pos.sell', 'pos.refund', 'inventory.view', 'inventory.manage', 'purchasing.manage', 'stocktaking.manage', 'stocktaking.approve', 'expenses.manage', 'customers.view', 'customers.manage', 'reports.view', 'staff.manage', 'settings.devices']),
  superintendent_pharmacist: new Set(['pharmacy.dispense', 'pharmacy.approve', 'dashboard.view', 'queue.view', 'pos.sell', 'pos.refund', 'inventory.view', 'inventory.manage', 'purchasing.manage', 'stocktaking.manage', 'stocktaking.approve', 'customers.view', 'customers.manage', 'reports.view', 'settings.devices']),
  pharmacist: new Set(['pharmacy.dispense', 'pharmacy.approve', 'dashboard.view', 'queue.view', 'pos.sell', 'inventory.view', 'inventory.manage', 'customers.view', 'reports.view', 'settings.devices']),
  inventory_officer: new Set(['dashboard.view', 'inventory.view', 'inventory.manage', 'purchasing.manage', 'stocktaking.manage', 'settings.devices']),
  warehouse_officer: new Set(['dashboard.view', 'warehouse.manage', 'inventory.view', 'stocktaking.manage', 'settings.devices']),
  accountant: new Set(['audit.view', 'hmo.manage', 'dashboard.view', 'billing.view', 'expenses.manage', 'reports.view', 'customers.view', 'customers.manage', 'subscription.manage', 'settings.devices']),
  sales_staff: new Set(['dashboard.view', 'pos.sell', 'inventory.view', 'customers.view', 'settings.devices']),
  receptionist: new Set(['dashboard.view', 'patients.manage', 'queue.view', 'queue.manage', 'settings.devices']),
  pharmacy_cashier: new Set(['dashboard.view', 'billing.collect', 'billing.view', 'queue.view', 'pos.sell', 'pos.refund', 'inventory.view', 'report.submit', 'settings.devices']),
  dispenser: new Set(['pharmacy.dispense', 'dashboard.view', 'queue.view', 'pos.sell', 'inventory.view', 'settings.devices']),
  cashier: new Set(['dashboard.view', 'billing.collect', 'billing.view', 'billing.refund', 'queue.view', 'pos.sell', 'pos.refund', 'inventory.view', 'report.submit', 'settings.devices']),
  doctor: new Set(['dashboard.view', 'patients.manage', 'queue.view', 'queue.manage', 'pharmacy.dispense']),
  nurse: new Set(['dashboard.view', 'patients.manage', 'queue.view', 'queue.manage']),
  laboratory_technician: new Set(['dashboard.view', 'patients.manage', 'queue.view']),
}

const REQUIRED_BY_ENTITY = {
  patients: ['patients.manage'],
  visits: ['patients.manage', 'queue.manage'],
  appointments: ['patients.manage', 'queue.manage'],
  payments: ['billing.collect'],
  sales: ['pos.sell'],
  products: ['inventory.manage'],
  batches: ['inventory.manage'],
  stock_movements: ['inventory.manage', 'pos.sell'],
  prescriptions: ['pharmacy.dispense'],
  dispensings: ['pharmacy.dispense'],
  refunds: ['billing.refund', 'pos.refund'],
  expenses: ['expenses.manage'],
  customers: ['customers.manage'],
  suppliers: ['purchasing.manage'],
  purchase_orders: ['purchasing.manage'],
  transfers: ['warehouse.manage'],
  stock_counts: ['stocktaking.manage'],
  hmo_claims: ['hmo.manage'],
  devices: ['settings.devices'],
  shift_reports: ['report.submit'],
  complaints: ['patients.manage', 'queue.manage'],
  hr_actions: ['staff.manage'],
  staff_payments: ['staff.manage'],
  settings: ['settings.manage'],
  audit_log: [],
}

const PRIVATE_KEYS = new Set(['password', 'passwordhash', 'pin', 'pinhash', 'token', 'refreshtoken', 'accesstoken', 'secret'])

export function sanitizeSyncPayload(value, depth = 0) {
  if (depth > 24) throw new Error('Record nesting is too deep')
  if (Array.isArray(value)) return value.map((item) => sanitizeSyncPayload(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const clean = {}
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ''))) continue
    clean[key] = sanitizeSyncPayload(child, depth + 1)
  }
  return clean
}

export function canWriteEntity({ entity, operation, roles = [], grants = [], denies = [] }) {
  const admin = roles.some((role) => ['facility_admin', 'ceo_owner', 'super_admin'].includes(role))
  if (operation === 'delete' && !admin) return false
  if (entity === 'audit_log') return operation === 'create'
  const required = REQUIRED_BY_ENTITY[entity]
  if (!required) return false
  const held = new Set()
  for (const role of roles) for (const permission of ROLE_PERMISSIONS[role] || []) held.add(permission)
  for (const permission of grants) if (typeof permission === 'string') held.add(permission)
  for (const permission of denies) held.delete(permission)
  return required.some((permission) => held.has(permission))
}
