import { getDB } from './db'
import { ROLE } from '@/auth/roles'
import { defaultHospitalConfig } from '@/lib/hospital'
import { hashPin } from '@/lib/pin'


const iso = (d) => d.toISOString()
const daysFromNow = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return iso(d)
}
const hoursAgo = (n) => iso(new Date(Date.now() - n * 3_600_000))

export const HOSPITAL_ID = 'hosp_demo'
export const HOSPITAL_SLUG = 'demohospital'
const HOSP_BRANCH = 'br_demo_hosp'

function buildHospital() {
  const P = HOSPITAL_ID
  const B = HOSP_BRANCH
  const cfg = defaultHospitalConfig()

  const hospitals = [
    {
      id: P,
      slug: HOSPITAL_SLUG,
      name: 'Demo Hospital',
      plan: 'Freemium',
      subscriptionStatus: 'active',
      email: 'hello@demohospital.ng',
      phone: '+234 800 555 0100',
      address: '12 Hospital Road, Aba',
      createdAt: daysFromNow(-40),
      ...cfg,
    },
  ]
  const branches = [{ id: B, hospitalId: P, name: 'Main Campus', address: '12 Hospital Road, Aba', isMain: true }]

  const staff = [
    { id: 'st_h_admin', hospitalId: P, branchId: B, name: 'Ifeoma Nwachukwu', email: 'admin@demohospital.ng', phone: '+234 803 555 0101', active: true },
    { id: 'st_h_recep', hospitalId: P, branchId: B, name: 'Amaka Obi', email: 'reception@demohospital.ng', phone: '+234 803 555 0102', active: true },
    { id: 'st_h_cash', hospitalId: P, branchId: B, name: 'Bola Adeyemi', email: 'cashier@demohospital.ng', phone: '+234 803 555 0103', active: true },
    { id: 'st_h_pharm', hospitalId: P, branchId: B, name: 'Chuka Eze', email: 'pharmacy@demohospital.ng', phone: '+234 803 555 0104', active: true },
  ]
  const staff_roles = [
    ['st_h_admin', ROLE.FACILITY_ADMIN],
    ['st_h_recep', ROLE.RECEPTIONIST],
    ['st_h_cash', ROLE.CASHIER],
    ['st_h_pharm', ROLE.PHARMACIST],
  ].map(([staffId, role]) => ({ id: `${staffId}__${role}`, staffId, role }))

  const products = [
    { id: 'pd_h_para', hospitalId: P, branchId: B, name: 'Paracetamol 500mg', category: 'Analgesics', barcode: '6008800000011', batch: 'DH-PARA-01', expiry: daysFromNow(210), quantity: 400, reorderLevel: 100, costPrice: 40, price: 90, rx: false },
    { id: 'pd_h_amox', hospitalId: P, branchId: B, name: 'Amoxicillin 500mg', category: 'Antibiotics', barcode: '6008800000028', batch: 'DH-AMOX-02', expiry: daysFromNow(38), quantity: 26, reorderLevel: 60, costPrice: 120, price: 240, rx: true },
    { id: 'pd_h_artem', hospitalId: P, branchId: B, name: 'Artemether-Lumefantrine', category: 'Antimalarials', barcode: '6008800000035', batch: 'DH-AL-03', expiry: daysFromNow(300), quantity: 80, reorderLevel: 40, costPrice: 650, price: 1200, rx: true },
    { id: 'pd_h_ors', hospitalId: P, branchId: B, name: 'ORS Sachets', category: 'Rehydration', barcode: '6008800000042', batch: 'DH-ORS-04', expiry: daysFromNow(500), quantity: 12, reorderLevel: 50, costPrice: 30, price: 70, rx: false },
  ]

  const patients = [
    { id: 'pt_1', dibiaId: 'DBA-7K2M-Q9XA', fullName: 'Chinedu Okeke', dob: '1988-04-12', sex: 'male', phone: '0803 411 2200', address: '5 Ngwa Road, Aba', kinName: 'Ada Okeke', kinPhone: '0803 411 2201', createdAt: daysFromNow(-30) },
    { id: 'pt_2', dibiaId: 'DBA-3PZ8-N4RD', fullName: 'Ngozi Adeleke', dob: '1995-09-03', sex: 'female', phone: '0806 220 9911', address: '18 Faulks Road, Aba', kinName: 'Tunde Adeleke', kinPhone: '0806 220 9912', createdAt: daysFromNow(-12) },
    { id: 'pt_3', dibiaId: 'DBA-Y5T1-B7HC', fullName: 'Emeka Nnamdi', dob: '1972-01-22', sex: 'male', phone: '0902 118 4455', address: '', kinName: '', kinPhone: '', createdAt: daysFromNow(-5) },
    { id: 'pt_4', dibiaId: 'DBA-D8W2-F6JE', fullName: 'Blessing Uche', dob: '2016-06-30', sex: 'female', phone: '0813 660 3388', address: '2 Osusu Road, Aba', kinName: 'Mrs Uche', kinPhone: '0813 660 3388', createdAt: daysFromNow(-3) },
    { id: 'pt_5', dibiaId: 'DBA-H1V6-K0GS', fullName: 'Musa Ibrahim', dob: '1965-11-08', sex: 'male', phone: '0705 330 7712', address: '9 Market Road, Aba', kinName: 'Hauwa Ibrahim', kinPhone: '0705 330 7713', createdAt: daysFromNow(-1) },
    { id: 'pt_6', dibiaId: 'DBA-R4C9-M2ZT', fullName: 'Adaora Eze', dob: '1990-02-14', sex: 'female', phone: '0811 902 5566', address: '31 Ehere Road, Aba', kinName: 'Ike Eze', kinPhone: '0811 902 5567', createdAt: hoursAgo(1) },
  ].map((p) => ({ hospitalId: P, updatedAt: p.createdAt, ...p }))

  const cons = (id, dept, fee, h) => ({ id, type: 'consultation', label: `Consultation, ${dept}`, qty: 1, unitPrice: fee, at: hoursAgo(h) })
  const drug = (id, label, qty, unit, h) => ({ id, type: 'pharmacy', label, qty, unitPrice: unit, at: hoursAgo(h) })

  const visitBase = { hospitalId: P, branchId: B, type: 'outpatient', openedBy: 'st_h_recep' }
  const visits = [
    { ...visitBase, id: 'vi_1', visitNo: 'V-DEMO-0001', patientId: 'pt_1', patientName: 'Chinedu Okeke', dibiaId: 'DBA-7K2M-Q9XA', status: 'at_cashier', route: { departmentId: 'dept_gop', department: 'General outpatient', doctor: 'Dr. Okafor' }, hmo: null, charges: [cons('ch_1a', 'General outpatient', 3000, 3), drug('ch_1b', 'Artemether-Lumefantrine', 1, 1200, 1), drug('ch_1c', 'Paracetamol 500mg', 10, 90, 1)], openedAt: hoursAgo(3) },
    { ...visitBase, id: 'vi_2', visitNo: 'V-DEMO-0002', patientId: 'pt_2', patientName: 'Ngozi Adeleke', dibiaId: 'DBA-3PZ8-N4RD', status: 'at_pharmacy', route: { departmentId: 'dept_ante', department: 'Antenatal', doctor: 'Dr. Bassey' }, hmo: { scheme: 'Hygeia HMO', memberId: 'HYG-220981' }, charges: [cons('ch_2a', 'Antenatal', 5000, 2)], openedAt: hoursAgo(2) },
    { ...visitBase, id: 'vi_3', visitNo: 'V-DEMO-0003', patientId: 'pt_3', patientName: 'Emeka Nnamdi', dibiaId: 'DBA-Y5T1-B7HC', status: 'with_doctor', route: { departmentId: 'dept_gop', department: 'General outpatient', doctor: 'Dr. Okafor' }, hmo: null, charges: [cons('ch_3a', 'General outpatient', 3000, 1)], openedAt: hoursAgo(1) },
    { ...visitBase, id: 'vi_4', visitNo: 'V-DEMO-0004', patientId: 'pt_4', patientName: 'Blessing Uche', dibiaId: 'DBA-D8W2-F6JE', status: 'waiting', route: { departmentId: 'dept_paed', department: 'Paediatrics', doctor: '' }, hmo: null, charges: [cons('ch_4a', 'Paediatrics', 4000, 0.5)], openedAt: hoursAgo(0.5) },
    { ...visitBase, id: 'vi_5', visitNo: 'V-DEMO-0005', patientId: 'pt_5', patientName: 'Musa Ibrahim', dibiaId: 'DBA-H1V6-K0GS', status: 'waiting', route: { departmentId: 'dept_emerg', department: 'Emergency', doctor: '', emergency: true }, hmo: null, charges: [cons('ch_5a', 'Emergency', 6000, 0.3)], openedAt: hoursAgo(0.3) },
    { ...visitBase, id: 'vi_6', visitNo: 'V-DEMO-0006', patientId: 'pt_6', patientName: 'Adaora Eze', dibiaId: 'DBA-R4C9-M2ZT', status: 'waiting', route: { departmentId: null, department: '', doctor: '' }, hmo: null, charges: [], openedAt: hoursAgo(0.1) },
    { ...visitBase, id: 'vi_old', visitNo: 'V-DEMO-0000', patientId: 'pt_1', patientName: 'Chinedu Okeke', dibiaId: 'DBA-7K2M-Q9XA', status: 'closed', closedReason: 'discharged', route: { departmentId: 'dept_gop', department: 'General outpatient', doctor: 'Dr. Okafor' }, hmo: null, charges: [cons('ch_0a', 'General outpatient', 3000, 720)], openedAt: daysFromNow(-30) },
  ].map((v) => ({ createdAt: v.openedAt, updatedAt: v.openedAt, ...v }))

  const oldLines = [{ id: 'ch_0a', type: 'consultation', label: 'Consultation, General outpatient', qty: 1, unitPrice: 3500, amount: 3500 }]
  const payments = [
    { id: 'pay_old', receiptNo: 'RCP-DEMO01', type: 'payment', visitId: 'vi_old', visitNo: 'V-DEMO-0000', patientId: 'pt_1', patientName: 'Chinedu Okeke', dibiaId: 'DBA-7K2M-Q9XA', hospitalId: P, branchId: B, methods: [{ method: 'cash', amount: 3762.5 }], amount: 3762.5, lines: oldLines, totals: { subtotal: 3500, vat: 262.5, total: 3762.5 }, cashierId: 'st_h_cash', cashierName: 'Bola Adeyemi', note: '', createdAt: daysFromNow(-30), updatedAt: daysFromNow(-30) },
    { id: 'pay_2', receiptNo: 'RCP-DEMO02', type: 'payment', visitId: 'vi_2', visitNo: 'V-DEMO-0002', patientId: 'pt_2', patientName: 'Ngozi Adeleke', dibiaId: 'DBA-3PZ8-N4RD', hospitalId: P, branchId: B, methods: [{ method: 'pos', amount: 2000 }], amount: 2000, lines: [{ id: 'ch_2a', type: 'consultation', label: 'Consultation, Antenatal', qty: 1, unitPrice: 5000, amount: 5000 }], totals: { subtotal: 5500, vat: 412.5, total: 5912.5 }, cashierId: 'st_h_cash', cashierName: 'Bola Adeyemi', note: '', createdAt: hoursAgo(1.5), updatedAt: hoursAgo(1.5) },
  ]

  const audit_log = [
    { id: 'au_h_1', hospitalId: P, action: 'patient.registered', ref: 'Adaora Eze Â· V-DEMO-0006', actorId: 'st_h_recep', at: hoursAgo(0.1) },
    { id: 'au_h_2', hospitalId: P, action: 'payment.recorded', ref: 'RCP-DEMO02 Â· Ngozi Adeleke', actorId: 'st_h_cash', amount: 2000, at: hoursAgo(1.5) },
  ]

  return { hospitals, branches, staff, staff_roles, products, patients, visits, payments, audit_log }
}

export async function ensureHospitalSeed() {
  const db = await getDB()
  const existing = await db.get('hospitals', HOSPITAL_ID)
  if (existing) return false

  const data = buildHospital()
  const stores = Object.keys(data)
  const tx = db.transaction(stores, 'readwrite')
  for (const store of stores) {
    for (const row of data[store]) {
      await tx.objectStore(store).put(row)
    }
  }
  await tx.done
  return true
}

// Pharmacy demo data for the hospital tenant: multi-batch stock, a controlled
// drug, an expired-only drug, prescriptions that trigger allergy, interaction
// and controlled-drug prompts. Additive, so databases seeded earlier get it too.
export async function ensureHospitalPharmacySeed() {
  const db = await getDB()
  if (!(await db.get('hospitals', HOSPITAL_ID))) return false
  if (await db.get('products', 'pd_h_warf')) return false

  const P = HOSPITAL_ID
  const B = HOSP_BRANCH
  const day = 86_400_000
  const inDays = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10)
  const now = iso(new Date())

  const drug = (id, name, generic, category, price, extra = {}) => ({
    id, hospitalId: P, branchId: B, name, genericName: generic, category, unit: 'tablet', packSize: 10, cartonSize: 10,
    price, costPrice: Math.round(price * 0.5), rx: true, controlled: false, thresholdOverride: null, createdAt: now, updatedAt: now, ...extra,
  })
  const products = [
    drug('pd_h_para', 'Paracetamol 500mg', 'paracetamol', 'Analgesics', 90, { rx: false, barcode: '6008800000011' }),
    drug('pd_h_amox', 'Amoxicillin 500mg', 'amoxicillin', 'Antibiotics', 240, { unit: 'capsule', barcode: '6008800000028' }),
    drug('pd_h_artem', 'Artemether-Lumefantrine', 'artemether-lumefantrine', 'Antimalarials', 1200, { barcode: '6008800000035' }),
    drug('pd_h_ors', 'ORS Sachets', 'oral rehydration salts', 'Rehydration', 70, { unit: 'sachet', rx: false, barcode: '6008800000042' }),
    drug('pd_h_tram', 'Tramadol 50mg', 'tramadol', 'Analgesics', 300, { unit: 'capsule', controlled: true }),
    drug('pd_h_warf', 'Warfarin 5mg', 'warfarin', 'Anticoagulants', 250),
    drug('pd_h_diclo', 'Diclofenac 50mg', 'diclofenac', 'Analgesics', 120, { rx: false }),
    drug('pd_h_flag', 'Amoxil Brand 500mg', 'amoxicillin', 'Antibiotics', 520, { unit: 'capsule' }),
  ]
  const batch = (id, productId, batchNo, expiry, received, balance, extra = {}) => ({
    id, hospitalId: P, branchId: B, productId, batchNo, mfgDate: null, expiry, received, balance,
    cost: 0, price: 0, supplier: 'MedPlus Distributors', receivedBy: 'st_h_pharm', receivedByName: 'Chuka Eze',
    receivedAt: hoursAgo(24 * 20), createdAt: now, updatedAt: now, ...extra,
  })
  const price = new Map(products.map((p) => [p.id, p]))
  const batches = [
    batch('bt_para_a', 'pd_h_para', 'DH-PARA-00', inDays(45), 300, 120),
    batch('bt_para_b', 'pd_h_para', 'DH-PARA-01', inDays(210), 300, 280),
    batch('bt_amox_a', 'pd_h_amox', 'DH-AMOX-02', inDays(38), 100, 20),
    batch('bt_artem_a', 'pd_h_artem', 'DH-AL-03', inDays(300), 100, 80),
    batch('bt_ors_a', 'pd_h_ors', 'DH-ORS-04', inDays(-12), 60, 12),
    batch('bt_tram_a', 'pd_h_tram', 'DH-TRAM-05', inDays(400), 80, 60),
    batch('bt_warf_a', 'pd_h_warf', 'DH-WARF-06', inDays(500), 60, 40),
    batch('bt_diclo_a', 'pd_h_diclo', 'DH-DICLO-07', inDays(240), 120, 90),
    batch('bt_flag_a', 'pd_h_flag', 'DH-AMOXIL-08', inDays(320), 40, 30),
  ].map((b) => ({ ...b, price: price.get(b.productId).price, cost: price.get(b.productId).costPrice }))
  for (const p of products) {
    const list = batches.filter((b) => b.productId === p.id)
    p.quantity = list.reduce((sum, b) => sum + b.balance, 0)
    p.initialStock = list.reduce((sum, b) => sum + b.received, 0)
    p.reorderLevel = Math.ceil(p.initialStock * 0.25)
  }
  const movements = batches.map((b) => ({
    id: `mv_${b.id}`, hospitalId: P, branchId: B, productId: b.productId, productName: price.get(b.productId).name,
    batchId: b.id, batchNo: b.batchNo, type: 'receipt', qty: b.received, batchBefore: 0, batchAfter: b.received,
    stockBefore: 0, stockAfter: b.received, staffId: 'st_h_pharm', staffName: 'Chuka Eze', ref: 'From MedPlus Distributors', reason: '', at: b.receivedAt,
  }))

  const rxLine = (id, name, productId, dose, frequency, duration, qty) => ({ id, status: 'pending', dispensedQty: 0, drugName: name, productId, dose, frequency, duration, qty })
  const prescriptions = [
    { id: 'rx_1', hospitalId: P, branchId: B, visitId: 'vi_2', visitNo: 'V-DEMO-0002', patientId: 'pt_2', patientName: 'Ngozi Adeleke', dibiaId: 'DBA-3PZ8-N4RD', source: 'dibia', prescriber: 'Dr. Bassey', status: 'pending', createdAt: hoursAgo(1.2), updatedAt: hoursAgo(1.2),
      lines: [rxLine('rl_1a', 'Amoxicillin 500mg', 'pd_h_amox', '500mg', 'Three times daily', '7 days', 21), rxLine('rl_1b', 'Paracetamol 500mg', 'pd_h_para', '500mg', 'When needed for pain', '5 days', 10)] },
    { id: 'rx_2', hospitalId: P, branchId: B, visitId: 'vi_3', visitNo: 'V-DEMO-0003', patientId: 'pt_3', patientName: 'Emeka Nnamdi', dibiaId: 'DBA-Y5T1-B7HC', source: 'dibia', prescriber: 'Dr. Okafor', status: 'pending', createdAt: hoursAgo(0.4), updatedAt: hoursAgo(0.4),
      lines: [rxLine('rl_2a', 'Warfarin 5mg', 'pd_h_warf', '5mg', 'Once daily', '30 days', 30), rxLine('rl_2b', 'Diclofenac 50mg', 'pd_h_diclo', '50mg', 'Twice daily', '5 days', 10), rxLine('rl_2c', 'Tramadol 50mg', 'pd_h_tram', '50mg', 'Every 8 hours when needed', '3 days', 9), rxLine('rl_2d', 'ORS Sachets', 'pd_h_ors', '1 sachet', 'After each loose stool', '3 days', 6)] },
  ]
  const pinHash = await hashPin('1234', 'st_h_pharm')
  const tx = db.transaction(['products', 'batches', 'stock_movements', 'prescriptions', 'patients', 'staff', 'visits'], 'readwrite')
  for (const p of products) await tx.objectStore('products').put(p)
  for (const b of batches) await tx.objectStore('batches').put(b)
  for (const m of movements) await tx.objectStore('stock_movements').put(m)
  for (const r of prescriptions) await tx.objectStore('prescriptions').put(r)
  const pt2 = await tx.objectStore('patients').get('pt_2')
  if (pt2) await tx.objectStore('patients').put({ ...pt2, allergies: 'Penicillin' })
  const pharm = await tx.objectStore('staff').get('st_h_pharm')
  if (pharm) await tx.objectStore('staff').put({ ...pharm, pinHash })
  const vi3 = await tx.objectStore('visits').get('vi_3')
  if (vi3) await tx.objectStore('visits').put({ ...vi3, status: 'at_pharmacy' })
  await tx.done
  return true
}
