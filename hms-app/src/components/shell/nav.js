import { PERM } from '@/auth/permissions'

export const MODULES = {
  overview: { label: 'Dashboard', accent: 'var(--muted-4)' },
  reception: { label: 'Reception', accent: 'var(--mod-reception)' },
  cashier: { label: 'Cashier', accent: 'var(--mod-cashier)' },
  pharmacy: { label: 'Pharmacy', accent: 'var(--mod-pharmacy)' },
  admin: { label: 'Admin', accent: 'var(--mod-admin)' },
}

export const NAV = [
  {
    module: 'overview',
    items: [{ to: 'dashboard', label: 'Dashboard', icon: 'dashboard', perm: PERM.DASHBOARD_VIEW, bottom: true }],
  },
  {
    module: 'reception',
    label: 'Reception',
    items: [
      { to: 'reception', label: 'Register patient', icon: 'userPlus', perm: PERM.PATIENTS_MANAGE, bottom: true },
      { to: 'queue', label: 'Queue', icon: 'queue', perm: PERM.QUEUE_VIEW, bottom: true },
    ],
  },
  {
    module: 'cashier',
    label: 'Cashier',
    items: [
      { to: 'cashier', label: 'New payment', icon: 'payment', perm: PERM.BILLING_COLLECT, bottom: true },
      { to: 'bills', label: 'Bills and receipts', icon: 'receipt', perm: PERM.BILLING_VIEW, bottom: true },
      { to: 'report', label: 'Close shift', icon: 'report', perm: PERM.REPORT_SUBMIT },
    ],
  },
  {
    module: 'pharmacy',
    label: 'Pharmacy',
    items: [
      { to: 'dispensing', label: 'Dispensing', icon: 'pill', perm: PERM.DISPENSE, bottom: true },
      { to: 'pos', label: 'Sell over the counter', icon: 'pos', perm: PERM.POS_SELL, bottom: true },
      { to: 'inventory', label: 'Inventory', icon: 'inventory', perm: PERM.INVENTORY_VIEW, bottom: true },
      { to: 'refund', label: 'Sale refund', icon: 'refund', perm: PERM.POS_REFUND },
      { to: 'customers', label: 'Credit accounts', icon: 'customers', perm: PERM.CUSTOMERS_VIEW },
      { to: 'purchasing', label: 'Purchasing', icon: 'purchasing', perm: PERM.PURCHASING_MANAGE },
      { to: 'stocktaking', label: 'Stocktaking', icon: 'stocktaking', perm: [PERM.STOCKTAKING_MANAGE, PERM.STOCKTAKING_APPROVE] },
      { to: 'warehouse', label: 'Warehouse', icon: 'warehouse', perm: PERM.WAREHOUSE_MANAGE },
    ],
  },
  {
    module: 'admin',
    label: 'Admin',
    items: [
      { to: 'hmo', label: 'HMO receivables', icon: 'receipt', perm: PERM.HMO_MANAGE },
      { to: 'audit', label: 'Audit trail', icon: 'activity', perm: PERM.AUDIT_VIEW },
      { to: 'devices', label: 'Devices', icon: 'monitor', perm: PERM.SETTINGS_MANAGE },
      { to: 'staff', label: 'Staff', icon: 'staff', perm: PERM.STAFF_MANAGE },
      { to: 'branches', label: 'Branches', icon: 'branches', perm: PERM.BRANCHES_MANAGE },
      { to: 'expenses', label: 'Expenses', icon: 'expenses', perm: PERM.EXPENSES_MANAGE },
      { to: 'reports', label: 'Reports', icon: 'reports', perm: PERM.REPORTS_VIEW },
      { to: 'subscription', label: 'Usage and billing', icon: 'subscription', perm: PERM.SUBSCRIPTION_MANAGE },
      { to: 'ceo', label: 'CEO view', icon: 'ceo', perm: PERM.CEO_VIEW },
      { to: 'settings', label: 'Settings', icon: 'settings', perm: PERM.SETTINGS_DEVICES },
    ],
  },
]

const ROUTE_MODULE = new Map()
for (const section of NAV) for (const item of section.items) ROUTE_MODULE.set(item.to, section.module)
ROUTE_MODULE.set('home', 'pharmacy')

export function moduleForRoute(segment, can) {
  if (segment === 'dashboard' || !segment) {
    if (can(PERM.DASHBOARD_ADMIN)) return 'admin'
    if (can(PERM.PATIENTS_MANAGE)) return 'reception'
    if (can(PERM.BILLING_COLLECT)) return 'cashier'
    return 'pharmacy'
  }
  return ROUTE_MODULE.get(segment) || 'admin'
}

const ITEM_MODULE = {
  reception: 'reception', queue: 'queue', cashier: 'cashier', bills: 'cashier',
  dispensing: 'pharmacy', pos: 'pharmacy', inventory: 'inventory', purchasing: 'inventory',
  stocktaking: 'inventory', warehouse: 'inventory', refund: 'pharmacy', customers: 'inventory',
  hmo: 'billing', expenses: 'billing', reports: 'reports',
}

export function visibleNav(can, moduleCodes, backendEnabled = false) {
  return NAV.map((s) => ({ ...s, items: s.items.filter((it) => {
    if (!can(it.perm)) return false
    const required = ITEM_MODULE[it.to]
    return !backendEnabled || !required || moduleCodes?.includes(required)
  }) })).filter((s) => s.items.length > 0)
}
