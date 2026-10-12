// Demo seed data for the console — the hospitals registered on Dibia, replaced
// by the billing/registry service later (FRONTEND_SPEC §7).
//
// hospital.status: 'active' | 'pending' | 'failed' | 'suspended'
//   pending  → awaiting Dibia's approval (shows in the approval queue)
//   failed   → last subscription payment failed
//   suspended→ access turned off by an admin

export function initialData() {
  const defaultModules = ['Reception', 'Queue', 'Cashier', 'Pharmacy', 'Inventory', 'Reports']
  return {
    hospitals: [
      { id: 'hosp_dibia_general', name: 'Dibia General Hospital', location: 'Aba, Abia State', branches: 3, staff: 34, plan: 'Small', status: 'active', modules: [...defaultModules], registeredAt: '2026-06-10' },
      { id: 'hosp_grace', name: 'Grace Medical Centre', location: 'Lagos, Lagos State', branches: 1, staff: 5, plan: 'Small', status: 'pending', modules: ['Reception', 'Queue'], registeredAt: '2026-08-18' },
      { id: 'hosp_sunrise', name: 'Sunrise Specialist Hospital', location: 'Kano, Kano State', branches: 1, staff: 4, plan: 'Small', status: 'pending', modules: ['Reception', 'Queue'], registeredAt: '2026-08-20' },
      { id: 'hosp_wellcare', name: 'Wellcare Community Hospital', location: 'Enugu, Enugu State', branches: 2, staff: 19, plan: 'Small', status: 'active', modules: [...defaultModules], registeredAt: '2026-05-22' },
      { id: 'hosp_citycare', name: 'CityCare Hospital', location: 'Ibadan, Oyo State', branches: 1, staff: 8, plan: 'Small', status: 'failed', modules: ['Reception', 'Queue', 'Cashier'], registeredAt: '2026-07-01' },
      { id: 'hosp_northgate', name: 'Northgate Hospital', location: 'Kaduna, Kaduna State', branches: 2, staff: 15, plan: 'Small', status: 'active', modules: [...defaultModules], registeredAt: '2026-04-14' },
      { id: 'hosp_riverside', name: 'Riverside General Hospital', location: 'Port Harcourt, Rivers State', branches: 1, staff: 6, plan: 'Small', status: 'active', modules: [...defaultModules], registeredAt: '2026-03-30' },
      { id: 'hosp_harmony', name: 'Harmony Medical Centre', location: 'Abuja, FCT', branches: 4, staff: 41, plan: 'Medium', status: 'active', modules: [...defaultModules], registeredAt: '2026-02-11' },
      { id: 'hosp_bluecross', name: 'Bluecross Hospital', location: 'Benin City, Edo State', branches: 1, staff: 7, plan: 'Freemium', status: 'active', modules: ['Reception', 'Queue'], registeredAt: '2026-07-19' },
    ],

    // Recent subscription charges across the platform.
    transactions: [
      { id: 'tx_1', hospitalId: 'hosp_harmony', hospitalName: 'Harmony Medical Centre', plan: 'Medium', amount: 250000, date: '2026-08-06', status: 'paid' },
      { id: 'tx_2', hospitalId: 'hosp_bluecross', hospitalName: 'Bluecross Hospital', plan: 'Freemium', amount: 0, date: '2026-08-06', status: 'paid' },
      { id: 'tx_3', hospitalId: 'hosp_northgate', hospitalName: 'Northgate Hospital', plan: 'Small', amount: 25000, date: '2026-08-04', status: 'paid' },
      { id: 'tx_4', hospitalId: 'hosp_dibia_general', hospitalName: 'Dibia General Hospital', plan: 'Small', amount: 25000, date: '2026-08-03', status: 'paid' },
      { id: 'tx_5', hospitalId: 'hosp_wellcare', hospitalName: 'Wellcare Community Hospital', plan: 'Small', amount: 25000, date: '2026-08-02', status: 'paid' },
      { id: 'tx_6', hospitalId: 'hosp_riverside', hospitalName: 'Riverside General Hospital', plan: 'Small', amount: 25000, date: '2026-08-02', status: 'paid' },
      { id: 'tx_7', hospitalId: 'hosp_citycare', hospitalName: 'CityCare Hospital', plan: 'Small', amount: 25000, date: '2026-08-01', status: 'failed' },
    ],

    // Support tickets raised by registered hospitals.
    tickets: [
      { id: 'tk_1', hospitalId: 'hosp_dibia_general', hospitalName: 'Dibia General Hospital', issue: 'Sync failing on Port Harcourt branch device', priority: 'high', status: 'open', reply: '' },
      { id: 'tk_2', hospitalId: 'hosp_citycare', hospitalName: 'CityCare Hospital', issue: 'Requesting payment retry', priority: 'medium', status: 'open' },
      { id: 'tk_3', hospitalId: 'hosp_wellcare', hospitalName: 'Wellcare Community Hospital', issue: 'Barcode scanner not detected', priority: 'medium', status: 'resolved' },
    ],
  }
}
