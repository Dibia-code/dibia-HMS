// The staff roles (FRONTEND_SPEC §4, extended for the HMS PRD v1.1). A staff account holds MANY at once
// (many-to-many via staff_roles); access is the UNION across all held roles —
// there is no single "role" column. Order here drives the chip picker.

export const ROLE = {
  SUPER_ADMIN: 'super_admin',
  FACILITY_ADMIN: 'facility_admin',
  CEO_OWNER: 'ceo_owner',
  BRANCH_MANAGER: 'branch_manager',
  PHARMACIST: 'pharmacist',
  SUPERINTENDENT_PHARMACIST: 'superintendent_pharmacist',
  RECEPTIONIST: 'receptionist',
  CASHIER: 'cashier',
  DISPENSER: 'dispenser',
  PHARMACY_CASHIER: 'pharmacy_cashier',
  INVENTORY_OFFICER: 'inventory_officer',
  SALES_STAFF: 'sales_staff',
  ACCOUNTANT: 'accountant',
  WAREHOUSE_OFFICER: 'warehouse_officer',
}

// Ordered list; label = exact UI text.
export const ROLES = [
  { slug: ROLE.SUPER_ADMIN, label: 'Super Admin' },
  { slug: ROLE.FACILITY_ADMIN, label: 'Hospital Admin' },
  { slug: ROLE.CEO_OWNER, label: 'CEO / Owner' },
  { slug: ROLE.BRANCH_MANAGER, label: 'Branch Manager' },
  { slug: ROLE.PHARMACIST, label: 'Pharmacist' },
  { slug: ROLE.SUPERINTENDENT_PHARMACIST, label: 'Superintendent Pharmacist' },
  { slug: ROLE.RECEPTIONIST, label: 'Receptionist' },
  { slug: ROLE.CASHIER, label: 'Cashier' },
  { slug: ROLE.DISPENSER, label: 'Dispenser / Technician' },
  { slug: ROLE.PHARMACY_CASHIER, label: 'Pharmacy Cashier' },
  { slug: ROLE.INVENTORY_OFFICER, label: 'Inventory Officer' },
  { slug: ROLE.SALES_STAFF, label: 'Sales Staff' },
  { slug: ROLE.ACCOUNTANT, label: 'Accountant' },
  { slug: ROLE.WAREHOUSE_OFFICER, label: 'Warehouse Officer' },
]

const LABEL_BY_SLUG = Object.fromEntries(ROLES.map((r) => [r.slug, r.label]))

export function roleLabel(slug) {
  return LABEL_BY_SLUG[slug] || slug
}

export function isRole(slug) {
  return slug in LABEL_BY_SLUG
}
