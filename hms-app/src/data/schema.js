// IndexedDB schema for the offline-first store (§6).
//
// Every domain record is tenant-scoped by `hospitalId` and most are further
// scoped by `branchId` (§3) — enforced in the repository query layer, not just
// the router. Bump DB_VERSION and add an upgrade branch in db.js when changing.

export const DB_NAME = 'dibia'
export const DB_VERSION = 6

// name → { keyPath, autoIncrement?, indexes: [{ name, keyPath, unique? }] }
export const STORES = {
  // The tenants themselves. Slug is the /:hospitalSlug in the URL.
  hospitals: {
    keyPath: 'id',
    // Existing offline databases can contain duplicate legacy/demo slugs.
    // Tenant slug uniqueness is enforced by the backend; keeping this local
    // lookup index non-unique lets upgrades preserve those cached records.
    indexes: [{ name: 'by_slug', keyPath: 'slug' }],
  },
  branches: {
    keyPath: 'id',
    indexes: [{ name: 'by_hospital', keyPath: 'hospitalId' }],
  },
  // Staff account. NO role column here — roles live in staff_roles (many-to-many).
  staff: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_email', keyPath: 'email' },
    ],
  },
  // The many-to-many join: one row per (staff, role). Matches the chip picker.
  staff_roles: {
    keyPath: 'id',
    indexes: [
      { name: 'by_staff', keyPath: 'staffId' },
      { name: 'by_role', keyPath: 'role' },
    ],
  },
  products: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_branch', keyPath: 'branchId' },
      { name: 'by_barcode', keyPath: 'barcode' },
    ],
  },
  customers: {
    keyPath: 'id',
    indexes: [{ name: 'by_hospital', keyPath: 'hospitalId' }],
  },
  suppliers: {
    keyPath: 'id',
    indexes: [{ name: 'by_hospital', keyPath: 'hospitalId' }],
  },
  purchase_orders: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_supplier', keyPath: 'supplierId' },
    ],
  },
  // Sales are the transactions that MUST NOT duplicate on reconnect (§6).
  sales: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_branch', keyPath: 'branchId' },
    ],
  },
  refunds: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_sale', keyPath: 'saleId' },
    ],
  },
  expenses: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_branch', keyPath: 'branchId' },
    ],
  },
  stock_counts: {
    keyPath: 'id',
    indexes: [{ name: 'by_hospital', keyPath: 'hospitalId' }],
  },
  transfers: {
    keyPath: 'id',
    indexes: [{ name: 'by_hospital', keyPath: 'hospitalId' }],
  },
  // Staff App "Submit Report" lands here → management Reports → closing sessions.
  shift_reports: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_branch', keyPath: 'branchId' },
    ],
  },
  audit_log: {
    keyPath: 'id',
    indexes: [{ name: 'by_hospital', keyPath: 'hospitalId' }],
  },

  // Hospital modules (PRD v1.1): patient identity, visits, and receipts.
  patients: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_dibia_id', keyPath: 'dibiaId' },
    ],
  },
  visits: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_branch', keyPath: 'branchId' },
      { name: 'by_patient', keyPath: 'patientId' },
    ],
  },
  // Pharmacy (PRD section 7): batches, every stock movement, prescriptions,
  // dispensing records, HMO claim batches and cashier shift reconciliations.
  batches: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_product', keyPath: 'productId' },
      { name: 'by_branch', keyPath: 'branchId' },
    ],
  },
  stock_movements: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_product', keyPath: 'productId' },
      { name: 'by_branch', keyPath: 'branchId' },
    ],
  },
  prescriptions: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_branch', keyPath: 'branchId' },
      { name: 'by_visit', keyPath: 'visitId' },
    ],
  },
  dispensings: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_branch', keyPath: 'branchId' },
      { name: 'by_prescription', keyPath: 'prescriptionId' },
    ],
  },
  devices: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_token', keyPath: 'token' },
    ],
  },
  hmo_claims: {
    keyPath: 'id',
    indexes: [{ name: 'by_hospital', keyPath: 'hospitalId' }],
  },
  // Receipts. Both payments and refunds live here (type discriminates) so a
  // visit's money trail is one list, never edited, only appended to.
  payments: {
    keyPath: 'id',
    indexes: [
      { name: 'by_hospital', keyPath: 'hospitalId' },
      { name: 'by_branch', keyPath: 'branchId' },
      { name: 'by_visit', keyPath: 'visitId' },
    ],
  },

  // --- infrastructure stores (not tenant domain data) ---

  // The sync queue. autoIncrement seq preserves order; opId is the idempotency
  // key (== the record's own uuid) the server dedupes on.
  outbox: {
    keyPath: 'seq',
    autoIncrement: true,
    indexes: [
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_opId', keyPath: 'opId' },
    ],
  },
  // Misc key/value: seed flag, cached session, last-sync timestamp.
  meta: { keyPath: 'key' },
}

// Domain stores that carry a hospitalId (used for tenant-scoped helpers/reset).
export const TENANT_STORES = Object.entries(STORES)
  .filter(([, def]) => def.indexes?.some((i) => i.name === 'by_hospital'))
  .map(([name]) => name)
