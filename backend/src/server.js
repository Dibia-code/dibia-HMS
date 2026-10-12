import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import jwt from 'jsonwebtoken'
import { canWriteEntity, sanitizeSyncPayload } from './policy.js'
import { applyFirestoreSync, firestoreStatus, getFirebaseAuth, getFirestoreStore, readFirestoreChanges, readFirestoreSnapshot } from './firestore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dbFile = path.resolve(root, process.env.DB_FILE || './data/dibia.sqlite')
fs.mkdirSync(path.dirname(dbFile), { recursive: true })

const PORT = Number(process.env.PORT || 4000)
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
const production = process.env.NODE_ENV === 'production'
const minPasswordLength = production ? 12 : 8
const JWT_SECRET = process.env.JWT_SECRET || (production ? '' : 'local-development-secret-change-me')
const origins = String(process.env.FRONTEND_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5175,http://localhost:5175').split(',').map((value) => value.trim()).filter(Boolean)
if (production) {
  const problems = []
  if (JWT_SECRET.length < 32 || /change-me|replace-|development|generate-a-unique/i.test(JWT_SECRET)) problems.push('JWT_SECRET must be a unique random secret of at least 32 characters')
  if (String(process.env.DEMO_MODE).toLowerCase() === 'true') problems.push('DEMO_MODE must be false')
  if (String(process.env.DATA_STORE || 'sqlite').toLowerCase() !== 'firestore') problems.push('DATA_STORE must be firestore; SQLite is local development storage, not an offline fallback')
  if (!origins.length || origins.some((origin) => !origin.startsWith('https://'))) problems.push('FRONTEND_ORIGINS must contain only exact HTTPS origins')
  if (!process.env.FIREBASE_PROJECT_ID || /^your-/i.test(process.env.FIREBASE_PROJECT_ID) || !process.env.FIREBASE_WEB_API_KEY || /^your-/i.test(process.env.FIREBASE_WEB_API_KEY)) problems.push('FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY are required')
  if (String(process.env.CONSOLE_ADMIN_PASSWORD || '').length < 16) problems.push('CONSOLE_ADMIN_PASSWORD must be at least 16 characters')
  if (!String(process.env.CONSOLE_ADMIN_EMAIL || '').includes('@') || /example\.com$/i.test(process.env.CONSOLE_ADMIN_EMAIL || '')) problems.push('CONSOLE_ADMIN_EMAIL must be a real admin address')
  if (!process.env.DB_FILE || !path.isAbsolute(process.env.DB_FILE)) problems.push('DB_FILE must be an absolute path on a persistent encrypted volume for platform control-plane data')
  if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join('; ')}`)
}
const db = new Database(dbFile)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    logo_url TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_settings (
    id TEXT PRIMARY KEY,
    value_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    address TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    branch_id TEXT REFERENCES branches(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    profession TEXT,
    password_hash TEXT NOT NULL,
    roles_json TEXT NOT NULL DEFAULT '[]',
    perm_grants_json TEXT NOT NULL DEFAULT '[]',
    perm_denies_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS refresh_sessions (
    id TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL REFERENCES staff(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_refresh_sessions (
    id TEXT PRIMARY KEY,
    platform_user_id TEXT NOT NULL REFERENCES platform_users(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS modules (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    pricing_model TEXT NOT NULL DEFAULT 'included',
    price_minor INTEGER NOT NULL DEFAULT 0,
    config_schema_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS module_dependencies (
    module_id TEXT NOT NULL REFERENCES modules(id),
    dependency_module_id TEXT NOT NULL REFERENCES modules(id),
    PRIMARY KEY (module_id, dependency_module_id)
  );
  CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    price_minor INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'NGN',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plan_modules (
    plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
    module_id TEXT NOT NULL REFERENCES modules(id),
    PRIMARY KEY (plan_id, module_id)
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
    status TEXT NOT NULL DEFAULT 'trialing',
    starts_at TEXT NOT NULL,
    renews_at TEXT,
    grace_ends_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS module_entitlements (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    module_id TEXT NOT NULL REFERENCES modules(id),
    source TEXT NOT NULL DEFAULT 'plan',
    status TEXT NOT NULL DEFAULT 'entitled',
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    PRIMARY KEY (tenant_id, module_id)
  );
  CREATE TABLE IF NOT EXISTS tenant_modules (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    module_id TEXT NOT NULL REFERENCES modules(id),
    status TEXT NOT NULL DEFAULT 'disabled',
    settings_json TEXT NOT NULL DEFAULT '{}',
    activated_by TEXT,
    activated_at TEXT,
    PRIMARY KEY (tenant_id, module_id)
  );
  CREATE TABLE IF NOT EXISTS platform_audit_logs (
    id TEXT PRIMARY KEY,
    platform_user_id TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    record_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_operations (
    tenant_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, op_id)
  );
  CREATE TABLE IF NOT EXISTS records (
    tenant_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    record_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, entity, record_id)
  );
  CREATE TABLE IF NOT EXISTS sync_changes (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT,
    record_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  );
`)

for (const [column, definition] of [['perm_grants_json', "TEXT NOT NULL DEFAULT '[]'"], ['perm_denies_json', "TEXT NOT NULL DEFAULT '[]'"]]) {
  try { db.exec(`ALTER TABLE staff ADD COLUMN ${column} ${definition}`) } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error }
}

if (production && db.prepare("SELECT 1 FROM tenants WHERE slug = 'demohospital' OR id IN ('ph_johncool', 'ph_dibia', 'ph_demo_hosp') LIMIT 1").get()) {
  throw new Error('Unsafe production database: demo/PMS tenant seed data is present; use a clean production database and migrate approved hospital data explicitly')
}

try { db.prepare("ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'").run() } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error }
for (const [column, definition] of [['address', 'TEXT'], ['phone', 'TEXT']]) {
  try { db.exec(`ALTER TABLE tenants ADD COLUMN ${column} ${definition}`) } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS platform_support_tickets (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), issue TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open',
    reply TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_messages (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), body TEXT NOT NULL,
    sent_by TEXT NOT NULL, created_at TEXT NOT NULL
  );
`)

const now = () => new Date().toISOString()
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const json = (value) => JSON.stringify(value ?? {})
const parse = (value, fallback = {}) => {
  try { return value ? JSON.parse(value) : fallback } catch { return fallback }
}

function seedDemoData() {
  const preferredTenantId = 'hosp_demo'
  const preferredBranchId = 'br_demo_hosp'
  const timestamp = now()
  const insertTenant = db.prepare('INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)')
  const insertBranch = db.prepare('INSERT INTO branches (id, tenant_id, name, address, created_at) VALUES (?, ?, ?, ?, ?)')
  const insertStaff = db.prepare('INSERT INTO staff (id, tenant_id, branch_id, name, email, phone, profession, password_hash, roles_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const demoAccounts = [
    ['staff_demohospital_admin', 'Ifeoma Nwachukwu', 'admin@demohospital.ng', '+2348035550101', 'Hospital administrator', ['facility_admin']],
    ['staff_demohospital_doctor', 'Dr. Daniel Okafor', 'doctor@demohospital.ng', '+2348035550105', 'Doctor', ['doctor']],
    ['staff_demohospital_nurse', 'Sarah Eze', 'nurse@demohospital.ng', '+2348035550106', 'Nurse', ['nurse']],
    ['staff_demohospital_lab', 'Ikenna Obi', 'lab@demohospital.ng', '+2348035550107', 'Laboratory technician', ['laboratory_technician']],
    ['staff_demohospital_reception', 'Amaka Obi', 'reception@demohospital.ng', '+2348035550102', 'Receptionist', ['receptionist']],
    ['staff_demohospital_cashier', 'Bola Adeyemi', 'cashier@demohospital.ng', '+2348035550103', 'Payments staff', ['cashier']],
    ['staff_demohospital_pharmacy', 'Chuka Eze', 'pharmacy@demohospital.ng', '+2348035550104', 'Pharmacist', ['pharmacist']],
    ['staff_demohospital_manager', 'Adaeze John', 'manager@demohospital.ng', '+2348035550108', 'Hospital management', ['ceo_owner']],
    ['staff_demohospital_patient', 'Musa Ibrahim', 'patient@demohospital.ng', '+2348035550109', 'Patient', ['patient']],
    ['staff_demohospital_hr', 'Ngozi Eze', 'hr@demohospital.ng', '+2348035550110', 'HR Officer', ['hr_officer']],
  ]
  const transaction = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM tenants WHERE slug = ?').get('demohospital')
    const tenantId = existing?.id || preferredTenantId
    if (!existing) {
      insertTenant.run(tenantId, 'demohospital', 'Demo Hospital', timestamp)
    }
    const existingBranch = db.prepare('SELECT id FROM branches WHERE tenant_id = ? ORDER BY created_at LIMIT 1').get(tenantId)
    const branchId = existingBranch?.id || preferredBranchId
    if (!existingBranch) insertBranch.run(branchId, tenantId, 'Main Branch', 'Demo Hospital Road, Nigeria', timestamp)
    for (const [staffId, name, email, phone, profession, roles] of demoAccounts) {
      insertStaff.run(staffId, tenantId, branchId, name, email, phone, profession, bcrypt.hashSync('DemoPass123!', 12), json(roles), timestamp, timestamp)
    }
  })
  try {
    transaction()
  } catch (error) {
    if (!String(error.message).includes('UNIQUE constraint failed: staff.email')) throw error
    // Existing demo installations already have the administrator row. Add any
    // missing dashboard accounts without replacing user-managed credentials.
    const existingTenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get('demohospital')
    if (!existingTenant) throw error
    const branch = db.prepare('SELECT id FROM branches WHERE tenant_id = ? ORDER BY created_at LIMIT 1').get(existingTenant.id)
    for (const [staffId, name, email, phone, profession, roles] of demoAccounts) {
      db.prepare('INSERT OR IGNORE INTO staff (id, tenant_id, branch_id, name, email, phone, profession, password_hash, roles_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(staffId, existingTenant.id, branch?.id || null, name, email, phone, profession, bcrypt.hashSync('DemoPass123!', 12), json(roles), timestamp, timestamp)
    }
  }
  const demoTenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get('demohospital')
  if (demoTenant && !db.prepare('SELECT id FROM platform_support_tickets WHERE tenant_id = ? LIMIT 1').get(demoTenant.id)) {
    db.prepare('INSERT INTO platform_support_tickets (id, tenant_id, issue, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('ticket_demo_sync', demoTenant.id, 'Sync reported as failed on a reception device', 'high', 'open', timestamp, timestamp)
  }
}
if (String(process.env.DEMO_MODE || '').toLowerCase() === 'true') seedDemoData()

function seedPlatform() {
  const timestamp = now()
  const bootstrapEmail = String(process.env.CONSOLE_ADMIN_EMAIL || process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase()
  const bootstrapPassword = String(process.env.CONSOLE_ADMIN_PASSWORD || process.env.PLATFORM_ADMIN_PASSWORD || '')
  if (bootstrapEmail && bootstrapPassword.length >= 12) {
    const platformUser = db.prepare('INSERT INTO platform_users (id, name, email, password_hash, roles_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at, active = 1')
    platformUser.run('platform_admin_bootstrap', 'Dibia Platform Super Admin', bootstrapEmail, bcrypt.hashSync(bootstrapPassword, 12), json(['platform_super_admin']), timestamp, timestamp)
  }

  const modules = [
    ['mod_reception', 'reception', 'Reception', 'Patient registration and identity capture', 'operations', 'included', 0],
    ['mod_queue', 'queue', 'Queue', 'Care routing and visit flow', 'operations', 'included', 0],
    ['mod_cashier', 'cashier', 'Cashier', 'Patient billing and payment collection', 'finance', 'included', 0],
    ['mod_inventory', 'inventory', 'Inventory', 'Hospital stock and supplies', 'operations', 'subscription', 1500000],
    ['mod_reports', 'reports', 'Reports', 'Hospital operational reports', 'administration', 'included', 0],
    ['mod_patient', 'patient-management', 'Patient Management', 'Central patient registry, identity and visit history', 'core', 'included', 0],
    ['mod_appointments', 'appointments', 'Appointments', 'Scheduling, follow-ups and reminders', 'operations', 'included', 0],
    ['mod_emr', 'emr', 'Electronic Medical Records', 'Clinical encounters, diagnoses and medical notes', 'clinical', 'subscription', 2500000],
    ['mod_laboratory', 'laboratory', 'Laboratory Management', 'Requests, samples, results and verification', 'clinical', 'subscription', 1800000],
    ['mod_pharmacy', 'pharmacy', 'Pharmacy Management', 'Prescriptions, dispensing and medicine stock', 'clinical', 'subscription', 1800000],
    ['mod_billing', 'billing', 'Billing & Accounts', 'Invoices, payments, receipts and insurance', 'finance', 'subscription', 1500000],
    ['mod_inpatient', 'inpatient', 'Inpatient Management', 'Admissions, wards, beds and discharge', 'clinical', 'subscription', 2200000],
    ['mod_radiology', 'radiology', 'Radiology & Imaging', 'Imaging requests, worklists and reports', 'clinical', 'addon', 2000000],
    ['mod_hr', 'hr', 'HR & Payroll', 'Staff, attendance, leave and payroll', 'administration', 'addon', 1200000],
    ['mod_analytics', 'analytics', 'Advanced Analytics', 'Cross-department operational insights', 'administration', 'addon', 1400000],
    ['mod_telemedicine', 'telemedicine', 'Telemedicine', 'Remote consultations and secure sessions', 'clinical', 'addon', 1600000],
  ]
  const insertModule = db.prepare('INSERT OR IGNORE INTO modules (id, code, name, description, category, version, status, pricing_model, price_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const [idValue, code, name, description, category, pricingModel, priceMinor] of modules) {
    insertModule.run(idValue, code, name, description, category, '1.0.0', 'published', pricingModel, priceMinor, timestamp, timestamp)
  }
  const plan = db.prepare('INSERT OR IGNORE INTO subscription_plans (id, code, name, price_minor, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  plan.run('plan_professional', 'professional', 'Professional', 9500000, 'NGN', 'active', timestamp, timestamp)
  for (const [code, name, fee] of [['freemium', 'Freemium', 0], ['small', 'Small', 25000], ['medium', 'Medium', 150000], ['large', 'Large', 600000]]) {
    plan.run(`plan_${code}`, code, name, fee * 100, 'NGN', 'active', timestamp, timestamp)
  }
  if (String(process.env.DEMO_MODE || '').toLowerCase() === 'true') {
    const demoFacilities = [
      { id: 'hosp_grace', slug: 'grace-medical-centre', name: 'Grace Medical Centre', address: 'Lagos, Lagos State', status: 'pending', planId: 'plan_freemium', subscriptionStatus: 'active' },
      { id: 'hosp_citycare', slug: 'citycare-hospital', name: 'CityCare Hospital', address: 'Ibadan, Oyo State', status: 'active', planId: 'plan_small', subscriptionStatus: 'past_due' },
    ]
    for (const facility of demoFacilities) {
      db.prepare('INSERT OR IGNORE INTO tenants (id, slug, name, address, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(facility.id, facility.slug, facility.name, facility.address, facility.status, timestamp)
      db.prepare('INSERT OR IGNORE INTO branches (id, tenant_id, name, address, created_at) VALUES (?, ?, ?, ?, ?)').run(`${facility.id}_main`, facility.id, 'Main Branch', facility.address, timestamp)
      db.prepare('INSERT OR IGNORE INTO subscriptions (id, tenant_id, plan_id, status, starts_at, renews_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`${facility.id}_subscription`, facility.id, facility.planId, facility.subscriptionStatus, timestamp, new Date(Date.now() + 30 * 86400000).toISOString(), timestamp, timestamp)
    }
    db.prepare('INSERT OR IGNORE INTO platform_support_tickets (id, tenant_id, issue, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('ticket_demo_payment', 'hosp_citycare', 'Please confirm our subscription payment', 'medium', 'open', timestamp, timestamp)
  }
  const planModule = db.prepare('INSERT OR IGNORE INTO plan_modules (plan_id, module_id) SELECT ?, id FROM modules WHERE code IN (?, ?, ?, ?, ?, ?, ?)')
  planModule.run('plan_professional', 'patient-management', 'appointments', 'emr', 'laboratory', 'pharmacy', 'billing', 'inpatient')

  const demoTenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get('demohospital')
  if (!demoTenant) return
  const subscription = db.prepare('INSERT OR IGNORE INTO subscriptions (id, tenant_id, plan_id, status, starts_at, renews_at, grace_ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  subscription.run('sub_demohospital_professional', demoTenant.id, 'plan_small', 'active', timestamp, new Date(Date.now() + 30 * 86400000).toISOString(), new Date(Date.now() + 37 * 86400000).toISOString(), timestamp, timestamp)
  const entitlement = db.prepare('INSERT OR IGNORE INTO module_entitlements (tenant_id, module_id, source, status, starts_at) SELECT ?, id, ?, ?, ? FROM modules WHERE code IN (?, ?, ?, ?, ?, ?, ?)')
  entitlement.run(demoTenant.id, 'professional-plan', 'entitled', timestamp, 'patient-management', 'appointments', 'emr', 'laboratory', 'pharmacy', 'billing', 'inpatient')
  const tenantModule = db.prepare('INSERT OR IGNORE INTO tenant_modules (tenant_id, module_id, status, activated_by, activated_at) SELECT ?, id, ?, ?, ? FROM modules WHERE code IN (?, ?, ?, ?, ?, ?, ?)')
  tenantModule.run(demoTenant.id, 'enabled', 'platform_admin_bootstrap', timestamp, 'patient-management', 'appointments', 'emr', 'laboratory', 'pharmacy', 'billing', 'inpatient')
}
seedPlatform()

const app = express()
app.disable('x-powered-by')
if (production) app.set('trust proxy', 1)
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  })
  next()
})
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
app.use(cors({ origin: (origin, callback) => !origin || origins.includes(origin) ? callback(null, true) : callback(new Error('Origin not allowed')), credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }))
app.use(express.json({ limit: '256kb', strict: true }))
app.use(cookieParser())

// Cookie-authenticated endpoints are vulnerable to cross-site request forgery.
// Restrict browser state changes to the explicitly configured app origins.
app.use((req, res, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next()
  const origin = req.get('origin')
  if (origin && !origins.includes(origin)) return res.status(403).json({ message: 'Request origin is not allowed' })
  if (production && !origin) return res.status(403).json({ message: 'Origin header is required' })
  next()
})

// Basic per-process credential throttling; production deployments must also
// apply a shared rate limit at the gateway/load balancer for multi-instance use.
const authAttempts = new Map()
function limitAuthAttempts(req, res, next) {
  const key = `${req.path}:${req.ip}`
  const current = authAttempts.get(key)
  const time = Date.now()
  if (current && current.resetAt <= time) authAttempts.delete(key)
  const recent = authAttempts.get(key) || { count: 0, resetAt: time + 15 * 60 * 1000 }
  if (recent.count >= 10) return res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' })
  recent.count += 1
  authAttempts.set(key, recent)
  if (authAttempts.size > 5000) {
    for (const [attemptKey, value] of authAttempts) if (value.resetAt <= time) authAttempts.delete(attemptKey)
  }
  next()
}

function issueAccess(staff) {
  return jwt.sign({ sub: staff.id, tenantId: staff.tenant_id, roles: parse(staff.roles_json, []), aud: 'hospital' }, JWT_SECRET, { expiresIn: '15m' })
}

function issuePlatformAccess(user) {
  return jwt.sign({ sub: user.id, roles: parse(user.roles_json, []), aud: 'platform' }, JWT_SECRET, { expiresIn: '15m' })
}

function publicSession(staff, tenant, branch) {
  return {
    user: { id: staff.id, name: staff.name, email: staff.email, roles: parse(staff.roles_json, []), hospitalId: tenant.id, hospitalSlug: tenant.slug, hospitalName: tenant.name, branchId: branch?.id || staff.branch_id || null },
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, logoUrl: tenant.logo_url || null },
    branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
  }
}

function firebaseSession(profile, tenant, branch = null) {
  const roles = profile.roles || ['facility_admin']
  const accessToken = jwt.sign({ sub: profile.id, tenantId: profile.tenantId, roles, aud: 'hospital' }, JWT_SECRET, { expiresIn: '15m' })
  return {
    accessToken,
    user: { id: profile.id, name: profile.name, email: profile.email, roles, hospitalId: profile.tenantId, hospitalSlug: tenant.slug, hospitalName: tenant.name, branchId: profile.branchId || branch?.id || null },
    tenant,
    branch,
  }
}

function setRefreshCookie(res, token) {
  res.cookie('dibia_refresh', token, { httpOnly: true, sameSite: production ? 'strict' : 'lax', secure: production, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 })
}

function setConsoleRefreshCookie(res, token) {
  res.cookie('dibia_console_refresh', token, { httpOnly: true, sameSite: production ? 'strict' : 'lax', secure: production, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 })
}

async function firebasePasswordSignIn(identifier, password) {
  const apiKey = String(process.env.FIREBASE_WEB_API_KEY || '').trim()
  if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY is required for Firebase password authentication')
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identifier, password, returnSecureToken: true }) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || 'Invalid login details')
  return payload
}

async function firebaseRefresh(rawRefreshToken) {
  const apiKey = String(process.env.FIREBASE_WEB_API_KEY || '').trim()
  if (!apiKey) return null
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rawRefreshToken }) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) return null
  return payload
}

async function firestoreHospitalSession(idToken) {
  const auth = getFirebaseAuth()
  const decoded = await auth.verifyIdToken(idToken)
  const db = getFirestoreStore()
  const profileSnapshot = await db.collection('staffProfiles').doc(decoded.uid).get()
  if (!profileSnapshot.exists) throw new Error('Hospital account profile not found')
  const profile = { id: decoded.uid, ...profileSnapshot.data() }
  if (profile.active === false) throw new Error('This account is deactivated')
  const tenantSnapshot = await db.collection('tenants').doc(profile.tenantId).get()
  if (!tenantSnapshot.exists) throw new Error('Hospital tenant not found')
  const tenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() }
  if (['pending', 'rejected', 'suspended'].includes(tenant.status)) {
    const error = new Error(tenant.status === 'pending' ? 'Your hospital registration is awaiting approval' : 'This hospital workspace is not active')
    error.code = 'HOSPITAL_NOT_ACTIVE'
    throw error
  }
  return { profile, tenant }
}

function findStaff(identifier) {
  return db.prepare('SELECT * FROM staff WHERE lower(email) = lower(?) OR phone = ?').get(identifier, identifier)
}

function createRefreshSession(staffId) {
  const raw = crypto.randomBytes(48).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare('INSERT INTO refresh_sessions (id, staff_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(id('session'), staffId, sha256(raw), expires, now())
  return raw
}

function createPlatformRefreshSession(platformUserId) {
  const raw = crypto.randomBytes(48).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare('INSERT INTO platform_refresh_sessions (id, platform_user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(id('platform_session'), platformUserId, sha256(raw), expires, now())
  return raw
}

function auth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ message: 'Authentication required' })
  try {
    req.auth = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    if (req.auth.aud !== 'hospital') return res.status(401).json({ message: 'Hospital session required' })
    if (firestoreStatus().enabled) {
      getFirestoreStore().collection('staffProfiles').doc(req.auth.sub).get().then((snapshot) => {
        if (!snapshot.exists) return res.status(401).json({ message: 'Hospital account is inactive' })
        const profile = snapshot.data()
        if (profile.active === false || profile.tenantId !== req.auth.tenantId) return res.status(401).json({ message: 'Hospital account is inactive' })
        return getFirestoreStore().collection('tenants').doc(req.auth.tenantId).get().then((tenantSnapshot) => {
          const status = tenantSnapshot.data()?.status
          if (!tenantSnapshot.exists || status !== 'active') return res.status(403).json({
            code: status === 'pending' ? 'REGISTRATION_PENDING' : 'HOSPITAL_INACTIVE',
            message: status === 'pending' ? 'Hospital registration is awaiting approval' : 'Hospital workspace is not active',
          })
          req.auth.roles = Array.isArray(profile.roles) ? profile.roles : []
          req.auth.branchId = profile.branchId || null
          return next()
        })
      }).catch(() => res.status(503).json({ message: 'Could not verify hospital account' }))
      return
    }
    const staff = db.prepare('SELECT roles_json, perm_grants_json, perm_denies_json, branch_id, active FROM staff WHERE id = ? AND tenant_id = ?').get(req.auth.sub, req.auth.tenantId)
    if (!staff || !staff.active) return res.status(401).json({ message: 'Hospital account is inactive' })
  const tenant = db.prepare('SELECT status FROM tenants WHERE id = ?').get(req.auth.tenantId)
  if (!tenant || tenant.status !== 'active') return res.status(403).json({
    code: tenant?.status === 'pending' ? 'REGISTRATION_PENDING' : 'HOSPITAL_INACTIVE',
    message: tenant?.status === 'pending' ? 'Hospital registration is awaiting approval' : 'Hospital workspace is not active',
  })
    req.auth.roles = parse(staff.roles_json, [])
    req.auth.permGrants = parse(staff.perm_grants_json, [])
    req.auth.permDenies = parse(staff.perm_denies_json, [])
    req.auth.branchId = staff.branch_id || null
    return next()
  } catch {
    return res.status(401).json({ message: 'Access token expired or invalid' })
  }
}

function platformAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ message: 'Platform authentication required' })
  try {
    req.auth = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    if (req.auth.aud !== 'platform') return res.status(401).json({ message: 'Platform session required' })
    const user = db.prepare('SELECT roles_json, active FROM platform_users WHERE id = ?').get(req.auth.sub)
    const roles = user?.active ? parse(user.roles_json, []) : []
    if (!roles.includes('platform_super_admin')) return res.status(403).json({ message: 'Platform Super Admin access required' })
    req.auth.roles = roles
    return next()
  } catch {
    return res.status(401).json({ message: 'Platform access token expired or invalid' })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.some((role) => req.auth.roles?.includes(role))) return res.status(403).json({ message: 'You do not have permission for this action' })
    next()
  }
}

function recordAudit(tenantId, actorId, action, entity = null, recordId = null, metadata = {}) {
  db.prepare('INSERT INTO audit_log (id, tenant_id, actor_id, action, entity, record_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id('audit'), tenantId, actorId, action, entity, recordId, json(metadata), now())
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'dibia-hms-backend', time: now(), dataStore: process.env.DATA_STORE || 'sqlite', firestore: firestoreStatus() }))

app.post('/auth/register', limitAuthAttempts, asyncRoute(async (req, res) => {
  const hospitalName = String(req.body?.hospitalName || '').trim()
  const ownerName = String(req.body?.ownerName || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const phone = String(req.body?.phone || '').trim()
  const address = String(req.body?.address || '').trim()
  if (!hospitalName || !ownerName || !email || password.length < minPasswordLength) return res.status(400).json({ message: `Hospital name, owner name, email, and a ${minPasswordLength}-character password are required` })

  if (!firestoreStatus().enabled) {
    if (db.prepare('SELECT id FROM staff WHERE lower(email) = lower(?)').get(email)) return res.status(409).json({ message: 'An account with that email already exists' })
    const baseSlug = hospitalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'hospital'
    let slug = baseSlug
    for (let suffix = 2; db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug); suffix += 1) slug = `${baseSlug}-${suffix}`.slice(0, 50)
    const tenantId = id('hospital')
    const branchId = id('branch')
    const staffId = id('staff')
    const timestamp = now()
    const roles = ['facility_admin']
    const create = db.transaction(() => {
      db.prepare('INSERT INTO tenants (id, slug, name, address, phone, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(tenantId, slug, hospitalName, address, phone, 'pending', timestamp)
      db.prepare('INSERT INTO branches (id, tenant_id, name, address, created_at) VALUES (?, ?, ?, ?, ?)').run(branchId, tenantId, 'Main Branch', address, timestamp)
      db.prepare('INSERT INTO staff (id, tenant_id, branch_id, name, email, phone, profession, password_hash, roles_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(staffId, tenantId, branchId, ownerName, email, phone, 'Hospital administrator', bcrypt.hashSync(password, 12), json(roles), timestamp, timestamp)
    })
    try { create() } catch (error) { return res.status(400).json({ message: production ? 'Could not create hospital account' : error.message || 'Could not create hospital account' }) }
    const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId)
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId)
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId)
    recordAudit(tenantId, staffId, 'hospital.registered', 'hospital', tenantId)
    return res.status(201).json({ status: 'pending', message: 'Registration received. A Dibia administrator must approve your hospital before you can sign in.', ...publicSession(staff, tenant, branch) })
  }

  const db = getFirestoreStore()
  const auth = getFirebaseAuth()
  let userRecord
  try {
    userRecord = await auth.createUser({ email, password, displayName: ownerName, phoneNumber: /^\+[1-9]\d{7,14}$/.test(phone) ? phone : undefined })
    const tenantId = id('tenant')
    const baseSlug = hospitalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `hospital-${tenantId.slice(-6)}`
    let slug = baseSlug
    for (let suffix = 2; (await db.collection('tenantSlugs').doc(slug).get()).exists; suffix += 1) slug = `${baseSlug}-${suffix}`.slice(0, 50)
    const branchId = id('branch')
    const createdAt = now()
    const tenant = { slug, name: hospitalName, address, phone, status: 'pending', createdAt: now() }
    const branch = { id: branchId, tenantId, name: 'Main Branch', address, createdAt }
    const profile = { id: userRecord.uid, tenantId, branchId, name: ownerName, email, phone, roles: ['facility_admin'], profession: 'Hospital administrator', active: true, createdAt }
    const tenantDoc = db.collection('tenants').doc(tenantId)
    const records = [
      { entity: 'hospitals', recordId: tenantId, payload: { id: tenantId, hospitalId: tenantId, slug, name: hospitalName, address, phone, status: 'pending', createdAt } },
      { entity: 'branches', recordId: branchId, payload: { id: branchId, hospitalId: tenantId, branchId, name: branch.name, address, isMain: true, createdAt } },
      { entity: 'staff', recordId: userRecord.uid, payload: { id: userRecord.uid, hospitalId: tenantId, branchId, name: ownerName, email, phone, active: true, profession: profile.profession, createdAt } },
      { entity: 'staff_roles', recordId: `${userRecord.uid}__facility_admin`, payload: { id: `${userRecord.uid}__facility_admin`, hospitalId: tenantId, staffId: userRecord.uid, role: 'facility_admin' } },
    ]
    await db.runTransaction(async (transaction) => {
      const slugRef = db.collection('tenantSlugs').doc(slug)
      if ((await transaction.get(slugRef)).exists) throw new Error('HOSPITAL_SLUG_EXISTS')
      transaction.set(tenantDoc, tenant)
      transaction.set(tenantDoc.collection('branches').doc(branchId), branch)
      transaction.set(tenantDoc.collection('staff').doc(userRecord.uid), profile)
      transaction.set(db.collection('staffProfiles').doc(userRecord.uid), profile)
      transaction.set(slugRef, { tenantId, createdAt })
      transaction.set(tenantDoc.collection('subscriptions').doc('current'), { id: `sub_${tenantId}`, tenantId, plan: 'Freemium', amountMinor: 0, status: 'pending', startsAt: createdAt, createdAt, updatedAt: createdAt })
      let sequence = 0
      for (const row of records) {
        sequence += 1
        transaction.set(tenantDoc.collection('records').doc(`${row.entity}__${row.recordId}`), { ...row, tenantId, deleted: false, updatedAt: createdAt })
        transaction.set(tenantDoc.collection('syncChanges').doc(String(sequence)), { sequence, entity: row.entity, recordId: row.recordId, operation: 'create', payload: row.payload, createdAt })
      }
      transaction.set(tenantDoc.collection('meta').doc('sync'), { lastSequence: sequence, updatedAt: createdAt })
    })
    await auth.setCustomUserClaims(userRecord.uid, { aud: 'hospital', tenantId, roles: profile.roles })
    res.status(201).json({ status: 'pending', message: 'Registration received. A Dibia administrator must approve your hospital before you can sign in.', tenant: { id: tenantId, ...tenant }, user: { id: profile.id, name: profile.name, email: profile.email }, branch })
  } catch (error) {
    if (userRecord?.uid) await auth.deleteUser(userRecord.uid).catch(() => {})
    if (String(error.message).includes('EMAIL_EXISTS')) return res.status(409).json({ message: 'An account with that email already exists' })
    return res.status(400).json({ message: production ? 'Could not create hospital account' : error.message || 'Could not create hospital account' })
  }
}))

app.post('/auth/login', limitAuthAttempts, (req, res) => {
  const identifier = String(req.body?.identifier || '').trim()
  const password = String(req.body?.password || '')
  if (req.body?.audience === 'platform') {
    const platformUser = db.prepare('SELECT * FROM platform_users WHERE lower(email) = lower(?)').get(identifier)
    if (!platformUser || !platformUser.active || !bcrypt.compareSync(password, platformUser.password_hash)) return res.status(401).json({ message: 'Invalid platform login details' })
    const refreshToken = createPlatformRefreshSession(platformUser.id)
    setRefreshCookie(res, refreshToken)
    db.prepare('INSERT INTO platform_audit_logs (id, platform_user_id, action, entity, record_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('platform_audit'), platformUser.id, 'auth.login', 'platform_user', platformUser.id, json({ audience: 'platform' }), now())
    return res.json({ accessToken: issuePlatformAccess(platformUser), user: { id: platformUser.id, name: platformUser.name, email: platformUser.email, roles: parse(platformUser.roles_json, []) } })
  }
  if (firestoreStatus().enabled) {
    return firebasePasswordSignIn(identifier, password)
      .then(async (signedIn) => {
        const { profile, tenant } = await firestoreHospitalSession(signedIn.idToken)
        setRefreshCookie(res, signedIn.refreshToken)
        res.json(firebaseSession(profile, tenant, null))
      })
      .catch((error) => res.status(error.code === 'HOSPITAL_NOT_ACTIVE' ? 403 : 401).json({
        ...(error.code === 'HOSPITAL_NOT_ACTIVE' ? { code: error.message.includes('awaiting approval') ? 'REGISTRATION_PENDING' : 'HOSPITAL_INACTIVE' } : {}),
        message: error.code === 'HOSPITAL_NOT_ACTIVE' ? error.message : 'Invalid login details',
      }))
  }
  const staff = findStaff(identifier)
  if (!staff || !staff.active || !bcrypt.compareSync(password, staff.password_hash)) return res.status(401).json({ message: 'Invalid login details' })
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(staff.tenant_id)
  if (!tenant || tenant.status !== 'active') return res.status(403).json({
    code: tenant?.status === 'pending' ? 'REGISTRATION_PENDING' : 'HOSPITAL_INACTIVE',
    message: tenant?.status === 'pending' ? 'Hospital registration is awaiting approval' : 'Hospital workspace is not active',
  })
  const branch = staff.branch_id ? db.prepare('SELECT * FROM branches WHERE id = ?').get(staff.branch_id) : null
  const refreshToken = createRefreshSession(staff.id)
    setRefreshCookie(res, refreshToken)
  recordAudit(staff.tenant_id, staff.id, 'auth.login', 'staff', staff.id)
  res.json({ accessToken: issueAccess(staff), ...publicSession(staff, tenant, branch) })
})

app.post('/auth/refresh', (req, res) => {
  const raw = req.cookies.dibia_refresh
  if (raw && firestoreStatus().enabled) {
    return firebaseRefresh(raw)
      .then(async (refreshed) => {
        if (!refreshed?.id_token) return null
        const { profile, tenant } = await firestoreHospitalSession(refreshed.id_token)
        setRefreshCookie(res, refreshed.refresh_token || raw)
        res.json(firebaseSession(profile, tenant, null))
        return true
      })
      .catch(() => null)
      .then((handled) => {
        if (!handled && !res.headersSent) continueRefreshWithSqlite()
      })
  }
  return continueRefreshWithSqlite()

  function continueRefreshWithSqlite() {
  const platformSession = raw ? db.prepare('SELECT * FROM platform_refresh_sessions WHERE token_hash = ? AND expires_at > ?').get(sha256(raw), now()) : null
  if (platformSession) {
    const platformUser = db.prepare('SELECT * FROM platform_users WHERE id = ? AND active = 1').get(platformSession.platform_user_id)
    if (!platformUser) return res.status(401).json({ message: 'Platform account is inactive' })
    db.prepare('DELETE FROM platform_refresh_sessions WHERE id = ?').run(platformSession.id)
    setRefreshCookie(res, createPlatformRefreshSession(platformUser.id))
    return res.json({ accessToken: issuePlatformAccess(platformUser), user: { id: platformUser.id, name: platformUser.name, email: platformUser.email, roles: parse(platformUser.roles_json, []) } })
  }
  const session = raw ? db.prepare('SELECT * FROM refresh_sessions WHERE token_hash = ? AND expires_at > ?').get(sha256(raw), now()) : null
  if (!session) return res.status(401).json({ message: 'Refresh session expired' })
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(session.staff_id)
  if (!staff || !staff.active) return res.status(401).json({ message: 'Hospital account is inactive' })
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(staff.tenant_id)
  const branch = staff.branch_id ? db.prepare('SELECT * FROM branches WHERE id = ?').get(staff.branch_id) : null
  db.prepare('DELETE FROM refresh_sessions WHERE id = ?').run(session.id)
  setRefreshCookie(res, createRefreshSession(staff.id))
  res.json({ accessToken: issueAccess(staff), ...publicSession(staff, tenant, branch) })
  }
})

app.post('/auth/logout', (req, res) => {
  const raw = req.cookies.dibia_refresh
  if (raw) {
    db.prepare('DELETE FROM refresh_sessions WHERE token_hash = ?').run(sha256(raw))
    db.prepare('DELETE FROM platform_refresh_sessions WHERE token_hash = ?').run(sha256(raw))
  }
  res.clearCookie('dibia_refresh', { httpOnly: true, sameSite: production ? 'strict' : 'lax', secure: production, path: '/' })
  res.json({ ok: true })
})

// Dibia Super Admin console sessions use a separate HttpOnly refresh cookie.
// The short-lived access token stays in the console app's memory.
app.post('/auth/console/login', limitAuthAttempts, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const admin = db.prepare('SELECT * FROM platform_users WHERE lower(email) = ? AND active = 1').get(email)
  if (!admin || !bcrypt.compareSync(password, admin.password_hash) || !parse(admin.roles_json, []).includes('platform_super_admin')) {
    return res.status(401).json({ message: 'Invalid Super Admin email or password' })
  }
  const refreshToken = createPlatformRefreshSession(admin.id)
  setConsoleRefreshCookie(res, refreshToken)
  platformAudit(admin.id, 'auth.login', 'platform_user', admin.id)
  return res.json({ accessToken: issuePlatformAccess(admin), user: { id: admin.id, name: admin.name, email: admin.email } })
})

app.get('/auth/console/session', (req, res) => {
  const raw = req.cookies.dibia_console_refresh
  const session = raw ? db.prepare('SELECT * FROM platform_refresh_sessions WHERE token_hash = ? AND expires_at > ?').get(sha256(raw), now()) : null
  const admin = session ? db.prepare('SELECT * FROM platform_users WHERE id = ? AND active = 1').get(session.platform_user_id) : null
  if (!admin || !parse(admin.roles_json, []).includes('platform_super_admin')) return res.status(401).json({ message: 'Console session expired' })
  db.prepare('DELETE FROM platform_refresh_sessions WHERE id = ?').run(session.id)
  setConsoleRefreshCookie(res, createPlatformRefreshSession(admin.id))
  return res.json({ accessToken: issuePlatformAccess(admin), user: { id: admin.id, name: admin.name, email: admin.email } })
})

app.post('/auth/console/logout', (req, res) => {
  const raw = req.cookies.dibia_console_refresh
  if (raw) db.prepare('DELETE FROM platform_refresh_sessions WHERE token_hash = ?').run(sha256(raw))
  res.clearCookie('dibia_console_refresh', { httpOnly: true, sameSite: production ? 'strict' : 'lax', secure: production, path: '/' })
  return res.json({ ok: true })
})

app.get('/me', auth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const db = getFirestoreStore()
    const [profileSnapshot, tenantSnapshot] = await Promise.all([
      db.collection('staffProfiles').doc(req.auth.sub).get(),
      db.collection('tenants').doc(req.auth.tenantId).get(),
    ])
    if (!profileSnapshot.exists || !tenantSnapshot.exists) return res.status(404).json({ message: 'Account not found' })
    const profile = { id: profileSnapshot.id, ...profileSnapshot.data() }
    const tenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() }
    const branchSnapshot = profile.branchId ? await tenantSnapshot.ref.collection('branches').doc(profile.branchId).get() : null
    const branch = branchSnapshot?.exists ? { id: branchSnapshot.id, ...branchSnapshot.data() } : null
    return res.json(firebaseSession(profile, tenant, branch))
  }
  const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND tenant_id = ?').get(req.auth.sub, req.auth.tenantId)
  if (!staff) return res.status(404).json({ message: 'Account not found' })
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(staff.tenant_id)
  const branch = staff.branch_id ? db.prepare('SELECT * FROM branches WHERE id = ?').get(staff.branch_id) : null
  res.json(publicSession(staff, tenant, branch))
}))

function platformAudit(platformUserId, action, entity, recordId, metadata = {}) {
  db.prepare('INSERT INTO platform_audit_logs (id, platform_user_id, action, entity, record_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('platform_audit'), platformUserId, action, entity, recordId, json(metadata), now())
}

async function firestoreTenantSummary(snapshot) {
  const tenant = { id: snapshot.id, ...snapshot.data() }
  const root = getFirestoreStore().collection('tenants').doc(snapshot.id)
  const [branches, staff, subscription, moduleDocs] = await Promise.all([
    root.collection('branches').get(),
    root.collection('staff').get(),
    root.collection('subscriptions').doc('current').get(),
    root.collection('tenantModules').where('status', '==', 'enabled').get(),
  ])
  const billing = subscription.exists ? subscription.data() : null
  return {
    id: tenant.id, slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl || null,
    location: tenant.address || '', phone: tenant.phone || '', tenantStatus: tenant.status || 'pending',
    registeredAt: tenant.createdAt || null, branches: branches.size, staff: staff.size,
    subscriptionStatus: billing?.status || 'pending', plan: billing?.plan || 'Freemium',
    status: ['past_due', 'failed'].includes(billing?.status) ? 'failed' : tenant.status || 'pending',
    usageDays: 0, modules: moduleDocs.docs.map((doc) => doc.data().name || doc.id),
  }
}

app.get('/platform/summary', platformAuth, asyncRoute(async (_req, res) => {
  if (firestoreStatus().enabled) {
    const snapshot = await getFirestoreStore().collection('tenants').get()
    let activeSubscriptions = 0
    let activeUsers = 0
    for (const tenant of snapshot.docs) {
      const [subscription, staff] = await Promise.all([
        tenant.ref.collection('subscriptions').doc('current').get(),
        tenant.ref.collection('staff').where('active', '==', true).get(),
      ])
      if (subscription.data()?.status === 'active') activeSubscriptions += 1
      activeUsers += staff.size
    }
    const publishedModules = db.prepare("SELECT COUNT(*) AS count FROM modules WHERE status = 'published'").get().count
    return res.json({ hospitals: snapshot.size, activeSubscriptions, publishedModules, activeUsers })
  }
  const hospitals = db.prepare('SELECT COUNT(*) AS count FROM tenants').get().count
  const activeSubscriptions = db.prepare("SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'").get().count
  const publishedModules = db.prepare("SELECT COUNT(*) AS count FROM modules WHERE status = 'published'").get().count
  const activeUsers = db.prepare('SELECT COUNT(*) AS count FROM staff WHERE active = 1').get().count
  res.json({ hospitals, activeSubscriptions, publishedModules, activeUsers })
}))

app.get('/platform/audit', platformAuth, (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)))
  const rows = db.prepare('SELECT id, platform_user_id AS platformUserId, action, entity, record_id AS recordId, metadata_json AS metadata, created_at AS createdAt FROM platform_audit_logs ORDER BY created_at DESC LIMIT ?').all(limit).map((row) => ({ ...row, metadata: parse(row.metadata, {}) }))
  res.json({ audit: rows })
})

app.get('/platform/settings', platformAuth, (_req, res) => {
  const row = db.prepare('SELECT value_json FROM platform_settings WHERE id = ?').get('platform')
  res.json({ settings: { id: 'platform', ...(parse(row?.value_json, {})) } })
})

app.patch('/platform/settings', platformAuth, (req, res) => {
  const value = { ...(req.body || {}) }
  delete value.id
  db.prepare('INSERT INTO platform_settings (id, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').run('platform', json(value), now())
  platformAudit(req.auth.sub, 'platform.settings.updated', 'platform_settings', 'platform')
  res.json({ settings: { id: 'platform', ...value } })
})

app.get('/platform/transactions', platformAuth, asyncRoute(async (_req, res) => {
  if (firestoreStatus().enabled) {
    const tenants = await getFirestoreStore().collection('tenants').get()
    const transactions = []
    for (const tenantDoc of tenants.docs) {
      const [billingSnapshot, tenantSummary] = await Promise.all([
        tenantDoc.ref.collection('subscriptions').doc('current').get(),
        firestoreTenantSummary(tenantDoc),
      ])
      if (!billingSnapshot.exists) continue
      const billing = billingSnapshot.data()
      transactions.push({
        id: billing.id || `sub_${tenantDoc.id}`, hospitalId: tenantDoc.id,
        hospitalName: tenantSummary.name, plan: billing.plan || 'Freemium',
        amountMinor: Number(billing.amountMinor || 0), amount: Number(billing.amountMinor || 0) / 100,
        date: billing.renewsAt || billing.updatedAt || billing.createdAt,
        status: billing.status === 'active' ? 'paid' : billing.status === 'past_due' ? 'failed' : billing.status,
      })
    }
    return res.json({ transactions: transactions.sort((a, b) => String(b.date).localeCompare(String(a.date))) })
  }
  const rows = db.prepare(`SELECT s.id, s.tenant_id AS hospitalId, t.name AS hospitalName, p.name AS plan,
      p.price_minor AS amountMinor, s.renews_at AS date, s.status
    FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id JOIN subscription_plans p ON p.id = s.plan_id
    ORDER BY s.updated_at DESC`).all().map((row) => ({ ...row, amount: row.amountMinor / 100, status: row.status === 'active' ? 'paid' : row.status === 'past_due' ? 'failed' : row.status }))
  res.json({ transactions: rows })
}))

app.patch('/platform/transactions/:id/confirm', platformAuth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const tenants = await getFirestoreStore().collection('tenants').get()
    for (const tenant of tenants.docs) {
      const billingRef = tenant.ref.collection('subscriptions').doc('current')
      const billing = await billingRef.get()
      if (billing.exists && (billing.data().id || `sub_${tenant.id}`) === req.params.id) {
        await billingRef.set({ status: 'active', paymentMethod: 'manual', updatedAt: now(), confirmedBy: req.auth.sub, confirmedAt: now() }, { merge: true })
        platformAudit(req.auth.sub, 'subscription.payment_confirmed', 'subscription', req.params.id, { tenantId: tenant.id, method: 'manual' })
        return res.json({ id: req.params.id, hospitalId: tenant.id, status: 'paid' })
      }
    }
    return res.status(404).json({ message: 'Subscription transaction not found' })
  }
  const transaction = db.prepare('SELECT id, tenant_id FROM subscriptions WHERE id = ?').get(req.params.id)
  if (!transaction) return res.status(404).json({ message: 'Subscription transaction not found' })
  db.prepare("UPDATE subscriptions SET status = 'active', updated_at = ? WHERE id = ?").run(now(), transaction.id)
  platformAudit(req.auth.sub, 'subscription.payment_confirmed', 'subscription', transaction.id, { tenantId: transaction.tenant_id, method: 'manual' })
  res.json({ id: transaction.id, hospitalId: transaction.tenant_id, status: 'paid' })
}))

app.get('/platform/modules', platformAuth, (_req, res) => {
  const modules = db.prepare('SELECT id, code, name, description, category, version, status, pricing_model AS pricingModel, price_minor AS priceMinor, config_schema_json AS configSchema, created_at AS createdAt, updated_at AS updatedAt FROM modules ORDER BY name').all().map((module) => ({ ...module, configSchema: parse(module.configSchema) }))
  res.json({ modules })
})

app.post('/platform/modules', platformAuth, (req, res) => {
  const code = String(req.body?.code || '').trim().toLowerCase()
  const name = String(req.body?.name || '').trim()
  if (!/^[a-z0-9-]+$/.test(code) || !name) return res.status(400).json({ message: 'Module code and name are required' })
  const timestamp = now()
  const moduleId = id('module')
  try {
    db.prepare('INSERT INTO modules (id, code, name, description, category, version, status, pricing_model, price_minor, config_schema_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(moduleId, code, name, String(req.body?.description || ''), String(req.body?.category || 'operations'), String(req.body?.version || '1.0.0'), 'draft', String(req.body?.pricingModel || 'addon'), Math.max(0, Number(req.body?.priceMinor || 0)), json(req.body?.configSchema || {}), timestamp, timestamp)
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ message: 'A module with that code already exists' })
    throw error
  }
  platformAudit(req.auth.sub, 'module.created', 'module', moduleId, { code })
  res.status(201).json({ id: moduleId, code, name, status: 'draft' })
})

app.get('/platform/tenants', platformAuth, asyncRoute(async (_req, res) => {
  if (firestoreStatus().enabled) {
    const snapshot = await getFirestoreStore().collection('tenants').get()
    const tenants = await Promise.all(snapshot.docs.map(firestoreTenantSummary))
    return res.json({ tenants: tenants.sort((a, b) => String(a.name).localeCompare(String(b.name))) })
  }
  const rows = db.prepare(`SELECT t.id, t.slug, t.name, t.logo_url AS logoUrl, t.address AS location, t.phone,
      t.status AS tenantStatus, t.created_at AS registeredAt,
      (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) AS branches,
      (SELECT COUNT(*) FROM staff u WHERE u.tenant_id = t.id) AS staff,
      (SELECT s.status FROM subscriptions s WHERE s.tenant_id = t.id ORDER BY s.created_at DESC LIMIT 1) AS subscriptionStatus,
      (SELECT p.name FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.tenant_id = t.id ORDER BY s.created_at DESC LIMIT 1) AS plan
    FROM tenants t ORDER BY t.name`).all()
  const tenants = rows.map((tenant) => ({
    ...tenant,
    status: ['past_due', 'failed'].includes(tenant.subscriptionStatus) ? 'failed' : tenant.tenantStatus,
    plan: tenant.plan || 'Freemium',
    usageDays: 0,
    modules: db.prepare(`SELECT m.name FROM tenant_modules tm JOIN modules m ON m.id = tm.module_id WHERE tm.tenant_id = ? AND tm.status = 'enabled' ORDER BY m.name`).all(tenant.id).map((row) => row.name),
  }))
  res.json({ tenants })
}))

app.post('/platform/tenants/:tenantId/decision', platformAuth, asyncRoute(async (req, res) => {
  const decision = String(req.body?.decision || '')
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ message: 'Decision must be approve or reject' })
  const nextStatus = decision === 'approve' ? 'active' : 'rejected'
  const timestamp = now()
  if (firestoreStatus().enabled) {
    const tenantRef = getFirestoreStore().collection('tenants').doc(req.params.tenantId)
    const tenantSnapshot = await tenantRef.get()
    if (!tenantSnapshot.exists) return res.status(404).json({ message: 'Hospital tenant not found' })
    const before = tenantSnapshot.data()
    if (before.status !== 'pending') return res.status(409).json({ message: `Only pending registrations can be ${decision === 'approve' ? 'approved' : 'rejected'}` })
    await getFirestoreStore().runTransaction(async (transaction) => {
      transaction.set(tenantRef, { status: nextStatus, updatedAt: timestamp, ...(decision === 'approve' ? { approvedAt: timestamp, approvedBy: req.auth.sub } : { rejectedAt: timestamp, rejectedBy: req.auth.sub }) }, { merge: true })
      if (decision === 'approve') {
        const subscriptionRef = tenantRef.collection('subscriptions').doc('current')
        transaction.set(subscriptionRef, { status: 'pending', startsAt: timestamp, updatedAt: timestamp }, { merge: true })
      }
    })
    platformAudit(req.auth.sub, `tenant.${decision}d`, 'tenant', tenantSnapshot.id, { before: { status: before.status }, after: { status: nextStatus } })
    return res.json({ tenant: { id: tenantSnapshot.id, ...before, status: nextStatus, updatedAt: timestamp } })
  }
  const tenant = db.prepare('SELECT id, slug, name, status FROM tenants WHERE id = ?').get(req.params.tenantId)
  if (!tenant) return res.status(404).json({ message: 'Hospital tenant not found' })
  if (tenant.status !== 'pending') return res.status(409).json({ message: `Only pending registrations can be ${decision === 'approve' ? 'approved' : 'rejected'}` })
  const applyDecision = db.transaction(() => {
    db.prepare('UPDATE tenants SET status = ? WHERE id = ? AND status = \'pending\'').run(nextStatus, tenant.id)
    if (decision === 'approve') {
      const plan = db.prepare("SELECT id FROM subscription_plans WHERE code = 'freemium'").get()
      if (plan) {
        const current = db.prepare('SELECT id FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1').get(tenant.id)
        if (current) db.prepare('UPDATE subscriptions SET status = ?, starts_at = ?, updated_at = ? WHERE id = ?').run('pending', timestamp, timestamp, current.id)
        else db.prepare('INSERT INTO subscriptions (id, tenant_id, plan_id, status, starts_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('sub'), tenant.id, plan.id, 'pending', timestamp, timestamp, timestamp)
      }
    }
  })
  applyDecision()
  platformAudit(req.auth.sub, `tenant.${decision}d`, 'tenant', tenant.id, { before: { status: tenant.status }, after: { status: nextStatus } })
  return res.json({ tenant: { ...tenant, status: nextStatus, updatedAt: timestamp } })
}))

app.patch('/platform/tenants/:tenantId', platformAuth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const tenantRef = getFirestoreStore().collection('tenants').doc(req.params.tenantId)
    const tenantSnapshot = await tenantRef.get()
    if (!tenantSnapshot.exists) return res.status(404).json({ message: 'Hospital tenant not found' })
    const tenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() }
    const allowedStatuses = new Set(['pending', 'active', 'suspended', 'rejected'])
    const status = req.body?.status == null ? tenant.status : String(req.body.status)
    if (!allowedStatuses.has(status)) return res.status(400).json({ message: 'Invalid tenant status' })
    if (status !== tenant.status && (tenant.status === 'pending' || status === 'rejected')) return res.status(409).json({ message: 'Use the registration decision action for pending hospitals' })
    const updates = { status, updatedAt: now() }
    if (req.body?.name != null) updates.name = String(req.body.name).trim()
    if (req.body?.location != null) updates.address = String(req.body.location).trim()
    if (req.body?.phone != null) updates.phone = String(req.body.phone).trim()
    let billingUpdate = null
    if (req.body?.plan != null) {
      const plan = db.prepare('SELECT code, name, price_minor FROM subscription_plans WHERE lower(name) = lower(?) OR lower(code) = lower(?)').get(String(req.body.plan), String(req.body.plan))
      if (!plan) return res.status(400).json({ message: 'Unknown subscription plan' })
      const billingRef = tenantRef.collection('subscriptions').doc('current')
      const current = await billingRef.get()
      billingUpdate = { id: current.data()?.id || `sub_${tenant.id}`, tenantId: tenant.id, plan: plan.name, planCode: plan.code, amountMinor: plan.price_minor, status: current.data()?.status || 'pending', updatedAt: now(), ...(current.exists ? {} : { createdAt: now(), startsAt: now() }) }
      await billingRef.set(billingUpdate, { merge: true })
    }
    await tenantRef.set(updates, { merge: true })
    platformAudit(req.auth.sub, `tenant.${status}`, 'tenant', tenant.id, { before: { status: tenant.status }, after: { status } })
    return res.json({ tenant: { ...tenant, ...updates, ...(billingUpdate ? { plan: billingUpdate.plan } : {}) } })
  }
  const tenant = db.prepare('SELECT id, slug, name, status FROM tenants WHERE id = ?').get(req.params.tenantId)
  if (!tenant) return res.status(404).json({ message: 'Hospital tenant not found' })
  const allowedStatuses = new Set(['pending', 'active', 'suspended', 'rejected'])
  const status = req.body?.status == null ? tenant.status : String(req.body.status)
  if (!allowedStatuses.has(status)) return res.status(400).json({ message: 'Invalid tenant status' })
  if (status !== tenant.status && (tenant.status === 'pending' || status === 'rejected')) return res.status(409).json({ message: 'Use the registration decision action for pending hospitals' })
  db.prepare('UPDATE tenants SET status = ?, name = COALESCE(?, name), address = COALESCE(?, address), phone = COALESCE(?, phone) WHERE id = ?').run(status, req.body?.name == null ? null : String(req.body.name), req.body?.location == null ? null : String(req.body.location), req.body?.phone == null ? null : String(req.body.phone), tenant.id)
  if (req.body?.plan != null) {
    const plan = db.prepare('SELECT id FROM subscription_plans WHERE lower(name) = lower(?) OR lower(code) = lower(?)').get(String(req.body.plan), String(req.body.plan))
    if (!plan) return res.status(400).json({ message: 'Unknown subscription plan' })
    const current = db.prepare('SELECT id FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1').get(tenant.id)
    if (current) db.prepare('UPDATE subscriptions SET plan_id = ?, updated_at = ? WHERE id = ?').run(plan.id, now(), current.id)
    else db.prepare('INSERT INTO subscriptions (id, tenant_id, plan_id, status, starts_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('sub'), tenant.id, plan.id, 'active', now(), now(), now())
  }
  platformAudit(req.auth.sub, `tenant.${status}`, 'tenant', tenant.id, { before: { status: tenant.status }, after: { status } })
  res.json({ tenant: { ...tenant, status } })
}))

app.get('/platform/tenants/:tenantId/users', platformAuth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const tenantSnapshot = await getFirestoreStore().collection('tenants').doc(req.params.tenantId).get()
    if (!tenantSnapshot.exists) return res.status(404).json({ message: 'Hospital tenant not found' })
    const tenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() }
    const snapshot = await tenantSnapshot.ref.collection('staff').get()
    return res.json({ users: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data(), hospitalId: tenant.id, hospitalName: tenant.name })) })
  }
  const tenant = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(req.params.tenantId)
  if (!tenant) return res.status(404).json({ message: 'Hospital tenant not found' })
  const users = db.prepare('SELECT id, name, email, profession, roles_json AS roles, active, created_at AS createdAt FROM staff WHERE tenant_id = ? ORDER BY name').all(tenant.id).map((user) => ({
    ...user, roles: parse(user.roles, []), hospitalId: tenant.id, hospitalName: tenant.name,
  }))
  res.json({ users })
}))

app.post('/platform/tenants/:tenantId/users', platformAuth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const tenantRef = getFirestoreStore().collection('tenants').doc(req.params.tenantId)
    const tenantSnapshot = await tenantRef.get()
    if (!tenantSnapshot.exists) return res.status(404).json({ message: 'Hospital tenant not found' })
    const tenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() }
    const name = String(req.body?.name || '').trim()
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    const role = String(req.body?.role || 'facility_admin').trim()
    const allowedRoles = new Set(['super_admin', 'facility_admin', 'ceo_owner', 'branch_manager', 'pharmacist', 'superintendent_pharmacist', 'receptionist', 'cashier', 'dispenser', 'pharmacy_cashier', 'inventory_officer', 'sales_staff', 'accountant', 'warehouse_officer', 'doctor', 'nurse', 'laboratory_technician'])
    if (!name || !email || password.length < minPasswordLength || !allowedRoles.has(role)) return res.status(400).json({ message: 'Name, valid email, supported role, and a sufficiently long password are required' })
    let userRecord
    try {
      const branches = await tenantRef.collection('branches').get()
      const branchId = req.body?.branchId || branches.docs[0]?.id || null
      if (req.body?.branchId && !branches.docs.some((doc) => doc.id === req.body.branchId)) return res.status(400).json({ message: 'Branch does not belong to this hospital' })
      userRecord = await getFirebaseAuth().createUser({ email, password, displayName: name })
      const timestamp = now()
      const profile = { id: userRecord.uid, tenantId: tenant.id, branchId, name, email, phone: String(req.body?.phone || ''), roles: [role], profession: role, active: true, createdAt: timestamp }
      const roleId = `${userRecord.uid}__${role}`
      const root = tenantRef
      await getFirestoreStore().runTransaction(async (transaction) => {
        const seqRef = root.collection('meta').doc('sync')
        const seqSnap = await transaction.get(seqRef)
        let sequence = Number(seqSnap.data()?.lastSequence || 0)
        const items = [
          { entity: 'staff', recordId: userRecord.uid, payload: { ...profile, hospitalId: tenant.id } },
          { entity: 'staff_roles', recordId: roleId, payload: { id: roleId, hospitalId: tenant.id, staffId: userRecord.uid, role } },
        ]
        for (const item of items) {
          sequence += 1
          transaction.set(root.collection('records').doc(`${item.entity}__${item.recordId}`), { ...item, tenantId: tenant.id, deleted: false, updatedAt: timestamp })
          transaction.set(root.collection('syncChanges').doc(String(sequence)), { sequence, entity: item.entity, recordId: item.recordId, operation: 'create', payload: item.payload, createdAt: timestamp })
        }
        transaction.set(seqRef, { lastSequence: sequence, updatedAt: timestamp }, { merge: true })
        transaction.set(root.collection('staff').doc(userRecord.uid), profile)
        transaction.set(getFirestoreStore().collection('staffProfiles').doc(userRecord.uid), profile)
      })
      await getFirebaseAuth().setCustomUserClaims(userRecord.uid, { aud: 'hospital', tenantId: tenant.id, roles: [role] })
      platformAudit(req.auth.sub, 'hospital.user.created', 'staff', userRecord.uid, { tenantId: tenant.id, role })
      return res.status(201).json({ user: { ...profile, hospitalId: tenant.id, hospitalName: tenant.name } })
    } catch (error) {
      if (userRecord?.uid) await getFirebaseAuth().deleteUser(userRecord.uid).catch(() => {})
      if (String(error.message).includes('EMAIL_EXISTS')) return res.status(409).json({ message: 'An account with that email already exists' })
      return res.status(400).json({ message: production ? 'Could not create hospital account' : error.message || 'Could not create hospital account' })
    }
  }
  const tenant = db.prepare('SELECT id, name, slug FROM tenants WHERE id = ?').get(req.params.tenantId)
  if (!tenant) return res.status(404).json({ message: 'Hospital tenant not found' })
  const name = String(req.body?.name || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const role = String(req.body?.role || 'facility_admin').trim()
  if (!name || !email || password.length < minPasswordLength) return res.status(400).json({ message: `Name, email, and a ${minPasswordLength}-character password are required` })
  const roles = [role]
  const timestamp = now()
  try {
    if (firestoreStatus().enabled) {
      const auth = getFirebaseAuth()
      const userRecord = await auth.createUser({ email, password, displayName: name })
      const profile = { id: userRecord.uid, tenantId: tenant.id, name, email, roles, profession: role, active: true, createdAt: timestamp }
      await getFirestoreStore().collection('tenants').doc(tenant.id).collection('staff').doc(userRecord.uid).set(profile)
      await getFirestoreStore().collection('staffProfiles').doc(userRecord.uid).set(profile)
      await auth.setCustomUserClaims(userRecord.uid, { aud: 'hospital', tenantId: tenant.id, roles })
      platformAudit(req.auth.sub, 'hospital.user.created', 'staff', userRecord.uid, { tenantId: tenant.id, role })
      return res.status(201).json({ user: { ...profile, hospitalId: tenant.id, hospitalName: tenant.name } })
    }
    const staffId = id('staff')
    db.prepare('INSERT INTO staff (id, tenant_id, branch_id, name, email, phone, profession, password_hash, roles_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      staffId, tenant.id, null, name, email, String(req.body?.phone || ''), role, bcrypt.hashSync(password, 12), json(roles), timestamp, timestamp,
    )
    platformAudit(req.auth.sub, 'hospital.user.created', 'staff', staffId, { tenantId: tenant.id, role })
    return res.status(201).json({ user: { id: staffId, name, email, roles, active: true, hospitalId: tenant.id, hospitalName: tenant.name, createdAt: timestamp } })
  } catch (error) {
    if (String(error.message).includes('EMAIL_EXISTS') || String(error.message).includes('UNIQUE')) return res.status(409).json({ message: 'An account with that email already exists' })
    return res.status(400).json({ message: production ? 'Could not create hospital account' : error.message || 'Could not create hospital account' })
  }
}))

function tenantModuleRows(tenantId) {
  return db.prepare(`SELECT m.id, m.code, m.name, m.description, m.category, m.version, m.status AS publicationStatus,
      CASE WHEN e.source = 'manual-payment-or-pro-override' THEN COALESCE(e.status, 'unentitled') ELSE 'unentitled' END AS entitlementStatus,
      CASE WHEN e.source = 'manual-payment-or-pro-override' THEN COALESCE(tm.status, 'disabled') ELSE 'disabled' END AS activationStatus,
      m.price_minor AS priceMinor
    FROM modules m
    LEFT JOIN module_entitlements e ON e.module_id = m.id AND e.tenant_id = ?
    LEFT JOIN tenant_modules tm ON tm.module_id = m.id AND tm.tenant_id = ?
    ORDER BY m.name`).all(tenantId, tenantId)
}

async function firestoreTenantModuleRows(tenantId) {
  const tenantRef = getFirestoreStore().collection('tenants').doc(tenantId)
  const [entitlements, activations] = await Promise.all([
    tenantRef.collection('moduleEntitlements').get(),
    tenantRef.collection('tenantModules').get(),
  ])
  const entitledByCode = new Map(entitlements.docs.map((doc) => [doc.id, doc.data()]))
  const activeByCode = new Map(activations.docs.map((doc) => [doc.id, doc.data()]))
  return db.prepare(`SELECT id, code, name, description, category, version, status AS publicationStatus, price_minor AS priceMinor
    FROM modules ORDER BY name`).all().map((module) => ({
    ...module,
    entitlementStatus: entitledByCode.get(module.code)?.source === 'manual-payment-or-pro-override' ? entitledByCode.get(module.code)?.status || 'unentitled' : 'unentitled',
    activationStatus: entitledByCode.get(module.code)?.source === 'manual-payment-or-pro-override' ? activeByCode.get(module.code)?.status || 'disabled' : 'disabled',
    priceMinor: Number(module.priceMinor || 0),
  }))
}

app.get('/platform/tenants/:tenantId/modules', platformAuth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const tenantSnapshot = await getFirestoreStore().collection('tenants').doc(req.params.tenantId).get()
    if (!tenantSnapshot.exists) return res.status(404).json({ message: 'Hospital tenant not found' })
    const tenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() }
    return res.json({ tenant, modules: await firestoreTenantModuleRows(tenant.id) })
  }
  const tenant = db.prepare('SELECT id, slug, name FROM tenants WHERE id = ?').get(req.params.tenantId)
  if (!tenant) return res.status(404).json({ message: 'Hospital tenant not found' })
  res.json({ tenant, modules: tenantModuleRows(tenant.id) })
}))

app.patch('/platform/tenants/:tenantId/modules/:code', platformAuth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const tenantRef = getFirestoreStore().collection('tenants').doc(req.params.tenantId)
    const tenant = await tenantRef.get()
    const module = db.prepare('SELECT id, code, name FROM modules WHERE code = ? OR lower(name) = lower(?)').get(req.params.code, req.params.code)
    if (!tenant.exists || !module) return res.status(404).json({ message: 'Tenant or module not found' })
    const entitlementStatus = req.body?.entitled === false ? 'revoked' : 'entitled'
    const activationStatus = entitlementStatus === 'revoked' || req.body?.enabled === false ? 'disabled' : 'enabled'
    const timestamp = now()
    await Promise.all([
      tenantRef.collection('moduleEntitlements').doc(module.code).set({ moduleCode: module.code, source: String(req.body?.source || 'platform'), status: entitlementStatus, startsAt: timestamp, updatedAt: timestamp }, { merge: true }),
      tenantRef.collection('tenantModules').doc(module.code).set({ moduleCode: module.code, name: module.name, status: activationStatus, activatedBy: req.auth.sub, activatedAt: activationStatus === 'enabled' ? timestamp : null }, { merge: true }),
    ])
    platformAudit(req.auth.sub, `tenant.module.${activationStatus}`, 'tenant_module', `${tenant.id}:${module.code}`)
    return res.json({ tenantId: tenant.id, moduleCode: module.code, moduleName: module.name, entitlementStatus, activationStatus })
  }
  const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(req.params.tenantId)
  const module = db.prepare('SELECT id, name FROM modules WHERE code = ? OR lower(name) = lower(?)').get(req.params.code, req.params.code)
  if (!tenant || !module) return res.status(404).json({ message: 'Tenant or module not found' })
  const status = req.body?.entitled === false ? 'revoked' : 'entitled'
  db.prepare('INSERT INTO module_entitlements (tenant_id, module_id, source, status, starts_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, module_id) DO UPDATE SET source = excluded.source, status = excluded.status, starts_at = excluded.starts_at').run(tenant.id, module.id, String(req.body?.source || 'platform'), status, now())
  const activationStatus = status === 'revoked' || req.body?.enabled === false ? 'disabled' : 'enabled'
  db.prepare('INSERT INTO tenant_modules (tenant_id, module_id, status, activated_by, activated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, module_id) DO UPDATE SET status = excluded.status, activated_by = excluded.activated_by, activated_at = excluded.activated_at').run(tenant.id, module.id, activationStatus, req.auth.sub, activationStatus === 'enabled' ? now() : null)
  platformAudit(req.auth.sub, `tenant.module.${activationStatus}`, 'tenant_module', `${tenant.id}:${module.id}`)
  res.json({ tenantId: tenant.id, moduleCode: req.params.code, moduleName: module.name, entitlementStatus: status, activationStatus })
}))

app.get('/platform/tickets', platformAuth, asyncRoute(async (_req, res) => {
  if (firestoreStatus().enabled) {
    const snapshot = await getFirestoreStore().collection('platformSupportTickets').orderBy('createdAt', 'desc').limit(500).get()
    const tickets = await Promise.all(snapshot.docs.map(async (doc) => {
      const ticket = { id: doc.id, ...doc.data() }
      const tenant = await getFirestoreStore().collection('tenants').doc(ticket.hospitalId).get()
      return { ...ticket, hospitalName: tenant.data()?.name || 'Unknown hospital' }
    }))
    return res.json({ tickets })
  }
  const tickets = db.prepare(`SELECT tk.id, tk.tenant_id AS hospitalId, t.name AS hospitalName, tk.issue,
      tk.priority, tk.status, tk.reply, tk.created_at AS createdAt, tk.updated_at AS updatedAt
    FROM platform_support_tickets tk JOIN tenants t ON t.id = tk.tenant_id ORDER BY tk.created_at DESC`).all()
  res.json({ tickets })
}))

app.patch('/platform/tickets/:id', platformAuth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const ref = getFirestoreStore().collection('platformSupportTickets').doc(req.params.id)
    const snapshot = await ref.get()
    if (!snapshot.exists) return res.status(404).json({ message: 'Support ticket not found' })
    const ticket = snapshot.data()
    const status = req.body?.status == null ? ticket.status : String(req.body.status)
    if (!['open', 'resolved'].includes(status)) return res.status(400).json({ message: 'Invalid ticket status' })
    const reply = req.body?.reply == null ? ticket.reply || '' : String(req.body.reply).trim().slice(0, 5000)
    await ref.set({ status, reply, updatedAt: now(), updatedBy: req.auth.sub }, { merge: true })
    platformAudit(req.auth.sub, status === 'resolved' ? 'support.ticket.resolved' : 'support.ticket.replied', 'support_ticket', req.params.id)
    return res.json({ id: req.params.id, hospitalId: ticket.hospitalId, issue: ticket.issue, priority: ticket.priority, status, reply })
  }
  const ticket = db.prepare('SELECT * FROM platform_support_tickets WHERE id = ?').get(req.params.id)
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found' })
  const status = req.body?.status == null ? ticket.status : String(req.body.status)
  if (!['open', 'resolved'].includes(status)) return res.status(400).json({ message: 'Invalid ticket status' })
  const reply = req.body?.reply == null ? ticket.reply : String(req.body.reply).trim()
  db.prepare('UPDATE platform_support_tickets SET status = ?, reply = ?, updated_at = ? WHERE id = ?').run(status, reply, now(), ticket.id)
  platformAudit(req.auth.sub, status === 'resolved' ? 'support.ticket.resolved' : 'support.ticket.replied', 'support_ticket', ticket.id)
  res.json({ id: ticket.id, hospitalId: ticket.tenant_id, issue: ticket.issue, priority: ticket.priority, status, reply })
}))

app.get('/platform/messages', platformAuth, asyncRoute(async (_req, res) => {
  if (firestoreStatus().enabled) {
    const snapshot = await getFirestoreStore().collection('platformMessages').orderBy('createdAt', 'desc').limit(500).get()
    const messages = await Promise.all(snapshot.docs.map(async (doc) => {
      const message = { id: doc.id, ...doc.data(), sentAt: doc.data().createdAt }
      const tenant = await getFirestoreStore().collection('tenants').doc(message.hospitalId).get()
      return { ...message, hospitalName: tenant.data()?.name || 'Unknown hospital' }
    }))
    return res.json({ messages })
  }
  const messages = db.prepare(`SELECT m.id, m.tenant_id AS hospitalId, t.name AS hospitalName, m.body,
      m.sent_by AS sentBy, m.created_at AS sentAt
    FROM platform_messages m JOIN tenants t ON t.id = m.tenant_id ORDER BY m.created_at DESC LIMIT 500`).all()
  res.json({ messages })
}))

app.post('/platform/tenants/:tenantId/messages', platformAuth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const tenant = await getFirestoreStore().collection('tenants').doc(req.params.tenantId).get()
    const body = String(req.body?.body || '').trim().slice(0, 5000)
    if (!tenant.exists) return res.status(404).json({ message: 'Hospital tenant not found' })
    if (!body) return res.status(400).json({ message: 'Message body is required' })
    const message = { id: id('message'), hospitalId: tenant.id, hospitalName: tenant.data().name, body, sentAt: now(), sentBy: req.auth.sub }
    await getFirestoreStore().collection('platformMessages').doc(message.id).set({ ...message, createdAt: message.sentAt })
    platformAudit(req.auth.sub, 'hospital.message.sent', 'platform_message', message.id, { tenantId: tenant.id })
    return res.status(201).json({ message })
  }
  const tenant = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(req.params.tenantId)
  const body = String(req.body?.body || '').trim()
  if (!tenant) return res.status(404).json({ message: 'Hospital tenant not found' })
  if (!body) return res.status(400).json({ message: 'Message body is required' })
  const message = { id: id('message'), hospitalId: tenant.id, hospitalName: tenant.name, body, sentAt: now(), sentBy: req.auth.sub }
  db.prepare('INSERT INTO platform_messages (id, tenant_id, body, sent_by, created_at) VALUES (?, ?, ?, ?, ?)').run(message.id, tenant.id, body, req.auth.sub, message.sentAt)
  platformAudit(req.auth.sub, 'hospital.message.sent', 'platform_message', message.id, { tenantId: tenant.id })
  res.status(201).json({ message })
}))

app.post('/support/tickets', auth, asyncRoute(async (req, res) => {
  const issue = String(req.body?.issue || '').trim().slice(0, 5000)
  const priority = ['low', 'medium', 'high'].includes(req.body?.priority) ? req.body.priority : 'medium'
  if (!issue) return res.status(400).json({ message: 'Describe the support issue' })
  const ticket = { id: id('ticket'), hospitalId: req.auth.tenantId, issue, priority, status: 'open', reply: '', createdAt: now(), updatedAt: now(), createdBy: req.auth.sub }
  if (firestoreStatus().enabled) {
    await getFirestoreStore().collection('platformSupportTickets').doc(ticket.id).set(ticket)
  } else {
    db.prepare('INSERT INTO platform_support_tickets (id, tenant_id, issue, priority, status, reply, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(ticket.id, ticket.hospitalId, ticket.issue, ticket.priority, ticket.status, ticket.reply, ticket.createdAt, ticket.updatedAt)
  }
  recordAudit(ticket.hospitalId, req.auth.sub, 'support.ticket.created', 'support_ticket', ticket.id)
  return res.status(201).json({ ticket })
}))

app.get('/tenant/modules', auth, asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) return res.json({ modules: await firestoreTenantModuleRows(req.auth.tenantId) })
  res.json({ modules: tenantModuleRows(req.auth.tenantId) })
}))

app.patch('/tenant/modules/:code', auth, requireRole('facility_admin', 'ceo_owner'), asyncRoute(async (req, res) => {
  const module = db.prepare('SELECT id, status FROM modules WHERE code = ?').get(req.params.code)
  if (!module) return res.status(404).json({ message: 'Module not found' })
  if (firestoreStatus().enabled) {
    const tenantRef = getFirestoreStore().collection('tenants').doc(req.auth.tenantId)
    const entitlement = await tenantRef.collection('moduleEntitlements').doc(req.params.code).get()
    if (entitlement.data()?.status !== 'entitled' || entitlement.data()?.source !== 'manual-payment-or-pro-override') return res.status(403).json({ message: 'This hospital is not entitled to this module' })
    const status = req.body?.enabled === false ? 'disabled' : 'enabled'
    await tenantRef.collection('tenantModules').doc(req.params.code).set({ moduleCode: req.params.code, status, activatedBy: req.auth.sub, activatedAt: status === 'enabled' ? now() : null }, { merge: true })
    return res.json({ moduleCode: req.params.code, activationStatus: status })
  }
  const entitlement = db.prepare('SELECT status, source FROM module_entitlements WHERE tenant_id = ? AND module_id = ?').get(req.auth.tenantId, module.id)
  if (entitlement?.status !== 'entitled' || entitlement.source !== 'manual-payment-or-pro-override') return res.status(403).json({ message: 'This hospital is not entitled to this module' })
  const status = req.body?.enabled === false ? 'disabled' : 'enabled'
  db.prepare('INSERT INTO tenant_modules (tenant_id, module_id, status, activated_by, activated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, module_id) DO UPDATE SET status = excluded.status, activated_by = excluded.activated_by, activated_at = excluded.activated_at').run(req.auth.tenantId, module.id, status, req.auth.sub, status === 'enabled' ? now() : null)
  recordAudit(req.auth.tenantId, req.auth.sub, `module.${status}`, 'module', module.id)
  res.json({ moduleCode: req.params.code, activationStatus: status })
}))

// Keep this list aligned with the frontend's durable domain stores. The
// backend stores synced records generically, so every user-facing entity can
// safely be accepted here while transport-only stores stay private to the
// client.
const allowedEntities = new Set([
  'hospitals', 'branches', 'staff', 'staff_roles', 'patients', 'visits',
  'appointments', 'payments', 'sales', 'products', 'batches', 'stock_movements',
  'prescriptions', 'dispensings', 'refunds', 'expenses', 'customers', 'suppliers',
  'purchase_orders', 'transfers', 'stock_counts', 'hmo_claims', 'devices',
  'shift_reports', 'audit_log', 'complaints', 'hr_actions', 'staff_payments',
  'settings',
])

app.get('/sync/snapshot', auth, async (req, res) => {
  let pageState = null
  if (req.query.cursor) {
    try {
      const state = jwt.verify(String(req.query.cursor), JWT_SECRET, { algorithms: ['HS256'], audience: 'sync-snapshot' })
      const firestoreCursor = Object.hasOwn(state, 'after')
      const validPosition = firestoreCursor
        ? state.after === null || typeof state.after === 'string'
        : typeof state.afterEntity === 'string' && typeof state.afterRecord === 'string'
      if (state.tenantId !== req.auth.tenantId || !Number.isSafeInteger(state.highWater) || !validPosition) throw new Error('Invalid cursor')
      pageState = firestoreCursor
        ? { after: state.after, highWater: state.highWater }
        : { afterEntity: state.afterEntity, afterRecord: state.afterRecord, highWater: state.highWater }
    } catch {
      return res.status(400).json({ message: 'Invalid or expired snapshot cursor. Restart the snapshot.' })
    }
  }
  if (firestoreStatus().enabled) {
    try {
      const snapshot = await readFirestoreSnapshot({ tenantId: req.auth.tenantId, pageState, pageSize: 200 })
      const nextCursor = snapshot.nextState ? jwt.sign({ ...snapshot.nextState, tenantId: req.auth.tenantId, aud: 'sync-snapshot' }, JWT_SECRET, { expiresIn: '1h' }) : null
      return res.json({ records: snapshot.records, nextCursor, deltaCursor: snapshot.deltaCursor })
    } catch (error) {
      return res.status(500).json({ message: 'Hospital data snapshot failed' })
    }
  }
  const highWater = pageState?.highWater ?? Number(db.prepare('SELECT COALESCE(MAX(sequence), 0) AS cursor FROM sync_changes WHERE tenant_id = ?').get(req.auth.tenantId).cursor)
  const afterEntity = pageState?.afterEntity || ''
  const afterRecord = pageState?.afterRecord || ''
  const rows = db.prepare(`SELECT entity, record_id, payload_json FROM records
    WHERE tenant_id = ? AND deleted = 0 AND (entity > ? OR (entity = ? AND record_id > ?))
    ORDER BY entity ASC, record_id ASC LIMIT 201`).all(req.auth.tenantId, afterEntity, afterEntity, afterRecord)
  const page = rows.slice(0, 200)
  const last = page.at(-1)
  const nextCursor = rows.length > 200 && last
    ? jwt.sign({ tenantId: req.auth.tenantId, aud: 'sync-snapshot', afterEntity: last.entity, afterRecord: last.record_id, highWater }, JWT_SECRET, { expiresIn: '1h' })
    : null
  return res.json({ records: page.map((row) => ({ entity: row.entity, recordId: row.record_id, payload: parse(row.payload_json, null) })), nextCursor, deltaCursor: highWater })
})

app.post('/sync', auth, async (req, res) => {
  const ops = Array.isArray(req.body?.ops) ? req.body.ops.slice(0, 50) : []
  if (!firestoreStatus().enabled) {
    const actor = db.prepare('SELECT id FROM staff WHERE id = ? AND tenant_id = ? AND active = 1').get(req.auth.sub, req.auth.tenantId)
    if (!actor) return res.status(401).json({ message: 'Active hospital staff session required' })
  }
  if (firestoreStatus().enabled) {
    try {
      return res.json(await applyFirestoreSync({ tenantId: req.auth.tenantId, actorId: req.auth.sub, ops, allowedEntities, timestamp: now }))
    } catch (error) {
      return res.status(500).json({ message: 'Firestore sync failed', ...(production ? {} : { detail: error.message }) })
    }
  }
  const acked = []
  const rejected = []
  const transaction = db.transaction(() => {
    for (const operation of ops) {
      const opId = String(operation?.opId || '')
      const entity = String(operation?.entity || '')
      if (!opId || !allowedEntities.has(entity)) {
        rejected.push({ opId, code: 'validation_error', message: 'Invalid operation or entity', retryable: false })
        continue
      }
      if (!['create', 'update', 'delete'].includes(operation.op)) {
        rejected.push({ opId, code: 'validation_error', message: 'Operation must be create, update, or delete', retryable: false })
        continue
      }
      const elevatedEntities = new Set(['hospitals', 'branches', 'staff', 'staff_roles', 'settings'])
      if (elevatedEntities.has(entity) && !req.auth.roles?.some((role) => ['facility_admin', 'ceo_owner', 'super_admin'].includes(role))) {
        rejected.push({ opId, code: 'forbidden', message: 'Hospital admin permission is required for this record', retryable: false })
        continue
      }
      if (!elevatedEntities.has(entity) && !canWriteEntity({ entity, operation: operation.op, roles: req.auth.roles, grants: req.auth.permGrants, denies: req.auth.permDenies })) {
        rejected.push({ opId, code: 'forbidden', message: 'Your role does not have permission to change this record', retryable: false })
        continue
      }
      const prior = db.prepare('SELECT result_json FROM sync_operations WHERE tenant_id = ? AND op_id = ?').get(req.auth.tenantId, opId)
      if (prior) {
        const result = parse(prior.result_json, {})
        if (result.acked) acked.push(opId)
        else rejected.push(result.rejected)
        continue
      }
      const recordId = String(operation.recordId || operation.payload?.id || '')
      if (!recordId) {
        rejected.push({ opId, code: 'validation_error', message: 'recordId is required', retryable: false })
        continue
      }
      const recordHospitalId = operation.payload?.hospitalId
      if (operation.payload?.actorId && operation.payload.actorId !== req.auth.sub) {
        rejected.push({ opId, code: 'forbidden', message: 'Record actor does not match the signed-in staff member', retryable: false })
        continue
      }
      if (recordHospitalId && recordHospitalId !== req.auth.tenantId) {
        rejected.push({ opId, code: 'forbidden', message: 'Record belongs to a different hospital', retryable: false })
        continue
      }
      const branchId = operation.payload?.branchId
      if (branchId && !firestoreStatus().enabled) {
        const isAdmin = req.auth.roles?.some((role) => ['facility_admin', 'ceo_owner', 'super_admin'].includes(role))
        if (req.auth.branchId && req.auth.branchId !== branchId && !isAdmin) {
          rejected.push({ opId, code: 'forbidden', message: 'Record belongs to a different branch', retryable: false })
          continue
        }
        const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND tenant_id = ?').get(branchId, req.auth.tenantId)
        if (!branch) {
          rejected.push({ opId, code: 'forbidden', message: 'Branch does not belong to the signed-in hospital', retryable: false })
          continue
        }
      }
      const action = operation.op === 'delete' ? 'delete' : operation.op === 'update' ? 'update' : 'create'
      const payload = { ...sanitizeSyncPayload(operation.payload || {}), id: recordId, hospitalId: req.auth.tenantId, ...(entity === 'audit_log' ? { actorId: req.auth.sub } : {}), updatedAt: now() }
      db.prepare('INSERT INTO records (tenant_id, entity, record_id, payload_json, deleted, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, entity, record_id) DO UPDATE SET payload_json = excluded.payload_json, deleted = excluded.deleted, updated_at = excluded.updated_at').run(req.auth.tenantId, entity, recordId, json(payload), action === 'delete' ? 1 : 0, now())
      db.prepare('INSERT INTO sync_changes (tenant_id, entity, record_id, operation, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.auth.tenantId, entity, recordId, action, action === 'delete' ? null : json(payload), now())
      if (entity === 'staff') {
        db.prepare(`UPDATE staff SET name = COALESCE(?, name), phone = COALESCE(?, phone), profession = COALESCE(?, profession),
          branch_id = COALESCE(?, branch_id), active = COALESCE(?, active), perm_grants_json = COALESCE(?, perm_grants_json),
          perm_denies_json = COALESCE(?, perm_denies_json), updated_at = ? WHERE id = ? AND tenant_id = ?`).run(
          payload.name == null ? null : String(payload.name), payload.phone == null ? null : String(payload.phone),
          payload.profession == null ? null : String(payload.profession), payload.branchId || null,
          action === 'delete' ? 0 : payload.active == null ? null : payload.active === false ? 0 : 1,
          payload.permGrants == null ? null : json(payload.permGrants), payload.permDenies == null ? null : json(payload.permDenies),
          now(), recordId, req.auth.tenantId,
        )
      }
      if (entity === 'staff_roles') {
        const staffId = String(payload.staffId || '')
        if (staffId) {
          const roleRows = db.prepare("SELECT payload_json FROM records WHERE tenant_id = ? AND entity = 'staff_roles' AND deleted = 0").all(req.auth.tenantId)
          const roles = roleRows.map((row) => parse(row.payload_json, {})).filter((row) => row.staffId === staffId && typeof row.role === 'string').map((row) => row.role)
          db.prepare('UPDATE staff SET roles_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(json([...new Set(roles)]), now(), staffId, req.auth.tenantId)
        }
      }
      recordAudit(req.auth.tenantId, req.auth.sub, `sync.${action}`, entity, recordId)
      const result = { acked: true }
      db.prepare('INSERT INTO sync_operations (tenant_id, op_id, result_json, created_at) VALUES (?, ?, ?, ?)').run(req.auth.tenantId, opId, json(result), now())
      acked.push(opId)
    }
  })
  try { transaction() } catch (error) { return res.status(500).json({ message: 'Sync transaction failed', ...(production ? {} : { detail: error.message }) }) }
  res.json({ acked, rejected })
})

app.get('/sync', auth, async (req, res) => {
  const cursor = Math.max(0, Number(req.query.cursor || 0))
  if (firestoreStatus().enabled) {
    try { return res.json(await readFirestoreChanges({ tenantId: req.auth.tenantId, cursor })) } catch (error) { return res.status(500).json({ message: 'Firestore pull failed', ...(production ? {} : { detail: error.message }) }) }
  }
  const changes = db.prepare('SELECT sequence, entity, record_id, operation, payload_json, created_at FROM sync_changes WHERE tenant_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 500').all(req.auth.tenantId, cursor).map((change) => ({ cursor: change.sequence, entity: change.entity, recordId: change.record_id, op: change.operation, payload: parse(change.payload_json, null), at: change.created_at }))
  res.json({ changes, cursor: changes.length ? changes[changes.length - 1].cursor : cursor })
})

app.get('/admin/summary', auth, requireRole('facility_admin', 'ceo_owner', 'super_admin'), asyncRoute(async (req, res) => {
  if (firestoreStatus().enabled) {
    const db = getFirestoreStore()
    const [tenantSnapshot, staffSnapshot, auditCountSnapshot] = await Promise.all([
      db.collection('tenants').doc(req.auth.tenantId).get(),
      db.collection('tenants').doc(req.auth.tenantId).collection('staff').get(),
      db.collection('tenants').doc(req.auth.tenantId).collection('syncChanges').where('entity', '==', 'audit_log').count().get(),
    ])
    if (!tenantSnapshot.exists) return res.status(404).json({ message: 'Hospital workspace not found' })
    const tenant = { id: tenantSnapshot.id, slug: tenantSnapshot.data().slug, name: tenantSnapshot.data().name, logoUrl: tenantSnapshot.data().logoUrl || null }
    return res.json({ tenant, staffCount: staffSnapshot.size, auditCount: auditCountSnapshot.data().count })
  }
  const tenantId = req.auth.tenantId
  const staffCount = db.prepare('SELECT COUNT(*) AS count FROM staff WHERE tenant_id = ?').get(tenantId).count
  const auditCount = db.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE tenant_id = ?').get(tenantId).count
  const tenant = db.prepare('SELECT id, slug, name, logo_url AS logoUrl FROM tenants WHERE id = ?').get(tenantId)
  res.json({ tenant, staffCount, auditCount })
}))

app.use((error, _req, res, _next) => {
  const status = error.message === 'Origin not allowed' ? 403 : 500
  if (status === 500) console.error('Unhandled backend error', error?.name || 'Error')
  return res.status(status).json({ message: status === 403 ? 'Request origin is not allowed' : 'Server error' })
})
app.listen(PORT, HOST, () => console.log(`Dibia HMS backend listening on ${HOST}:${PORT}`))
