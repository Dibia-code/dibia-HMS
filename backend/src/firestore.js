import { applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { canWriteEntity, sanitizeSyncPayload } from './policy.js'

// Firestore is initialized only when explicitly enabled. This keeps local
// development usable with SQLite while allowing the same API server to run
// against Firebase in staging and production.
export function getFirestoreStore() {
  if (String(process.env.DATA_STORE || 'sqlite').toLowerCase() !== 'firestore') return null

  const app = getApps().length
    ? getApp()
    : initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || undefined,
      })

  return getFirestore(app)
}

export function getFirebaseAuth() {
  getFirestoreStore()
  return getAuth(getApp())
}

export function firestoreStatus() {
  return {
    enabled: String(process.env.DATA_STORE || 'sqlite').toLowerCase() === 'firestore',
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || null,
  }
}

const tenantRef = (db, tenantId) => db.collection('tenants').doc(tenantId)

export async function applyFirestoreSync({ tenantId, actorId, ops, allowedEntities, timestamp }) {
  const db = getFirestoreStore()
  if (!db) throw new Error('Firestore is not enabled')

  const actorSnapshot = await db.collection('staffProfiles').doc(actorId).get()
  if (!actorSnapshot.exists) throw new Error('Active hospital staff session required')
  const actor = actorSnapshot.data()
  if (actor.active === false || actor.tenantId !== tenantId) throw new Error('Active hospital staff session required')
  const roles = Array.isArray(actor.roles) ? actor.roles : []
  const grants = Array.isArray(actor.permGrants) ? actor.permGrants : []
  const denies = Array.isArray(actor.permDenies) ? actor.permDenies : []
  const admin = roles.some((role) => ['facility_admin', 'ceo_owner', 'super_admin'].includes(role))
  const elevatedEntities = new Set(['hospitals', 'branches', 'staff', 'staff_roles', 'settings'])

  const acked = []
  const rejected = []
  for (const operation of ops) {
    const opId = String(operation?.opId || '')
    const entity = String(operation?.entity || '')
    if (!opId || opId.length > 160 || !allowedEntities.has(entity) || !['create', 'update', 'delete'].includes(operation?.op)) {
      rejected.push({ opId, code: 'validation_error', message: 'Invalid operation or entity', retryable: false })
      continue
    }
    if (elevatedEntities.has(entity) && !admin) {
      rejected.push({ opId, code: 'forbidden', message: 'Hospital admin permission is required for this record', retryable: false })
      continue
    }
    if (!elevatedEntities.has(entity) && !canWriteEntity({ entity, operation: operation.op, roles, grants, denies })) {
      rejected.push({ opId, code: 'forbidden', message: 'Your role does not have permission to change this record', retryable: false })
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
      const branchSnapshot = await tenantRef(db, tenantId).collection('records').doc(`branches__${branchId}`).get()
      const branchRecord = branchSnapshot.data()
      if (!branchSnapshot.exists || branchRecord.deleted || branchRecord.payload?.hospitalId !== tenantId) {
        rejected.push({ opId, code: 'forbidden', message: 'Branch does not belong to the signed-in hospital', retryable: false })
        continue
      }
    }

    const result = await db.runTransaction(async (transaction) => {
      const root = tenantRef(db, tenantId)
      const opRef = root.collection('syncOperations').doc(opId)
      const sequenceRef = root.collection('meta').doc('sync')
      const recordRef = root.collection('records').doc(`${entity}__${recordId}`)
      const prior = await transaction.get(opRef)
      if (prior.exists) return prior.data()?.result || { acked: true }

      const sequence = await transaction.get(sequenceRef)
      let profileRef = null
      let profileSnapshot = null
      let roleRows = []
      const targetStaffId = entity === 'staff' ? recordId : entity === 'staff_roles' ? String(operation.payload.staffId || '') : ''
      if (targetStaffId) {
        profileRef = db.collection('staffProfiles').doc(targetStaffId)
        profileSnapshot = await transaction.get(profileRef)
        if (entity === 'staff_roles') {
          const rolesQuery = root.collection('records').where('entity', '==', 'staff_roles')
          const rolesSnapshot = await transaction.get(rolesQuery)
          roleRows = rolesSnapshot.docs
            .filter((doc) => doc.id !== `${entity}__${recordId}` && !doc.data().deleted)
            .map((doc) => doc.data().payload)
          if (operation.op !== 'delete' && operation.payload.staffId === targetStaffId) roleRows.push(operation.payload)
        }
      }
      if (targetStaffId && (!profileSnapshot?.exists || profileSnapshot.data()?.tenantId !== tenantId)) return { rejected: { code: 'not_found', message: 'Staff account does not exist in this hospital', retryable: false } }
      const nextSequence = Number(sequence.data()?.lastSequence || 0) + 1
      const action = operation.op
      const payload = { ...sanitizeSyncPayload(operation.payload || {}), id: recordId, hospitalId: tenantId, ...(entity === 'audit_log' ? { actorId } : {}), updatedAt: timestamp() }
      transaction.set(recordRef, { tenantId, entity, recordId, payload, deleted: action === 'delete', updatedAt: timestamp() })
      if (targetStaffId && profileSnapshot?.exists) {
        const profile = profileSnapshot.data()
        const updates = entity === 'staff'
          ? {
              ...(action === 'delete' ? { active: false } : {}),
              ...(payload.name != null ? { name: String(payload.name) } : {}),
              ...(payload.phone != null ? { phone: String(payload.phone) } : {}),
              ...(payload.profession != null ? { profession: String(payload.profession) } : {}),
              ...(payload.branchId != null ? { branchId: payload.branchId } : {}),
              ...(payload.active != null ? { active: payload.active !== false } : {}),
              ...(Array.isArray(payload.permGrants) ? { permGrants: payload.permGrants } : {}),
              ...(Array.isArray(payload.permDenies) ? { permDenies: payload.permDenies } : {}),
            }
          : { roles: [...new Set(roleRows.filter((row) => row?.staffId === targetStaffId && typeof row.role === 'string').map((row) => row.role))] }
        const nextProfile = { ...profile, ...updates, updatedAt: timestamp() }
        transaction.set(profileRef, nextProfile)
        transaction.set(root.collection('staff').doc(targetStaffId), nextProfile, { merge: true })
      }
      transaction.set(sequenceRef, { lastSequence: nextSequence, updatedAt: timestamp() }, { merge: true })
      transaction.set(root.collection('syncChanges').doc(String(nextSequence)), { sequence: nextSequence, entity, recordId, operation: action, payload: action === 'delete' ? null : payload, createdAt: timestamp() })
      transaction.set(opRef, { result: { acked: true }, actorId, createdAt: timestamp() })
      return { acked: true }
    })
    if (result.acked) acked.push(opId)
    else rejected.push({ opId, ...result.rejected })
  }
  return { acked, rejected }
}

export async function readFirestoreChanges({ tenantId, cursor = 0 }) {
  const db = getFirestoreStore()
  if (!db) throw new Error('Firestore is not enabled')
  const snapshot = await tenantRef(db, tenantId).collection('syncChanges')
    .where('sequence', '>', Number(cursor || 0))
    .orderBy('sequence', 'asc')
    .limit(500)
    .get()
  const changes = snapshot.docs.map((doc) => {
    const change = doc.data()
    return { cursor: change.sequence, entity: change.entity, recordId: change.recordId, op: change.operation, payload: change.payload ?? null, at: change.createdAt }
  })
  return { changes, cursor: changes.length ? changes[changes.length - 1].cursor : Number(cursor || 0) }
}

export async function readFirestoreSnapshot({ tenantId, pageState = null, pageSize = 200 }) {
  const db = getFirestoreStore()
  if (!db) throw new Error('Firestore is not enabled')
  let state = pageState || { after: null, highWater: null }
  if (state.after !== null && typeof state.after !== 'string') throw new Error('Invalid snapshot cursor')
  if (!pageState) {
    const sequence = await tenantRef(db, tenantId).collection('meta').doc('sync').get()
    state.highWater = Number(sequence.data()?.lastSequence || 0)
  }
  const records = tenantRef(db, tenantId).collection('records')
  let query = records.orderBy(FieldPath.documentId()).limit(pageSize)
  if (state.after) {
    const prior = await records.doc(state.after).get()
    if (!prior.exists) throw new Error('Snapshot cursor expired; restart the snapshot')
    query = query.startAfter(prior)
  }
  const page = await query.get()
  const items = page.docs.filter((doc) => !doc.data().deleted).map((doc) => {
    const row = doc.data()
    return { entity: row.entity, recordId: row.recordId, payload: row.payload }
  })
  const hasMore = page.size === pageSize
  const last = page.docs.at(-1)
  const nextState = hasMore && last ? { after: last.id, highWater: state.highWater } : null
  return { records: items, nextState, deltaCursor: state.highWater }
}
