import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Pool } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { saveDomainRecord, writeProfile, writeStaff, appendSyncChange } from '../../src/supabase-store.js'
import { sanitizeSyncPayload } from '../../src/policy.js'

const migrationDir = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(migrationDir, '.env.migration'), override: true })
const sourceProject = String(process.env.FIREBASE_PROJECT_ID || '').trim()
const sourceApiKey = String(process.env.FIREBASE_WEB_API_KEY || '').trim()
const serviceAccountPath = path.resolve(migrationDir, process.env.GOOGLE_APPLICATION_CREDENTIALS || '../../dibia-service-account.json')
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim()
const supabaseSecret = String(process.env.SUPABASE_SECRET_KEY || '').trim()
const databaseUrl = new URL(process.env.DATABASE_URL || 'postgres://localhost/postgres')
for (const key of [...databaseUrl.searchParams.keys()]) if (key.toLowerCase() === 'sslmode') databaseUrl.searchParams.delete(key)
const pool = new Pool({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false }, max: 4 })
const admin = supabaseUrl && supabaseSecret ? createClient(supabaseUrl, supabaseSecret, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }) : null
const authTokenUrl = 'https://oauth2.googleapis.com/token'
const firestoreScope = 'https://www.googleapis.com/auth/datastore'
const authScope = 'https://www.googleapis.com/auth/identitytoolkit'
const rootCollections = new Set(['tenants','hospitals','staffProfiles','platformUsers','modules','subscriptionPlans','platformSettings','platformAuditLogs','platformSupportTickets','platformMessages','deviceInvites','tenantSlugs','authRateLimits','refreshSessions'])
const tenantCollections = new Set(['branches','staff','subscriptions','tenantModules','moduleEntitlements','records','syncChanges','auditLogs','meta','settings','refreshSessions','authRateLimits'])
const counters = { sourceAuthUsers: 0, createdAuthUsers: 0, existingAuthUsers: 0, tenants: 0, branches: 0, profiles: 0, staff: 0, domainRecords: 0, subscriptions: 0, modules: 0, entitlements: 0, supportTickets: 0, platformMessages: 0, auditLogs: 0, syncChanges: 0, deviceInvites: 0, skippedRecords: 0 }
let sourceAccessToken
let tokenExpiry = 0
let sourceAuthUsers = []
let sourceAuthById = new Map()
let authIdByEmail = new Map()
let authIdByPhone = new Map()
let authIdBySourceId = new Map()
let transferStage = 'configuration'

function encode(value) { return Buffer.from(value).toString('base64url') }

function credentials() {
  if (!fs.existsSync(serviceAccountPath)) throw new Error('The source service account file is missing at the configured path')
  const account = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
  if (!account.client_email || !account.private_key) throw new Error('The source service account file is incomplete')
  return account
}

async function googleAccessToken(scope) {
  if (sourceAccessToken && tokenExpiry > Date.now() + 60000) return sourceAccessToken
  const account = credentials()
  const issued = Math.floor(Date.now() / 1000)
  const unsigned = `${encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${encode(JSON.stringify({ iss: account.client_email, scope, aud: authTokenUrl, iat: issued, exp: issued + 3600 }))}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')
  const response = await fetch(authTokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.access_token) throw new Error(`Source identity exchange failed (${response.status})`)
  sourceAccessToken = result.access_token
  tokenExpiry = Date.now() + Number(result.expires_in || 3600) * 1000
  return sourceAccessToken
}

async function sourceFetch(url, options = {}, retry = 0) {
  const token = await googleAccessToken(options.scope || firestoreScope)
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  const response = await fetch(url, { ...options, headers })
  if ((response.status === 429 || response.status >= 500) && retry < 5) {
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** retry)))
    return sourceFetch(url, options, retry + 1)
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(`Source transfer request failed (${response.status})`)
    error.firebaseHttpStatus = response.status
    error.firebaseCode = result?.error?.code || result?.error?.status || response.status
    error.firebaseMessage = result?.error?.message || response.statusText || 'Firebase source request failed'
    throw error
  }
  return result
}

function decodeValue(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) { const number = Number(value.integerValue); return Number.isSafeInteger(number) ? number : String(value.integerValue) }
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('bytesValue' in value) return value.bytesValue
  if ('referenceValue' in value) return value.referenceValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  return null
}

function decodeFields(fields = {}) { return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])) }
function documentPath(name) { return name.split('/documents/').at(-1) }
function sourceDocument(document) {
  const segments = documentPath(document.name).split('/')
  return { path: segments.join('/'), segments, collection: segments.at(-2), id: segments.at(-1), data: decodeFields(document.fields || {}) }
}

async function listCollectionIds(parent = '') {
  const root = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sourceProject)}/databases/(default)/documents`
  const pathPart = parent ? `/${parent}` : ''
  const ids = []
  let pageToken = ''
  do {
    const result = await sourceFetch(`${root}${pathPart}:listCollectionIds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) }) })
    ids.push(...(result.collectionIds || []))
    pageToken = result.nextPageToken || ''
  } while (pageToken)
  return ids
}

async function* listCollectionDocuments(collectionPath) {
  const root = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sourceProject)}/databases/(default)/documents/${collectionPath}`
  let pageToken = ''
  do {
    const url = new URL(root)
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const result = await sourceFetch(url)
    for (const document of result.documents || []) yield sourceDocument(document)
    pageToken = result.nextPageToken || ''
  } while (pageToken)
}

async function* allSourceDocuments() {
  const roots = await listCollectionIds()
  const queue = roots.map((name) => ({ path: name, depth: 0 }))
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    for await (const document of listCollectionDocuments(current.path)) {
      yield document
      if (current.depth < 8) {
        for (const child of await listCollectionIds(document.path)) queue.push({ path: `${document.path}/${child}`, depth: current.depth + 1 })
      }
    }
  }
}

async function listSourceUsers() {
  const users = []
  let pageToken = ''
  do {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(sourceProject)}/accounts:batchGet`)
    url.searchParams.set('maxResults', '1000')
    url.searchParams.set('key', sourceApiKey)
    if (pageToken) url.searchParams.set('nextPageToken', pageToken)
    const result = await sourceFetch(url, { scope: authScope })
    users.push(...(result.users || []))
    pageToken = result.nextPageToken || ''
  } while (pageToken)
  return users
}

async function listDestinationUsers() {
  const users = []
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Destination account lookup failed (${error.code || error.status || 'auth error'})`)
    users.push(...data.users)
    if (data.users.length < 1000) break
  }
  return users
}

async function provisionUsers() {
  transferStage = 'Firebase Auth user export'
  sourceAuthUsers = await listSourceUsers()
  counters.sourceAuthUsers = sourceAuthUsers.length
  console.log(`Read ${counters.sourceAuthUsers} Firebase Auth users`)
  transferStage = 'Supabase Auth user lookup'
  const existingUsers = await listDestinationUsers()
  const destinationByEmail = new Map(existingUsers.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user]))
  const destinationByPhone = new Map(existingUsers.filter((user) => user.phone).map((user) => [user.phone, user]))
  for (const sourceUser of sourceAuthUsers) {
    const email = String(sourceUser.email || '').trim().toLowerCase()
    const phone = String(sourceUser.phoneNumber || '').trim()
    if (!email && !phone) { counters.skippedRecords += 1; continue }
    let target = (email && destinationByEmail.get(email)) || (phone && destinationByPhone.get(phone))
    if (!target) {
      transferStage = 'Supabase Auth user import'
      const { data, error } = await admin.auth.admin.createUser({ email: email || undefined, phone: phone || undefined, password: crypto.randomBytes(48).toString('base64url'), email_confirm: Boolean(email), phone_confirm: Boolean(phone), user_metadata: { name: sourceUser.displayName || '', migratedFrom: 'firebase' } })
      if (error) throw new Error(`Could not provision an Auth account (${error.code || error.status || 'auth error'})`)
      target = data.user
      if (email) destinationByEmail.set(email, target)
      if (phone) destinationByPhone.set(phone, target)
      counters.createdAuthUsers += 1
    } else counters.existingAuthUsers += 1
    if (email) authIdByEmail.set(email, target.id)
    if (phone) authIdByPhone.set(phone, target.id)
    authIdBySourceId.set(sourceUser.localId, target.id)
    sourceAuthById.set(sourceUser.localId, sourceUser)
  }
}

function authIdFor(idValue, email = '', phone = '') { return authIdBySourceId.get(idValue) || authIdByEmail.get(String(email).toLowerCase()) || authIdByPhone.get(String(phone)) || null }
function tenantIdFrom(document) { return document.segments[0] === 'tenants' ? document.segments[1] : null }
function safeDate(value) { return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null }
function count(key) { counters[key] += 1 }

function isKnownDocument(document) {
  if (document.segments.length === 2 && rootCollections.has(document.collection)) return true
  if (document.segments[0] === 'tenants' && document.segments.length === 2) return true
  return document.segments[0] === 'tenants' && document.segments.length === 4 && tenantCollections.has(document.segments[2])
}

async function upsertTenant(client, sourceId, data) {
  const tenant = { id: sourceId, slug: data.slug || `tenant-${sourceId}`.slice(0, 50), name: data.name || data.hospitalName || 'Hospital', address: data.address || data.location || null, phone: data.phone || null, logoUrl: data.logoUrl || null, status: ['pending','active','suspended','rejected'].includes(data.status) ? data.status : 'pending', createdAt: safeDate(data.createdAt), updatedAt: safeDate(data.updatedAt) }
  await saveDomainRecord(client, sourceId, 'hospitals', sourceId, tenant)
  count('tenants')
}

async function migrateBranches(client, documents) {
  for (const document of documents) {
    const tenantId = tenantIdFrom(document)
    if (!tenantId || document.segments.length !== 4 || document.segments[2] !== 'branches') continue
    await saveDomainRecord(client, tenantId, 'branches', document.id, { ...document.data, id: document.id, hospitalId: tenantId })
    count('branches')
  }
}

async function migrateProfilesAndStaff(client, documents) {
  const profileDocs = documents.filter((document) => ['staffProfiles','platformUsers'].includes(document.collection) && document.segments.length === 2)
  for (const document of profileDocs) {
    const data = document.data
    const sourceId = String(data.uid || data.userId || document.id)
    const authUser = sourceAuthById.get(sourceId)
    const email = String(data.email || authUser?.email || '').toLowerCase() || null
    const phone = String(data.phone || authUser?.phoneNumber || '') || null
    const userId = authIdFor(sourceId, email, phone)
    if (!userId || (!email && !phone)) { count('skippedRecords'); continue }
    const tenantId = document.collection === 'platformUsers' ? null : data.tenantId || data.hospitalId || null
    const branchId = tenantId ? data.branchId || null : null
    const profile = { id: userId, tenantId, branchId, name: data.name || data.displayName || '', email, phone, roles: Array.isArray(data.roles) ? data.roles : document.collection === 'platformUsers' ? ['platform_super_admin'] : [], active: data.active !== false && authUser?.disabled !== true, permGrants: data.permGrants || [], permDenies: data.permDenies || [] }
    await writeProfile(client, profile)
    count('profiles')
  }
  const staffDocs = documents.filter((document) => tenantIdFrom(document) && document.segments.length === 4 && document.segments[2] === 'staff')
  for (const document of staffDocs) {
    const tenantId = tenantIdFrom(document), data = document.data
    const email = String(data.email || '').toLowerCase(), authUserId = authIdFor(document.id, email, data.phone)
    await writeStaff(client, { ...data, id: document.id, hospitalId: tenantId, authUserId, active: data.active !== false })
    count('staff')
  }
  const sourceProfileDocs = profileDocs.filter((document) => document.collection === 'staffProfiles')
  for (const document of sourceProfileDocs) {
    const data = document.data, email = String(data.email || '').toLowerCase(), userId = authIdFor(String(data.uid || data.userId || document.id), email, data.phone), tenantId = data.tenantId || data.hospitalId
    if (!userId || !tenantId) continue
    const roles = Array.isArray(data.roles) ? data.roles : []
    for (const role of roles) await client.query('insert into public.staff_roles (id,hospital_id,staff_id,role) values ($1,$2,$3,$4) on conflict (hospital_id,staff_id,role) do nothing', [`${userId}__${role}`,tenantId,document.id,role])
  }
}

const entityOrder = ['hospitals','branches','staff','staff_roles','patients','visits','appointments','products','customers','suppliers','sales','purchase_orders','batches','prescriptions','dispensings','payments','refunds','expenses','stock_movements','transfers','stock_counts','hmo_claims','devices','shift_reports','complaints','hr_actions','staff_payments','audit_log','settings']
const mappedRecordEntities = new Set([...entityOrder,'hospitals','branches','staff','staff_roles'])

async function migrateDomainRecords(client, documents) {
  const records = []
  for (const document of documents) {
    const tenantId = tenantIdFrom(document)
    if (!tenantId) continue
    if (document.segments[2] === 'records' && document.segments.length === 4) {
      const data = document.data, entity = String(data.entity || '').replace(/-/g, '_'), payload = data.payload
      if (!entityOrder.includes(entity) || !payload || typeof payload !== 'object') { count('skippedRecords'); continue }
      records.push({ tenantId, entity, id: String(data.recordId || payload.id || document.id), payload, deleted: data.deleted === true })
    }
  }
  records.sort((left, right) => entityOrder.indexOf(left.entity) - entityOrder.indexOf(right.entity))
  for (const record of records) {
    const payload = sanitizeSyncPayload(record.payload)
    if (record.entity === 'devices' && typeof record.payload.token === 'string' && record.payload.token) await client.query('insert into public.device_invites (token_hash,hospital_id,device_id) values ($1,$2,$3) on conflict (token_hash) do nothing', [crypto.createHash('sha256').update(record.payload.token).digest('hex'),record.tenantId,record.id])
    await saveDomainRecord(client, record.tenantId, record.entity, record.id, { ...payload, id: record.id, hospitalId: record.tenantId }, record.deleted)
    count('domainRecords')
  }
}

async function migrateAuxiliary(client, documents) {
  for (const document of documents.filter((item) => item.collection === 'modules' && item.segments.length === 2)) {
    const data = document.data, code = String(data.code || document.id)
    await client.query('insert into public.modules (id,code,name,description,category,version,status,pricing_model,price_minor,config_schema) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) on conflict (code) do update set name=excluded.name,description=excluded.description,category=excluded.category,version=excluded.version,status=excluded.status,pricing_model=excluded.pricing_model,price_minor=excluded.price_minor,config_schema=excluded.config_schema,updated_at=now()', [data.id || `mod_${code}`,code,data.name || code,data.description || '',data.category || 'operations',data.version || '1.0.0',data.status || 'published',data.pricingModel || 'addon',Number(data.priceMinor || 0),JSON.stringify(data.configSchema || {})])
    count('modules')
  }
  for (const document of documents.filter((item) => item.collection === 'subscriptionPlans' && item.segments.length === 2)) {
    const data = document.data, code = String(data.code || document.id)
    await client.query('insert into public.subscription_plans (id,code,name,price_minor,currency,status) values ($1,$2,$3,$4,$5,$6) on conflict (code) do update set name=excluded.name,price_minor=excluded.price_minor,currency=excluded.currency,status=excluded.status,updated_at=now()', [data.id || `plan_${code}`,code,data.name || code,Number(data.priceMinor || 0),data.currency || 'NGN',data.status || 'active'])
  }
  for (const document of documents) {
    const data = document.data
    if (document.collection === 'deviceInvites' && document.segments.length === 2) {
      const device = await client.query('select 1 from public.devices where hospital_id=$1 and id=$2', [data.tenantId,data.recordId])
      if (device.rowCount) { await client.query('insert into public.device_invites (token_hash,hospital_id,device_id) values ($1,$2,$3) on conflict (token_hash) do nothing', [document.id,data.tenantId,data.recordId]); count('deviceInvites') } else count('skippedRecords')
      continue
    }
    const tenantId = tenantIdFrom(document) || (['platformSupportTickets','platformMessages'].includes(document.collection) ? data.hospitalId : null)
    if (document.collection === 'modules' && document.segments.length === 2) {
      continue
    }
    if (document.collection === 'subscriptionPlans' && document.segments.length === 2) {
      continue
    }
    if (!tenantId) {
      if (document.collection === 'platformSettings') await client.query('insert into public.platform_settings (key,value) values ($1,$2::jsonb) on conflict (key) do update set value=excluded.value,updated_at=now()', [document.id,JSON.stringify(data.value || data)])
      if (document.collection === 'platformAuditLogs') { const actorId = authIdFor(data.platformUserId || data.actorId, data.email); await client.query('insert into public.platform_audit_logs (id,actor_id,action,entity,record_id,metadata,created_at) values ($1,$2,$3,$4,$5,$6::jsonb,coalesce($7::timestamptz,now())) on conflict (id) do nothing', [data.id || document.id,actorId,data.action || 'migrated',data.entity || null,data.recordId || null,JSON.stringify(data.metadata || {}),safeDate(data.createdAt)]); count('auditLogs') }
      continue
    }
    if (document.segments[2] === 'subscriptions' && document.segments.length === 4) {
      const planName = data.plan || data.planName || 'Freemium', planResult = await client.query('select code from public.subscription_plans where lower(code)=lower($1) or lower(name)=lower($1) limit 1', [data.planCode || planName])
      await client.query('insert into public.subscriptions (id,hospital_id,plan_code,plan_name,amount_minor,status,payment_method,starts_at,renews_at,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10::timestamptz,now()),coalesce($11::timestamptz,now())) on conflict (hospital_id,id) do update set plan_code=excluded.plan_code,plan_name=excluded.plan_name,amount_minor=excluded.amount_minor,status=excluded.status,payment_method=excluded.payment_method,starts_at=excluded.starts_at,renews_at=excluded.renews_at,updated_at=excluded.updated_at', [data.id || `sub_${tenantId}`,tenantId,planResult.rows[0]?.code || null,planName,Number(data.amountMinor || 0),data.status || 'pending',data.paymentMethod || null,safeDate(data.startsAt),safeDate(data.renewsAt),safeDate(data.createdAt),safeDate(data.updatedAt)])
      count('subscriptions')
    }
    if (document.segments[2] === 'moduleEntitlements' && document.segments.length === 4) await client.query('insert into public.module_entitlements (hospital_id,module_code,source,status,starts_at) values ($1,$2,$3,$4,$5) on conflict (hospital_id,module_code) do update set source=excluded.source,status=excluded.status,starts_at=excluded.starts_at,updated_at=now()', [tenantId,data.moduleCode || document.id,data.source || 'migrated',data.status || 'entitled',safeDate(data.startsAt)]), count('entitlements')
    if (document.segments[2] === 'tenantModules' && document.segments.length === 4) await client.query('insert into public.tenant_modules (hospital_id,module_code,status,activated_at) values ($1,$2,$3,$4) on conflict (hospital_id,module_code) do update set status=excluded.status,activated_at=excluded.activated_at', [tenantId,data.moduleCode || document.id,data.status || 'disabled',safeDate(data.activatedAt)])
    if (document.collection === 'platformSupportTickets' || document.segments[2] === 'supportTickets') {
      await client.query('insert into public.support_tickets (id,hospital_id,created_by,issue,priority,status,reply,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz,now()),coalesce($9::timestamptz,now())) on conflict (id) do update set issue=excluded.issue,priority=excluded.priority,status=excluded.status,reply=excluded.reply,updated_at=excluded.updated_at', [data.id || document.id,tenantId,authIdFor(data.createdBy),data.issue || data.message || 'Migrated support request',data.priority || 'medium',data.status || 'open',data.reply || '',safeDate(data.createdAt),safeDate(data.updatedAt)])
      count('supportTickets')
    }
    if (document.collection === 'platformMessages') {
      await client.query('insert into public.platform_messages (id,hospital_id,sent_by,body,created_at) values ($1,$2,$3,$4,coalesce($5::timestamptz,now())) on conflict (id) do nothing', [data.id || document.id,tenantId,authIdFor(data.sentBy),data.body || '',safeDate(data.createdAt || data.sentAt)])
      count('platformMessages')
    }
    if (document.segments[2] === 'auditLogs' && document.segments.length === 4) {
      await client.query('insert into public.audit_logs (id,hospital_id,actor_id,action,entity,record_id,metadata,created_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,coalesce($8::timestamptz,now())) on conflict (id) do nothing', [data.id || document.id,tenantId,authIdFor(data.actorId),data.action || 'migrated',data.entity || null,data.recordId || null,JSON.stringify(data.metadata || {}),safeDate(data.createdAt)])
      count('auditLogs')
    }
    if (document.segments[2] === 'syncChanges' && document.segments.length === 4) {
      const sequence = Number(data.sequence || document.id)
      if (Number.isSafeInteger(sequence) && sequence > 0) {
        await client.query('insert into public.sync_changes (hospital_id,sequence,entity,record_id,operation,payload,created_at) values ($1,$2,$3,$4,$5,$6::jsonb,coalesce($7::timestamptz,now())) on conflict (hospital_id,sequence) do update set entity=excluded.entity,record_id=excluded.record_id,operation=excluded.operation,payload=excluded.payload', [tenantId,sequence,String(data.entity || 'patients').replace(/-/g,'_'),String(data.recordId || ''),['create','update','delete'].includes(data.operation) ? data.operation : 'update',data.payload == null ? null : JSON.stringify(sanitizeSyncPayload(data.payload)),safeDate(data.createdAt)])
        count('syncChanges')
      }
    }
    if (document.segments[2] === 'settings' && document.segments.length === 4) await client.query('insert into public.hospital_settings (hospital_id,id,value,updated_at) values ($1,$2,$3::jsonb,coalesce($4::timestamptz,now())) on conflict (hospital_id) do update set id=excluded.id,value=excluded.value,updated_at=excluded.updated_at', [tenantId,document.id,JSON.stringify(data.value || data),safeDate(data.updatedAt)])
  }
}

async function migrate() {
  if (!sourceProject || !sourceApiKey || !supabaseUrl || !supabaseSecret || !process.env.DATABASE_URL) throw new Error('Source and destination configuration is incomplete')
  if (!fs.existsSync(serviceAccountPath)) throw new Error('The source service account file is missing at the configured path')
  const account = credentials()
  if (sourceProject !== account.project_id) throw new Error('Firebase project ID does not match the service account project_id')
  transferStage = 'Supabase Postgres connection check'
  console.log('Checking Supabase Postgres connection and schema')
  const tableCheck = await pool.query("select to_regclass('public.tenants') as tenants, to_regclass('public.staff_roles') as staff_roles")
  if (!tableCheck.rows[0].tenants || !tableCheck.rows[0].staff_roles) throw new Error('Apply the Supabase schema migration before transferring data')
  const documents = []
  transferStage = 'Firebase Firestore export'
  console.log('Reading Firebase Firestore documents')
  for await (const document of allSourceDocuments()) {
    documents.push(document)
    if (documents.length % 500 === 0) console.log(`Read ${documents.length} Firestore documents`)
  }
  console.log(`Finished reading ${documents.length} Firestore documents`)
  const unknownCount = documents.filter((document) => !isKnownDocument(document)).length
  if (unknownCount) throw new Error(`Source contains ${unknownCount} records in collections without a relational mapping; no transfer was started`)
  const unmappedRecordCount = documents.filter((document) => document.segments[0] === 'tenants' && document.segments[2] === 'records' && document.segments.length === 4).filter((document) => !mappedRecordEntities.has(String(document.data.entity || '').replace(/-/g,'_')) || !document.data.payload || typeof document.data.payload !== 'object').length
  if (unmappedRecordCount) throw new Error(`Source contains ${unmappedRecordCount} domain records without a relational mapping; no transfer was started`)
  counters.skippedRecords += documents.filter((document) => ['refreshSessions','authRateLimits','tenantSlugs','meta'].includes(document.collection)).length
  await provisionUsers()
  const tenants = documents.filter((document) => document.segments.length === 2 && ['tenants','hospitals'].includes(document.collection))
  transferStage = 'Supabase Postgres data import'
  console.log('Writing migrated records to Supabase Postgres')
  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const document of tenants) await upsertTenant(client, document.id, document.data)
    await migrateBranches(client, documents)
    await migrateProfilesAndStaff(client, documents)
    await migrateDomainRecords(client, documents)
    await migrateAuxiliary(client, documents)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally { client.release() }
  console.log(JSON.stringify(counters))
}

migrate().catch((error) => {
  const code = /^[A-Z0-9_]+$/.test(String(error?.code || '')) ? ` (${error.code})` : ''
  const message = error?.code ? '' : `: ${String(error?.message || 'Unknown error').replace(/[\r\n]+/g,' ').slice(0,300)}`
  console.error(`Migration transfer failed during ${transferStage}${code}${message}`)
  if (error?.firebaseHttpStatus) {
    const account = credentials()
    console.error(`Firebase error code: ${error.firebaseCode}`)
    console.error(`Firebase error message: ${String(error.firebaseMessage).replace(/[\r\n]+/g,' ').slice(0,300)}`)
    console.error(`Firebase project ID: ${sourceProject}`)
    console.error(`Firebase service account email: ${account.client_email}`)
    console.error(`Firebase service account project_id: ${account.project_id}`)
  }
  process.exitCode = 1
}).finally(() => pool.end())
