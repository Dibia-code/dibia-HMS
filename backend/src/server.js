import 'dotenv/config'
import crypto from 'node:crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import jwt from 'jsonwebtoken'
import { query, transaction, supabaseStatus, checkSupabaseDatabase, getProfile, getPlatformProfile, getTenant, listTenants, updateTenant, getBranch, listBranches, getStaff, listStaff, findStaffByEmail, findStaffByPhone, writeProfile, writeStaff, saveDomainRecord, getDomainRecord, listDomainRecords, appendSyncChange } from './supabase-store.js'
import { createSupabaseUser, deleteSupabaseUser, findSupabaseUserByEmail, updateSupabaseUserPassword, verifySupabaseAccessToken, signInSupabasePassword, refreshSupabaseSession, revokeSupabaseSession, sendSupabasePasswordReset, updateSupabasePassword, supabaseAuthReady } from './supabase-auth.js'
import { applySupabaseSync, readSupabaseChanges, readSupabaseSnapshot } from './supabase-sync.js'

const production = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT || 4000)
const HOST = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1')
const JWT_SECRET = process.env.JWT_SECRET || (production ? '' : 'local-development-secret-change-me')
const minPasswordLength = production ? 12 : 8
const origins = String(process.env.FRONTEND_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5175,http://localhost:5175').split(',').map((value) => value.trim()).filter(Boolean)
const allowedEntities = new Set(['hospitals','branches','staff','staff_roles','patients','visits','appointments','payments','sales','products','batches','stock_movements','prescriptions','dispensings','refunds','expenses','customers','suppliers','purchase_orders','transfers','stock_counts','hmo_claims','devices','shift_reports','audit_log','complaints','hr_actions','staff_payments','settings'])
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const now = () => new Date().toISOString()
const apiError = (res, message, status = 500) => res.status(status).json({ message, ...(status >= 500 && res.req?.requestId ? { requestId: res.req.requestId } : {}) })
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

function sanitizeErrorMessage(value) {
  return String(value || 'Unknown error').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]').replace(/([?&](?:key|token|password|secret|access_token|refresh_token)=)[^&\s]*/gi, '$1[REDACTED]').replace(/((?:password|token|secret|private[_-]?key|client[_-]?secret|authorization|credential)\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s;]+)/gi, '$1[REDACTED]').replace(/[\r\n\t]+/g, ' ').slice(0, 400)
}

function errorDiagnostics(error, depth = 0) {
  const details = { name: String(error?.name || 'Error').slice(0, 80), code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null, message: sanitizeErrorMessage(error?.message) }
  if (depth < 2 && error?.cause) details.cause = errorDiagnostics(error.cause, depth + 1)
  return details
}

if (production) {
  const problems = []
  const exactHttps = (value) => { try { const parsed = new URL(value); return parsed.protocol === 'https:' && parsed.origin === value } catch { return false } }
  if (JWT_SECRET.length < 32 || /change-me|replace-|development|generate-a-unique/i.test(JWT_SECRET)) problems.push('JWT_SECRET must be a unique random secret of at least 32 characters')
  if (String(process.env.DEMO_MODE).toLowerCase() === 'true') problems.push('DEMO_MODE must be false')
  if (!origins.length || origins.some((origin) => !exactHttps(origin))) problems.push('FRONTEND_ORIGINS must contain only exact HTTPS origins without paths or trailing slashes')
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is required')
  if (!process.env.SUPABASE_URL || !/^https:\/\//i.test(process.env.SUPABASE_URL)) problems.push('SUPABASE_URL must be an HTTPS Supabase project URL')
  if (!process.env.SUPABASE_PUBLISHABLE_KEY) problems.push('SUPABASE_PUBLISHABLE_KEY is required')
  if (!process.env.SUPABASE_SECRET_KEY) problems.push('SUPABASE_SECRET_KEY is required')
  if (String(process.env.CONSOLE_ADMIN_PASSWORD || '').length < 16) problems.push('CONSOLE_ADMIN_PASSWORD must be at least 16 characters')
  if (!String(process.env.CONSOLE_ADMIN_EMAIL || '').includes('@')) problems.push('CONSOLE_ADMIN_EMAIL must be configured')
  if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join('; ')}`)
}

const app = express()
app.disable('x-powered-by')
if (production) app.set('trust proxy', 1)
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID()
  res.setHeader('X-Request-ID', req.requestId)
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store', ...(production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}) })
  next()
})
app.use(cors({ origin: (origin, callback) => !origin || origins.includes(origin) ? callback(null, true) : callback(new Error('Origin not allowed')), credentials: true, methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }))
app.use(express.json({ limit: '256kb', strict: true }))
app.use(cookieParser())
app.use((req, res, next) => {
  if (!['POST','PATCH','PUT','DELETE'].includes(req.method)) return next()
  const origin = req.get('origin')
  if (origin && !origins.includes(origin)) return res.status(403).json({ message: 'Request origin is not allowed' })
  if (production && !origin) return res.status(403).json({ message: 'Origin header is required' })
  next()
})

function setCookie(res, name, value) { res.cookie(name, value, { httpOnly: true, sameSite: production ? 'strict' : 'lax', secure: production, path: '/', maxAge: 7 * 86400000 }) }
function clearCookie(res, name) { res.clearCookie(name, { httpOnly: true, sameSite: production ? 'strict' : 'lax', secure: production, path: '/' }) }
function getBearer(req) { return String(req.get('authorization') || '').replace(/^Bearer\s+/i, '') }
function session(profile, tenant, branch, accessToken) {
  const roles = Array.isArray(profile.roles) ? profile.roles : ['facility_admin']
  return { accessToken, user: { id: profile.id, name: profile.name, email: profile.email, roles, hospitalId: profile.tenantId, hospitalSlug: tenant.slug, hospitalName: tenant.name, branchId: profile.branchId || branch?.id || null }, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl || null }, branch }
}

async function rateLimit(req, res, next) {
  try {
    const registration = req.path === '/auth/register'
    const windowMs = registration ? 3600000 : 900000
    const ipMax = registration ? 100 : 1000
    const accountMax = registration ? 5 : 10
    const identity = String(req.body?.email || req.body?.identifier || '').trim().toLowerCase()
    const keys = [{ value: `${req.path}:ip:${req.ip}`, max: ipMax }, ...(identity ? [{ value: `${req.path}:account:${identity}`, max: accountMax }] : [])]
    const allowed = await transaction(async (client) => {
      for (const key of keys) {
        const result = await client.query('insert into public.auth_rate_limits (id,count,reset_at) values ($1,1,now() + ($2 * interval \'1 millisecond\')) on conflict (id) do update set count = case when public.auth_rate_limits.reset_at <= now() then 1 else public.auth_rate_limits.count + 1 end, reset_at = case when public.auth_rate_limits.reset_at <= now() then now() + ($2 * interval \'1 millisecond\') else public.auth_rate_limits.reset_at end returning count', [sha256(key.value), windowMs])
        if (result.rows[0].count > key.max) return false
      }
      return true
    })
    if (!allowed) return apiError(res, 'Too many sign-in attempts. Try again later.', 429)
    next()
  } catch (error) { next(error) }
}

async function hospitalAccount(accessToken) {
  const authUser = await verifySupabaseAccessToken(accessToken)
  const profile = await getProfile(authUser.uid)
  if (!profile || profile.active === false || !profile.tenantId) throw new Error('Hospital account profile not found')
  const tenant = await getTenant(profile.tenantId)
  if (!tenant) throw new Error('Hospital tenant not found')
  if (tenant.status !== 'active') {
    const error = new Error(tenant.status === 'pending' ? 'Your hospital registration is awaiting approval' : 'This hospital workspace is not active')
    error.code = 'HOSPITAL_NOT_ACTIVE'
    throw error
  }
  const branch = profile.branchId ? await getBranch(profile.tenantId, profile.branchId) : null
  return { authUser, profile, tenant, branch }
}

async function platformAccount(accessToken) {
  const authUser = await verifySupabaseAccessToken(accessToken)
  const profile = await getPlatformProfile(authUser.uid)
  if (!profile || profile.active === false) throw new Error('Platform account not found')
  return { authUser, profile }
}

async function verifyHospital(req, res, next) {
  try {
    const account = await hospitalAccount(getBearer(req))
    req.auth = { sub: account.profile.id, tenantId: account.profile.tenantId, roles: account.profile.roles, branchId: account.profile.branchId, permGrants: account.profile.permGrants, permDenies: account.profile.permDenies }
    next()
  } catch (error) { res.status(error.code === 'HOSPITAL_NOT_ACTIVE' ? 403 : 401).json({ ...(error.code === 'HOSPITAL_NOT_ACTIVE' ? { code: error.message.includes('awaiting approval') ? 'REGISTRATION_PENDING' : 'HOSPITAL_INACTIVE' } : {}), message: error.code === 'HOSPITAL_NOT_ACTIVE' ? error.message : 'Access token expired or invalid' }) }
}

async function verifyPlatform(req, res, next) {
  try {
    const account = await platformAccount(getBearer(req))
    req.auth = { sub: account.profile.id, roles: account.profile.roles }
    next()
  } catch { res.status(401).json({ message: 'Platform access token expired or invalid' }) }
}

const auth = verifyHospital
const platformAuth = verifyPlatform
const requireRole = (...roles) => (req, res, next) => roles.some((role) => req.auth.roles?.includes(role)) ? next() : res.status(403).json({ message: 'You do not have permission for this action' })

async function platformAudit(actorId, action, entity, recordId, metadata = {}) {
  await query('insert into public.platform_audit_logs (id,actor_id,action,entity,record_id,metadata) values ($1,$2,$3,$4,$5,$6::jsonb)', [id('platform_audit'), actorId, action, entity, recordId, JSON.stringify(metadata)])
}

async function recordAudit(tenantId, actorId, action, entity = null, recordId = null, metadata = {}) {
  await query('insert into public.audit_logs (id,hospital_id,actor_id,action,entity,record_id,metadata) values ($1,$2,$3,$4,$5,$6,$7::jsonb)', [id('audit'), tenantId, actorId, action, entity, recordId, JSON.stringify(metadata)])
}

function passwordResetRedirect(req) {
  const origin = req.get('origin')
  if (!origin || !origins.includes(origin)) throw new Error('Password reset must be requested from an approved frontend origin')
  return `${origin}/reset-password`
}

const moduleSeed = [
  ['reception','Reception','Patient registration and identity capture','operations','included',0],['queue','Queue','Care routing and visit flow','operations','included',0],['cashier','Cashier','Patient billing and payment collection','finance','included',0],['inventory','Inventory','Hospital stock and supplies','operations','subscription',1500000],['reports','Reports','Hospital operational reports','administration','included',0],['patient-management','Patient Management','Central patient registry, identity and visit history','core','included',0],['appointments','Appointments','Scheduling, follow-ups and reminders','operations','included',0],['emr','Electronic Medical Records','Clinical encounters, diagnoses and medical notes','clinical','subscription',2500000],['laboratory','Laboratory Management','Requests, samples, results and verification','clinical','subscription',1800000],['pharmacy','Pharmacy Management','Prescriptions, dispensing and medicine stock','clinical','subscription',1800000],['billing','Billing & Accounts','Invoices, payments, receipts and insurance','finance','subscription',1500000],['inpatient','Inpatient Management','Admissions, wards, beds and discharge','clinical','subscription',2200000],['radiology','Radiology & Imaging','Imaging requests, worklists and reports','clinical','addon',2000000],['hr','HR & Payroll','Staff, attendance, leave and payroll','administration','addon',1200000],['analytics','Advanced Analytics','Cross-department operational insights','administration','addon',1400000],['telemedicine','Telemedicine','Remote consultations and secure sessions','clinical','addon',1600000],
]
const planSeed = [['professional','Professional',9500000],['freemium','Freemium',0],['small','Small',2500000],['medium','Medium',15000000],['large','Large',60000000]]

async function seedPlatform() {
  await transaction(async (client) => {
    for (const [code,name,description,category,pricingModel,priceMinor] of moduleSeed) await client.query('insert into public.modules (code,id,name,description,category,version,status,pricing_model,price_minor,config_schema) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) on conflict (code) do nothing', [code,`mod_${code}`,name,description,category,'1.0.0','published',pricingModel,priceMinor,'{}'])
    for (const [code,name,priceMinor] of planSeed) await client.query('insert into public.subscription_plans (code,id,name,price_minor,currency,status) values ($1,$2,$3,$4,$5,$6) on conflict (code) do nothing', [code,`plan_${code}`,name,priceMinor,'NGN','active'])
  })
  const email = String(process.env.CONSOLE_ADMIN_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.CONSOLE_ADMIN_PASSWORD || '')
  if (!email || password.length < 12) return
  let user
  try { user = await findSupabaseUserByEmail(email) } catch (error) {
    if (error.code !== 'auth/user-not-found' && error.status !== 404) throw error
    user = await createSupabaseUser({ email, password, displayName: 'Dibia Platform Super Admin' })
  }
  await transaction(async (client) => writeProfile(client, { id: user.uid, tenantId: null, name: user.displayName || 'Dibia Platform Super Admin', email, roles: ['platform_super_admin'], active: true }))
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'dibia-hms-backend', time: now(), dataStore: 'supabase-postgres', supabase: supabaseStatus() }))
app.get('/health/ready', asyncRoute(async (_req, res) => {
  const checks = await Promise.allSettled([checkSupabaseDatabase(), supabaseAuthReady(), (async () => { const result = await query("select exists(select 1 from public.profiles where active and roles @> array['platform_super_admin']::text[]) as ready"); return result.rows[0].ready })()])
  const state = { supabaseDatabase: checks[0].status === 'fulfilled', supabaseAuthConfigured: checks[1].status === 'fulfilled', platformAdmin: checks[2].status === 'fulfilled' && checks[2].value }
  const ready = Object.values(state).every(Boolean)
  res.status(ready ? 200 : 503).json({ ok: ready, service: 'dibia-hms-backend', checks: state, supabase: supabaseStatus() })
}))

app.post('/auth/register', rateLimit, asyncRoute(async (req, res) => {
  const hospitalName = String(req.body?.hospitalName || '').trim(), ownerName = String(req.body?.ownerName || '').trim(), email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || ''), phone = String(req.body?.phone || '').trim(), address = String(req.body?.address || '').trim()
  if (!hospitalName || !ownerName || !email || password.length < minPasswordLength) return apiError(res, `Hospital name, owner name, email, and a ${minPasswordLength}-character password are required`, 400)
  let user
  const tenantId = id('tenant'), branchId = id('branch'), base = hospitalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `hospital-${tenantId.slice(-6)}`
  let tenantSlug = base
  try {
    user = await createSupabaseUser({ email, password, displayName: ownerName, phoneNumber: /^\+[1-9]\d{7,14}$/.test(phone) ? phone : undefined })
    const timestamp = now()
    const branch = { id: branchId, hospitalId: tenantId, name: 'Main Branch', address, isMain: true, createdAt: timestamp }
    const profile = { id: user.uid, tenantId, branchId, name: ownerName, email, phone, roles: ['facility_admin'], active: true }
    await transaction(async (client) => {
      const slugResult = await client.query("select $1 || case when count(*) = 0 then '' else '-' || (count(*) + 1)::text end as slug from public.tenants where slug = $1 or slug like $1 || '-%'", [base])
      tenantSlug = slugResult.rows[0].slug.slice(0, 50)
      await client.query('insert into public.tenants (id,slug,name,address,phone,status) values ($1,$2,$3,$4,$5,$6)', [tenantId, tenantSlug, hospitalName, address, phone, 'pending'])
      await client.query('insert into public.branches (id,hospital_id,name,address,is_main) values ($1,$2,$3,$4,true)', [branchId, tenantId, 'Main Branch', address])
      await writeProfile(client, profile)
      await writeStaff(client, { ...profile, authUserId: user.uid, profession: 'Hospital administrator' })
      await client.query("insert into public.staff_roles (id,hospital_id,staff_id,role) values ($1,$2,$3,'facility_admin')", [`${user.uid}__facility_admin`, tenantId, user.uid])
      await client.query("insert into public.subscriptions (id,hospital_id,plan_code,plan_name,amount_minor,status,starts_at) values ($1,$2,'freemium','Freemium',0,'pending',now())", [`sub_${tenantId}`, tenantId])
      await client.query("insert into public.sync_changes (hospital_id,sequence,entity,record_id,operation,payload) values ($1,1,'hospitals',$1,'create',$2::jsonb),($1,2,'branches',$3,'create',$4::jsonb),($1,3,'staff',$5,'create',$6::jsonb),($1,4,'staff_roles',$7,'create',$8::jsonb)", [tenantId, JSON.stringify({ id: tenantId, hospitalId: tenantId, slug: tenantSlug, name: hospitalName, address, phone, status: 'pending' }), branchId, JSON.stringify(branch), user.uid, JSON.stringify({ ...profile, hospitalId: tenantId }), `${user.uid}__facility_admin`, JSON.stringify({ id: `${user.uid}__facility_admin`, hospitalId: tenantId, staffId: user.uid, role: 'facility_admin' })])
    })
    return res.status(201).json({ status: 'pending', message: 'Registration received. A Dibia administrator must approve your hospital before you can sign in.', tenant: { id: tenantId, slug: tenantSlug, name: hospitalName, address, phone, status: 'pending', createdAt: timestamp }, user: { id: user.uid, name: ownerName, email }, branch })
  } catch (error) {
    if (user?.uid) await deleteSupabaseUser(user.uid).catch(() => {})
    console.error('Hospital registration failed', { requestId: req.requestId, ...errorDiagnostics(error) })
    if (error.code === 'auth/email-already-exists') return apiError(res, 'An account with that email already exists', 409)
    return apiError(res, production ? 'Could not create hospital account.' : error.message, Number.isInteger(error.status) && error.status < 500 ? error.status : 400)
  }
}))

async function sendHospitalSession(res, accessToken, refreshToken) {
  const account = await hospitalAccount(accessToken)
  setCookie(res, 'dibia_refresh', refreshToken)
  return session(account.profile, account.tenant, account.branch, accessToken)
}

async function sendPlatformSession(res, accessToken, refreshToken, cookie = 'dibia_refresh') {
  const account = await platformAccount(accessToken)
  setCookie(res, cookie, refreshToken)
  return { accessToken, user: { id: account.profile.id, name: account.profile.name, email: account.profile.email, roles: account.profile.roles } }
}

app.post('/auth/login', rateLimit, asyncRoute(async (req, res) => {
  let identifier = String(req.body?.identifier || '').trim()
  const password = String(req.body?.password || '')
  if (!identifier.includes('@')) { const staff = await findStaffByPhone(identifier); if (!staff) return apiError(res, 'Invalid login details', 401); identifier = staff.email || identifier }
  try {
    const signed = await signInSupabasePassword(identifier.toLowerCase(), password)
    const result = req.body?.audience === 'platform' ? await sendPlatformSession(res, signed.accessToken, signed.refreshToken) : await sendHospitalSession(res, signed.accessToken, signed.refreshToken)
    return res.json(result)
  } catch (error) {
    if (error.status === 429) return apiError(res, 'Too many sign-in attempts. Try again later.', 429)
    if (error.code === 'HOSPITAL_NOT_ACTIVE') return res.status(403).json({ code: error.message.includes('awaiting approval') ? 'REGISTRATION_PENDING' : 'HOSPITAL_INACTIVE', message: error.message })
    return apiError(res, error.status >= 500 ? 'Authentication service is temporarily unavailable.' : 'Invalid login details', error.status >= 500 ? 503 : 401)
  }
}))

app.post('/auth/console/login', rateLimit, asyncRoute(async (req, res) => {
  try {
    const signed = await signInSupabasePassword(String(req.body?.email || '').trim().toLowerCase(), String(req.body?.password || ''))
    const result = await sendPlatformSession(res, signed.accessToken, signed.refreshToken, 'dibia_console_refresh')
    await platformAudit(result.user.id, 'auth.login', 'platform_user', result.user.id)
    return res.json(result)
  } catch (error) { return apiError(res, error.status >= 500 ? 'Authentication service is temporarily unavailable.' : 'Invalid Super Admin email or password', error.status >= 500 ? 503 : 401) }
}))

app.post('/auth/refresh', asyncRoute(async (req, res) => {
  const token = req.cookies.dibia_refresh
  if (!token) return apiError(res, 'Refresh session expired', 401)
  const refreshed = await refreshSupabaseSession(token)
  if (!refreshed) return apiError(res, 'Refresh session expired', 401)
  try {
    const profile = await getProfile(refreshed.user.uid)
    if (profile?.roles?.includes('platform_super_admin')) return res.json(await sendPlatformSession(res, refreshed.accessToken, refreshed.refreshToken))
    return res.json(await sendHospitalSession(res, refreshed.accessToken, refreshed.refreshToken))
  } catch { clearCookie(res, 'dibia_refresh'); return apiError(res, 'Refresh session expired', 401) }
}))

app.post('/auth/logout', asyncRoute(async (req, res) => { const token = req.cookies.dibia_refresh; if (token) await revokeSupabaseSession(token); clearCookie(res, 'dibia_refresh'); res.json({ ok: true }) }))
app.get('/auth/console/session', asyncRoute(async (req, res) => {
  const token = req.cookies.dibia_console_refresh
  const refreshed = token ? await refreshSupabaseSession(token) : null
  if (!refreshed) return apiError(res, 'Console session expired', 401)
  try { return res.json(await sendPlatformSession(res, refreshed.accessToken, refreshed.refreshToken, 'dibia_console_refresh')) } catch { clearCookie(res, 'dibia_console_refresh'); return apiError(res, 'Console session expired', 401) }
}))
app.post('/auth/console/logout', asyncRoute(async (req, res) => { const token = req.cookies.dibia_console_refresh; if (token) await revokeSupabaseSession(token); clearCookie(res, 'dibia_console_refresh'); res.json({ ok: true }) }))

async function requestPasswordReset(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const generic = { message: 'If an account exists for that email, a password reset link will be sent.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json(generic)
  const result = await sendSupabasePasswordReset(email, passwordResetRedirect(req))
  if (!result.ok) { console.error('Password reset request failed', { requestId: req.requestId, code: result.error?.code || 'SUPABASE_AUTH_ERROR' }); return apiError(res, 'Password reset is temporarily unavailable.', 503) }
  return res.json(generic)
}
app.post('/auth/console/forgot-password', rateLimit, asyncRoute(requestPasswordReset))
app.post('/auth/forgot-password', rateLimit, asyncRoute(requestPasswordReset))
app.post('/auth/password/update', rateLimit, asyncRoute(async (req, res) => {
  const token = getBearer(req), password = String(req.body?.password || '')
  if (!token) return apiError(res, 'Password reset session is invalid or expired.', 401)
  if (password.length < minPasswordLength) return apiError(res, `Password must be at least ${minPasswordLength} characters.`, 400)
  try { await updateSupabasePassword(token, password); return res.json({ message: 'Password updated. You can now sign in.' }) }
  catch (error) { console.error('Password update failed', { requestId: req.requestId, ...errorDiagnostics(error) }); return apiError(res, error.status === 401 ? 'Password reset session is invalid or expired.' : 'Password could not be updated. Request a new reset link.', error.status === 401 ? 401 : 503) }
}))

app.get('/me', auth, asyncRoute(async (req, res) => {
  const profile = await getProfile(req.auth.sub), tenant = await getTenant(req.auth.tenantId), branch = profile.branchId ? await getBranch(profile.tenantId, profile.branchId) : null
  res.json(session(profile, tenant, branch, getBearer(req)))
}))

app.post('/staff/:staffId/password-reset', auth, requireRole('facility_admin','ceo_owner','super_admin'), asyncRoute(async (req, res) => {
  const staff = await getStaff(req.auth.tenantId, req.params.staffId)
  if (!staff) return apiError(res, 'Staff member not found in this hospital', 404)
  const email = String(staff.email || '').trim().toLowerCase()
  if (!email) return apiError(res, 'This staff account has no email address for password recovery', 400)
  const roleResult = await query('select role from public.staff_roles where hospital_id = $1 and staff_id = $2', [req.auth.tenantId, staff.id])
  const roles = [...new Set(roleResult.rows.map((row) => row.role))]
  if (!roles.length) return apiError(res, 'Assign at least one role to this staff member before enabling sign-in', 409)
  let user
  try { user = await findSupabaseUserByEmail(email) } catch (error) {
    if (error.status !== 404) throw error
    user = await createSupabaseUser({ email, password: crypto.randomBytes(36).toString('base64url'), displayName: staff.name, emailConfirmed: true })
  }
  const existing = await getProfile(user.uid)
  if (existing?.roles?.includes('platform_super_admin')) return apiError(res, 'This email is reserved for a platform console account', 409)
  if (existing?.tenantId && existing.tenantId !== req.auth.tenantId) return apiError(res, 'This email is already linked to another hospital account', 409)
  const profile = { id: user.uid, tenantId: req.auth.tenantId, branchId: staff.branchId, name: staff.name || user.displayName || email, email, phone: staff.phone, roles, active: staff.active !== false, permGrants: staff.permGrants || [], permDenies: staff.permDenies || [] }
  await transaction(async (client) => { await writeProfile(client, profile); await client.query('update public.staff set auth_user_id = $3 where hospital_id = $1 and id = $2', [req.auth.tenantId, staff.id, user.uid]) })
  const result = await sendSupabasePasswordReset(email, passwordResetRedirect(req))
  if (!result.ok) return apiError(res, 'Password reset email could not be sent. Try again later.', 503)
  await recordAudit(req.auth.tenantId, req.auth.sub, 'staff.password_reset', 'staff', staff.id)
  res.json({ message: 'A secure password reset link was requested for the staff member.' })
}))

app.post('/staff/:staffId/access-code', auth, requireRole('facility_admin','ceo_owner','super_admin'), asyncRoute(async (req, res) => {
  const staffId = String(req.params.staffId || '').trim()
  const staff = req.body?.staff && typeof req.body.staff === 'object' ? req.body.staff : {}
  const email = String(staff.email || '').trim().toLowerCase()
  const name = String(staff.name || '').trim()
  const accessCode = String(req.body?.accessCode || '')
  const roles = Array.isArray(req.body?.roles) ? req.body.roles : []
  const supported = new Set(['super_admin','facility_admin','ceo_owner','branch_manager','pharmacist','superintendent_pharmacist','receptionist','cashier','dispenser','pharmacy_cashier','inventory_officer','sales_staff','accountant','warehouse_officer','doctor','nurse','laboratory_technician'])
  if (!staffId || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || accessCode.length < minPasswordLength || !roles.length || roles.some((row) => !row?.id || !supported.has(row.role))) return apiError(res, `Staff name, email, supported roles, and an access code of at least ${minPasswordLength} characters are required`, 400)
  const branchId = staff.branchId || null
  if (branchId && !await getBranch(req.auth.tenantId, branchId)) return apiError(res, 'Branch does not belong to this hospital', 400)
  const existingStaff = await getStaff(req.auth.tenantId, staffId)
  let user
  let created = false
  try {
    try {
      user = await findSupabaseUserByEmail(email)
      if (!existingStaff || existingStaff.authUserId !== user.uid) return apiError(res, 'This email already belongs to another sign-in account', 409)
      await updateSupabaseUserPassword(user.uid, accessCode)
    } catch (error) {
      if (error.status !== 404 && error.code !== 'auth/user-not-found') throw error
      user = await createSupabaseUser({ email, password: accessCode, displayName: name })
      created = true
    }
    const roleNames = [...new Set(roles.map((row) => row.role))]
    const profile = { id: user.uid, tenantId: req.auth.tenantId, branchId, name, email, phone: String(staff.phone || ''), roles: roleNames, active: staff.active !== false, permGrants: staff.permGrants || [], permDenies: staff.permDenies || [] }
    await transaction(async (client) => {
      await writeProfile(client, profile)
      await writeStaff(client, { ...staff, id: staffId, hospitalId: req.auth.tenantId, authUserId: user.uid, branchId, name, email, roles: roleNames, active: profile.active })
      await client.query('delete from public.staff_roles where hospital_id=$1 and staff_id=$2', [req.auth.tenantId, staffId])
      for (const row of roles) await client.query('insert into public.staff_roles (id,hospital_id,staff_id,role) values ($1,$2,$3,$4) on conflict (id) do update set role=excluded.role', [row.id, req.auth.tenantId, staffId, row.role])
      await appendSyncChange(client, req.auth.tenantId, 'staff', staffId, 'update', { ...staff, id: staffId, hospitalId: req.auth.tenantId, authUserId: user.uid }, req.auth.sub)
      for (const row of roles) await appendSyncChange(client, req.auth.tenantId, 'staff_roles', row.id, 'create', { ...row, hospitalId: req.auth.tenantId, staffId }, req.auth.sub)
    })
    await recordAudit(req.auth.tenantId, req.auth.sub, 'staff.sign_in_created', 'staff', staffId)
    return res.status(201).json({ message: 'Staff sign-in is ready. Share the access code securely and ask them to change it using Forgot password.' })
  } catch (error) {
    if (created && user?.uid) await deleteSupabaseUser(user.uid).catch(() => {})
    throw error
  }
}))

async function tenantSummary(tenant) {
  const [branches, staff, subscription, modules] = await Promise.all([
    query('select count(*)::int as count from public.branches where hospital_id = $1 and not is_deleted', [tenant.id]),
    query('select count(*)::int as count from public.staff where hospital_id = $1 and active and not is_deleted', [tenant.id]),
    query('select * from public.subscriptions where hospital_id = $1 order by created_at desc limit 1', [tenant.id]),
    query("select m.name from public.tenant_modules tm join public.modules m on m.code = tm.module_code where tm.hospital_id = $1 and tm.status = 'enabled' order by m.name", [tenant.id]),
  ])
  const billing = subscription.rows[0]
  return { id: tenant.id, slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl || null, location: tenant.address || '', phone: tenant.phone || '', tenantStatus: tenant.status || 'pending', registeredAt: tenant.createdAt || null, branches: branches.rows[0].count, staff: staff.rows[0].count, subscriptionStatus: billing?.status || 'pending', plan: billing?.plan_name || 'Freemium', status: ['past_due','failed'].includes(billing?.status) ? 'failed' : tenant.status || 'pending', usageDays: 0, modules: modules.rows.map((row) => row.name) }
}

async function moduleRows(tenantId) {
  const result = await query('select m.id,m.code,m.name,m.description,m.category,m.version,m.status,m.price_minor,e.source,e.status as entitlement_status,tm.status as activation_status from public.modules m left join public.module_entitlements e on e.module_code=m.code and e.hospital_id=$1 left join public.tenant_modules tm on tm.module_code=m.code and tm.hospital_id=$1 order by m.name', [tenantId])
  return result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, description: row.description, category: row.category, version: row.version, publicationStatus: row.status, priceMinor: Number(row.price_minor), entitlementStatus: row.source === 'manual-payment-or-pro-override' && row.entitlement_status === 'entitled' ? 'entitled' : 'unentitled', activationStatus: row.source === 'manual-payment-or-pro-override' && row.entitlement_status === 'entitled' ? row.activation_status || 'disabled' : 'disabled' }))
}

async function addRecord(tenantId, entity, recordId, payload, operation = 'create', actorId = null) {
  await transaction(async (client) => {
    await saveDomainRecord(client, tenantId, entity, recordId, payload, operation === 'delete')
    await appendSyncChange(client, tenantId, entity, recordId, operation, operation === 'delete' ? null : payload, actorId)
  })
}

app.get('/platform/summary', platformAuth, asyncRoute(async (_req, res) => {
  const [tenants, subscriptions, modules, staff] = await Promise.all([query('select count(*)::int as count from public.tenants'), query("select count(*)::int as count from public.subscriptions where status='active'"), query("select count(*)::int as count from public.modules where status='published'"), query('select count(*)::int as count from public.staff where active and not is_deleted')])
  res.json({ hospitals: tenants.rows[0].count, activeSubscriptions: subscriptions.rows[0].count, publishedModules: modules.rows[0].count, activeUsers: staff.rows[0].count })
}))
app.get('/platform/audit', platformAuth, asyncRoute(async (req, res) => { const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200))); const result = await query('select id,actor_id as "platformUserId",action,entity,record_id as "recordId",metadata,created_at as "createdAt" from public.platform_audit_logs order by created_at desc limit $1', [limit]); res.json({ audit: result.rows }) }))
app.get('/platform/settings', platformAuth, asyncRoute(async (_req, res) => { const result = await query("select value from public.platform_settings where key='platform'"); res.json({ settings: { id: 'platform', ...(result.rows[0]?.value || {}) } }) }))
app.patch('/platform/settings', platformAuth, asyncRoute(async (req, res) => { const value = { ...(req.body || {}) }; delete value.id; await query("insert into public.platform_settings (key,value) values ('platform',$1::jsonb) on conflict (key) do update set value=excluded.value,updated_at=now()", [JSON.stringify(value)]); await platformAudit(req.auth.sub, 'platform.settings.updated', 'platform_settings', 'platform'); res.json({ settings: { id: 'platform', ...value } }) }))
app.get('/platform/transactions', platformAuth, asyncRoute(async (_req, res) => { const result = await query('select s.id,s.hospital_id as "hospitalId",t.name as "hospitalName",s.plan_name as plan,s.amount_minor as "amountMinor",s.amount_minor/100.0 as amount,coalesce(s.renews_at,s.updated_at,s.created_at) as date,s.status from public.subscriptions s join public.tenants t on t.id=s.hospital_id order by s.created_at desc'); res.json({ transactions: result.rows.map((row) => ({ ...row, status: row.status === 'active' ? 'paid' : row.status === 'past_due' ? 'failed' : row.status })) }) }))
app.patch('/platform/transactions/:id/confirm', platformAuth, asyncRoute(async (req, res) => { const result = await query("update public.subscriptions set status='active',payment_method='manual',confirmed_by=$2,confirmed_at=now(),updated_at=now() where id=$1 returning id,hospital_id", [req.params.id, req.auth.sub]); if (!result.rowCount) return apiError(res, 'Subscription transaction not found', 404); await platformAudit(req.auth.sub, 'subscription.payment_confirmed', 'subscription', req.params.id, { tenantId: result.rows[0].hospital_id, method: 'manual' }); res.json({ id: req.params.id, hospitalId: result.rows[0].hospital_id, status: 'paid' }) }))
app.get('/platform/modules', platformAuth, asyncRoute(async (_req, res) => { const result = await query('select id,code,name,description,category,version,status,pricing_model as "pricingModel",price_minor as "priceMinor",config_schema as "configSchema",created_at as "createdAt",updated_at as "updatedAt" from public.modules order by name'); res.json({ modules: result.rows }) }))
app.post('/platform/modules', platformAuth, asyncRoute(async (req, res) => { const code = String(req.body?.code || '').trim().toLowerCase(), name = String(req.body?.name || '').trim(); if (!/^[a-z0-9-]+$/.test(code) || !name) return apiError(res, 'Module code and name are required', 400); const item = { id: id('module'), code, name, description: String(req.body?.description || ''), category: String(req.body?.category || 'operations'), version: String(req.body?.version || '1.0.0'), status: 'draft', pricing_model: String(req.body?.pricingModel || 'addon'), price_minor: Math.max(0, Number(req.body?.priceMinor || 0)), config_schema: req.body?.configSchema || {} }; try { await query('insert into public.modules (id,code,name,description,category,version,status,pricing_model,price_minor,config_schema) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)', [item.id,item.code,item.name,item.description,item.category,item.version,item.status,item.pricing_model,item.price_minor,JSON.stringify(item.config_schema)]) } catch (error) { if (error.code === '23505') return apiError(res, 'A module with that code already exists', 409); throw error } await platformAudit(req.auth.sub, 'module.created', 'module', item.id, { code }); res.status(201).json(item) }))
app.get('/platform/tenants', platformAuth, asyncRoute(async (_req, res) => { const tenants = await listTenants(); const items = await Promise.all(tenants.map(tenantSummary)); res.json({ tenants: items.sort((a, b) => a.name.localeCompare(b.name)) }) }))
app.post('/platform/tenants/:tenantId/decision', platformAuth, asyncRoute(async (req, res) => { const decision = String(req.body?.decision || ''); if (!['approve','reject'].includes(decision)) return apiError(res, 'Decision must be approve or reject', 400); const tenant = await getTenant(req.params.tenantId); if (!tenant) return apiError(res, 'Hospital tenant not found', 404); if (tenant.status !== 'pending') return apiError(res, `Only pending registrations can be ${decision === 'approve' ? 'approved' : 'rejected'}`, 409); const status = decision === 'approve' ? 'active' : 'rejected'; await transaction(async (client) => { await client.query('update public.tenants set status=$2,updated_at=now() where id=$1', [tenant.id,status]); if (decision === 'approve') await client.query("update public.subscriptions set starts_at=coalesce(starts_at,now()),updated_at=now() where hospital_id=$1", [tenant.id]) }); await platformAudit(req.auth.sub, `tenant.${decision}d`, 'tenant', tenant.id, { before: { status: tenant.status }, after: { status } }); res.json({ tenant: { ...tenant, status, updatedAt: now() } }) }))
app.patch('/platform/tenants/:tenantId', platformAuth, asyncRoute(async (req, res) => {
  const tenant = await getTenant(req.params.tenantId)
  if (!tenant) return apiError(res, 'Hospital tenant not found', 404)
  const allowed = new Set(['pending','active','suspended','rejected'])
  const status = req.body?.status == null ? tenant.status : String(req.body.status)
  if (!allowed.has(status)) return apiError(res, 'Invalid tenant status', 400)
  if (status !== tenant.status && (tenant.status === 'pending' || status === 'rejected')) return apiError(res, 'Use the registration decision action for pending hospitals', 409)
  let plan
  if (req.body?.plan != null) {
    const result = await query('select code,name,price_minor from public.subscription_plans where lower(code)=lower($1) or lower(name)=lower($1) limit 1', [String(req.body.plan)])
    if (!result.rowCount) return apiError(res, 'Unknown subscription plan', 400)
    plan = result.rows[0]
  }
  const values = { status }
  if (req.body?.name != null) values.name = String(req.body.name).trim()
  if (req.body?.location != null) values.address = String(req.body.location).trim()
  if (req.body?.phone != null) values.phone = String(req.body.phone).trim()
  const updated = await updateTenant(tenant.id, values)
  if (plan) {
    const current = await query('select id,status from public.subscriptions where hospital_id=$1 order by created_at desc limit 1', [tenant.id])
    const subscriptionId = current.rows[0]?.id || `sub_${tenant.id}`
    await query('insert into public.subscriptions (id,hospital_id,plan_code,plan_name,amount_minor,status,starts_at) values ($1,$2,$3,$4,$5,$6,now()) on conflict (hospital_id,id) do update set plan_code=excluded.plan_code,plan_name=excluded.plan_name,amount_minor=excluded.amount_minor,updated_at=now()', [subscriptionId,tenant.id,plan.code,plan.name,plan.price_minor,current.rows[0]?.status || 'pending'])
  }
  await platformAudit(req.auth.sub, `tenant.${status}`, 'tenant', tenant.id, { before: { status: tenant.status }, after: { status } })
  res.json({ tenant: { ...updated, ...(plan ? { plan: plan.name } : {}) } })
}))
app.get('/platform/tenants/:tenantId/users', platformAuth, asyncRoute(async (req, res) => { const tenant = await getTenant(req.params.tenantId); if (!tenant) return apiError(res, 'Hospital tenant not found', 404); const staff = await listStaff(tenant.id); res.json({ users: staff.map((person) => ({ ...person, hospitalId: tenant.id, hospitalName: tenant.name })) }) }))
app.post('/platform/tenants/:tenantId/users', platformAuth, asyncRoute(async (req, res) => {
  const tenant = await getTenant(req.params.tenantId)
  if (!tenant) return apiError(res, 'Hospital tenant not found', 404)
  const name = String(req.body?.name || '').trim(), email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || ''), role = String(req.body?.role || 'facility_admin')
  const supported = new Set(['super_admin','facility_admin','ceo_owner','branch_manager','pharmacist','superintendent_pharmacist','receptionist','cashier','dispenser','pharmacy_cashier','inventory_officer','sales_staff','accountant','warehouse_officer','doctor','nurse','laboratory_technician'])
  if (!name || !email || password.length < minPasswordLength || !supported.has(role)) return apiError(res, 'Name, valid email, supported role, and a sufficiently long password are required', 400)
  const branches = await listBranches(tenant.id), branchId = req.body?.branchId || branches[0]?.id || null
  if (req.body?.branchId && !branches.some((branch) => branch.id === branchId)) return apiError(res, 'Branch does not belong to this hospital', 400)
  let user
  try {
    user = await createSupabaseUser({ email, password, displayName: name })
    const profile = { id: user.uid, tenantId: tenant.id, branchId, name, email, phone: String(req.body?.phone || ''), roles: [role], active: true }
    await transaction(async (client) => { await writeProfile(client, profile); await writeStaff(client, { ...profile, authUserId: user.uid, profession: role }); await client.query('insert into public.staff_roles (id,hospital_id,staff_id,role) values ($1,$2,$3,$4)', [`${user.uid}__${role}`,tenant.id,user.uid,role]); await appendSyncChange(client, tenant.id, 'staff', user.uid, 'create', { ...profile, hospitalId: tenant.id }, req.auth.sub); await appendSyncChange(client, tenant.id, 'staff_roles', `${user.uid}__${role}`, 'create', { id: `${user.uid}__${role}`, hospitalId: tenant.id, staffId: user.uid, role }, req.auth.sub) })
    await platformAudit(req.auth.sub, 'hospital.user.created', 'staff', user.uid, { tenantId: tenant.id, role })
    res.status(201).json({ user: { ...profile, hospitalId: tenant.id, hospitalName: tenant.name } })
  } catch (error) { if (user?.uid) await deleteSupabaseUser(user.uid).catch(() => {}); if (error.code === 'auth/email-already-exists') return apiError(res, 'An account with that email already exists', 409); return apiError(res, production ? 'Could not create hospital account' : error.message, 400) }
}))
app.get('/platform/tenants/:tenantId/modules', platformAuth, asyncRoute(async (req, res) => { const tenant = await getTenant(req.params.tenantId); if (!tenant) return apiError(res, 'Hospital tenant not found', 404); res.json({ tenant, modules: await moduleRows(tenant.id) }) }))
app.patch('/platform/tenants/:tenantId/modules/:code', platformAuth, asyncRoute(async (req, res) => { const tenant = await getTenant(req.params.tenantId); const module = await query('select * from public.modules where code=$1', [req.params.code]); if (!tenant || !module.rowCount) return apiError(res, 'Tenant or module not found', 404); const item = module.rows[0], entitlement = req.body?.entitled !== false ? 'entitled' : 'revoked', activation = entitlement === 'revoked' || req.body?.enabled === false ? 'disabled' : 'enabled'; await transaction(async (client) => { await client.query('insert into public.module_entitlements (hospital_id,module_code,source,status,starts_at) values ($1,$2,$3,$4,now()) on conflict (hospital_id,module_code) do update set source=excluded.source,status=excluded.status,starts_at=excluded.starts_at,updated_at=now()', [tenant.id,item.code,String(req.body?.source || 'platform'),entitlement]); await client.query('insert into public.tenant_modules (hospital_id,module_code,status,activated_by,activated_at) values ($1,$2,$3,$4,case when $3=\'enabled\' then now() end) on conflict (hospital_id,module_code) do update set status=excluded.status,activated_by=excluded.activated_by,activated_at=excluded.activated_at', [tenant.id,item.code,activation,req.auth.sub]) }); await platformAudit(req.auth.sub, `tenant.module.${activation}`, 'tenant_module', `${tenant.id}:${item.code}`); res.json({ tenantId: tenant.id, moduleCode: item.code, moduleName: item.name, entitlementStatus: entitlement, activationStatus: activation }) }))
app.get('/platform/tickets', platformAuth, asyncRoute(async (_req, res) => { const result = await query('select s.id,s.hospital_id as "hospitalId",t.name as "hospitalName",s.created_by as "createdBy",s.updated_by as "updatedBy",s.issue,s.priority,s.status,s.reply,s.created_at as "createdAt",s.updated_at as "updatedAt" from public.support_tickets s join public.tenants t on t.id=s.hospital_id order by s.created_at desc limit 500'); res.json({ tickets: result.rows }) }))
app.patch('/platform/tickets/:id', platformAuth, asyncRoute(async (req, res) => { const current = await query('select * from public.support_tickets where id=$1', [req.params.id]); if (!current.rowCount) return apiError(res, 'Support ticket not found', 404); const ticket = current.rows[0], status = req.body?.status == null ? ticket.status : String(req.body.status); if (!['open','resolved'].includes(status)) return apiError(res, 'Invalid ticket status', 400); const reply = req.body?.reply == null ? ticket.reply : String(req.body.reply).trim().slice(0,5000); await query('update public.support_tickets set status=$2,reply=$3,updated_by=$4,updated_at=now() where id=$1', [ticket.id,status,reply,req.auth.sub]); await platformAudit(req.auth.sub, status === 'resolved' ? 'support.ticket.resolved' : 'support.ticket.replied', 'support_ticket', ticket.id); res.json({ id: ticket.id, hospitalId: ticket.hospital_id, issue: ticket.issue, priority: ticket.priority, status, reply }) }))
app.get('/platform/messages', platformAuth, asyncRoute(async (_req, res) => { const result = await query('select m.id,m.hospital_id as "hospitalId",t.name as "hospitalName",m.sent_by as "sentBy",m.body,m.created_at as "sentAt" from public.platform_messages m join public.tenants t on t.id=m.hospital_id order by m.created_at desc limit 500'); res.json({ messages: result.rows.map((row) => ({ ...row, direction: 'outgoing' })) }) }))
app.post('/platform/tenants/:tenantId/messages', platformAuth, asyncRoute(async (req, res) => { const tenant = await getTenant(req.params.tenantId), body = String(req.body?.body || '').trim().slice(0,5000); if (!tenant) return apiError(res, 'Hospital tenant not found', 404); if (!body) return apiError(res, 'Message body is required', 400); const message = { id: id('message'), hospitalId: tenant.id, hospitalName: tenant.name, body, sentAt: now(), sentBy: req.auth.sub }; await query('insert into public.platform_messages (id,hospital_id,sent_by,body) values ($1,$2,$3,$4)', [message.id,tenant.id,req.auth.sub,body]); await platformAudit(req.auth.sub, 'hospital.message.sent', 'platform_message', message.id, { tenantId: tenant.id }); res.status(201).json({ message }) }))
app.post('/support/tickets', auth, asyncRoute(async (req, res) => { const issue = String(req.body?.issue || '').trim().slice(0,5000), priority = ['low','medium','high'].includes(req.body?.priority) ? req.body.priority : 'medium'; if (!issue) return apiError(res, 'Describe the support issue', 400); const ticket = { id: id('ticket'), hospitalId: req.auth.tenantId, issue, priority, status: 'open', reply: '', createdAt: now(), updatedAt: now(), createdBy: req.auth.sub }; await query('insert into public.support_tickets (id,hospital_id,created_by,issue,priority,status,reply) values ($1,$2,$3,$4,$5,$6,$7)', [ticket.id,ticket.hospitalId,ticket.createdBy,ticket.issue,ticket.priority,ticket.status,ticket.reply]); await recordAudit(ticket.hospitalId, req.auth.sub, 'support.ticket.created', 'support_ticket', ticket.id); res.status(201).json({ ticket }) }))
app.get('/tenant/modules', auth, asyncRoute(async (req, res) => res.json({ modules: await moduleRows(req.auth.tenantId) })))
app.patch('/tenant/modules/:code', auth, requireRole('facility_admin','ceo_owner'), asyncRoute(async (req, res) => { const result = await query('select e.status,e.source from public.module_entitlements e where e.hospital_id=$1 and e.module_code=$2', [req.auth.tenantId,req.params.code]); if (!result.rowCount) return apiError(res, 'Module not found', 404); if (result.rows[0].status !== 'entitled' || result.rows[0].source !== 'manual-payment-or-pro-override') return apiError(res, 'This hospital is not entitled to this module', 403); const status = req.body?.enabled === false ? 'disabled' : 'enabled'; await query('insert into public.tenant_modules (hospital_id,module_code,status,activated_by,activated_at) values ($1,$2,$3,$4,case when $3=\'enabled\' then now() end) on conflict (hospital_id,module_code) do update set status=excluded.status,activated_by=excluded.activated_by,activated_at=excluded.activated_at', [req.auth.tenantId,req.params.code,status,req.auth.sub]); await recordAudit(req.auth.tenantId,req.auth.sub,`module.${status}`,'module',req.params.code); res.json({ moduleCode: req.params.code, activationStatus: status }) }))

app.post('/devices/invite', auth, requireRole('facility_admin','ceo_owner','super_admin'), asyncRoute(async (req, res) => { const deviceId = String(req.body?.id || '').trim(), name = String(req.body?.name || '').trim(), token = String(req.body?.token || '').trim(); if (!deviceId || !name || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return apiError(res, 'A device name and valid access token are required', 400); const device = { id: deviceId, hospitalId: req.auth.tenantId, name, token, status: 'invited', createdBy: req.auth.sub, createdAt: now(), updatedAt: now() }, storedDevice = { ...device }; delete storedDevice.token; try { await transaction(async (client) => { await saveDomainRecord(client,req.auth.tenantId,'devices',deviceId,storedDevice); await client.query('insert into public.device_invites (token_hash,hospital_id,device_id) values ($1,$2,$3)',[sha256(token),req.auth.tenantId,deviceId]); await appendSyncChange(client,req.auth.tenantId,'devices',deviceId,'create',storedDevice,req.auth.sub) }) } catch (error) { if (error.code === '23505') return apiError(res, 'This device access token already exists', 409); throw error } res.status(201).json({ device }) }))
async function findDeviceInvite(token) { if (!token) return null; const result = await query('select i.hospital_id,i.device_id from public.device_invites i where i.token_hash=$1 and (i.expires_at is null or i.expires_at>now())', [sha256(token)]); if (!result.rowCount) return null; const device = await getDomainRecord(result.rows[0].hospital_id,'devices',result.rows[0].device_id); return device ? { tenantId: result.rows[0].hospital_id, recordId: result.rows[0].device_id, payload: device } : null }
app.get('/devices/join', asyncRoute(async (req, res) => { const invite = await findDeviceInvite(String(req.query.token || '')); if (!invite) return apiError(res, 'Device access link not found', 404); const tenant = await getTenant(invite.tenantId); if (!tenant || tenant.status !== 'active') return apiError(res, 'This hospital workspace is not active', 403); res.json({ device: invite.payload }) }))
app.post('/devices/join', asyncRoute(async (req, res) => { const invite = await findDeviceInvite(String(req.body?.token || '')); if (!invite) return apiError(res, 'Device access link not found', 404); const tenant = await getTenant(invite.tenantId); if (!tenant || tenant.status !== 'active') return apiError(res, 'This hospital workspace is not active', 403); if (!['invited','pending'].includes(invite.payload.status)) return apiError(res, 'This device invitation is no longer available', 409); const device = { ...invite.payload, status: 'pending', requestedName: String(req.body?.name || '').trim().slice(0,100) || invite.payload.name, requestedAt: now(), updatedAt: now() }; await addRecord(invite.tenantId,'devices',invite.recordId,device,'update'); res.json({ device }) }))
app.get('/devices', auth, requireRole('facility_admin','ceo_owner','super_admin'), asyncRoute(async (req, res) => res.json({ devices: await listDomainRecords(req.auth.tenantId,'devices') })))
app.post('/devices/:deviceId/link', auth, requireRole('facility_admin','ceo_owner','super_admin'), asyncRoute(async (req, res) => {
  const device = await getDomainRecord(req.auth.tenantId, 'devices', req.params.deviceId)
  if (!device) return apiError(res, 'Device not found', 404)
  if (device.status !== 'invited') return apiError(res, 'Only invited devices can have an access link', 409)
  const token = crypto.randomBytes(24).toString('base64url')
  await transaction(async (client) => {
    await client.query('delete from public.device_invites where hospital_id=$1 and device_id=$2', [req.auth.tenantId, device.id])
    await client.query('insert into public.device_invites (token_hash,hospital_id,device_id) values ($1,$2,$3)', [sha256(token), req.auth.tenantId, device.id])
  })
  res.json({ token })
}))
app.delete('/devices/:deviceId', auth, requireRole('facility_admin','ceo_owner','super_admin'), asyncRoute(async (req, res) => {
  const device = await getDomainRecord(req.auth.tenantId, 'devices', req.params.deviceId)
  if (!device) return apiError(res, 'Device not found', 404)
  await transaction(async (client) => {
    await client.query('delete from public.device_invites where hospital_id=$1 and device_id=$2', [req.auth.tenantId, device.id])
    await saveDomainRecord(client, req.auth.tenantId, 'devices', device.id, device, true)
    await appendSyncChange(client, req.auth.tenantId, 'devices', device.id, 'delete', null, req.auth.sub)
  })
  res.json({ ok: true })
}))
app.patch('/devices/:deviceId', auth, requireRole('facility_admin','ceo_owner','super_admin'), asyncRoute(async (req, res) => { const status = String(req.body?.status || ''); if (!['approved','rejected','revoked'].includes(status)) return apiError(res, 'Invalid device status', 400); const old = await getDomainRecord(req.auth.tenantId,'devices',req.params.deviceId); if (!old) return apiError(res, 'Device not found', 404); const allowed = status === 'approved' || status === 'rejected' ? old.status === 'pending' : old.status === 'approved'; if (!allowed) return apiError(res, `A device cannot move from ${old.status} to ${status}`, 409); const device = { ...old, status, decidedBy: req.auth.sub, decidedAt: now(), updatedAt: now() }; await addRecord(req.auth.tenantId,'devices',old.id,device,'update',req.auth.sub); await recordAudit(req.auth.tenantId,req.auth.sub,`device.${status}`,'device',old.id,{ before: { status: old.status }, after: { status } }); res.json({ device }) }))

app.get('/sync/snapshot', auth, asyncRoute(async (req, res) => { let pageState = null; if (req.query.cursor) { try { const cursor = jwt.verify(String(req.query.cursor),JWT_SECRET,{ algorithms:['HS256'],audience:'sync-snapshot' }); if (cursor.tenantId !== req.auth.tenantId || !Number.isSafeInteger(cursor.highWater) || (cursor.after !== null && typeof cursor.after !== 'string')) throw new Error(); pageState = { after: cursor.after, highWater: cursor.highWater } } catch { return apiError(res,'Invalid or expired snapshot cursor. Restart the snapshot.',400) } } const result = await readSupabaseSnapshot({ tenantId:req.auth.tenantId,pageState,pageSize:200 }); const nextCursor = result.nextState ? jwt.sign({ ...result.nextState,tenantId:req.auth.tenantId,aud:'sync-snapshot' },JWT_SECRET,{ expiresIn:'1h' }) : null; res.json({ records:result.records,nextCursor,deltaCursor:result.deltaCursor }) }))
app.post('/sync', auth, asyncRoute(async (req, res) => { const ops = Array.isArray(req.body?.ops) ? req.body.ops.slice(0,50) : []; try { res.json(await applySupabaseSync({ tenantId:req.auth.tenantId,actorId:req.auth.sub,ops,allowedEntities,timestamp:now })) } catch (error) { console.error('Supabase sync failed',{ requestId:req.requestId,...errorDiagnostics(error) }); apiError(res,'Sync failed') } }))
app.get('/sync', auth, asyncRoute(async (req, res) => { const cursor = Math.max(0,Number(req.query.cursor || 0)); res.json(await readSupabaseChanges({ tenantId:req.auth.tenantId,cursor })) }))
app.get('/admin/summary', auth, requireRole('facility_admin','ceo_owner','super_admin'), asyncRoute(async (req, res) => { const [tenant,staff,audit] = await Promise.all([getTenant(req.auth.tenantId),listStaff(req.auth.tenantId),query('select count(*)::int as count from public.audit_logs where hospital_id=$1',[req.auth.tenantId])]); if (!tenant) return apiError(res,'Hospital workspace not found',404); res.json({ tenant:{ id:tenant.id,slug:tenant.slug,name:tenant.name,logoUrl:tenant.logoUrl || null },staffCount:staff.length,auditCount:audit.rows[0].count }) }))

app.use((error, req, res, _next) => {
  const status = error.message === 'Origin not allowed' ? 403 : Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : Number.isInteger(error.status) && error.status >= 500 ? error.status : 500
  if (status >= 500) { const requestId = req.requestId || crypto.randomUUID(); console.error('Unhandled backend error',{ requestId,method:req.method,path:req.path,...errorDiagnostics(error) }); return res.status(status).json({ message:status === 503 ? 'Backend service is temporarily unavailable.' : 'Server error',requestId }) }
  if (status === 401) return res.status(401).json({ message:'Invalid login details.' })
  if (status === 429) return res.status(429).json({ message:'Too many sign-in attempts. Try again later.' })
  return res.status(status).json({ message:status === 403 ? 'Request origin is not allowed' : 'Invalid request' })
})

async function start() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be an integer from 1 to 65535')
  await seedPlatform()
  const server = app.listen(PORT,HOST,() => console.log(`Dibia HMS backend listening on ${HOST}:${PORT}`))
  const shutdown = (signal) => { console.log(`Backend received ${signal}; closing server`); server.close((error) => { if (error) { console.error('Backend shutdown failed',error.name); process.exitCode = 1 } }) }
  process.once('SIGTERM',() => shutdown('SIGTERM'))
  process.once('SIGINT',() => shutdown('SIGINT'))
}
start().catch((error) => { console.error('Backend startup failed',errorDiagnostics(error)); process.exitCode = 1 })
