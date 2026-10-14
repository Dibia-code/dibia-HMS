import 'dotenv/config'
import crypto from 'node:crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import jwt from 'jsonwebtoken'
import { getFirestoreStore, getFirebaseAuth, firestoreStatus, applyFirestoreSync, readFirestoreChanges, readFirestoreSnapshot } from './firestore.js'

const production = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT || 4000)
const HOST = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1')
const JWT_SECRET = process.env.JWT_SECRET || (production ? '' : 'local-development-secret-change-me')
const minPasswordLength = production ? 12 : 8
const origins = String(process.env.FRONTEND_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5175,http://localhost:5175').split(',').map((v) => v.trim()).filter(Boolean)
const isExactHttpsOrigin = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}
if (production) {
  const problems = []
  if (JWT_SECRET.length < 32 || /change-me|replace-|development|generate-a-unique/i.test(JWT_SECRET)) problems.push('JWT_SECRET must be a unique random secret of at least 32 characters')
  if (String(process.env.DEMO_MODE).toLowerCase() === 'true') problems.push('DEMO_MODE must be false')
  if (!origins.length || origins.some((origin) => !isExactHttpsOrigin(origin))) problems.push('FRONTEND_ORIGINS must contain only exact HTTPS origins without paths or trailing slashes')
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_WEB_API_KEY) problems.push('FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY are required')
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) problems.push('Firebase Admin credentials are required')
  if (String(process.env.CONSOLE_ADMIN_PASSWORD || '').length < 16) problems.push('CONSOLE_ADMIN_PASSWORD must be at least 16 characters')
  if (!String(process.env.CONSOLE_ADMIN_EMAIL || '').includes('@')) problems.push('CONSOLE_ADMIN_EMAIL must be configured')
  if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join('; ')}`)
}

const app = express()
app.disable('x-powered-by')
if (production) app.set('trust proxy', 1)
const now = () => new Date().toISOString()
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const db = () => getFirestoreStore()
const authAdmin = () => getFirebaseAuth()
const appAuth = (uid) => db().collection('staffProfiles').doc(uid)
const tenantRef = (tenantId) => db().collection('tenants').doc(tenantId)
const platformUserRef = (uid) => db().collection('platformUsers').doc(uid)
const apiError = (res, message, status = 500) => res.status(status).json({ message, ...(status >= 500 && res.req?.requestId ? { requestId: res.req.requestId } : {}) })
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
function sanitizeErrorMessage(value) {
  return String(value || 'Unknown error')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(/([?&](?:key|token|password|secret|access_token|refresh_token)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/((?:password|token|secret|private[_-]?key|client[_-]?secret|authorization|credential)\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s;]+)/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 400)
}
function errorDiagnostics(error, depth = 0) {
  const details = {
    name: String(error?.name || 'Error').slice(0, 80),
    code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null,
    message: sanitizeErrorMessage(error?.message),
  }
  if (depth < 2 && error?.cause) details.cause = errorDiagnostics(error.cause, depth + 1)
  return details
}

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID()
  res.setHeader('X-Request-ID', req.requestId)
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store', ...(production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}) })
  next()
})
app.use(cors({ origin: (origin, cb) => !origin || origins.includes(origin) ? cb(null, true) : cb(new Error('Origin not allowed')), credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }))
app.use(express.json({ limit: '256kb', strict: true }))
app.use(cookieParser())
app.use((req, res, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next()
  const origin = req.get('origin')
  if (origin && !origins.includes(origin)) return res.status(403).json({ message: 'Request origin is not allowed' })
  if (production && !origin) return res.status(403).json({ message: 'Origin header is required' })
  next()
})

function limitAuthAttempts(req, res, next) {
  const time = Date.now()
  const isRegistration = req.path === '/auth/register'
  const windowMs = isRegistration ? 3600000 : 900000
  const ipLimit = isRegistration ? 100 : 1000
  const accountLimit = isRegistration ? 5 : 10
  const identity = String(req.body?.email || req.body?.identifier || '').trim().toLowerCase()
  const limits = [{ ref: db().collection('authRateLimits').doc(sha256(`${req.path}:ip:${req.ip}`)), max: ipLimit }]
  if (identity) limits.push({ ref: db().collection('authRateLimits').doc(sha256(`${req.path}:account:${identity}`)), max: accountLimit })
  db().runTransaction(async (transaction) => {
    const snapshots = await Promise.all(limits.map(({ ref }) => transaction.get(ref)))
    const next = snapshots.map((snapshot, index) => {
      const prior = snapshot.data()
      if (!prior || prior.resetAt <= time) return { count: 1, resetAt: time + windowMs }
      if (prior.count >= limits[index].max) return null
      return { count: prior.count + 1, resetAt: prior.resetAt }
    })
    if (next.some((value) => value === null)) return false
    next.forEach((value, index) => transaction.set(limits[index].ref, value))
    return true
  }).then((allowed) => {
    if (!allowed) return res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' })
    next()
  }).catch(next)
}

function setCookie(res, name, value) {
  res.cookie(name, value, { httpOnly: true, sameSite: production ? 'strict' : 'lax', secure: production, path: '/', maxAge: 7 * 86400000 })
}
function clearCookie(res, name) { res.clearCookie(name, { httpOnly: true, sameSite: production ? 'strict' : 'lax', secure: production, path: '/' }) }
async function saveRefreshSession(token, uid, audience) {
  const createdAt = now()
  await db().collection('refreshSessions').doc(sha256(token)).set({ uid, audience, createdAt, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() })
}
function accessToken(claims) { return jwt.sign(claims, JWT_SECRET, { expiresIn: '15m' }) }
function session(profile, tenant, branch = null) {
  const roles = Array.isArray(profile.roles) ? profile.roles : ['facility_admin']
  return { accessToken: accessToken({ sub: profile.id, tenantId: profile.tenantId, roles, aud: 'hospital' }), user: { id: profile.id, name: profile.name, email: profile.email, roles, hospitalId: profile.tenantId, hospitalSlug: tenant.slug, hospitalName: tenant.name, branchId: profile.branchId || branch?.id || null }, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl || null }, branch }
}
async function verifyHospital(req, res, next) {
  try {
    const header = req.get('authorization') || ''
    if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'Authentication required' })
    const claims = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] })
    if (claims.aud !== 'hospital') return res.status(401).json({ message: 'Hospital session required' })
    const [profileDoc, tenantDoc] = await Promise.all([appAuth(claims.sub).get(), tenantRef(claims.tenantId).get()])
    if (!profileDoc.exists || !tenantDoc.exists) return res.status(401).json({ message: 'Hospital account is inactive' })
    const profile = profileDoc.data(), tenant = tenantDoc.data()
    if (profile.active === false || profile.tenantId !== claims.tenantId) return res.status(401).json({ message: 'Hospital account is inactive' })
    if (tenant.status !== 'active') return res.status(403).json({ code: tenant.status === 'pending' ? 'REGISTRATION_PENDING' : 'HOSPITAL_INACTIVE', message: tenant.status === 'pending' ? 'Hospital registration is awaiting approval' : 'Hospital workspace is not active' })
    req.auth = { ...claims, roles: profile.roles || [], branchId: profile.branchId || null, permGrants: profile.permGrants || [], permDenies: profile.permDenies || [] }
    return next()
  } catch { return res.status(401).json({ message: 'Access token expired or invalid' }) }
}
async function verifyPlatform(req, res, next) {
  try {
    const header = req.get('authorization') || ''
    if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'Platform authentication required' })
    const claims = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] })
    if (claims.aud !== 'platform') return res.status(401).json({ message: 'Platform session required' })
    const user = await platformUserRef(claims.sub).get()
    if (!user.exists || user.data().active === false || !(user.data().roles || []).includes('platform_super_admin')) return res.status(403).json({ message: 'Platform Super Admin access required' })
    req.auth = { ...claims, roles: user.data().roles || [] }
    return next()
  } catch { return res.status(401).json({ message: 'Platform access token expired or invalid' }) }
}
const auth = verifyHospital
const platformAuth = verifyPlatform
const requireRole = (...roles) => (req, res, next) => roles.some((role) => req.auth.roles?.includes(role)) ? next() : res.status(403).json({ message: 'You do not have permission for this action' })

async function platformAudit(actorId, action, entity, recordId, metadata = {}) {
  const auditId = id('platform_audit')
  await db().collection('platformAuditLogs').doc(auditId).set({ id: auditId, platformUserId: actorId, action, entity, recordId, metadata, createdAt: now() })
}
async function recordAudit(tenantId, actorId, action, entity = null, recordId = null, metadata = {}) {
  const auditId = id('audit')
  await tenantRef(tenantId).collection('auditLogs').doc(auditId).set({ id: auditId, tenantId, actorId, action, entity, recordId, metadata, createdAt: now() })
}
async function firebasePasswordSignIn(email, password) {
  const key = encodeURIComponent(String(process.env.FIREBASE_WEB_API_KEY || ''))
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const firebaseCode = String(data.error?.message || '').split(':')[0].toUpperCase()
    const credentialErrors = new Set(['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'USER_DISABLED', 'INVALID_EMAIL'])
    const configurationErrors = new Set(['CONFIGURATION_NOT_FOUND', 'API_KEY_INVALID', 'PROJECT_NOT_FOUND', 'OPERATION_NOT_ALLOWED'])
    const error = new Error(configurationErrors.has(firebaseCode)
      ? 'Firebase Authentication is unavailable or misconfigured.'
      : credentialErrors.has(firebaseCode) ? 'Invalid login details.'
        : firebaseCode === 'TOO_MANY_ATTEMPTS_TRY_LATER' ? 'Too many sign-in attempts.'
          : 'Firebase Authentication sign-in failed.')
    error.code = firebaseCode === 'CONFIGURATION_NOT_FOUND' ? 'auth/configuration-not-found' : `firebase-auth/${firebaseCode.toLowerCase() || 'upstream-error'}`
    error.status = credentialErrors.has(firebaseCode) ? 401 : firebaseCode === 'TOO_MANY_ATTEMPTS_TRY_LATER' ? 429 : 503
    throw error
  }
  return data
}
async function firebasePasswordReset(email) {
  const key = encodeURIComponent(String(process.env.FIREBASE_WEB_API_KEY || ''))
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }) })
  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, code: String(data.error?.message || '').split(':')[0].toUpperCase() }
}
async function firebaseRefresh(token) {
  const key = encodeURIComponent(String(process.env.FIREBASE_WEB_API_KEY || ''))
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }) })
  const data = await response.json().catch(() => ({}))
  return response.ok ? data : null
}
async function hospitalProfile(idToken) {
  const decoded = await authAdmin().verifyIdToken(idToken)
  const profileDoc = await appAuth(decoded.uid).get()
  if (!profileDoc.exists) throw new Error('Hospital account profile not found')
  const profile = { id: decoded.uid, ...profileDoc.data() }
  if (profile.active === false) throw new Error('This account is deactivated')
  const tenantDoc = await tenantRef(profile.tenantId).get()
  if (!tenantDoc.exists) throw new Error('Hospital tenant not found')
  const tenant = { id: tenantDoc.id, ...tenantDoc.data() }
  if (tenant.status !== 'active') { const error = new Error(tenant.status === 'pending' ? 'Your hospital registration is awaiting approval' : 'This hospital workspace is not active'); error.code = 'HOSPITAL_NOT_ACTIVE'; throw error }
  const branchDoc = profile.branchId ? await tenantRef(profile.tenantId).collection('branches').doc(profile.branchId).get() : null
  return { profile, tenant, branch: branchDoc?.exists ? { id: branchDoc.id, ...branchDoc.data() } : null }
}

const moduleSeed = [
  ['reception','Reception','Patient registration and identity capture','operations','included',0],['queue','Queue','Care routing and visit flow','operations','included',0],['cashier','Cashier','Patient billing and payment collection','finance','included',0],['inventory','Inventory','Hospital stock and supplies','operations','subscription',1500000],['reports','Reports','Hospital operational reports','administration','included',0],['patient-management','Patient Management','Central patient registry, identity and visit history','core','included',0],['appointments','Appointments','Scheduling, follow-ups and reminders','operations','included',0],['emr','Electronic Medical Records','Clinical encounters, diagnoses and medical notes','clinical','subscription',2500000],['laboratory','Laboratory Management','Requests, samples, results and verification','clinical','subscription',1800000],['pharmacy','Pharmacy Management','Prescriptions, dispensing and medicine stock','clinical','subscription',1800000],['billing','Billing & Accounts','Invoices, payments, receipts and insurance','finance','subscription',1500000],['inpatient','Inpatient Management','Admissions, wards, beds and discharge','clinical','subscription',2200000],['radiology','Radiology & Imaging','Imaging requests, worklists and reports','clinical','addon',2000000],['hr','HR & Payroll','Staff, attendance, leave and payroll','administration','addon',1200000],['analytics','Advanced Analytics','Cross-department operational insights','administration','addon',1400000],['telemedicine','Telemedicine','Remote consultations and secure sessions','clinical','addon',1600000],
]
const planSeed = [['professional','Professional',9500000],['freemium','Freemium',0],['small','Small',2500000],['medium','Medium',15000000],['large','Large',60000000]]
async function seedPlatform() {
  const batch = db().batch(), timestamp = now()
  for (const [code,name,description,category,pricingModel,priceMinor] of moduleSeed) {
    const ref = db().collection('modules').doc(code)
    batch.set(ref, { id: `mod_${code}`, code, name, description, category, version: '1.0.0', status: 'published', pricingModel, priceMinor, configSchema: {}, createdAt: timestamp, updatedAt: timestamp }, { merge: true })
  }
  for (const [code,name,priceMinor] of planSeed) batch.set(db().collection('subscriptionPlans').doc(code), { id: `plan_${code}`, code, name, priceMinor, currency: 'NGN', status: 'active', updatedAt: timestamp }, { merge: true })
  await batch.commit()
  const email = String(process.env.CONSOLE_ADMIN_EMAIL || '').trim().toLowerCase(), password = String(process.env.CONSOLE_ADMIN_PASSWORD || '')
  if (email && password.length >= 12) {
    try {
      let user
      try { user = await authAdmin().getUserByEmail(email) } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error
        try { user = await authAdmin().createUser({ email, password, displayName: 'Dibia Platform Super Admin' }) } catch (createError) {
          if (createError.code !== 'auth/email-already-exists') throw createError
          user = await authAdmin().getUserByEmail(email)
        }
      }
      await platformUserRef(user.uid).set({ id: user.uid, name: user.displayName || 'Dibia Platform Super Admin', email, roles: ['platform_super_admin'], active: true, updatedAt: timestamp }, { merge: true })
      await authAdmin().setCustomUserClaims(user.uid, { appAudience: 'platform', roles: ['platform_super_admin'] })
    } catch (error) {
      console.error('Platform admin bootstrap failed', errorDiagnostics(error))
      if (production) throw error
    }
  }
}

app.get('/health', (_req,res) => res.json({ ok:true, service:'dibia-hms-backend', time:now(), dataStore:'firestore', firestore:firestoreStatus() }))
app.get('/health/ready', asyncRoute(async (_req, res) => {
  const [firestoreCheck, authCheck, platformAdminCheck] = await Promise.allSettled([
    db().collection('_health').doc('probe').get(),
    authAdmin().projectConfigManager().getProjectConfig(),
    (async () => {
      const admin = await authAdmin().getUserByEmail(String(process.env.CONSOLE_ADMIN_EMAIL || '').trim().toLowerCase())
      const profile = await platformUserRef(admin.uid).get()
      return profile.exists && profile.data().active !== false && profile.data().roles?.includes('platform_super_admin')
    })(),
  ])
  const checks = {
    firestore: firestoreCheck.status === 'fulfilled',
    firebaseAuthConfigured: authCheck.status === 'fulfilled',
    platformAdmin: platformAdminCheck.status === 'fulfilled' && platformAdminCheck.value === true,
  }
  const ready = Object.values(checks).every(Boolean)
  res.status(ready ? 200 : 503).json({ ok: ready, service: 'dibia-hms-backend', checks, projectId: firestoreStatus().projectId })
}))
app.post('/auth/register', limitAuthAttempts, asyncRoute(async (req,res) => {
  const hospitalName=String(req.body?.hospitalName||'').trim(), ownerName=String(req.body?.ownerName||'').trim(), email=String(req.body?.email||'').trim().toLowerCase(), password=String(req.body?.password||''), phone=String(req.body?.phone||'').trim(), address=String(req.body?.address||'').trim()
  if(!hospitalName||!ownerName||!email||password.length<minPasswordLength)return res.status(400).json({message:`Hospital name, owner name, email, and a ${minPasswordLength}-character password are required`})
  let user
  try {
    user=await authAdmin().createUser({email,password,displayName:ownerName,phoneNumber:/^\+[1-9]\d{7,14}$/.test(phone)?phone:undefined})
    const tenantId=id('tenant'), base=hospitalName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||`hospital-${tenantId.slice(-6)}`
    let slug=base, n=2
    while((await db().collection('tenantSlugs').doc(slug).get()).exists) slug=`${base}-${n++}`.slice(0,50)
    const branchId=id('branch'), timestamp=now(), tenant={slug,name:hospitalName,address,phone,status:'pending',createdAt:timestamp}, branch={id:branchId,tenantId,name:'Main Branch',address,createdAt:timestamp}, profile={id:user.uid,tenantId,branchId,name:ownerName,email,phone,roles:['facility_admin'],profession:'Hospital administrator',active:true,createdAt:timestamp}
    const tRef=tenantRef(tenantId), records=[['hospitals',tenantId,{id:tenantId,hospitalId:tenantId,slug,name:hospitalName,address,phone,status:'pending',createdAt:timestamp}],['branches',branchId,{id:branchId,hospitalId:tenantId,branchId,name:'Main Branch',address,isMain:true,createdAt:timestamp}],['staff',user.uid,{id:user.uid,hospitalId:tenantId,branchId,name:ownerName,email,phone,active:true,profession:profile.profession,createdAt:timestamp}],['staff_roles',`${user.uid}__facility_admin`,{id:`${user.uid}__facility_admin`,hospitalId:tenantId,staffId:user.uid,role:'facility_admin'}]]
    const batch=db().batch(); batch.create(tRef,tenant); batch.create(db().collection('tenantSlugs').doc(slug),{tenantId,createdAt:timestamp}); batch.set(tRef.collection('branches').doc(branchId),branch); batch.set(tRef.collection('staff').doc(user.uid),profile); batch.set(appAuth(user.uid),profile); batch.set(tRef.collection('subscriptions').doc('current'),{id:`sub_${tenantId}`,tenantId,plan:'Freemium',amountMinor:0,status:'pending',startsAt:timestamp,createdAt:timestamp,updatedAt:timestamp})
    records.forEach(([entity,recordId,payload],i)=>{batch.set(tRef.collection('records').doc(`${entity}__${recordId}`),{tenantId,entity,recordId,payload,deleted:false,updatedAt:timestamp});batch.set(tRef.collection('syncChanges').doc(String(i+1)),{sequence:i+1,entity,recordId,operation:'create',payload,createdAt:timestamp})})
    batch.set(tRef.collection('meta').doc('sync'),{lastSequence:records.length,updatedAt:timestamp}); await authAdmin().setCustomUserClaims(user.uid,{appAudience:'hospital',tenantId,roles:profile.roles}); await batch.commit()
    return res.status(201).json({status:'pending',message:'Registration received. A Dibia administrator must approve your hospital before you can sign in.',tenant:{id:tenantId,...tenant},user:{id:user.uid,name:ownerName,email},branch})
  } catch(error) {
    if(user?.uid)await authAdmin().deleteUser(user.uid).catch(()=>{})
    console.error('Hospital registration failed',{requestId:req.requestId,...errorDiagnostics(error)})
    if(error.code==='auth/email-already-exists')return res.status(409).json({message:'An account with that email already exists'})
    if(error.code==='auth/configuration-not-found')return apiError(res,error.message,503)
    const invalidInput=['auth/invalid-email','auth/invalid-password','auth/invalid-phone-number','auth/phone-number-already-exists'].includes(error.code)
    if(production&&!invalidInput)return apiError(res,'Could not create hospital account.',503)
    return res.status(400).json({message:production?'Check the email, phone number, and password, then try again.':error.message})
  }
}))
app.post('/auth/login',limitAuthAttempts,asyncRoute(async(req,res)=>{
  let identifier=String(req.body?.identifier||'').trim(), password=String(req.body?.password||'')
  if(!identifier.includes('@')){const matches=await db().collection('staffProfiles').where('phone','==',identifier).limit(1).get();if(matches.empty)return apiError(res,'Invalid login details',401);identifier=matches.docs[0].data().email||''}
  if(req.body?.audience==='platform') { const signed=await firebasePasswordSignIn(identifier,password); const decoded=await authAdmin().verifyIdToken(signed.idToken); const user=await platformUserRef(decoded.uid).get(); if(!user.exists||user.data().active===false)return apiError(res,'Invalid platform login details',401); const claims={sub:decoded.uid,roles:user.data().roles||[],aud:'platform'}; await saveRefreshSession(signed.refreshToken,decoded.uid,'platform'); setCookie(res,'dibia_refresh',signed.refreshToken); await platformAudit(decoded.uid,'auth.login','platform_user',decoded.uid,{audience:'platform'}); return res.json({accessToken:accessToken(claims),user:{id:decoded.uid,name:user.data().name,email:user.data().email,roles:claims.roles}}) }
  try { const signed=await firebasePasswordSignIn(identifier,password), {profile,tenant,branch}=await hospitalProfile(signed.idToken); await saveRefreshSession(signed.refreshToken,profile.id,'hospital'); setCookie(res,'dibia_refresh',signed.refreshToken); return res.json(session(profile,tenant,branch)) } catch(error) { if(error.code==='auth/configuration-not-found')return apiError(res,error.message,503); if(error.status===429)return apiError(res,'Too many sign-in attempts. Try again later.',429); if(error.status>=500)return apiError(res,'Authentication service is temporarily unavailable.',503); return res.status(error.code==='HOSPITAL_NOT_ACTIVE'?403:401).json({...(error.code==='HOSPITAL_NOT_ACTIVE'?{code:error.message.includes('awaiting approval')?'REGISTRATION_PENDING':'HOSPITAL_INACTIVE'}:{}),message:error.code==='HOSPITAL_NOT_ACTIVE'?error.message:'Invalid login details'}) }
}))
app.post('/auth/refresh',asyncRoute(async(req,res)=>{const token=req.cookies.dibia_refresh;if(!token)return apiError(res,'Refresh session expired',401);const sessions=db().collection('refreshSessions'),sessionRef=sessions.doc(sha256(token)),prior=await sessionRef.get();if(!prior.exists||Date.parse(prior.data().expiresAt)<=Date.now())return apiError(res,'Refresh session expired',401);const refreshed=await firebaseRefresh(token);if(!refreshed)return apiError(res,'Refresh session expired',401);const decoded=await authAdmin().verifyIdToken(refreshed.id_token).catch(()=>null);if(!decoded||decoded.uid!==prior.data().uid)return apiError(res,'Refresh session expired',401);await sessionRef.delete();await saveRefreshSession(refreshed.refresh_token,decoded.uid,prior.data().audience);setCookie(res,'dibia_refresh',refreshed.refresh_token);if(prior.data().audience==='platform'){const user=await platformUserRef(decoded.uid).get();if(!user.exists||user.data().active===false)return apiError(res,'Refresh session expired',401);return res.json({accessToken:accessToken({sub:decoded.uid,roles:user.data().roles||[],aud:'platform'}),user:{id:decoded.uid,name:user.data().name,email:user.data().email,roles:user.data().roles||[]}})}const {profile,tenant,branch}=await hospitalProfile(refreshed.id_token);return res.json(session(profile,tenant,branch))}))
app.post('/auth/logout',asyncRoute(async(req,res)=>{const token=req.cookies.dibia_refresh;if(token)await db().collection('refreshSessions').doc(sha256(token)).delete();clearCookie(res,'dibia_refresh');res.json({ok:true})}))
app.post('/staff/:staffId/password-reset',auth,requireRole('facility_admin','ceo_owner','super_admin'),asyncRoute(async(req,res)=>{
  const staffId=String(req.params.staffId||'').trim(),root=tenantRef(req.auth.tenantId),staffSnapshot=await root.collection('staff').doc(staffId).get()
  let staff=staffSnapshot.exists?staffSnapshot.data():null
  if(!staff){const record=await root.collection('records').doc(`staff__${staffId}`).get();if(record.exists&&!record.data().deleted)staff=record.data().payload}
  if(!staff)return apiError(res,'Staff member not found in this hospital',404)
  const email=String(staff.email||'').trim().toLowerCase()
  if(!email)return apiError(res,'This staff account has no email address for password recovery',400)
  let roles=Array.isArray(staff.roles)?staff.roles:Array.isArray(staff.roleSlugs)?staff.roleSlugs:[]
  if(!roles.length){const roleRows=await root.collection('records').where('entity','==','staff_roles').get();roles=roleRows.docs.filter((doc)=>!doc.data().deleted&&doc.data().payload?.staffId===staffId&&typeof doc.data().payload?.role==='string').map((doc)=>doc.data().payload.role)}
  roles=[...new Set(roles)]
  if(!roles.length)return apiError(res,'Assign at least one role to this staff member before enabling sign-in',409)
  let firebaseUser,profileSnapshot
  try { firebaseUser=await authAdmin().getUserByEmail(email) } catch(error) {
    if(error.code!=='auth/user-not-found')throw error
    const temporaryPassword=crypto.randomBytes(36).toString('base64url')
    try { firebaseUser=await authAdmin().createUser({email,password:temporaryPassword,displayName:String(staff.name||email)}) }
    catch(createError){if(createError.code!=='auth/email-already-exists')throw createError;firebaseUser=await authAdmin().getUserByEmail(email)}
  }
  profileSnapshot=await appAuth(firebaseUser.uid).get()
  const platformAccount=await platformUserRef(firebaseUser.uid).get()
  if(platformAccount.exists||firebaseUser.customClaims?.appAudience==='platform')return apiError(res,'This email is reserved for a platform console account',409)
  if(profileSnapshot.exists&&profileSnapshot.data().tenantId!==req.auth.tenantId)return apiError(res,'This email is already linked to another hospital account',409)
  const timestamp=now(),profile={id:firebaseUser.uid,tenantId:req.auth.tenantId,branchId:staff.branchId||null,name:String(staff.name||firebaseUser.displayName||email),email,phone:String(staff.phone||''),profession:String(staff.profession||''),roles,active:staff.active!==false,permGrants:Array.isArray(staff.permGrants)?staff.permGrants:[],permDenies:Array.isArray(staff.permDenies)?staff.permDenies:[],createdAt:profileSnapshot.data()?.createdAt||staff.createdAt||timestamp,updatedAt:timestamp}
  await appAuth(firebaseUser.uid).set(profile,{merge:true})
  await authAdmin().setCustomUserClaims(firebaseUser.uid,{appAudience:'hospital',tenantId:req.auth.tenantId,roles})
  const result=await firebasePasswordReset(email)
  if(!result.ok){console.error('Staff password reset failed',{requestId:req.requestId,code:result.code||'FIREBASE_UPSTREAM_ERROR'});return apiError(res,'Password reset email could not be sent. Try again later.',503)}
  await recordAudit(req.auth.tenantId,req.auth.sub,'staff.password_reset','staff',firebaseUser.uid,{email})
  return res.json({message:'Firebase sent a password reset link to the staff member’s email address.'})
}))
app.post('/auth/console/login',limitAuthAttempts,asyncRoute(async(req,res)=>{const signed=await firebasePasswordSignIn(String(req.body?.email||'').trim().toLowerCase(),String(req.body?.password||''));const decoded=await authAdmin().verifyIdToken(signed.idToken);const user=await platformUserRef(decoded.uid).get();if(!user.exists||!(user.data().roles||[]).includes('platform_super_admin'))return apiError(res,'Invalid Super Admin email or password',401);await saveRefreshSession(signed.refreshToken,decoded.uid,'platform');setCookie(res,'dibia_console_refresh',signed.refreshToken);await platformAudit(decoded.uid,'auth.login','platform_user',decoded.uid);return res.json({accessToken:accessToken({sub:decoded.uid,roles:user.data().roles,aud:'platform'}),user:{id:decoded.uid,name:user.data().name,email:user.data().email}})}))
app.post('/auth/console/forgot-password',limitAuthAttempts,asyncRoute(async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase()
  const generic={message:'If an account exists for that email, Firebase will send a password reset link.'}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.json(generic)
  const result=await firebasePasswordReset(email)
  if(!result.ok&&!['EMAIL_NOT_FOUND','USER_NOT_FOUND','INVALID_EMAIL'].includes(result.code)){
    console.error('Console password reset request failed',{requestId:req.requestId,code:result.code||'FIREBASE_UPSTREAM_ERROR'})
    return apiError(res,'Password reset is temporarily unavailable.',503)
  }
  return res.json(generic)
}))
app.post('/auth/forgot-password',limitAuthAttempts,asyncRoute(async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase()
  const generic={message:'If an account exists for that email, Firebase will send a password reset link.'}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.json(generic)
  const result=await firebasePasswordReset(email)
  if(!result.ok&&!['EMAIL_NOT_FOUND','USER_NOT_FOUND','INVALID_EMAIL'].includes(result.code)){
    console.error('Hospital password reset request failed',{requestId:req.requestId,code:result.code||'FIREBASE_UPSTREAM_ERROR'})
    return apiError(res,'Password reset is temporarily unavailable.',503)
  }
  return res.json(generic)
}))
app.get('/auth/console/session',asyncRoute(async(req,res)=>{const token=req.cookies.dibia_console_refresh||'',ref=db().collection('refreshSessions').doc(sha256(token)),saved=token?await ref.get():null;if(!saved?.exists||saved.data().audience!=='platform'||Date.parse(saved.data().expiresAt)<=Date.now())return apiError(res,'Console session expired',401);const refreshed=await firebaseRefresh(token);if(!refreshed)return apiError(res,'Console session expired',401);const decoded=await authAdmin().verifyIdToken(refreshed.id_token),user=await platformUserRef(decoded.uid).get();if(decoded.uid!==saved.data().uid||!user.exists||!(user.data().roles||[]).includes('platform_super_admin'))return apiError(res,'Console session expired',401);await ref.delete();await saveRefreshSession(refreshed.refresh_token,decoded.uid,'platform');setCookie(res,'dibia_console_refresh',refreshed.refresh_token);return res.json({accessToken:accessToken({sub:decoded.uid,roles:user.data().roles,aud:'platform'}),user:{id:decoded.uid,name:user.data().name,email:user.data().email}})}))
app.post('/auth/console/logout',asyncRoute(async(req,res)=>{const token=req.cookies.dibia_console_refresh;if(token)await db().collection('refreshSessions').doc(sha256(token)).delete();clearCookie(res,'dibia_console_refresh');res.json({ok:true})}))
app.get('/me',auth,asyncRoute(async(req,res)=>{const {profile,tenant,branch}=await hospitalProfileFromUid(req.auth.sub);return res.json(session(profile,tenant,branch))}))
async function hospitalProfileFromUid(uid){const p=await appAuth(uid).get();if(!p.exists)throw new Error('Account not found');const profile={id:p.id,...p.data()},t=await tenantRef(profile.tenantId).get();if(!t.exists)throw new Error('Hospital not found');const b=profile.branchId?await tenantRef(profile.tenantId).collection('branches').doc(profile.branchId).get():null;return{profile,tenant:{id:t.id,...t.data()},branch:b?.exists?{id:b.id,...b.data()}:null}}

async function tenantSummary(doc){const t={id:doc.id,...doc.data()},r=tenantRef(doc.id);const [branches,staff,sub,mods]=await Promise.all([r.collection('branches').get(),r.collection('staff').get(),r.collection('subscriptions').doc('current').get(),r.collection('tenantModules').where('status','==','enabled').get()]);const billing=sub.data()||{};return{id:t.id,slug:t.slug,name:t.name,logoUrl:t.logoUrl||null,location:t.address||'',phone:t.phone||'',tenantStatus:t.status||'pending',registeredAt:t.createdAt||null,branches:branches.size,staff:staff.size,subscriptionStatus:billing.status||'pending',plan:billing.plan||'Freemium',status:['past_due','failed'].includes(billing.status)?'failed':t.status||'pending',usageDays:0,modules:mods.docs.map(x=>x.data().name||x.id)}}
async function moduleRows(tenantId){const [mods,ent,active]=await Promise.all([db().collection('modules').orderBy('name').get(),tenantRef(tenantId).collection('moduleEntitlements').get(),tenantRef(tenantId).collection('tenantModules').get()]);const e=new Map(ent.docs.map(x=>[x.id,x.data()])),a=new Map(active.docs.map(x=>[x.id,x.data()]));return mods.docs.map(x=>{const m=x.data(),er=e.get(m.code),ar=a.get(m.code),eligible=er?.source==='manual-payment-or-pro-override'&&er?.status==='entitled';return{id:m.id,code:m.code,name:m.name,description:m.description,category:m.category,version:m.version,publicationStatus:m.status,priceMinor:Number(m.priceMinor||0),entitlementStatus:eligible?'entitled':'unentitled',activationStatus:eligible?(ar?.status||'disabled'):'disabled'}})}
async function addRecord(tenantId,entity,recordId,payload,op='create'){const root=tenantRef(tenantId),timestamp=now();await db().runTransaction(async tx=>{const seqRef=root.collection('meta').doc('sync'),seq=await tx.get(seqRef),n=Number(seq.data()?.lastSequence||0)+1;tx.set(root.collection('records').doc(`${entity}__${recordId}`),{tenantId,entity,recordId,payload,deleted:op==='delete',updatedAt:timestamp});tx.set(root.collection('syncChanges').doc(String(n)),{sequence:n,entity,recordId,operation:op,payload:op==='delete'?null:payload,createdAt:timestamp});tx.set(seqRef,{lastSequence:n,updatedAt:timestamp},{merge:true})})}

app.get('/platform/summary',platformAuth,asyncRoute(async(_req,res)=>{const tenants=await db().collection('tenants').get();let activeSubscriptions=0,activeUsers=0;for(const doc of tenants.docs){const [s,u]=await Promise.all([tenantRef(doc.id).collection('subscriptions').doc('current').get(),tenantRef(doc.id).collection('staff').where('active','==',true).get()]);if(s.data()?.status==='active')activeSubscriptions++;activeUsers+=u.size}const modules=await db().collection('modules').where('status','==','published').get();res.json({hospitals:tenants.size,activeSubscriptions,publishedModules:modules.size,activeUsers})}))
app.get('/platform/audit',platformAuth,asyncRoute(async(req,res)=>{const limit=Math.min(500,Math.max(1,Number(req.query.limit||200))),snap=await db().collection('platformAuditLogs').orderBy('createdAt','desc').limit(limit).get();res.json({audit:snap.docs.map(d=>d.data())})}))
app.get('/platform/settings',platformAuth,asyncRoute(async(_req,res)=>{const snap=await db().collection('platformSettings').doc('platform').get();res.json({settings:{id:'platform',...(snap.data()?.value||{})}})}))
app.patch('/platform/settings',platformAuth,asyncRoute(async(req,res)=>{const value={...(req.body||{})};delete value.id;await db().collection('platformSettings').doc('platform').set({value,updatedAt:now()});await platformAudit(req.auth.sub,'platform.settings.updated','platform_settings','platform');res.json({settings:{id:'platform',...value}})}))
app.get('/platform/transactions',platformAuth,asyncRoute(async(_req,res)=>{const tenants=await db().collection('tenants').get(),rows=[];for(const t of tenants.docs){const [b,s]=await Promise.all([tenantRef(t.id).collection('subscriptions').doc('current').get(),tenantSummary(t)]);if(!b.exists)continue;const v=b.data();rows.push({id:v.id||`sub_${t.id}`,hospitalId:t.id,hospitalName:s.name,plan:v.plan||'Freemium',amountMinor:Number(v.amountMinor||0),amount:Number(v.amountMinor||0)/100,date:v.renewsAt||v.updatedAt||v.createdAt,status:v.status==='active'?'paid':v.status==='past_due'?'failed':v.status})}res.json({transactions:rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)))})}))
app.patch('/platform/transactions/:id/confirm',platformAuth,asyncRoute(async(req,res)=>{const tenants=await db().collection('tenants').get();for(const t of tenants.docs){const ref=tenantRef(t.id).collection('subscriptions').doc('current'),s=await ref.get();if(s.exists&&(s.data().id||`sub_${t.id}`)===req.params.id){await ref.set({status:'active',paymentMethod:'manual',updatedAt:now(),confirmedBy:req.auth.sub,confirmedAt:now()},{merge:true});await platformAudit(req.auth.sub,'subscription.payment_confirmed','subscription',req.params.id,{tenantId:t.id,method:'manual'});return res.json({id:req.params.id,hospitalId:t.id,status:'paid'})}}return apiError(res,'Subscription transaction not found',404)}))
app.get('/platform/modules',platformAuth,asyncRoute(async(_req,res)=>{const s=await db().collection('modules').orderBy('name').get();res.json({modules:s.docs.map(d=>d.data())})}))
app.post('/platform/modules',platformAuth,asyncRoute(async(req,res)=>{const code=String(req.body?.code||'').trim().toLowerCase(),name=String(req.body?.name||'').trim();if(!/^[a-z0-9-]+$/.test(code)||!name)return apiError(res,'Module code and name are required',400);const ref=db().collection('modules').doc(code);if((await ref.get()).exists)return apiError(res,'A module with that code already exists',409);const timestamp=now(),item={id:id('module'),code,name,description:String(req.body?.description||''),category:String(req.body?.category||'operations'),version:String(req.body?.version||'1.0.0'),status:'draft',pricingModel:String(req.body?.pricingModel||'addon'),priceMinor:Math.max(0,Number(req.body?.priceMinor||0)),configSchema:req.body?.configSchema||{},createdAt:timestamp,updatedAt:timestamp};await ref.set(item);await platformAudit(req.auth.sub,'module.created','module',item.id,{code});res.status(201).json(item)}))
app.get('/platform/tenants',platformAuth,asyncRoute(async(_req,res)=>{const s=await db().collection('tenants').get(),items=await Promise.all(s.docs.map(tenantSummary));res.json({tenants:items.sort((a,b)=>a.name.localeCompare(b.name))})}))
app.post('/platform/tenants/:tenantId/decision',platformAuth,asyncRoute(async(req,res)=>{const decision=String(req.body?.decision||'');if(!['approve','reject'].includes(decision))return apiError(res,'Decision must be approve or reject',400);const ref=tenantRef(req.params.tenantId),s=await ref.get();if(!s.exists)return apiError(res,'Hospital tenant not found',404);const before=s.data();if(before.status!=='pending')return apiError(res,`Only pending registrations can be ${decision==='approve'?'approved':'rejected'}`,409);const timestamp=now(),status=decision==='approve'?'active':'rejected';await db().runTransaction(async tx=>{tx.set(ref,{status,updatedAt:timestamp,[decision==='approve'?'approvedAt':'rejectedAt']:timestamp,[decision==='approve'?'approvedBy':'rejectedBy']:req.auth.sub},{merge:true});if(decision==='approve')tx.set(ref.collection('subscriptions').doc('current'),{status:'pending',startsAt:timestamp,updatedAt:timestamp},{merge:true})});await platformAudit(req.auth.sub,`tenant.${decision}d`,'tenant',s.id,{before:{status:before.status},after:{status}});res.json({tenant:{id:s.id,...before,status,updatedAt:timestamp}})}))
app.patch('/platform/tenants/:tenantId',platformAuth,asyncRoute(async(req,res)=>{const ref=tenantRef(req.params.tenantId),s=await ref.get();if(!s.exists)return apiError(res,'Hospital tenant not found',404);const t={id:s.id,...s.data()},allowed=new Set(['pending','active','suspended','rejected']),status=req.body?.status==null?t.status:String(req.body.status);if(!allowed.has(status))return apiError(res,'Invalid tenant status',400);if(status!==t.status&&(t.status==='pending'||status==='rejected'))return apiError(res,'Use the registration decision action for pending hospitals',409);const updates={status,updatedAt:now()};if(req.body?.name!=null)updates.name=String(req.body.name).trim();if(req.body?.location!=null)updates.address=String(req.body.location).trim();if(req.body?.phone!=null)updates.phone=String(req.body.phone).trim();let planName;if(req.body?.plan!=null){const plans=await db().collection('subscriptionPlans').get(),plan=plans.docs.map(d=>d.data()).find(p=>p.code.toLowerCase()===String(req.body.plan).toLowerCase()||p.name.toLowerCase()===String(req.body.plan).toLowerCase());if(!plan)return apiError(res,'Unknown subscription plan',400);const subRef=ref.collection('subscriptions').doc('current'),old=await subRef.get(),v={id:old.data()?.id||`sub_${t.id}`,tenantId:t.id,plan:plan.name,planCode:plan.code,amountMinor:plan.priceMinor,status:old.data()?.status||'pending',updatedAt:now(),...(old.exists?{}:{createdAt:now(),startsAt:now()})};await subRef.set(v,{merge:true});planName=plan.name}await ref.set(updates,{merge:true});await platformAudit(req.auth.sub,`tenant.${status}`,'tenant',t.id,{before:{status:t.status},after:{status}});res.json({tenant:{...t,...updates,...(planName?{plan:planName}:{})}})}))
app.get('/platform/tenants/:tenantId/users',platformAuth,asyncRoute(async(req,res)=>{const t=await tenantRef(req.params.tenantId).get();if(!t.exists)return apiError(res,'Hospital tenant not found',404);const s=await tenantRef(req.params.tenantId).collection('staff').get();res.json({users:s.docs.map(d=>({id:d.id,...d.data(),hospitalId:t.id,hospitalName:t.data().name}))})}))
app.post('/platform/tenants/:tenantId/users',platformAuth,asyncRoute(async(req,res)=>{const tRef=tenantRef(req.params.tenantId),t=await tRef.get();if(!t.exists)return apiError(res,'Hospital tenant not found',404);const name=String(req.body?.name||'').trim(),email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||''),role=String(req.body?.role||'facility_admin'),allowed=new Set(['super_admin','facility_admin','ceo_owner','branch_manager','pharmacist','superintendent_pharmacist','receptionist','cashier','dispenser','pharmacy_cashier','inventory_officer','sales_staff','accountant','warehouse_officer','doctor','nurse','laboratory_technician']);if(!name||!email||password.length<minPasswordLength||!allowed.has(role))return apiError(res,'Name, valid email, supported role, and a sufficiently long password are required',400);let user;try{const branches=await tRef.collection('branches').get(),branchId=req.body?.branchId||branches.docs[0]?.id||null;if(req.body?.branchId&&!branches.docs.some(d=>d.id===branchId))return apiError(res,'Branch does not belong to this hospital',400);user=await authAdmin().createUser({email,password,displayName:name});const timestamp=now(),profile={id:user.uid,tenantId:t.id,branchId,name,email,phone:String(req.body?.phone||''),roles:[role],profession:role,active:true,createdAt:timestamp},items=[['staff',user.uid,{...profile,hospitalId:t.id}],['staff_roles',`${user.uid}__${role}`,{id:`${user.uid}__${role}`,hospitalId:t.id,staffId:user.uid,role}]];await db().runTransaction(async tx=>{const seqRef=tRef.collection('meta').doc('sync'),seq=await tx.get(seqRef);let n=Number(seq.data()?.lastSequence||0);for(const [entity,recordId,payload]of items){n++;tx.set(tRef.collection('records').doc(`${entity}__${recordId}`),{tenantId:t.id,entity,recordId,payload,deleted:false,updatedAt:timestamp});tx.set(tRef.collection('syncChanges').doc(String(n)),{sequence:n,entity,recordId,operation:'create',payload,createdAt:timestamp})}tx.set(seqRef,{lastSequence:n,updatedAt:timestamp},{merge:true});tx.set(tRef.collection('staff').doc(user.uid),profile);tx.set(appAuth(user.uid),profile)});await authAdmin().setCustomUserClaims(user.uid,{appAudience:'hospital',tenantId:t.id,roles:[role]});await platformAudit(req.auth.sub,'hospital.user.created','staff',user.uid,{tenantId:t.id,role});res.status(201).json({user:{...profile,hospitalId:t.id,hospitalName:t.data().name}})}catch(e){if(user?.uid)await authAdmin().deleteUser(user.uid).catch(()=>{});if(e.code==='auth/email-already-exists')return apiError(res,'An account with that email already exists',409);return apiError(res,production?'Could not create hospital account':e.message,400)}}))
app.get('/platform/tenants/:tenantId/modules',platformAuth,asyncRoute(async(req,res)=>{const t=await tenantRef(req.params.tenantId).get();if(!t.exists)return apiError(res,'Hospital tenant not found',404);res.json({tenant:{id:t.id,...t.data()},modules:await moduleRows(t.id)})}))
app.patch('/platform/tenants/:tenantId/modules/:code',platformAuth,asyncRoute(async(req,res)=>{const t=tenantRef(req.params.tenantId),[ts,ms]=await Promise.all([t.get(),db().collection('modules').doc(req.params.code).get()]);if(!ts.exists||!ms.exists)return apiError(res,'Tenant or module not found',404);const m=ms.data(),entitled=req.body?.entitled!==false?'entitled':'revoked',activation=entitled==='revoked'||req.body?.enabled===false?'disabled':'enabled',timestamp=now();await Promise.all([t.collection('moduleEntitlements').doc(m.code).set({moduleCode:m.code,source:String(req.body?.source||'platform'),status:entitled,startsAt:timestamp,updatedAt:timestamp},{merge:true}),t.collection('tenantModules').doc(m.code).set({moduleCode:m.code,name:m.name,status:activation,activatedBy:req.auth.sub,activatedAt:activation==='enabled'?timestamp:null},{merge:true})]);await platformAudit(req.auth.sub,`tenant.module.${activation}`,'tenant_module',`${ts.id}:${m.code}`);res.json({tenantId:ts.id,moduleCode:m.code,moduleName:m.name,entitlementStatus:entitled,activationStatus:activation})}))
app.get('/platform/tickets',platformAuth,asyncRoute(async(_req,res)=>{const s=await db().collection('platformSupportTickets').orderBy('createdAt','desc').limit(500).get(),tickets=await Promise.all(s.docs.map(async d=>{const v=d.data(),t=await tenantRef(v.hospitalId).get();return{...v,hospitalName:t.data()?.name||'Unknown hospital'}}));res.json({tickets})}))
app.patch('/platform/tickets/:id',platformAuth,asyncRoute(async(req,res)=>{const ref=db().collection('platformSupportTickets').doc(req.params.id),s=await ref.get();if(!s.exists)return apiError(res,'Support ticket not found',404);const t=s.data(),status=req.body?.status==null?t.status:String(req.body.status);if(!['open','resolved'].includes(status))return apiError(res,'Invalid ticket status',400);const reply=req.body?.reply==null?t.reply||'':String(req.body.reply).trim().slice(0,5000);await ref.set({status,reply,updatedAt:now(),updatedBy:req.auth.sub},{merge:true});await platformAudit(req.auth.sub,status==='resolved'?'support.ticket.resolved':'support.ticket.replied','support_ticket',req.params.id);res.json({id:req.params.id,hospitalId:t.hospitalId,issue:t.issue,priority:t.priority,status,reply})}))
app.get('/platform/messages',platformAuth,asyncRoute(async(_req,res)=>{const s=await db().collection('platformMessages').orderBy('createdAt','desc').limit(500).get(),messages=await Promise.all(s.docs.map(async d=>{const m=d.data(),t=await tenantRef(m.hospitalId).get();return{...m,sentAt:m.createdAt,hospitalName:t.data()?.name||'Unknown hospital'}}));res.json({messages})}))
app.post('/platform/tenants/:tenantId/messages',platformAuth,asyncRoute(async(req,res)=>{const t=await tenantRef(req.params.tenantId).get(),body=String(req.body?.body||'').trim().slice(0,5000);if(!t.exists)return apiError(res,'Hospital tenant not found',404);if(!body)return apiError(res,'Message body is required',400);const message={id:id('message'),hospitalId:t.id,hospitalName:t.data().name,body,sentAt:now(),sentBy:req.auth.sub};await db().collection('platformMessages').doc(message.id).set({...message,createdAt:message.sentAt});await platformAudit(req.auth.sub,'hospital.message.sent','platform_message',message.id,{tenantId:t.id});res.status(201).json({message})}))
app.post('/support/tickets',auth,asyncRoute(async(req,res)=>{const issue=String(req.body?.issue||'').trim().slice(0,5000),priority=['low','medium','high'].includes(req.body?.priority)?req.body.priority:'medium';if(!issue)return apiError(res,'Describe the support issue',400);const ticket={id:id('ticket'),hospitalId:req.auth.tenantId,issue,priority,status:'open',reply:'',createdAt:now(),updatedAt:now(),createdBy:req.auth.sub};await db().collection('platformSupportTickets').doc(ticket.id).set(ticket);await recordAudit(ticket.hospitalId,req.auth.sub,'support.ticket.created','support_ticket',ticket.id);res.status(201).json({ticket})}))
app.get('/tenant/modules',auth,asyncRoute(async(req,res)=>res.json({modules:await moduleRows(req.auth.tenantId)})))
app.patch('/tenant/modules/:code',auth,requireRole('facility_admin','ceo_owner'),asyncRoute(async(req,res)=>{const m=await db().collection('modules').doc(req.params.code).get();if(!m.exists)return apiError(res,'Module not found',404);const ref=tenantRef(req.auth.tenantId),ent=await ref.collection('moduleEntitlements').doc(req.params.code).get();if(ent.data()?.status!=='entitled'||ent.data()?.source!=='manual-payment-or-pro-override')return apiError(res,'This hospital is not entitled to this module',403);const status=req.body?.enabled===false?'disabled':'enabled';await ref.collection('tenantModules').doc(req.params.code).set({moduleCode:req.params.code,status,activatedBy:req.auth.sub,activatedAt:status==='enabled'?now():null},{merge:true});await recordAudit(req.auth.tenantId,req.auth.sub,`module.${status}`,'module',req.params.code);res.json({moduleCode:req.params.code,activationStatus:status})}))

const allowedEntities=new Set(['hospitals','branches','staff','staff_roles','patients','visits','appointments','payments','sales','products','batches','stock_movements','prescriptions','dispensings','refunds','expenses','customers','suppliers','purchase_orders','transfers','stock_counts','hmo_claims','devices','shift_reports','audit_log','complaints','hr_actions','staff_payments','settings'])
async function findDeviceInvite(token){
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(token))return null
  const store=db(),inviteRef=store.collection('deviceInvites').doc(sha256(token)),indexed=await inviteRef.get()
  if(indexed.exists){
    const pointer=indexed.data(),record=await tenantRef(pointer.tenantId).collection('records').doc(`devices__${pointer.recordId}`).get(),value=record.data()
    if(record.exists&&!value.deleted&&value.payload?.token===token)return{tenantId:pointer.tenantId,recordId:pointer.recordId,payload:value.payload}
    return null
  }
  // Read invitations created before the token lookup collection existed.
  const snapshot=await store.collectionGroup('records').where('entity','==','devices').get(),match=snapshot.docs.find((doc)=>!doc.data().deleted&&doc.data().payload?.token===token)
  if(!match)return null
  const value=match.data(),invite={tenantId:value.tenantId,recordId:value.recordId,payload:value.payload}
  await inviteRef.create({tenantId:invite.tenantId,recordId:invite.recordId,createdAt:now()}).catch((error)=>{if(error.code!=='already-exists'&&error.code!==6)throw error})
  return invite
}
async function createDeviceInvite(tenantId,recordId,device,actorId){
  const store=db(),root=tenantRef(tenantId),inviteRef=store.collection('deviceInvites').doc(sha256(device.token)),sequenceRef=root.collection('meta').doc('sync'),recordRef=root.collection('records').doc(`devices__${recordId}`),auditRef=root.collection('auditLogs').doc(id('audit'))
  return store.runTransaction(async(transaction)=>{
    const [invite,sequence]=await Promise.all([transaction.get(inviteRef),transaction.get(sequenceRef)])
    if(invite.exists)return false
    const next=Number(sequence.data()?.lastSequence||0)+1,timestamp=now()
    transaction.create(inviteRef,{tenantId,recordId,createdAt:timestamp})
    transaction.set(recordRef,{tenantId,entity:'devices',recordId,payload:device,deleted:false,updatedAt:timestamp})
    transaction.set(root.collection('syncChanges').doc(String(next)),{sequence:next,entity:'devices',recordId,operation:'create',payload:device,createdAt:timestamp})
    transaction.set(sequenceRef,{lastSequence:next,updatedAt:timestamp},{merge:true})
    transaction.create(auditRef,{id:auditRef.id,tenantId,actorId,action:'device.invited',entity:'device',recordId,metadata:{name:device.name},createdAt:timestamp})
    return true
  })
}
app.post('/devices/invite',auth,requireRole('facility_admin','ceo_owner','super_admin'),asyncRoute(async(req,res)=>{const recordId=String(req.body?.id||'').trim(),name=String(req.body?.name||'').trim(),token=String(req.body?.token||'').trim();if(!recordId||!name||!(/^[A-Za-z0-9_-]{20,100}$/).test(token))return apiError(res,'A device name and valid access token are required',400);const device={id:recordId,hospitalId:req.auth.tenantId,name,token,status:'invited',createdBy:req.auth.sub,createdAt:now(),updatedAt:now()};if(!await createDeviceInvite(req.auth.tenantId,recordId,device,req.auth.sub))return apiError(res,'This device access token already exists',409);res.status(201).json({device})}))
app.get('/devices/join',asyncRoute(async(req,res)=>{const inv=await findDeviceInvite(String(req.query.token||''));if(!inv)return apiError(res,'Device access link not found',404);const t=await tenantRef(inv.tenantId).get();if(!t.exists||t.data().status!=='active')return apiError(res,'This hospital workspace is not active',403);res.json({device:inv.payload})}))
app.post('/devices/join',asyncRoute(async(req,res)=>{const inv=await findDeviceInvite(String(req.body?.token||''));if(!inv)return apiError(res,'Device access link not found',404);const t=await tenantRef(inv.tenantId).get();if(!t.exists||t.data().status!=='active')return apiError(res,'This hospital workspace is not active',403);if(!['invited','pending'].includes(inv.payload.status))return apiError(res,'This device invitation is no longer available',409);const device={...inv.payload,status:'pending',requestedName:String(req.body?.name||'').trim().slice(0,100)||inv.payload.name,requestedAt:now(),updatedAt:now()};await addRecord(inv.tenantId,'devices',inv.recordId,device,'update');res.json({device})}))
app.get('/devices',auth,requireRole('facility_admin','ceo_owner','super_admin'),asyncRoute(async(req,res)=>{const s=await tenantRef(req.auth.tenantId).collection('records').where('entity','==','devices').get();res.json({devices:s.docs.filter(d=>!d.data().deleted).map(d=>d.data().payload).filter(Boolean)})}))
app.patch('/devices/:deviceId',auth,requireRole('facility_admin','ceo_owner','super_admin'),asyncRoute(async(req,res)=>{const status=String(req.body?.status||'');if(!['approved','rejected','revoked'].includes(status))return apiError(res,'Invalid device status',400);const ref=tenantRef(req.auth.tenantId).collection('records').doc(`devices__${req.params.deviceId}`),s=await ref.get(),old=s.data()?.payload;if(!s.exists||s.data().deleted||!old)return apiError(res,'Device not found',404);const allowed=status==='approved'||status==='rejected'?old.status==='pending':old.status==='approved';if(!allowed)return apiError(res,`A device cannot move from ${old.status} to ${status}`,409);const device={...old,status,decidedBy:req.auth.sub,decidedAt:now(),updatedAt:now()};await addRecord(req.auth.tenantId,'devices',old.id,device,'update');await recordAudit(req.auth.tenantId,req.auth.sub,`device.${status}`,'device',old.id,{before:{status:old.status},after:{status}});res.json({device})}))
app.get('/sync/snapshot',auth,asyncRoute(async(req,res)=>{let pageState=null;if(req.query.cursor){try{const c=jwt.verify(String(req.query.cursor),JWT_SECRET,{algorithms:['HS256'],audience:'sync-snapshot'});if(c.tenantId!==req.auth.tenantId||!Number.isSafeInteger(c.highWater)||(c.after!==null&&typeof c.after!=='string'))throw Error();pageState={after:c.after,highWater:c.highWater}}catch{return apiError(res,'Invalid or expired snapshot cursor. Restart the snapshot.',400)}}const s=await readFirestoreSnapshot({tenantId:req.auth.tenantId,pageState,pageSize:200}),nextCursor=s.nextState?jwt.sign({...s.nextState,tenantId:req.auth.tenantId,aud:'sync-snapshot'},JWT_SECRET,{expiresIn:'1h'}):null;res.json({records:s.records,nextCursor,deltaCursor:s.deltaCursor})}))
app.post('/sync',auth,asyncRoute(async(req,res)=>{const ops=Array.isArray(req.body?.ops)?req.body.ops.slice(0,50):[];try{res.json(await applyFirestoreSync({tenantId:req.auth.tenantId,actorId:req.auth.sub,ops,allowedEntities,timestamp:now}))}catch(e){console.error('Firestore sync failed',{requestId:req.requestId,...errorDiagnostics(e)});apiError(res,'Firestore sync failed')}}))
app.get('/sync',auth,asyncRoute(async(req,res)=>{const cursor=Math.max(0,Number(req.query.cursor||0));res.json(await readFirestoreChanges({tenantId:req.auth.tenantId,cursor}))}))
app.get('/admin/summary',auth,requireRole('facility_admin','ceo_owner','super_admin'),asyncRoute(async(req,res)=>{const ref=tenantRef(req.auth.tenantId),[t,staff,audit]=await Promise.all([ref.get(),ref.collection('staff').get(),ref.collection('auditLogs').count().get()]);if(!t.exists)return apiError(res,'Hospital workspace not found',404);res.json({tenant:{id:t.id,slug:t.data().slug,name:t.data().name,logoUrl:t.data().logoUrl||null},staffCount:staff.size,auditCount:audit.data().count})}))

app.use((error,req,res,_next)=>{const status=error.code==='auth/configuration-not-found'?503:error.message==='Origin not allowed'?403:Number.isInteger(error.status)&&error.status>=400&&error.status<500?error.status:Number.isInteger(error.status)&&error.status>=500?error.status:500;if(status>=500){const requestId=req.requestId||crypto.randomUUID();console.error('Unhandled backend error',{requestId,method:req.method,path:req.path,...errorDiagnostics(error)});return res.status(status).json({message:error.code==='auth/configuration-not-found'?error.message:status===503?'Authentication service is temporarily unavailable.':'Server error',requestId})}if(status===401)return res.status(401).json({message:'Invalid login details.'});if(status===429)return res.status(429).json({message:'Too many sign-in attempts. Try again later.'});return res.status(status).json({message:status===403?'Request origin is not allowed':'Invalid request'})})
async function start(){
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be an integer from 1 to 65535')
  await seedPlatform()
  const server = app.listen(PORT,HOST,()=>console.log(`Dibia HMS backend listening on ${HOST}:${PORT}`))
  const shutdown = (signal) => {
    console.log(`Backend received ${signal}; closing server`)
    server.close((error) => { if (error) { console.error('Backend shutdown failed', error.name); process.exitCode = 1 } })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
start().catch(error=>{console.error('Backend startup failed',errorDiagnostics(error));process.exitCode=1})
