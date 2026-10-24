import { ROLE } from './roles'

// Capabilities — one permission per protected action/route. Guards and sidebar
// filtering read these (never a raw role check), so "access = union of roles".
export const PERM = {
  DASHBOARD_VIEW: 'dashboard.view',
  DASHBOARD_ADMIN: 'dashboard.admin',
  PATIENTS_MANAGE: 'patients.manage',
  QUEUE_VIEW: 'queue.view',
  QUEUE_MANAGE: 'queue.manage',
  BILLING_COLLECT: 'billing.collect',
  BILLING_VIEW: 'billing.view',
  BILLING_EDIT: 'billing.edit',
  BILLING_REFUND: 'billing.refund',
  DISPENSE: 'pharmacy.dispense',
  PHARMACY_APPROVE: 'pharmacy.approve',
  AUDIT_VIEW: 'audit.view',
  HMO_MANAGE: 'hmo.manage',
  POS_SELL: 'pos.sell',
  POS_REFUND: 'pos.refund',
  REPORT_SUBMIT: 'report.submit', // staff end-of-shift reconciliation
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  PURCHASING_MANAGE: 'purchasing.manage',
  BRANCHES_MANAGE: 'branches.manage',
  WAREHOUSE_MANAGE: 'warehouse.manage',
  STAFF_MANAGE: 'staff.manage',
  STOCKTAKING_MANAGE: 'stocktaking.manage',
  STOCKTAKING_APPROVE: 'stocktaking.approve',
  EXPENSES_MANAGE: 'expenses.manage',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  REPORTS_VIEW: 'reports.view',
  // Split settings access two ways: any staff member may pair devices and print
  // receipts (SETTINGS_DEVICES), but only the CEO/Owner may edit the receipt
  // template and business configuration (SETTINGS_MANAGE).
  SETTINGS_DEVICES: 'settings.devices',
  SETTINGS_MANAGE: 'settings.manage',
  SUBSCRIPTION_MANAGE: 'subscription.manage',
  CEO_VIEW: 'ceo.view',
}

const ALL_PERMS = Object.values(PERM)

// Role → permissions (FRONTEND_SPEC §5). The single place to tune the matrix —
// adjust freely once the backend team confirms it.
export const ROLE_PERMISSIONS = {
  // Full access — spec §4: "CEO/Owner effectively has access to everything."
  [ROLE.CEO_OWNER]: [...ALL_PERMS],
  [ROLE.SUPER_ADMIN]: [...ALL_PERMS],
  [ROLE.FACILITY_ADMIN]: [...ALL_PERMS],

  [ROLE.BRANCH_MANAGER]: [
    PERM.DISPENSE, PERM.AUDIT_VIEW, PERM.HMO_MANAGE,
    PERM.DASHBOARD_VIEW,
    PERM.PATIENTS_MANAGE, PERM.QUEUE_VIEW, PERM.QUEUE_MANAGE,
    PERM.BILLING_VIEW, PERM.BILLING_COLLECT, PERM.BILLING_EDIT, PERM.BILLING_REFUND,
    PERM.POS_SELL, PERM.POS_REFUND,
    PERM.INVENTORY_VIEW, PERM.INVENTORY_MANAGE,
    PERM.PURCHASING_MANAGE,
    PERM.STOCKTAKING_MANAGE, PERM.STOCKTAKING_APPROVE,
    PERM.EXPENSES_MANAGE,
    PERM.CUSTOMERS_VIEW, PERM.CUSTOMERS_MANAGE,
    PERM.REPORTS_VIEW,
    PERM.STAFF_MANAGE,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.SUPERINTENDENT_PHARMACIST]: [
    PERM.DISPENSE, PERM.PHARMACY_APPROVE,
    PERM.DASHBOARD_VIEW, PERM.INVENTORY_VIEW, PERM.INVENTORY_MANAGE,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.PHARMACIST]: [
    PERM.DISPENSE,
    PERM.DASHBOARD_VIEW,
    PERM.INVENTORY_VIEW, PERM.INVENTORY_MANAGE,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.INVENTORY_OFFICER]: [
    PERM.DASHBOARD_VIEW,
    PERM.INVENTORY_VIEW, PERM.INVENTORY_MANAGE,
    PERM.PURCHASING_MANAGE,
    PERM.STOCKTAKING_MANAGE,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.WAREHOUSE_OFFICER]: [
    PERM.DASHBOARD_VIEW,
    PERM.WAREHOUSE_MANAGE,
    PERM.INVENTORY_VIEW,
    PERM.STOCKTAKING_MANAGE,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.ACCOUNTANT]: [
    PERM.AUDIT_VIEW, PERM.HMO_MANAGE,
    PERM.DASHBOARD_VIEW, PERM.BILLING_VIEW,
    PERM.EXPENSES_MANAGE,
    PERM.REPORTS_VIEW,
    PERM.CUSTOMERS_VIEW, PERM.CUSTOMERS_MANAGE,
    PERM.SUBSCRIPTION_MANAGE,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.SALES_STAFF]: [
    PERM.DASHBOARD_VIEW,
    PERM.POS_SELL,
    PERM.INVENTORY_VIEW,
    PERM.CUSTOMERS_VIEW,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.RECEPTIONIST]: [
    PERM.DASHBOARD_VIEW,
    PERM.PATIENTS_MANAGE, PERM.QUEUE_VIEW, PERM.QUEUE_MANAGE,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.PHARMACY_CASHIER]: [
    PERM.DASHBOARD_VIEW, PERM.DISPENSE, PERM.POS_SELL, PERM.POS_REFUND,
    PERM.INVENTORY_VIEW, PERM.INVENTORY_MANAGE, PERM.REPORT_SUBMIT, PERM.SETTINGS_DEVICES,
  ],

  [ROLE.DISPENSER]: [
    PERM.DISPENSE,
    PERM.DASHBOARD_VIEW, PERM.INVENTORY_VIEW, PERM.INVENTORY_MANAGE,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.CASHIER]: [
    PERM.DASHBOARD_VIEW, PERM.PATIENTS_MANAGE, PERM.QUEUE_VIEW, PERM.QUEUE_MANAGE,
    PERM.BILLING_COLLECT, PERM.BILLING_VIEW, PERM.BILLING_EDIT, PERM.BILLING_REFUND,
    PERM.REPORT_SUBMIT,
    PERM.SETTINGS_DEVICES,
  ],

  [ROLE.DOCTOR]: [PERM.DASHBOARD_VIEW, PERM.PATIENTS_MANAGE, PERM.QUEUE_VIEW, PERM.QUEUE_MANAGE],
  [ROLE.NURSE]: [PERM.DASHBOARD_VIEW, PERM.PATIENTS_MANAGE, PERM.QUEUE_VIEW, PERM.QUEUE_MANAGE],
  [ROLE.LABORATORY_TECHNICIAN]: [PERM.DASHBOARD_VIEW, PERM.PATIENTS_MANAGE, PERM.QUEUE_VIEW],
}

// Union of permissions across every role the account holds. Returns a Set.
export function permissionsFor(roleSlugs = []) {
  const set = new Set()
  for (const slug of roleSlugs) {
    const perms = ROLE_PERMISSIONS[slug]
    if (perms) for (const p of perms) set.add(p)
  }
  return set
}

// can(perms, need): perms is a Set (from permissionsFor). `need` may be a single
// permission or an array — array means "any-of" (matches route guards below).
export function can(perms, need) {
  if (!need) return true
  const list = Array.isArray(need) ? need : [need]
  return list.some((p) => perms.has(p))
}

export function landingPath() {
  return 'dashboard'
}
