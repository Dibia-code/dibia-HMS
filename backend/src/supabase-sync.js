import { appendSyncChange, getBranch, getDomainRecord, getProfile, getStaff, listDomainRecordsAfter, query, saveDomainRecord, transaction } from './supabase-store.js'
import { canWriteEntity, hasPermission, sanitizeSyncPayload } from './policy.js'

const tenantEntities = ['hospitals', 'branches', 'staff', 'staff_roles', 'patients', 'visits', 'appointments', 'payments', 'sales', 'products', 'batches', 'stock_movements', 'prescriptions', 'dispensings', 'refunds', 'expenses', 'customers', 'suppliers', 'purchase_orders', 'transfers', 'stock_counts', 'hmo_claims', 'devices', 'shift_reports', 'audit_log', 'complaints', 'hr_actions', 'staff_payments', 'settings']
const stableValue = (value) => Array.isArray(value) ? value.map(stableValue) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])) : value

async function existingBootstrapCreate(entity, tenantId, recordId, payload) {
  if (entity === 'hospitals' && recordId === tenantId) {
    return (await query('select 1 from public.tenants where id = $1', [tenantId])).rowCount > 0
  }
  if (entity === 'branches') return Boolean(await getBranch(tenantId, recordId))
  if (entity === 'staff') {
    const staff = await getStaff(tenantId, recordId)
    return Boolean(staff && (!payload.email || staff.email?.toLowerCase() === String(payload.email).toLowerCase()))
  }
  if (entity === 'staff_roles') {
    return (await query('select 1 from public.staff_roles where hospital_id=$1 and id=$2 and staff_id=$3 and role=$4', [tenantId, recordId, payload.staffId, payload.role])).rowCount > 0
  }
  return false
}

async function acknowledgeExistingCreate(opId, tenantId, actorId) {
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`sync:${tenantId}:${opId}`])
    const prior = await client.query('select result from public.sync_operations where op_id = $1 and hospital_id = $2', [opId, tenantId])
    if (prior.rowCount) return prior.rows[0].result || { acked: true }
    const result = { acked: true }
    await client.query('insert into public.sync_operations (op_id,hospital_id,actor_id,result) values ($1,$2,$3,$4::jsonb)', [opId, tenantId, actorId, JSON.stringify(result)])
    return result
  })
}

export async function applySupabaseSync({ tenantId, actorId, ops, allowedEntities, timestamp }) {
  const actor = await getProfile(actorId)
  if (!actor || actor.active === false || actor.tenantId !== tenantId) throw new Error('Active hospital staff session required')
  const roles = Array.isArray(actor.roles) ? actor.roles : []
  const grants = Array.isArray(actor.permGrants) ? actor.permGrants : []
  const denies = Array.isArray(actor.permDenies) ? actor.permDenies : []
  const admin = roles.some((role) => ['facility_admin', 'ceo_owner', 'super_admin'].includes(role))
  const pharmacyStaff = roles.some((role) => ['pharmacist', 'superintendent_pharmacist', 'pharmacy_cashier', 'dispenser', 'sales_staff'].includes(role))
  const settingsResult = await query('select value from public.hospital_settings where hospital_id=$1', [tenantId])
  const pharmacyCollectPayments = settingsResult.rows[0]?.value?.pharmacyCollectPayments !== false
  const saleProductIds = new Set(ops.filter((operation) => operation?.entity === 'sales').flatMap((operation) => (operation.payload?.items || []).map((item) => String(item.productId || ''))))
  const adminOnly = new Set(['hospitals'])
  const elevatedRoles = new Set(['facility_admin', 'ceo_owner', 'super_admin'])
  const adminOnlyPermissions = new Set(['dashboard.admin', 'staff.manage', 'settings.manage', 'subscription.manage', 'ceo.view'])
  const acked = []
  const rejected = []

  for (const operation of ops) {
    const opId = String(operation?.opId || '')
    const entity = String(operation?.entity || '')
    const action = operation?.op
    if (!opId || opId.length > 160 || !allowedEntities.has(entity) || !['create', 'update', 'delete'].includes(action)) {
      rejected.push({ opId, code: 'validation_error', message: 'Invalid operation or entity', retryable: false })
      continue
    }
    const recordId = String(operation.recordId || operation.payload?.id || '')
    if (!recordId || recordId.length > 200 || !operation.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload)) {
      rejected.push({ opId, code: 'validation_error', message: 'recordId is required', retryable: false })
      continue
    }
    if (operation.payload.hospitalId && operation.payload.hospitalId !== tenantId) {
      rejected.push({ opId, code: 'forbidden', message: 'Record belongs to a different hospital', retryable: false })
      continue
    }
    const blockedPharmacyCollection = !pharmacyCollectPayments && !admin && pharmacyStaff && (
      ['payments', 'sales', 'refunds'].includes(entity) ||
      (entity === 'stock_movements' && operation.payload.type === 'sale') ||
      (entity === 'batches' && action === 'update' && saleProductIds.has(String(operation.payload.productId || ''))) ||
      (entity === 'products' && action === 'update' && saleProductIds.has(recordId)) ||
      (entity === 'audit_log' && operation.payload.action === 'sale.recorded')
    )
    if (blockedPharmacyCollection) {
      rejected.push({ opId, code: 'forbidden', message: 'Pharmacy payment collection is disabled by the hospital admin', retryable: false })
      continue
    }
    if (action === 'create' && ['hospitals', 'branches', 'staff', 'staff_roles'].includes(entity) && await existingBootstrapCreate(entity, tenantId, recordId, operation.payload)) {
      const result = await acknowledgeExistingCreate(opId, tenantId, actorId)
      if (result.acked) acked.push(opId)
      else rejected.push({ opId, ...result.rejected })
      continue
    }
    if (adminOnly.has(entity) && !admin) {
      rejected.push({ opId, code: 'forbidden', message: 'Hospital admin permission is required for this record', retryable: false })
      continue
    }
    if (!adminOnly.has(entity) && !canWriteEntity({ entity, operation: action, roles, grants, denies, pharmacyCollectPayments })) {
      rejected.push({ opId, code: 'forbidden', message: 'Your role does not have permission to change this record', retryable: false })
      continue
    }
    const billingOnlyVisitEdit = entity === 'visits' && action === 'update' &&
      hasPermission({ permission: 'billing.edit', roles, grants, denies }) &&
      !hasPermission({ permission: 'patients.manage', roles, grants, denies }) &&
      !hasPermission({ permission: 'queue.manage', roles, grants, denies })
    if (billingOnlyVisitEdit) {
      const current = await getDomainRecord(tenantId, 'visits', recordId)
      const next = sanitizeSyncPayload(operation.payload)
      const keys = new Set([...Object.keys(current || {}), ...Object.keys(next)])
      const protectedChanges = [...keys].filter((key) => !['charges', 'updatedAt'].includes(key) && JSON.stringify(stableValue(current?.[key] ?? null)) !== JSON.stringify(stableValue(next[key] ?? null)))
      if (!current || protectedChanges.length) {
        rejected.push({ opId, code: 'forbidden', message: 'Cashier access only allows adding or removing bill items', retryable: false })
        continue
      }
    }
    if (!admin && entity === 'staff_roles' && elevatedRoles.has(operation.payload?.role)) {
      rejected.push({ opId, code: 'forbidden', message: 'Only hospital administrators can assign administrator roles', retryable: false })
      continue
    }
    if (!admin && entity === 'staff' && [...(operation.payload?.permGrants || [])].some((permission) => adminOnlyPermissions.has(permission))) {
      rejected.push({ opId, code: 'forbidden', message: 'Only hospital administrators can grant administrator permissions', retryable: false })
      continue
    }
    if (operation.payload.actorId && operation.payload.actorId !== actorId) {
      rejected.push({ opId, code: 'forbidden', message: 'Record actor does not match the signed-in staff member', retryable: false })
      continue
    }
    const branchId = operation.payload.branchId
    if (branchId) {
      if (actor.branchId && actor.branchId !== branchId && !admin) {
        rejected.push({ opId, code: 'forbidden', message: 'Record belongs to a different branch', retryable: false })
        continue
      }
      if (!await getBranch(tenantId, branchId)) {
        rejected.push({ opId, code: 'forbidden', message: 'Branch does not belong to the signed-in hospital', retryable: false })
        continue
      }
    }

    try {
      const result = await transaction(async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`sync:${tenantId}:${opId}`])
        const prior = await client.query('select result from public.sync_operations where op_id = $1 and hospital_id = $2', [opId, tenantId])
        if (prior.rowCount) return prior.rows[0].result || { acked: true }

        const payload = { ...sanitizeSyncPayload(operation.payload), id: recordId, hospitalId: tenantId, updatedAt: timestamp() }
        const staffId = entity === 'staff' ? recordId : entity === 'staff_roles' ? String(payload.staffId || '') : null
        let deletedStaffAuthUserId = null
        if (entity === 'staff' && action === 'delete') {
          const existing = await client.query('select auth_user_id from public.staff where hospital_id=$1 and id=$2', [tenantId, recordId])
          deletedStaffAuthUserId = existing.rows[0]?.auth_user_id || null
        }
        if (staffId && entity === 'staff_roles' && !await getStaff(tenantId, staffId)) {
          return { rejected: { code: 'not_found', message: 'Staff account does not exist in this hospital', retryable: false } }
        }
        if (entity === 'staff' && action !== 'delete') await saveDomainRecord(client, tenantId, entity, recordId, payload, false)
        else await saveDomainRecord(client, tenantId, entity, recordId, payload, action === 'delete')

        if (deletedStaffAuthUserId) {
          await client.query(`update public.profiles set active=false,roles='{}',perm_grants='{}',perm_denies='{}',updated_at=now() where id=$1 and hospital_id=$2`, [deletedStaffAuthUserId, tenantId])
          await client.query('delete from public.profile_roles where user_id=$1 and hospital_id=$2', [deletedStaffAuthUserId, tenantId])
          await client.query("update public.devices set status='revoked',updated_at=now() where hospital_id=$1 and assigned_staff_id=$2 and not is_deleted", [tenantId, recordId])
        }

        if (entity === 'staff_roles') {
          const staff = await client.query('select auth_user_id from public.staff where hospital_id = $1 and id = $2', [tenantId, staffId])
          if (staff.rows[0]?.auth_user_id) {
            const rolesResult = await client.query('select role from public.staff_roles where hospital_id = $1 and staff_id = $2', [tenantId, staffId])
            const assigned = rolesResult.rows.map((row) => row.role)
            await client.query('update public.profiles set roles = $3, updated_at = now() where id = $1 and hospital_id = $2', [staff.rows[0].auth_user_id, tenantId, assigned])
            await client.query('delete from public.profile_roles where user_id=$1 and hospital_id=$2', [staff.rows[0].auth_user_id, tenantId])
            for (const role of assigned) await client.query('insert into public.profile_roles (id,user_id,hospital_id,role) values ($1,$2,$3,$4) on conflict (user_id,hospital_id,role) do nothing', [`${staff.rows[0].auth_user_id}:${tenantId}:${role}`,staff.rows[0].auth_user_id,tenantId,role])
          }
        }
        const changePayload = action === 'delete' ? null : payload
        await appendSyncChange(client, tenantId, entity, recordId, action, changePayload, actorId)
        const ack = { acked: true }
        await client.query('insert into public.sync_operations (op_id,hospital_id,actor_id,result) values ($1,$2,$3,$4::jsonb)', [opId, tenantId, actorId, JSON.stringify(ack)])
        return ack
      })
      if (result.acked) acked.push(opId)
      else rejected.push({ opId, ...result.rejected })
    } catch (error) {
      if (error.code === '23503') rejected.push({ opId, code: 'not_found', message: 'A linked record is missing from this hospital', retryable: false })
      else throw error
    }
  }
  return { acked, rejected }
}

export async function readSupabaseChanges({ tenantId, cursor = 0 }) {
  const result = await query('select sequence,entity,record_id,operation,payload,created_at from public.sync_changes where hospital_id = $1 and sequence > $2 order by sequence asc limit 500', [tenantId, Number(cursor || 0)])
  const changes = result.rows.map((row) => ({ cursor: Number(row.sequence), entity: row.entity, recordId: row.record_id, op: row.operation, payload: row.payload, at: row.created_at }))
  return { changes, cursor: changes.length ? changes.at(-1).cursor : Number(cursor || 0) }
}

export async function readSupabaseSnapshot({ tenantId, pageState = null, pageSize = 200 }) {
  let highWater = pageState?.highWater
  let afterEntity = ''
  let afterId = ''
  if (pageState?.after) {
    const parts = String(pageState.after).split('|')
    afterEntity = parts[0] || ''
    afterId = parts.slice(1).join('|')
    if (!afterEntity || !afterId) throw new Error('Invalid snapshot cursor')
  }
  if (highWater == null) {
    const latest = await query('select coalesce(max(sequence),0)::bigint as sequence from public.sync_changes where hospital_id = $1', [tenantId])
    highWater = Number(latest.rows[0].sequence)
  }
  const page = []
  let hasMore = false
  for (const entity of [...tenantEntities].sort()) {
    if (afterEntity && entity < afterEntity) continue
    const cursor = entity === afterEntity ? afterId : ''
    const rows = await listDomainRecordsAfter(tenantId, entity, cursor, pageSize - page.length + 1)
    for (const payload of rows) {
      if (page.length === pageSize) { hasMore = true; break }
      page.push({ entity, recordId: payload.id, payload })
    }
    if (hasMore) break
  }
  const last = page.at(-1)
  const nextState = hasMore && last ? { after: `${last.entity}|${last.recordId}`, highWater } : null
  return { records: page, nextState, deltaCursor: highWater }
}
