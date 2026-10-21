import { getDB } from './db'
import { STORES } from './schema'
import { uuid } from '@/lib/id'
import { newDibiaId, newVisitNo, newReceiptNo, newClaimNo } from '@/lib/ids'
import { fefoOrder, expiredWithStock } from '@/lib/stock'
import { permissionsFor, can as hasPerm, PERM } from '@/auth/permissions'
import { hashPin } from '@/lib/pin'

// Change bus — mutations dispatch a 'change' event so live queries (useLiveQuery)
// can refresh without a manual reload. detail.entities lists what changed.
export const dataBus = new EventTarget()
function emitChange(entities) {
  dataBus.dispatchEvent(new CustomEvent('change', { detail: { entities: [...new Set(entities)] } }))
}

// ---------------------------------------------------------------------------
// Repository — the app's ONLY data entry point (the adapter seam). Backed by
// IndexedDB today; the same methods can front a REST/GraphQL client later
// (see remoteClient.js). Every mutation applies its change AND appends an outbox
// op with a fresh opId in one transaction, so a change is never persisted
// without its sync being queued (idempotency, §6).
// ---------------------------------------------------------------------------

function hasHospitalIndex(entity) {
  return STORES[entity]?.indexes?.some((i) => i.name === 'by_hospital')
}
function hasBranchIndex(entity) {
  return STORES[entity]?.indexes?.some((i) => i.name === 'by_branch')
}

export class LocalRepository {
  constructor({ hospitalId = null, branchId = null } = {}) {
    this.hospitalId = hospitalId
    this.branchId = branchId
  }

  // Return a copy scoped to a tenant/branch without mutating this instance.
  withScope({ hospitalId = this.hospitalId, branchId = this.branchId }) {
    return new LocalRepository({ hospitalId, branchId })
  }

  // ------------------------------------------------------------------ reads
  async get(entity, id) {
    const db = await getDB()
    const row = await db.get(entity, id)
    if (row && hasHospitalIndex(entity) && this.hospitalId != null && row.hospitalId !== this.hospitalId) return undefined
    return row
  }

  // list(entity, { branchId, filter, sort, limit }). When the store is tenant
  // scoped, results are always constrained to this.hospitalId (§3 — enforced
  // here at the query layer, never left to the router).
  async list(entity, opts = {}) {
    const db = await getDB()
    let rows

    if (hasHospitalIndex(entity) && this.hospitalId != null) {
      rows = await db.getAllFromIndex(entity, 'by_hospital', this.hospitalId)
    } else {
      rows = await db.getAll(entity)
    }

    const branchId = opts.branchId ?? this.branchId
    if (branchId != null && hasBranchIndex(entity)) {
      rows = rows.filter((r) => r.branchId == null || r.branchId === branchId)
    }
    if (typeof opts.filter === 'function') rows = rows.filter(opts.filter)
    if (typeof opts.sort === 'function') rows = rows.sort(opts.sort)
    if (opts.limit != null) rows = rows.slice(0, opts.limit)
    return rows
  }

  async listByIndex(entity, index, key) {
    const db = await getDB()
    const rows = await db.getAllFromIndex(entity, index, key)
    return hasHospitalIndex(entity) && this.hospitalId != null ? rows.filter((row) => row.hospitalId === this.hospitalId) : rows
  }

  async findByIndex(entity, index, key) {
    const db = await getDB()
    const row = await db.getFromIndex(entity, index, key)
    if (row && hasHospitalIndex(entity) && this.hospitalId != null && row.hospitalId !== this.hospitalId) return undefined
    return row
  }

  // ----------------------------------------------------------------- writes
  async create(entity, data) {
    const now = new Date().toISOString()
    const record = {
      id: data.id || uuid(),
      ...data,
      createdAt: data.createdAt || now,
      updatedAt: now,
    }
    if (hasHospitalIndex(entity) && record.hospitalId == null) {
      record.hospitalId = this.hospitalId
    }
    await this._commit([{ entity, op: 'create', record }])
    return record
  }

  async update(entity, id, patch) {
    const db = await getDB()
    const existing = await db.get(entity, id)
    if (!existing) throw new Error(`${entity} ${id} not found`)
    const record = { ...existing, ...patch, id, updatedAt: new Date().toISOString() }
    await this._commit([{ entity, op: 'update', record }])
    return record
  }

  async remove(entity, id) {
    const db = await getDB()
    const existing = await db.get(entity, id)
    const record = { ...(existing || {}), id, ...(existing?.hospitalId || !this.hospitalId ? {} : { hospitalId: this.hospitalId }) }
    await this._commit([{ entity, op: 'delete', record }])
    return { id }
  }

  // ------------------------------------------------------------ domain ops
  // A sale touches several stores and must be atomic + idempotent (§6). The
  // whole thing is one transaction: write the sale, decrement stock for each
  // line, append an audit entry, and queue one sync op per affected record.
  async recordSale(sale) {
    const now = new Date().toISOString()
    const record = {
      id: sale.id || uuid(),
      ...sale,
      hospitalId: sale.hospitalId ?? this.hospitalId,
      branchId: sale.branchId ?? this.branchId,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    }

    const db = await getDB()
    const tx = db.transaction(['sales', 'products', 'batches', 'stock_movements', 'audit_log', 'outbox'], 'readwrite')

    await tx.objectStore('sales').put(record)
    await this._enqueue(tx, { entity: 'sales', op: 'create', recordId: record.id, payload: record })

    // Take stock first-expiry-first-out from batches, in the same transaction.
    for (const line of record.items || []) {
      const product = await tx.objectStore('products').get(line.productId)
      if (!product) continue
      const { draws, shortfall, all } = await this._drawFefo(tx, product, line.qty)
      await this._commitDraws(tx, product, all, draws, shortfall, {
        type: 'sale', staffId: record.cashierId, staffName: record.cashierName, ref: record.reference,
      })
    }

    const audit = {
      id: uuid(), hospitalId: record.hospitalId, branchId: record.branchId,
      action: 'sale.recorded', ref: record.reference, actorId: record.cashierId,
      amount: record.total, at: now,
    }
    await tx.objectStore('audit_log').put(audit)
    await this._enqueue(tx, { entity: 'audit_log', op: 'create', recordId: audit.id, payload: audit })

    await tx.done
    emitChange(['sales', 'products', 'audit_log'])
    return record
  }

  // Staff end-of-shift report → management Reports → closing sessions (§5).
  async submitShiftReport(report) {
    const now = new Date().toISOString()
    const record = {
      id: report.id || uuid(),
      ...report,
      hospitalId: report.hospitalId ?? this.hospitalId,
      branchId: report.branchId ?? this.branchId,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    }
    await this._commit([{ entity: 'shift_reports', op: 'create', record }])
    return record
  }

  // Create or update a staff member together with their role assignments.
  // Roles are many-to-many via the staff_roles join table (§4): a person's
  // access is the UNION of permissions across every role they hold. This
  // reconciles the join rows against the picked slugs — adding newly-selected
  // roles, deleting unpicked ones — in ONE transaction with the staff record,
  // and queues a sync op for every affected row.
  async saveStaff({ id, roleSlugs = [], actorId, statusChange, ...fields }) {
    const now = new Date().toISOString()
    const db = await getDB()
    const tx = db.transaction(['staff', 'staff_roles', 'audit_log', 'outbox'], 'readwrite')
    const staffStore = tx.objectStore('staff')
    const rolesStore = tx.objectStore('staff_roles')

    // 1. Upsert the staff record.
    const existing = id ? await staffStore.get(id) : null
    const staff = {
      id: id || uuid(),
      ...existing,
      ...fields,
      hospitalId: fields.hospitalId ?? existing?.hospitalId ?? this.hospitalId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    await staffStore.put(staff)
    await this._enqueue(tx, {
      entity: 'staff', op: existing ? 'update' : 'create', recordId: staff.id, payload: staff,
    })

    // 2. Reconcile the join rows: remove unpicked, add newly picked.
    const current = await rolesStore.index('by_staff').getAll(staff.id)
    const currentSlugs = new Set(current.map((r) => r.role))
    const wanted = new Set(roleSlugs)
    for (const row of current) {
      if (!wanted.has(row.role)) {
        await rolesStore.delete(row.id)
        await this._enqueue(tx, { entity: 'staff_roles', op: 'delete', recordId: row.id, payload: { ...row, hospitalId: staff.hospitalId } })
      }
    }
    for (const slug of wanted) {
      if (!currentSlugs.has(slug)) {
        const link = { id: uuid(), staffId: staff.id, role: slug, hospitalId: staff.hospitalId, createdAt: now, updatedAt: now }
        await rolesStore.put(link)
        await this._enqueue(tx, { entity: 'staff_roles', op: 'create', recordId: link.id, payload: link })
      }
    }

    // 3. Audit trail.
    const audit = {
      id: uuid(), hospitalId: staff.hospitalId, branchId: staff.branchId ?? null,
      action: statusChange ? `staff.${statusChange.replace(' ', '_')}` : existing ? 'staff.updated' : 'staff.created',
      ref: staff.name, at: now, actorId: actorId ?? null,
      before: existing ? { active: existing.active !== false, roles: current.map((r) => r.role), grants: existing.permGrants || [], denies: existing.permDenies || [] } : undefined,
      after: { active: staff.active !== false, roles: [...wanted], grants: staff.permGrants || [], denies: staff.permDenies || [] },
    }
    await tx.objectStore('audit_log').put(audit)
    await this._enqueue(tx, { entity: 'audit_log', op: 'create', recordId: audit.id, payload: audit })

    await tx.done
    emitChange(['staff', 'staff_roles', 'audit_log'])
    return staff
  }

  // Remove a staff member and all of their join rows together (§4) so no
  // orphaned staff_roles survive; each deletion is queued for sync.
  async removeStaff(id, actorId = null) {
    const db = await getDB()
    const tx = db.transaction(['staff', 'staff_roles', 'audit_log', 'outbox'], 'readwrite')
    const staff = await tx.objectStore('staff').get(id)
    const rows = await tx.objectStore('staff_roles').index('by_staff').getAll(id)
    for (const row of rows) {
      await tx.objectStore('staff_roles').delete(row.id)
      await this._enqueue(tx, { entity: 'staff_roles', op: 'delete', recordId: row.id, payload: { ...row, hospitalId: staff?.hospitalId || this.hospitalId } })
    }
    await tx.objectStore('staff').delete(id)
    await this._enqueue(tx, { entity: 'staff', op: 'delete', recordId: id, payload: { ...(staff || {}), id, hospitalId: staff?.hospitalId || this.hospitalId } })
    const audit = {
      id: uuid(), hospitalId: staff?.hospitalId || this.hospitalId, branchId: staff?.branchId ?? null,
      action: 'staff.deleted', ref: staff?.name || id, at: new Date().toISOString(), actorId,
      before: { active: staff?.active !== false, roles: rows.map((row) => row.role) },
    }
    await tx.objectStore('audit_log').put(audit)
    await this._enqueue(tx, { entity: 'audit_log', op: 'create', recordId: audit.id, payload: audit })
    await tx.done
    emitChange(['staff', 'staff_roles', 'audit_log'])
    return { id }
  }

  async createClaim({ scheme, items, actor }) {
    const now = new Date().toISOString()
    const record = {
      id: uuid(), claimNo: newClaimNo(), scheme, items,
      amount: items.reduce((sum, i) => sum + i.amount, 0),
      status: 'draft', hospitalId: this.hospitalId, createdBy: actor?.id ?? null, createdAt: now, updatedAt: now,
    }
    await this._commit([
      { entity: 'hmo_claims', op: 'create', record },
      { entity: 'audit_log', op: 'create', record: this._audit('hmo.claim_created', `${scheme} · ${record.claimNo}`, { actorId: actor?.id, after: { amount: record.amount } }) },
    ])
    return record
  }

  async updateClaim(id, patch, { actor, action }) {
    const db = await getDB()
    const claim = await db.get('hmo_claims', id)
    const before = {}
    for (const k of Object.keys(patch)) before[k] = claim[k]
    await this._commit([
      { entity: 'hmo_claims', op: 'update', record: { ...claim, ...patch, updatedAt: new Date().toISOString() } },
      { entity: 'audit_log', op: 'create', record: this._audit(action, `${claim.scheme} · ${claim.claimNo}`, { actorId: actor?.id, before, after: patch }) },
    ])
  }

  // ------------------------------------------------------------ stock ops
  async _drawFefo(tx, product, qty, { forceBatchId, allowExpired } = {}) {
    const all = await tx.objectStore('batches').index('by_product').getAll(product.id)
    let pool = forceBatchId ? all.filter((b) => b.id === forceBatchId) : fefoOrder(all)
    if (allowExpired && !forceBatchId) pool = [...pool, ...expiredWithStock(all)]
    let remaining = qty
    const draws = []
    for (const batch of pool) {
      if (remaining <= 0) break
      const take = Math.min(batch.balance || 0, remaining)
      if (take > 0) {
        draws.push({ batch, qty: take })
        remaining -= take
      }
    }
    return { draws, shortfall: remaining, all }
  }

  async _commitDraws(tx, product, all, draws, shortfall, ctx) {
    const now = new Date().toISOString()
    let running = all.reduce((sum, b) => sum + (b.balance || 0), 0)
    for (const { batch, qty } of draws) {
      const after = { ...batch, balance: batch.balance - qty, updatedAt: now }
      await tx.objectStore('batches').put(after)
      await this._enqueue(tx, { entity: 'batches', op: 'update', recordId: after.id, payload: after })
      const stockBefore = running
      running -= qty
      await this._putMovement(tx, product, {
        batchId: batch.id, batchNo: batch.batchNo, type: ctx.type, qty: -qty,
        batchBefore: batch.balance, batchAfter: after.balance, stockBefore, stockAfter: running,
      }, ctx)
    }
    if (shortfall > 0 && ctx.type === 'sale') {
      await this._putMovement(tx, product, {
        batchId: null, batchNo: null, type: 'sale', qty: -shortfall,
        batchBefore: null, batchAfter: null, stockBefore: running, stockAfter: running,
        note: `${shortfall} unit(s) sold with no batch stock recorded`,
      }, ctx)
    }
    await this._setProductTotal(tx, product, running)
    return draws.map(({ batch, qty }) => ({ batch, qty }))
  }

  async _setProductTotal(tx, product, total) {
    const updated = { ...product, quantity: total, updatedAt: new Date().toISOString() }
    await tx.objectStore('products').put(updated)
    await this._enqueue(tx, { entity: 'products', op: 'update', recordId: updated.id, payload: { id: updated.id, quantity: total } })
    return updated
  }

  async _putMovement(tx, product, fields, ctx) {
    const row = {
      id: uuid(),
      hospitalId: product.hospitalId,
      branchId: product.branchId ?? this.branchId,
      productId: product.id,
      productName: product.name,
      staffId: ctx.staffId ?? null,
      staffName: ctx.staffName ?? '',
      ref: ctx.ref ?? '',
      reason: ctx.reason ?? '',
      at: new Date().toISOString(),
      ...fields,
    }
    await tx.objectStore('stock_movements').put(row)
    await this._enqueue(tx, { entity: 'stock_movements', op: 'create', recordId: row.id, payload: row })
    return row
  }

  async _auditIn(tx, action, ref, extra = {}) {
    const row = this._audit(action, ref, extra)
    await tx.objectStore('audit_log').put(row)
    await this._enqueue(tx, { entity: 'audit_log', op: 'create', recordId: row.id, payload: row })
  }

  async createProduct({ product, batch, actor }) {
    const now = new Date().toISOString()
    const units = Number(batch.received) || 0
    const record = {
      id: uuid(),
      ...product,
      quantity: units,
      initialStock: units,
      thresholdOverride: product.thresholdOverride ?? null,
      hospitalId: this.hospitalId,
      branchId: this.branchId,
      createdAt: now,
      updatedAt: now,
    }
    record.reorderLevel = Math.ceil(units * 0.25)
    const db = await getDB()
    const tx = db.transaction(['products', 'batches', 'stock_movements', 'audit_log', 'outbox'], 'readwrite')
    await tx.objectStore('products').put(record)
    await this._enqueue(tx, { entity: 'products', op: 'create', recordId: record.id, payload: record })
    if (units > 0) await this._putBatch(tx, record, batch, actor, 0)
    await this._auditIn(tx, 'product.created', record.name, { actorId: actor?.id })
    await tx.done
    emitChange(['products', 'batches', 'stock_movements', 'audit_log'])
    return record
  }

  async _putBatch(tx, product, batch, actor, stockBefore) {
    const now = new Date().toISOString()
    const units = Number(batch.received) || 0
    const row = {
      id: uuid(),
      hospitalId: product.hospitalId,
      branchId: product.branchId ?? this.branchId,
      productId: product.id,
      batchNo: batch.batchNo || 'UNNUMBERED',
      mfgDate: batch.mfgDate || null,
      expiry: batch.expiry || null,
      received: units,
      balance: units,
      cost: Number(batch.cost) || 0,
      price: Number(batch.price) || product.price || 0,
      supplier: batch.supplier || '',
      receivedBy: actor?.id ?? null,
      receivedByName: actor?.name ?? '',
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    await tx.objectStore('batches').put(row)
    await this._enqueue(tx, { entity: 'batches', op: 'create', recordId: row.id, payload: row })
    await this._putMovement(tx, product, {
      batchId: row.id, batchNo: row.batchNo, type: 'receipt', qty: units,
      batchBefore: 0, batchAfter: units, stockBefore, stockAfter: stockBefore + units,
    }, { staffId: actor?.id, staffName: actor?.name, ref: row.supplier ? `From ${row.supplier}` : '' })
    return row
  }

  async receiveStock({ productId, batch, actor }) {
    const db = await getDB()
    const tx = db.transaction(['products', 'batches', 'stock_movements', 'audit_log', 'outbox'], 'readwrite')
    const product = await tx.objectStore('products').get(productId)
    if (!product) throw new Error('Product not found')
    const before = await tx.objectStore('batches').index('by_product').getAll(productId)
    const stockBefore = before.reduce((sum, b) => sum + (b.balance || 0), 0)
    const row = await this._putBatch(tx, product, batch, actor, stockBefore)
    await this._setProductTotal(tx, product, stockBefore + row.received)
    await this._auditIn(tx, 'stock.received', `${product.name} · ${row.batchNo}`, {
      actorId: actor?.id, after: { quantity: row.received, batchNo: row.batchNo },
    })
    await tx.done
    emitChange(['products', 'batches', 'stock_movements', 'audit_log'])
    return row
  }

  async setThreshold(productId, value, actor) {
    const db = await getDB()
    const product = await db.get('products', productId)
    const base = product.initialStock ?? product.quantity ?? 0
    const override = value === null || value === '' ? null : Math.max(0, Number(value))
    const effective = override ?? Math.ceil(base * 0.25)
    await this._commit([
      { entity: 'products', op: 'update', record: { ...product, thresholdOverride: override, reorderLevel: effective, updatedAt: new Date().toISOString() } },
      {
        entity: 'audit_log', op: 'create',
        record: this._audit('product.threshold', product.name, {
          actorId: actor?.id, before: { threshold: product.reorderLevel }, after: { threshold: effective },
        }),
      },
    ])
  }

  async adjustBatch({ batchId, newBalance, kind = 'adjustment', reason, actor }) {
    const db = await getDB()
    const tx = db.transaction(['products', 'batches', 'stock_movements', 'audit_log', 'outbox'], 'readwrite')
    const batch = await tx.objectStore('batches').get(batchId)
    const product = await tx.objectStore('products').get(batch.productId)
    const all = await tx.objectStore('batches').index('by_product').getAll(product.id)
    const stockBefore = all.reduce((sum, b) => sum + (b.balance || 0), 0)
    const balance = Math.max(0, Number(newBalance))
    const diff = balance - batch.balance
    const after = { ...batch, balance, updatedAt: new Date().toISOString() }
    await tx.objectStore('batches').put(after)
    await this._enqueue(tx, { entity: 'batches', op: 'update', recordId: after.id, payload: after })
    await this._putMovement(tx, product, {
      batchId, batchNo: batch.batchNo, type: kind, qty: diff,
      batchBefore: batch.balance, batchAfter: balance, stockBefore, stockAfter: stockBefore + diff,
    }, { staffId: actor?.id, staffName: actor?.name, reason })
    await this._setProductTotal(tx, product, stockBefore + diff)
    await this._auditIn(tx, `stock.${kind}`, `${product.name} · ${batch.batchNo}`, {
      actorId: actor?.id, reason, before: { balance: batch.balance }, after: { balance },
    })
    await tx.done
    emitChange(['products', 'batches', 'stock_movements', 'audit_log'])
  }

  async archiveProduct(id, actor) {
    const db = await getDB()
    const product = await db.get('products', id)
    await this._commit([
      { entity: 'products', op: 'update', record: { ...product, archived: true, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
      { entity: 'audit_log', op: 'create', record: this._audit('product.archived', product.name, { actorId: actor?.id }) },
    ])
  }

  // Finds the pharmacist (or other approver) whose PIN was entered.
  async verifyApprover(pin) {
    const db = await getDB()
    const staff = (await db.getAllFromIndex('staff', 'by_hospital', this.hospitalId)).filter((s) => s.active !== false && s.pinHash)
    for (const member of staff) {
      if ((await hashPin(pin, member.id)) !== member.pinHash) continue
      const roles = (await db.getAllFromIndex('staff_roles', 'by_staff', member.id)).map((r) => r.role)
      if (hasPerm(permissionsFor(roles), PERM.PHARMACY_APPROVE)) return { id: member.id, name: member.name }
    }
    return null
  }

  async setStaffPin(staffId, pin) {
    const db = await getDB()
    const member = await db.get('staff', staffId)
    const pinHash = await hashPin(pin, staffId)
    await this._commit([
      { entity: 'staff', op: 'update', record: { ...member, pinHash, updatedAt: new Date().toISOString() } },
      { entity: 'audit_log', op: 'create', record: this._audit('staff.pin_set', member.name) },
    ])
  }

  // ---------------------------------------------------------- prescriptions
  async createPrescription({ visit, patient, source, prescriber, lines, actor }) {
    const now = new Date().toISOString()
    const record = {
      id: uuid(),
      hospitalId: this.hospitalId,
      branchId: visit.branchId ?? this.branchId,
      visitId: visit.id,
      visitNo: visit.visitNo,
      patientId: patient.id,
      patientName: patient.fullName,
      dibiaId: patient.dibiaId,
      source,
      prescriber: prescriber || '',
      status: 'pending',
      lines: lines.map((l) => ({ id: uuid(), status: 'pending', dispensedQty: 0, ...l })),
      createdBy: actor?.id ?? null,
      createdAt: now,
      updatedAt: now,
    }
    const changes = [{ entity: 'prescriptions', op: 'create', record }]
    if (['waiting', 'with_doctor'].includes(visit.status)) {
      changes.push({ entity: 'visits', op: 'update', record: { ...visit, status: 'at_pharmacy', updatedAt: now } })
    }
    changes.push({
      entity: 'audit_log', op: 'create',
      record: this._audit(source === 'external' ? 'prescription.logged_external' : 'prescription.received', `${patient.fullName} · ${lines.length} line(s)`, { actorId: actor?.id }),
    })
    await this._commit(changes)
    return record
  }

  async dispenseLine({ prescriptionId, lineId, qty, productId, forceBatchId, allowExpired, approvals = {}, flags = [], substituted, actor }) {
    const db = await getDB()
    const tx = db.transaction(
      ['prescriptions', 'visits', 'products', 'batches', 'stock_movements', 'dispensings', 'audit_log', 'outbox'],
      'readwrite',
    )
    const rx = await tx.objectStore('prescriptions').get(prescriptionId)
    const line = rx.lines.find((l) => l.id === lineId)
    const product = await tx.objectStore('products').get(productId)
    const { draws, shortfall, all } = await this._drawFefo(tx, product, qty, { forceBatchId, allowExpired })
    const given = qty - shortfall
    if (given <= 0) {
      tx.abort()
      throw new Error('No stock available to dispense')
    }
    const now = new Date().toISOString()
    const done = await this._commitDraws(tx, product, all, draws, 0, {
      type: 'dispense', staffId: actor.id, staffName: actor.name, ref: `${rx.patientName} · ${rx.visitNo}`,
    })

    const visit = await tx.objectStore('visits').get(rx.visitId)
    const charges = [...(visit.charges || [])]
    const records = []
    for (const { batch, qty: take } of done) {
      const d = {
        id: uuid(),
        hospitalId: rx.hospitalId,
        branchId: rx.branchId,
        prescriptionId: rx.id,
        lineId,
        visitId: rx.visitId,
        visitNo: rx.visitNo,
        patientId: rx.patientId,
        patientName: rx.patientName,
        productId: product.id,
        drugName: product.name,
        prescribedName: line.drugName,
        substituted: !!substituted,
        qty: take,
        returnedQty: 0,
        batchId: batch.id,
        batchNo: batch.batchNo,
        expiry: batch.expiry,
        unitPrice: batch.price || product.price || 0,
        dose: line.dose,
        frequency: line.frequency,
        duration: line.duration,
        flags: flags.map((f) => ({ kind: f.kind, message: f.message })),
        approvals,
        staffId: actor.id,
        staffName: actor.name,
        at: now,
        createdAt: now,
        updatedAt: now,
      }
      await tx.objectStore('dispensings').put(d)
      await this._enqueue(tx, { entity: 'dispensings', op: 'create', recordId: d.id, payload: d })
      charges.push({ id: uuid(), type: 'pharmacy', label: product.name, qty: take, unitPrice: d.unitPrice, at: now, dispensingId: d.id })
      records.push(d)
    }

    const dispensed = (line.dispensedQty || 0) + given
    const lineStatus = dispensed >= line.qty ? 'done' : 'partial'
    const lines = rx.lines.map((l) =>
      l.id === lineId
        ? {
            ...l,
            dispensedQty: dispensed,
            status: lineStatus,
            outstandingNote: lineStatus === 'partial' ? `${line.qty - dispensed} outstanding` : '',
          }
        : l,
    )
    const complete = lines.every((l) => l.status === 'done' || l.status === 'cancelled')
    const anyProgress = lines.some((l) => l.status === 'done' || l.status === 'partial')
    const rxAfter = { ...rx, lines, status: complete ? 'complete' : anyProgress ? 'partial' : 'pending', updatedAt: now }
    await tx.objectStore('prescriptions').put(rxAfter)
    await this._enqueue(tx, { entity: 'prescriptions', op: 'update', recordId: rx.id, payload: rxAfter })

    const nextVisit = { ...visit, charges, updatedAt: now }
    if (complete && visit.status === 'at_pharmacy') nextVisit.status = 'at_cashier'
    await tx.objectStore('visits').put(nextVisit)
    await this._enqueue(tx, { entity: 'visits', op: 'update', recordId: visit.id, payload: nextVisit })

    await this._auditIn(tx, 'drug.dispensed', `${product.name} x${given} · ${rx.patientName}`, {
      actorId: actor.id,
      after: { batches: records.map((r) => `${r.batchNo} x${r.qty}`), substituted: !!substituted, flags: flags.length, approvals },
    })
    if (forceBatchId) await this._auditIn(tx, 'fefo.override', `${product.name} · ${records[0]?.batchNo}`, { actorId: approvals.fefoBy || actor.id })
    if (allowExpired) await this._auditIn(tx, 'expired.override', `${product.name} · ${records[0]?.batchNo}`, { actorId: approvals.expiredBy || actor.id })
    await tx.done
    emitChange(['prescriptions', 'visits', 'products', 'batches', 'stock_movements', 'dispensings', 'audit_log'])
    return { records, given, short: qty - given }
  }

  // The pharmacy must work even when stock was never counted in (PRD 7.3):
  // the drug is handed over, logged as "stock not recorded", and billed.
  async dispenseUntracked({ prescriptionId, lineId, qty, productId, drugName, unitPrice, approvals = {}, flags = [], actor }) {
    const db = await getDB()
    const tx = db.transaction(['prescriptions', 'visits', 'products', 'stock_movements', 'dispensings', 'audit_log', 'outbox'], 'readwrite')
    const rx = await tx.objectStore('prescriptions').get(prescriptionId)
    const line = rx.lines.find((l) => l.id === lineId)
    const product = productId ? await tx.objectStore('products').get(productId) : null
    const now = new Date().toISOString()
    const name = product?.name || drugName
    const d = {
      id: uuid(), hospitalId: rx.hospitalId, branchId: rx.branchId, prescriptionId: rx.id, lineId,
      visitId: rx.visitId, visitNo: rx.visitNo, patientId: rx.patientId, patientName: rx.patientName,
      productId: product?.id ?? null, drugName: name, prescribedName: line.drugName, substituted: false,
      qty, returnedQty: 0, batchId: null, batchNo: 'Not recorded', expiry: null, untracked: true,
      unitPrice: Number(unitPrice) || 0, dose: line.dose, frequency: line.frequency, duration: line.duration,
      flags: flags.map((f) => ({ kind: f.kind, message: f.message })), approvals,
      staffId: actor.id, staffName: actor.name, at: now, createdAt: now, updatedAt: now,
    }
    await tx.objectStore('dispensings').put(d)
    await this._enqueue(tx, { entity: 'dispensings', op: 'create', recordId: d.id, payload: d })
    if (product) {
      await this._putMovement(tx, product, {
        batchId: null, batchNo: null, type: 'dispense', qty: 0, batchBefore: null, batchAfter: null,
        stockBefore: product.quantity || 0, stockAfter: product.quantity || 0,
        note: `${qty} dispensed with no batch stock recorded`,
      }, { staffId: actor.id, staffName: actor.name, ref: `${rx.patientName} · ${rx.visitNo}` })
    }

    const visit = await tx.objectStore('visits').get(rx.visitId)
    const charges = [...(visit.charges || []), { id: uuid(), type: 'pharmacy', label: name, qty, unitPrice: d.unitPrice, at: now, dispensingId: d.id }]
    const dispensed = (line.dispensedQty || 0) + qty
    const status = dispensed >= line.qty ? 'done' : 'partial'
    const lines = rx.lines.map((l) => (l.id === lineId ? { ...l, dispensedQty: dispensed, status, outstandingNote: status === 'partial' ? `${line.qty - dispensed} outstanding` : '' } : l))
    const complete = lines.every((l) => l.status === 'done' || l.status === 'cancelled')
    const rxAfter = { ...rx, lines, status: complete ? 'complete' : 'partial', updatedAt: now }
    await tx.objectStore('prescriptions').put(rxAfter)
    await this._enqueue(tx, { entity: 'prescriptions', op: 'update', recordId: rx.id, payload: rxAfter })
    const nextVisit = { ...visit, charges, updatedAt: now }
    if (complete && visit.status === 'at_pharmacy') nextVisit.status = 'at_cashier'
    await tx.objectStore('visits').put(nextVisit)
    await this._enqueue(tx, { entity: 'visits', op: 'update', recordId: visit.id, payload: nextVisit })
    await this._auditIn(tx, 'drug.dispensed_untracked', `${name} x${qty} · ${rx.patientName}`, { actorId: actor.id, after: { note: 'Stock not recorded', flags: flags.length, approvals } })
    await tx.done
    emitChange(['prescriptions', 'visits', 'products', 'stock_movements', 'dispensings', 'audit_log'])
    return { records: [d], given: qty, short: 0 }
  }

  async returnDispensing({ dispensingId, qty, reason, disposition, actor }) {
    const db = await getDB()
    const tx = db.transaction(['dispensings', 'visits', 'products', 'batches', 'stock_movements', 'audit_log', 'outbox'], 'readwrite')
    const d = await tx.objectStore('dispensings').get(dispensingId)
    const product = await tx.objectStore('products').get(d.productId)
    const now = new Date().toISOString()
    const after = { ...d, returnedQty: (d.returnedQty || 0) + qty, updatedAt: now }
    await tx.objectStore('dispensings').put(after)
    await this._enqueue(tx, { entity: 'dispensings', op: 'update', recordId: d.id, payload: after })

    const all = await tx.objectStore('batches').index('by_product').getAll(product.id)
    const stockBefore = all.reduce((sum, b) => sum + (b.balance || 0), 0)
    const batch = all.find((b) => b.id === d.batchId)
    if (disposition === 'restock' && batch) {
      const restored = { ...batch, balance: batch.balance + qty, updatedAt: now }
      await tx.objectStore('batches').put(restored)
      await this._enqueue(tx, { entity: 'batches', op: 'update', recordId: restored.id, payload: restored })
      await this._putMovement(tx, product, {
        batchId: batch.id, batchNo: batch.batchNo, type: 'return', qty,
        batchBefore: batch.balance, batchAfter: restored.balance, stockBefore, stockAfter: stockBefore + qty,
      }, { staffId: actor.id, staffName: actor.name, reason, ref: d.patientName })
      await this._setProductTotal(tx, product, stockBefore + qty)
    } else {
      await this._putMovement(tx, product, {
        batchId: d.batchId, batchNo: d.batchNo, type: disposition === 'expired' ? 'return_expired' : 'return_damaged', qty: 0,
        batchBefore: batch?.balance ?? null, batchAfter: batch?.balance ?? null, stockBefore, stockAfter: stockBefore,
        note: `${qty} returned and not restocked`,
      }, { staffId: actor.id, staffName: actor.name, reason, ref: d.patientName })
    }

    const visit = await tx.objectStore('visits').get(d.visitId)
    const credit = { id: uuid(), type: 'pharmacy', label: `Return: ${d.drugName}`, qty: -qty, unitPrice: d.unitPrice, at: now, dispensingId: d.id }
    const nextVisit = { ...visit, charges: [...(visit.charges || []), credit], updatedAt: now }
    await tx.objectStore('visits').put(nextVisit)
    await this._enqueue(tx, { entity: 'visits', op: 'update', recordId: visit.id, payload: nextVisit })

    await this._auditIn(tx, 'drug.returned', `${d.drugName} x${qty} · ${d.patientName}`, {
      actorId: actor.id, reason, after: { disposition },
    })
    await tx.done
    emitChange(['dispensings', 'visits', 'products', 'batches', 'stock_movements', 'audit_log'])
  }

  async ensureBatches() {
    const db = await getDB()
    const products = await db.getAll('products')
    const batches = await db.getAll('batches')
    const has = new Set(batches.map((b) => b.productId))
    const now = new Date().toISOString()
    const changes = []
    for (const p of products) {
      if (has.has(p.id)) continue
      const units = Number(p.quantity) || 0
      const batch = {
        id: uuid(), hospitalId: p.hospitalId, branchId: p.branchId ?? null, productId: p.id,
        batchNo: p.batch || 'OPENING', mfgDate: null, expiry: p.expiry || null,
        received: units, balance: units, cost: p.costPrice || 0, price: p.price || 0, supplier: '',
        receivedBy: null, receivedByName: 'Opening balance', receivedAt: now, createdAt: now, updatedAt: now,
      }
      changes.push({ entity: 'batches', op: 'create', record: batch })
      changes.push({
        entity: 'stock_movements', op: 'create',
        record: {
          id: uuid(), hospitalId: p.hospitalId, branchId: p.branchId ?? null, productId: p.id, productName: p.name,
          batchId: batch.id, batchNo: batch.batchNo, type: 'opening', qty: units,
          batchBefore: 0, batchAfter: units, stockBefore: 0, stockAfter: units,
          staffId: null, staffName: 'Opening balance', ref: '', reason: '', at: now,
        },
      })
      if (p.initialStock == null) {
        changes.push({
          entity: 'products', op: 'update',
          record: {
            ...p, initialStock: units,
            thresholdOverride: p.reorderLevel > 0 ? p.reorderLevel : null,
            updatedAt: now,
          },
        })
      }
    }
    if (changes.length) await this._commit(changes)
  }

  _audit(action, ref, extra = {}) {
    return {
      id: uuid(),
      hospitalId: this.hospitalId,
      branchId: this.branchId,
      action,
      ref,
      at: new Date().toISOString(),
      ...extra,
    }
  }

  async registerPatient({ patient, visit, actorId }) {
    const now = new Date().toISOString()
    const isNew = !patient.id
    const p = isNew
      ? {
          id: uuid(),
          dibiaId: newDibiaId(),
          ...patient,
          hospitalId: this.hospitalId,
          createdAt: now,
          updatedAt: now,
        }
      : patient
    const v = {
      id: uuid(),
      visitNo: newVisitNo(),
      status: 'waiting',
      type: 'outpatient',
      charges: [],
      ...visit,
      patientId: p.id,
      patientName: p.fullName,
      dibiaId: p.dibiaId,
      hospitalId: this.hospitalId,
      branchId: visit.branchId ?? this.branchId,
      openedBy: actorId,
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    const changes = []
    if (isNew) changes.push({ entity: 'patients', op: 'create', record: p })
    changes.push({ entity: 'visits', op: 'create', record: v })
    changes.push({
      entity: 'audit_log',
      op: 'create',
      record: this._audit(isNew ? 'patient.registered' : 'visit.opened', `${p.fullName} · ${v.visitNo}`, { actorId }),
    })
    await this._commit(changes)
    return { patient: p, visit: v }
  }

  async updateVisit(id, patch, { actorId, action = 'visit.updated', ref } = {}) {
    const db = await getDB()
    const existing = await db.get('visits', id)
    if (!existing) throw new Error('Visit not found')
    const record = { ...existing, ...patch, id, updatedAt: new Date().toISOString() }
    const before = {}
    const after = {}
    for (const key of Object.keys(patch)) {
      before[key] = existing[key]
      after[key] = patch[key]
    }
    await this._commit([
      { entity: 'visits', op: 'update', record },
      {
        entity: 'audit_log',
        op: 'create',
        record: this._audit(action, ref || `${existing.patientName} · ${existing.visitNo}`, { actorId, before, after }),
      },
    ])
    return record
  }

  async addCharge(visitId, charge, actorId) {
    const db = await getDB()
    const visit = await db.get('visits', visitId)
    if (!visit) throw new Error('Visit not found')
    const line = { id: uuid(), qty: 1, at: new Date().toISOString(), ...charge }
    return this.updateVisit(visitId, { charges: [...(visit.charges || []), line] }, {
      actorId,
      action: 'charge.added',
      ref: `${visit.patientName} · ${line.label}`,
    })
  }

  async recordPayment({ visit, methods, lines, totals, balanceAfter = 0, actorId, cashierName, note }) {
    const now = new Date().toISOString()
    const amount = methods.reduce((sum, m) => sum + (Number(m.amount) || 0), 0)
    const record = {
      id: uuid(),
      receiptNo: newReceiptNo(),
      type: 'payment',
      visitId: visit.id,
      visitNo: visit.visitNo,
      patientId: visit.patientId,
      patientName: visit.patientName,
      dibiaId: visit.dibiaId,
      hospitalId: this.hospitalId,
      branchId: visit.branchId ?? this.branchId,
      methods,
      amount,
      lines,
      totals,
      balanceAfter,
      cashierId: actorId,
      cashierName,
      note: note || '',
      createdAt: now,
      updatedAt: now,
    }
    await this._commit([
      { entity: 'payments', op: 'create', record },
      {
        entity: 'audit_log',
        op: 'create',
        record: this._audit('payment.recorded', `${record.receiptNo} · ${visit.patientName}`, { actorId, amount }),
      },
    ])
    return record
  }

  async recordRefund({ payment, amount, method, reason, actorId, cashierName }) {
    const now = new Date().toISOString()
    const record = {
      id: uuid(),
      receiptNo: newReceiptNo(),
      type: 'refund',
      refundOf: payment.id,
      refundOfNo: payment.receiptNo,
      visitId: payment.visitId,
      visitNo: payment.visitNo,
      patientId: payment.patientId,
      patientName: payment.patientName,
      dibiaId: payment.dibiaId,
      hospitalId: this.hospitalId,
      branchId: payment.branchId,
      methods: [{ method, amount }],
      amount,
      reason,
      cashierId: actorId,
      cashierName,
      createdAt: now,
      updatedAt: now,
    }
    await this._commit([
      { entity: 'payments', op: 'create', record },
      {
        entity: 'audit_log',
        op: 'create',
        record: this._audit('payment.refunded', `${record.receiptNo} · ${payment.receiptNo}`, { actorId, amount, reason }),
      },
    ])
    return record
  }

  // ------------------------------------------------------------- internals
  // Apply a batch of {entity, op, record} atomically and queue each for sync.
  async _commit(changes) {
    const db = await getDB()
    const stores = [...new Set(changes.map((c) => c.entity)), 'outbox']
    const tx = db.transaction(stores, 'readwrite')
    for (const { entity, op, record } of changes) {
      const store = tx.objectStore(entity)
      if (op === 'delete') await store.delete(record.id)
      else await store.put(record)
      await this._enqueue(tx, { entity, op, recordId: record.id, payload: record })
    }
    await tx.done
    // Notify live queries (useLiveQuery). Without this, create/update/remove
    // persist to IndexedDB but the UI never refreshes — the exact symptom of
    // "the Add button / edits don't save". The domain ops (recordSale,
    // saveStaff, …) emit their own change; this covers the generic CRUD path.
    emitChange(changes.map((c) => c.entity))
  }

  // Append one op to the outbox within an existing transaction. opId is a fresh
  // uuid — the idempotency key for THIS mutation (distinct from the record id,
  // since one record may be created then updated many times).
  async _enqueue(tx, { entity, op, recordId, payload }) {
    await tx.objectStore('outbox').add({
      opId: uuid(),
      entity,
      op,
      recordId,
      payload,
      tenantId: payload?.hospitalId || this.hospitalId || null,
      status: 'pending',
      tries: 0,
      createdAt: new Date().toISOString(),
    })
  }
}
