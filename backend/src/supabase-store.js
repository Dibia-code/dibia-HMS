import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

let pool
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const supabaseCaPath = path.join(backendDir, 'certs', 'supabase-ca.crt')

function databaseUrl() {
  const url = new URL(process.env.DATABASE_URL)
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase() === 'sslmode') url.searchParams.delete(key)
  return url.toString()
}

const entityTables = {
  hospitals: { table: 'tenants', fields: { slug: 'slug', name: 'name', address: 'address', phone: 'phone', logoUrl: 'logo_url', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' } },
  branches: { table: 'branches', fields: { name: 'name', address: 'address', phone: 'phone', isMain: 'is_main', createdAt: 'created_at', updatedAt: 'updated_at' } },
  staff: { table: 'staff', fields: { name: 'name', email: 'email', phone: 'phone', profession: 'profession', active: 'active', pinHash: 'pin_hash', createdAt: 'created_at', updatedAt: 'updated_at' } },
  patients: { table: 'patients', fields: { dibiaId: 'dibia_id', firstName: 'first_name', lastName: 'last_name', dateOfBirth: 'date_of_birth', sex: 'sex', phone: 'phone', email: 'email', createdAt: 'created_at', updatedAt: 'updated_at', archivedAt: 'archived_at' } },
  visits: { table: 'visits', fields: { patientId: 'patient_id', status: 'status', clinicianId: 'clinician_id', openedAt: 'opened_at', closedAt: 'closed_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
  appointments: { table: 'appointments', fields: { patientId: 'patient_id', clinicianId: 'clinician_id', scheduledAt: 'scheduled_at', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' } },
  products: { table: 'products', fields: { barcode: 'barcode', name: 'name', category: 'category', unit: 'unit', quantity: 'quantity', reorderLevel: 'reorder_level', archived: 'archived', createdAt: 'created_at', updatedAt: 'updated_at' } },
  batches: { table: 'batches', fields: { productId: 'product_id', batchNo: 'batch_no', quantity: 'quantity', expiryDate: 'expiry_date', purchasePriceMinor: 'purchase_price_minor', sellingPriceMinor: 'selling_price_minor', createdAt: 'created_at', updatedAt: 'updated_at' } },
  customers: { table: 'customers', fields: { name: 'name', phone: 'phone', email: 'email', createdAt: 'created_at', updatedAt: 'updated_at' } },
  suppliers: { table: 'suppliers', fields: { name: 'name', phone: 'phone', email: 'email', createdAt: 'created_at', updatedAt: 'updated_at' } },
  sales: { table: 'sales', fields: { branchId: 'branch_id', customerId: 'customer_id', staffId: 'staff_id', totalMinor: 'total_minor', status: 'status', soldAt: 'sold_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
  purchase_orders: { table: 'purchase_orders', fields: { supplierId: 'supplier_id', branchId: 'branch_id', status: 'status', totalMinor: 'total_minor', orderedAt: 'ordered_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
  stock_movements: { table: 'stock_movements', fields: { branchId: 'branch_id', productId: 'product_id', batchId: 'batch_id', staffId: 'staff_id', quantityDelta: 'quantity_delta', movementType: 'movement_type', createdAt: 'created_at' } },
  transfers: { table: 'transfers', fields: { sourceBranchId: 'source_branch_id', destinationBranchId: 'destination_branch_id', requestedBy: 'requested_by', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' } },
  stock_counts: { table: 'stock_counts', fields: { branchId: 'branch_id', countedBy: 'counted_by', status: 'status', countedAt: 'counted_at', createdAt: 'created_at' } },
  prescriptions: { table: 'prescriptions', fields: { branchId: 'branch_id', patientId: 'patient_id', visitId: 'visit_id', prescribedBy: 'prescribed_by', status: 'status', prescribedAt: 'prescribed_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
  dispensings: { table: 'dispensings', fields: { branchId: 'branch_id', prescriptionId: 'prescription_id', patientId: 'patient_id', dispensedBy: 'dispensed_by', dispensedAt: 'dispensed_at', status: 'status' } },
  payments: { table: 'payments', fields: { branchId: 'branch_id', patientId: 'patient_id', visitId: 'visit_id', collectedBy: 'collected_by', amountMinor: 'amount_minor', method: 'method', status: 'status', paidAt: 'paid_at', createdAt: 'created_at' } },
  refunds: { table: 'refunds', fields: { branchId: 'branch_id', saleId: 'sale_id', paymentId: 'payment_id', refundedBy: 'refunded_by', amountMinor: 'amount_minor', reason: 'reason', refundedAt: 'refunded_at' } },
  expenses: { table: 'expenses', fields: { branchId: 'branch_id', createdBy: 'created_by', amountMinor: 'amount_minor', category: 'category', incurredAt: 'incurred_at', createdAt: 'created_at' } },
  hmo_claims: { table: 'hmo_claims', fields: { patientId: 'patient_id', visitId: 'visit_id', claimNo: 'claim_no', scheme: 'scheme', amountMinor: 'amount_minor', status: 'status', submittedAt: 'submitted_at' } },
  shift_reports: { table: 'shift_reports', fields: { branchId: 'branch_id', staffId: 'staff_id', submittedAt: 'submitted_at' } },
  complaints: { table: 'complaints', fields: { patientId: 'patient_id', visitId: 'visit_id', status: 'status', createdBy: 'created_by', createdAt: 'created_at' } },
  hr_actions: { table: 'hr_actions', fields: { staffId: 'staff_id', actionType: 'action_type', effectiveAt: 'effective_at', createdBy: 'created_by', createdAt: 'created_at' } },
  staff_payments: { table: 'staff_payments', fields: { staffId: 'staff_id', amountMinor: 'amount_minor', paymentStatus: 'payment_status', paidAt: 'paid_at', createdAt: 'created_at' } },
  devices: { table: 'devices', fields: { name: 'name', status: 'status', assignedStaffId: 'assigned_staff_id', createdAt: 'created_at', updatedAt: 'updated_at' } },
  audit_log: { table: 'audit_logs', fields: { actorId: 'actor_id', action: 'action', entity: 'entity', recordId: 'record_id', createdAt: 'created_at' } },
  settings: { table: 'hospital_settings', fields: { updatedAt: 'updated_at' } },
  staff_roles: { table: 'staff_roles', fields: { staffId: 'staff_id', role: 'role', createdAt: 'created_at' } },
}

const branchTables = new Set(['staff', 'patients', 'visits', 'appointments', 'products', 'batches', 'sales', 'purchase_orders', 'stock_movements', 'stock_counts', 'prescriptions', 'dispensings', 'payments', 'refunds', 'expenses', 'shift_reports'])
const updatedTables = new Set(['branches', 'staff', 'patients', 'visits', 'appointments', 'products', 'batches', 'customers', 'suppliers', 'sales', 'purchase_orders', 'transfers', 'prescriptions', 'devices'])
const deletedTables = new Set(['branches', ...Object.values(entityTables).map(({ table }) => table).filter((table) => !['tenants', 'hospital_settings', 'staff_roles'].includes(table))])
const privateAttributes = new Set(['password','passwordhash','pin','pinhash','token','refreshtoken','accesstoken','secret','apikey',['service','account'].join(''),'privatekey','credential'])

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Supabase Postgres')
  if (!fs.existsSync(supabaseCaPath)) throw new Error('Supabase CA certificate is required at backend/certs/supabase-ca.crt')
  pool ||= new Pool({
    connectionString: databaseUrl(),
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { ca: fs.readFileSync(supabaseCaPath), rejectUnauthorized: true },
  })
  return pool
}

export function query(text, values) {
  return getPool().query(text, values)
}

export async function transaction(callback) {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const result = await callback(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export function supabaseStatus() {
  let host = null
  try { host = new URL(process.env.SUPABASE_URL || '').host || null } catch {}
  return { enabled: Boolean(process.env.DATABASE_URL), host }
}

export async function checkSupabaseDatabase() {
  const result = await query(`
    select to_regclass('public.tenants') as tenants,
      to_regclass('public.sync_changes') as sync_changes,
      to_regclass('public.device_credentials') as device_credentials,
      exists(select 1 from pg_attribute where attrelid='public.profiles'::regclass and attname='must_change_password' and not attisdropped) as password_change_ready,
      exists(select 1 from pg_attribute where attrelid='public.devices'::regclass and attname='assigned_staff_id' and not attisdropped) as device_staff_ready
  `)
  const state = result.rows[0]
  if (!state?.tenants || !state?.sync_changes || !state?.device_credentials || !state?.password_change_ready || !state?.device_staff_ready) throw new Error('Supabase schema migration has not been applied')
  return true
}

export async function closeSupabaseDatabase() {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
}

export function toProfile(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.hospital_id,
    branchId: row.branch_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    roles: row.roles || [],
    active: row.active,
    permGrants: row.perm_grants || [],
    permDenies: row.perm_denies || [],
    mustChangePassword: row.must_change_password === true,
  }
}

export async function getProfile(userId) {
  const result = await query(`
    select p.*,
      coalesce(
        (select array_agg(pr.role order by pr.role) from public.profile_roles pr where pr.user_id = p.id and pr.hospital_id is not distinct from p.hospital_id),
        p.roles
      ) as roles
    from public.profiles p
    where p.id = $1
  `, [userId])
  return toProfile(result.rows[0])
}

export async function findProfileByEmail(email) {
  const result = await query('select * from public.profiles where lower(email) = lower($1) limit 1', [email])
  return toProfile(result.rows[0])
}

export async function getPlatformProfile(userId) {
  const result = await query("select * from public.profiles where id = $1 and active and roles @> array['platform_super_admin']::text[]", [userId])
  return toProfile(result.rows[0])
}

export async function getTenant(tenantId) {
  const result = await query('select * from public.tenants where id = $1', [tenantId])
  return tenantFromRow(result.rows[0])
}

export async function findTenantBySlug(slug) {
  const result = await query('select * from public.tenants where slug = $1', [slug])
  return tenantFromRow(result.rows[0])
}

export async function listTenants() {
  const result = await query('select * from public.tenants order by name')
  return result.rows.map(tenantFromRow)
}

export async function updateTenant(tenantId, values) {
  const fields = { name: 'name', address: 'address', phone: 'phone', status: 'status', logoUrl: 'logo_url' }
  const entries = Object.entries(values).filter(([key, value]) => fields[key] && value !== undefined)
  if (!entries.length) return getTenant(tenantId)
  const args = entries.map(([, value]) => value)
  const setters = entries.map(([key], index) => `${fields[key]} = $${index + 1}`)
  args.push(new Date().toISOString(), tenantId)
  await query(`update public.tenants set ${setters.join(', ')}, updated_at = $${args.length - 1} where id = $${args.length}`, args)
  return getTenant(tenantId)
}

function tenantFromRow(row) {
  if (!row) return null
  return { id: row.id, slug: row.slug, name: row.name, address: row.address, phone: row.phone, logoUrl: row.logo_url, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }
}

function branchFromRow(row) {
  if (!row) return null
  return { id: row.id, hospitalId: row.hospital_id, name: row.name, address: row.address, phone: row.phone, isMain: row.is_main, createdAt: row.created_at, updatedAt: row.updated_at }
}

function staffFromRow(row) {
  if (!row) return null
  return { ...row.attributes, id: row.id, hospitalId: row.hospital_id, branchId: row.branch_id, authUserId: row.auth_user_id, name: row.name, email: row.email, phone: row.phone, profession: row.profession, active: row.active, roles: row.roles || [], pinHash: row.pin_hash, createdAt: row.created_at, updatedAt: row.updated_at }
}

export async function getBranch(tenantId, branchId) {
  const result = await query('select * from public.branches where hospital_id = $1 and id = $2', [tenantId, branchId])
  return branchFromRow(result.rows[0])
}

export async function listBranches(tenantId) {
  const result = await query('select * from public.branches where hospital_id = $1 order by name', [tenantId])
  return result.rows.map(branchFromRow)
}

export async function getStaff(tenantId, staffId) {
  const result = await query("select s.*,coalesce(array_agg(sr.role) filter (where sr.role is not null),'{}') as roles from public.staff s left join public.staff_roles sr on sr.hospital_id=s.hospital_id and sr.staff_id=s.id where s.hospital_id=$1 and s.id=$2 and not s.is_deleted group by s.id", [tenantId, staffId])
  return staffFromRow(result.rows[0])
}

export async function listStaff(tenantId, activeOnly = false) {
  const result = await query("select s.*,coalesce(array_agg(sr.role) filter (where sr.role is not null),'{}') as roles from public.staff s left join public.staff_roles sr on sr.hospital_id=s.hospital_id and sr.staff_id=s.id where s.hospital_id=$1 and not s.is_deleted and ($2=false or s.active) group by s.id order by s.name", [tenantId, activeOnly])
  return result.rows.map(staffFromRow)
}

export async function findStaffByEmail(email) {
  const result = await query('select * from public.staff where lower(email) = lower($1) and not is_deleted limit 1', [email])
  return staffFromRow(result.rows[0])
}

export async function findStaffByPhone(phone) {
  const result = await query('select * from public.staff where phone = $1 and not is_deleted limit 1', [phone])
  return staffFromRow(result.rows[0])
}

export async function writeProfile(client, profile) {
  const roles = Array.isArray(profile.roles) ? profile.roles : []
  await client.query(`
    insert into public.profiles (id, hospital_id, branch_id, email, name, phone, roles, active, perm_grants, perm_denies, must_change_password)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,false))
    on conflict (id) do update set hospital_id = excluded.hospital_id, branch_id = excluded.branch_id, email = excluded.email, name = excluded.name, phone = excluded.phone, roles = excluded.roles, active = excluded.active, perm_grants = excluded.perm_grants, perm_denies = excluded.perm_denies, must_change_password = coalesce($11,public.profiles.must_change_password), updated_at = now()
  `, [profile.id, profile.tenantId || null, profile.branchId || null, profile.email, profile.name || '', profile.phone || null, roles, profile.active !== false, profile.permGrants || [], profile.permDenies || [], profile.mustChangePassword ?? null])
  await client.query('delete from public.profile_roles where user_id = $1', [profile.id])
  for (const role of roles) {
    const id = `${profile.id}:${profile.tenantId || 'platform'}:${role}`
    await client.query('insert into public.profile_roles (id,user_id,hospital_id,role) values ($1,$2,$3,$4) on conflict (user_id,hospital_id,role) do nothing', [id, profile.id, profile.tenantId || null, role])
  }
}

export async function writeStaff(client, staff) {
  const attrs = { ...staff }
  for (const key of ['id', 'hospitalId', 'tenantId', 'branchId', 'name', 'email', 'phone', 'profession', 'active', 'roles', 'authUserId', 'pinHash', 'createdAt', 'updatedAt', 'deleted']) delete attrs[key]
  await client.query(`
    insert into public.staff (id,hospital_id,branch_id,auth_user_id,name,email,phone,profession,active,pin_hash,is_deleted,attributes,created_at,updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,coalesce($13::timestamptz,now()),coalesce($14::timestamptz,now()))
    on conflict (id) do update set hospital_id=excluded.hospital_id,branch_id=excluded.branch_id,auth_user_id=coalesce(excluded.auth_user_id,public.staff.auth_user_id),name=excluded.name,email=excluded.email,phone=excluded.phone,profession=excluded.profession,active=excluded.active,pin_hash=excluded.pin_hash,is_deleted=excluded.is_deleted,attributes=excluded.attributes,updated_at=excluded.updated_at
  `, [staff.id, staff.hospitalId || staff.tenantId, staff.branchId || null, staff.authUserId || null, staff.name || '', staff.email || null, staff.phone || null, staff.profession || null, staff.active !== false, staff.pinHash || null, staff.deleted === true, JSON.stringify(attrs), staff.createdAt || null, staff.updatedAt || null])
}

function tableFor(entity) {
  const config = entityTables[entity]
  if (!config) throw new Error(`Unsupported data type: ${entity}`)
  return config
}

function relationData(entity, tenantId, recordId, payload, deleted) {
  const config = tableFor(entity)
  if (entity === 'hospitals') {
    const values = [recordId, payload.slug, payload.name, payload.address || null, payload.phone || null, payload.logoUrl || null, payload.status || 'pending', payload.createdAt || null, payload.updatedAt || null]
    return {
      table: config.table,
      sql: `insert into public.tenants (id,slug,name,address,phone,logo_url,status,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz,now()),coalesce($9::timestamptz,now())) on conflict (id) do update set slug=excluded.slug,name=excluded.name,address=excluded.address,phone=excluded.phone,logo_url=excluded.logo_url,status=excluded.status,updated_at=excluded.updated_at`,
      values,
    }
  }
  if (entity === 'settings') {
    return {
      table: config.table,
      sql: `insert into public.hospital_settings (hospital_id,id,value,updated_at) values ($1,$2,$3::jsonb,coalesce($4::timestamptz,now())) on conflict (hospital_id) do update set id=excluded.id,value=excluded.value,updated_at=excluded.updated_at`,
      values: [tenantId, recordId, JSON.stringify(payload.value || payload), payload.updatedAt || null],
    }
  }
  const fields = { ...config.fields }
  const columns = ['id', 'hospital_id']
  const values = [recordId, tenantId]
  const updates = []
  const add = (column, value) => {
    columns.push(column)
    values.push(value === undefined ? null : value)
    updates.push(`${column}=excluded.${column}`)
  }
  const common = new Set(['id', 'hospitalId', 'tenantId', 'branchId', 'deleted', ...Object.keys(config.fields)])
  const attributes = {}
  for (const [key, value] of Object.entries(payload)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
    if (!common.has(key) && !privateAttributes.has(normalized)) attributes[key] = value
  }
  if (branchTables.has(config.table) && !Object.hasOwn(fields, 'branchId')) add('branch_id', payload.branchId || null)
  if (config.table !== 'staff_roles') add('is_deleted', deleted)
  for (const [key, column] of Object.entries(fields)) {
    if (Object.hasOwn(payload, key)) add(column, payload[key])
  }
  if (config.table === 'staff') {
    add('auth_user_id', payload.authUserId || null)
    add('attributes', JSON.stringify(attributes))
  } else if (!['branches', 'audit_logs', 'staff_roles'].includes(config.table)) {
    add('attributes', JSON.stringify(attributes))
  } else if (config.table === 'audit_logs') {
    add('metadata', JSON.stringify(payload.metadata || {}))
  }
  const placeholders = values.map((_, index) => `$${index + 1}`)
  const conflict = 'id'
  const updateAssignments = updatedTables.has(config.table)
    ? [...updates.filter((assignment) => !assignment.startsWith('updated_at=')), 'updated_at = now()']
    : updates
  if (config.table === 'staff') {
    const authAssignment = updateAssignments.findIndex((assignment) => assignment.startsWith('auth_user_id='))
    if (authAssignment !== -1) updateAssignments[authAssignment] = 'auth_user_id=coalesce(excluded.auth_user_id,public.staff.auth_user_id)'
  }
  const updateSql = updateAssignments.length ? `do update set ${updateAssignments.join(', ')}` : 'do nothing'
  const sql = `insert into public.${config.table} (${columns.join(',')}) values (${placeholders.join(',')}) on conflict (${conflict}) ${updateSql}`
  return { sql, values, table: config.table }
}

export async function saveDomainRecord(client, tenantId, entity, recordId, payload, deleted = false) {
  if (entity === 'staff_roles' && deleted) {
    await client.query('delete from public.staff_roles where hospital_id=$1 and id=$2', [tenantId, recordId])
    return
  }
  const result = relationData(entity, tenantId, recordId, payload, deleted)
  await client.query(result.sql, result.values)
}

export async function getDomainRecord(tenantId, entity, recordId, client = getPool()) {
  const { table } = tableFor(entity)
  if (entity === 'hospitals') {
    const result = await client.query('select * from public.tenants where id = $1', [recordId])
    return result.rows[0] ? payloadFromRow(entity, result.rows[0]) : null
  }
  const result = await client.query(`select * from public.${table} where hospital_id = $1 and id = $2`, [tenantId, recordId])
  return result.rows[0] ? payloadFromRow(entity, result.rows[0]) : null
}

export async function listDomainRecords(tenantId, entity, filters = {}, client = getPool()) {
  const { table } = tableFor(entity)
  if (entity === 'hospitals') {
    const result = await client.query('select * from public.tenants where id = $1', [tenantId])
    return result.rows.map((row) => payloadFromRow(entity, row))
  }
  if (entity === 'settings') {
    const result = await client.query('select * from public.hospital_settings where hospital_id = $1', [tenantId])
    return result.rows.map((row) => ({ id: row.id, hospitalId: row.hospital_id, value: row.value, updatedAt: row.updated_at }))
  }
  const values = [tenantId]
  const where = ['hospital_id = $1']
  for (const [key, value] of Object.entries(filters)) {
    const column = tableFor(entity).fields[key]
    if (!column) throw new Error(`Unsupported ${entity} filter: ${key}`)
    values.push(value)
    where.push(`${column} = $${values.length}`)
  }
  if (deletedTables.has(table)) where.push('not is_deleted')
  const result = await client.query(`select * from public.${table} where ${where.join(' and ')} order by id`, values)
  return result.rows.map((row) => payloadFromRow(entity, row))
}

export async function listDomainRecordsAfter(tenantId, entity, afterId = '', limit = 200, client = getPool()) {
  if (entity === 'hospitals') {
    if (tenantId <= afterId) return []
    const result = await client.query('select * from public.tenants where id=$1 limit $2', [tenantId, Math.max(1, limit)])
    return result.rows.map((row) => payloadFromRow(entity, row))
  }
  if (entity === 'settings') {
    const result = await client.query('select * from public.hospital_settings where hospital_id=$1 and id>$2 order by id limit $3', [tenantId, afterId, Math.max(1, limit)])
    return result.rows.map((row) => ({ id: row.id, hospitalId: row.hospital_id, value: row.value, updatedAt: row.updated_at }))
  }
  const { table } = tableFor(entity)
  const values = [tenantId, afterId, Math.max(1, limit)]
  const deleted = deletedTables.has(table) ? ' and not is_deleted' : ''
  const result = await client.query(`select * from public.${table} where hospital_id=$1 and id>$2${deleted} order by id limit $3`, values)
  return result.rows.map((row) => payloadFromRow(entity, row))
}

function payloadFromRow(entity, row) {
  const config = tableFor(entity)
  if (entity === 'settings') return { id: row.id, hospitalId: row.hospital_id, value: row.value, updatedAt: row.updated_at }
  const value = { ...(row.attributes || {}), id: row.id }
  if (entity === 'hospitals') value.hospitalId = row.id
  else value.hospitalId = row.hospital_id
  for (const [key, column] of Object.entries(config.fields)) {
    if (row[column] !== null && row[column] !== undefined) value[key] = row[column]
  }
  if (entity === 'audit_log') value.metadata = row.metadata || {}
  if (row.branch_id) value.branchId = row.branch_id
  if (row.is_deleted) value.deleted = true
  return value
}

export async function appendSyncChange(client, tenantId, entity, recordId, operation, payload, actorId) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId])
  const current = await client.query('select coalesce(max(sequence), 0)::bigint as sequence from public.sync_changes where hospital_id = $1', [tenantId])
  const sequence = Number(current.rows[0].sequence) + 1
  await client.query('insert into public.sync_changes (hospital_id,sequence,entity,record_id,operation,payload) values ($1,$2,$3,$4,$5,$6::jsonb)', [tenantId, sequence, entity, recordId, operation, payload == null ? null : JSON.stringify(payload)])
  return sequence
}
