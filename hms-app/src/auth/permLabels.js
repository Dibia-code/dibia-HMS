import { PERM } from './permissions'

export const PERM_GROUPS = [
  { group: 'Reception', items: [[PERM.PATIENTS_MANAGE, 'Register patients and open visits'], [PERM.QUEUE_VIEW, 'See the queue'], [PERM.QUEUE_MANAGE, 'Change queue routing and status']] },
  { group: 'Cashier', items: [[PERM.BILLING_COLLECT, 'Collect payments'], [PERM.BILLING_VIEW, 'View bills and receipts'], [PERM.BILLING_REFUND, 'Refund payments'], [PERM.REPORT_SUBMIT, 'Close a shift']] },
  { group: 'Pharmacy', items: [[PERM.DISPENSE, 'Dispense prescriptions'], [PERM.PHARMACY_APPROVE, 'Approve controlled drugs and overrides'], [PERM.POS_SELL, 'Sell over the counter'], [PERM.POS_REFUND, 'Refund a sale'], [PERM.INVENTORY_VIEW, 'View inventory'], [PERM.INVENTORY_MANAGE, 'Manage inventory and batches'], [PERM.PURCHASING_MANAGE, 'Purchasing'], [PERM.STOCKTAKING_MANAGE, 'Stocktaking'], [PERM.WAREHOUSE_MANAGE, 'Warehouse']] },
  { group: 'Admin', items: [[PERM.DASHBOARD_ADMIN, 'Hospital dashboard'], [PERM.STAFF_MANAGE, 'Manage staff'], [PERM.AUDIT_VIEW, 'View the audit trail'], [PERM.HMO_MANAGE, 'HMO receivables and claims'], [PERM.REPORTS_VIEW, 'Reports'], [PERM.EXPENSES_MANAGE, 'Expenses'], [PERM.BRANCHES_MANAGE, 'Branches'], [PERM.SETTINGS_MANAGE, 'Hospital settings'], [PERM.SUBSCRIPTION_MANAGE, 'Usage and billing']] },
]
