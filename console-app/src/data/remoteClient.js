import { dataBus } from './repository'

let accessToken = null
export const setConsoleAccessToken = (token) => { accessToken = token || null }

export class RemoteConsoleClient {
  constructor({ baseUrl } = {}) {
    this.baseUrl = String(baseUrl || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:4000' : '/api')).replace(/\/+$/, '')
  }

  async request(path, options = {}) {
    const send = () => fetch(`${this.baseUrl}${path}`, {
      ...options, credentials: 'include',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
    })
    let response = await send()
    if (response.status === 401) {
      const refresh = await fetch(`${this.baseUrl}/auth/console/session`, { credentials: 'include' })
      const session = await refresh.json().catch(() => ({}))
      if (refresh.ok && session.accessToken) {
        setConsoleAccessToken(session.accessToken)
        response = await send()
      }
    }
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.message || `Platform API failed (${response.status})`)
    return body
  }

  changed() { dataBus.dispatchEvent(new Event('change')) }

  async list(entity) {
    if (entity === 'modules') return (await this.request('/platform/modules')).modules || []
    if (entity === 'hospitals') {
      const catalog = await this.list('modules')
      const { tenants = [] } = await this.request('/platform/tenants')
      return Promise.all(tenants.map(async (hospital) => {
        try {
          const { modules = [] } = await this.request(`/platform/tenants/${encodeURIComponent(hospital.id)}/modules`)
          return { ...hospital, modules: modules.filter((module) => module.entitlementStatus === 'entitled' && module.activationStatus === 'enabled').map((module) => module.code), moduleStates: modules, moduleCatalog: catalog }
        } catch { return { ...hospital, modules: [] } }
      }))
    }
    if (entity === 'transactions') return (await this.request('/platform/transactions')).transactions || []
    if (entity === 'tickets') return (await this.request('/platform/tickets')).tickets || []
    if (entity === 'messages') return (await this.request('/platform/messages')).messages || []
    throw new Error(`Platform list is not available for ${entity}`)
  }

  async get(entity, id) {
    const rows = await this.list(entity)
    return rows.find((row) => row.id === id) || null
  }

  async update(entity, id, patch) {
    let result
    if (entity === 'hospitals') {
      if (['active', 'rejected'].includes(patch.status)) {
        const current = await this.get('hospitals', id)
        if (current?.status === 'pending') {
          const decision = patch.status === 'active' ? 'approve' : 'reject'
          const response = await this.request(`/platform/tenants/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision }) })
          result = response.tenant
        }
      }
      const { modules, ...fields } = patch
      if (!result && Object.keys(fields).length) {
        const { tenant } = await this.request(`/platform/tenants/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(fields) })
        result = tenant
      }
      if (Array.isArray(modules)) {
        const selected = new Set(modules)
        const catalog = await this.list('modules')
        await Promise.all(catalog.map(({ code }) => this.request(
          `/platform/tenants/${encodeURIComponent(id)}/modules/${code}`,
          { method: 'PATCH', body: JSON.stringify({ enabled: selected.has(code), entitled: selected.has(code), source: 'manual-payment-or-pro-override' }) },
        )))
      }
      result = { ...(result || await this.get('hospitals', id)), ...patch }
    } else if (entity === 'transactions' && patch.status === 'paid') {
      result = await this.request(`/platform/transactions/${encodeURIComponent(id)}/confirm`, { method: 'PATCH', body: JSON.stringify({ method: 'manual' }) })
    } else if (entity === 'tickets') {
      result = await this.request(`/platform/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
    } else throw new Error(`Platform update is not available for ${entity}`)
    this.changed()
    return result
  }

  async create(entity, data) {
    if (entity !== 'messages') throw new Error(`Platform create is not available for ${entity}`)
    const { message } = await this.request(`/platform/tenants/${encodeURIComponent(data.hospitalId)}/messages`, { method: 'POST', body: JSON.stringify({ body: data.body }) })
    this.changed()
    return message
  }

  async remove() { throw new Error('Deleting platform records is not available yet') }
}
