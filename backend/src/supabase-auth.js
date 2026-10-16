import { createClient } from '@supabase/supabase-js'

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
let adminClient
let publicClient

function config() {
  const url = String(process.env.SUPABASE_URL || '').trim()
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim()
  const secretKey = String(process.env.SUPABASE_SECRET_KEY || '').trim()
  if (!url || !publishableKey || !secretKey) throw new Error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY are required')
  return { url, publishableKey, secretKey }
}

function clients() {
  const values = config()
  adminClient ||= createClient(values.url, values.secretKey, options)
  publicClient ||= createClient(values.url, values.publishableKey, options)
  return { ...values, admin: adminClient, public: publicClient }
}

function mapUser(user) {
  if (!user) return null
  return { uid: user.id, email: user.email || '', displayName: user.user_metadata?.name || user.user_metadata?.full_name || '', user }
}

function makeError(error, status = 503) {
  const result = new Error(error?.message || 'Supabase Auth request failed')
  result.code = error?.code || error?.status || 'supabase-auth/error'
  result.status = Number(error?.status) || status
  return result
}

async function authRequest(path, body, key) {
  const { url, publishableKey } = clients()
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: key || publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = makeError(data, response.status)
    if (response.status === 400 || response.status === 401) error.status = 401
    throw error
  }
  return data
}

export async function findSupabaseUserByEmail(email) {
  const { admin } = clients()
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw makeError(error)
    const user = data.users.find((item) => String(item.email || '').toLowerCase() === String(email).toLowerCase())
    if (user) return mapUser(user)
    if (data.users.length < 1000) break
  }
  const error = new Error('Supabase user not found')
  error.code = 'auth/user-not-found'
  error.status = 404
  throw error
}

export async function createSupabaseUser({ email, password, displayName, phoneNumber, emailConfirmed = true }) {
  const { admin } = clients()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: emailConfirmed,
    phone: phoneNumber || undefined,
    phone_confirm: phoneNumber ? true : undefined,
    user_metadata: displayName ? { name: displayName } : {},
  })
  if (error) {
    const result = makeError(error)
    if (/already[_ -]?exists|email.*exists|user.*exists/i.test(`${error.code || ''} ${error.message || ''}`)) result.code = 'auth/email-already-exists'
    throw result
  }
  return mapUser(data.user)
}

export async function deleteSupabaseUser(userId) {
  const { admin } = clients()
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw makeError(error)
}

export async function updateSupabaseUserPassword(userId, password) {
  const { admin } = clients()
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) throw makeError(error)
}

export async function verifySupabaseAccessToken(accessToken) {
  const { admin } = clients()
  const { data, error } = await admin.auth.getUser(accessToken)
  if (error || !data.user) throw makeError(error || new Error('Invalid access token'), 401)
  return mapUser(data.user)
}

export async function signInSupabasePassword(identifier, password) {
  const { publishableKey } = clients()
  const credentials = String(identifier).includes('@') ? { email: String(identifier).toLowerCase() } : { phone: String(identifier) }
  const data = await authRequest('token?grant_type=password', { ...credentials, password }, publishableKey)
  return { accessToken: data.access_token, refreshToken: data.refresh_token, user: mapUser(data.user) }
}

export async function refreshSupabaseSession(refreshToken) {
  try {
    const { publishableKey } = clients()
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token: refreshToken }, publishableKey)
    return { accessToken: data.access_token, refreshToken: data.refresh_token, user: mapUser(data.user) }
  } catch {
    return null
  }
}

export async function revokeSupabaseSession(refreshToken) {
  const session = await refreshSupabaseSession(refreshToken)
  if (!session) return
  const { url, publishableKey } = clients()
  await fetch(`${url}/auth/v1/logout`, { method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${session.accessToken}` } }).catch(() => {})
}

export async function sendSupabasePasswordReset(email, redirectTo) {
  const { public: client } = clients()
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo })
  return { ok: !error, error: error ? makeError(error) : null }
}

export async function updateSupabasePassword(accessToken, password) {
  const user = await verifySupabaseAccessToken(accessToken)
  const { admin } = clients()
  const { error } = await admin.auth.admin.updateUserById(user.uid, { password })
  if (error) throw makeError(error)
  return user
}

export async function supabaseAuthReady() {
  const { admin } = clients()
  const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) throw makeError(error)
  return true
}
