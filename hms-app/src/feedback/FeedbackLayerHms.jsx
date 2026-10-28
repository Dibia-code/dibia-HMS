import { Outlet } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useSyncEngine } from '../data/RepositoryContext'
import { apiBase } from '../lib/apiBase'
import FeedbackNotebook from './FeedbackNotebook'

const allowedEmails = String(import.meta.env.VITE_FEEDBACK_REVIEWER_EMAILS || 'olawoyinabdulsalam202@gmail.com,iezediba@gmail.com').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)

export default function FeedbackLayerHms() {
  const { user } = useAuth()
  const sync = useSyncEngine()
  const email = String(user?.email || '').trim().toLowerCase()
  const allowed = allowedEmails.includes(email)
  const configuredHospital = String(import.meta.env.VITE_FEEDBACK_HOSPITAL_ID || '').trim()
  const configuredHospitalKey = configuredHospital.toLowerCase()
  const hospitalKeys = [user?.hospitalId, user?.hospitalSlug].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
  const hospitalStaff = Boolean(configuredHospitalKey && hospitalKeys.includes(configuredHospitalKey))
  const demoStaff = import.meta.env.DEV && user?.hospitalId === 'hosp_demo' && (user?.roles || []).some((role) => ['cashier', 'receptionist'].includes(role))
  const directReviewAccess = allowed || hospitalStaff || demoStaff
  const [ownerHospitalAccess, setOwnerHospitalAccess] = useState(false)
  useEffect(() => {
    let active = true
    setOwnerHospitalAccess(false)
    if (!user?.hospitalId || directReviewAccess || !sync?.remote?.hasEndpoint) return () => { active = false }
    sync.remote.request(`${apiBase()}/feedback/access`, { credentials: 'include', headers: {} })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (active && response.ok) setOwnerHospitalAccess(result.enabled === true)
      })
      .catch(() => {})
    return () => { active = false }
  }, [user?.hospitalId, directReviewAccess, sync])
  const publicReview = import.meta.env.VITE_FEEDBACK_PUBLIC_REVIEW === 'true'
  const reviewAccess = directReviewAccess || ownerHospitalAccess
  const enabled = import.meta.env.VITE_FEEDBACK_ENABLED !== 'false' && (reviewAccess || (!user && publicReview))
  const scopeKey = import.meta.env.VITE_FEEDBACK_DEMO_REVIEW_MODE === 'true' && reviewAccess ? 'shared-reviewer' : user?.userId || user?.id || (publicReview ? 'public-reviewer' : 'anonymous')
  const api = useMemo(() => user?.hospitalId && sync?.remote?.hasEndpoint ? {
    list: async () => {
      const response = await sync.remote.request(`${sync.remote.baseUrl}/feedback`, { credentials: 'include', headers: {} })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Unable to load sent feedback')
      return (body.feedback || []).map((item) => ({ ...item, sent: true }))
    },
    messages: async () => {
      const response = await sync.remote.request(`${sync.remote.baseUrl}/feedback/messages`, { credentials: 'include', headers: {} })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Unable to load messages')
      return body.messages || []
    },
    recipients: async () => {
      const response = await sync.remote.request(`${sync.remote.baseUrl}/feedback/recipients`, { credentials: 'include', headers: {} })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Unable to load recipient hospitals')
      return body.hospitals || []
    },
    sendMessage: async (recipientHospitalId, body) => {
      const response = await sync.remote.request(`${sync.remote.baseUrl}/feedback/messages`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientHospitalId, body }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Unable to send the hospital message')
      return result.message
    },
    send: async (feedback) => {
      const response = await sync.remote.request(`${sync.remote.baseUrl}/feedback`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feedback) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Unable to send feedback')
      return body.feedback
    },
    addInfo: async (feedbackId, entry) => {
      const response = await sync.remote.request(`${sync.remote.baseUrl}/feedback/${encodeURIComponent(feedbackId)}/updates`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: entry.text, kind: 'reviewer_note' }) })
      if (!response.ok) throw new Error('Unable to share additional information')
    },
    update: async (feedbackId, update) => {
      const response = await sync.remote.request(`${sync.remote.baseUrl}/feedback/${encodeURIComponent(feedbackId)}/retest`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Unable to save retest result')
      return body.feedback
    },
  } : null, [user?.hospitalId, user?.hospitalName, sync])

  return <><Outlet /><FeedbackNotebook app="HMS" user={user} workspace={user?.hospitalName} role={user?.roles?.join(', ')} scopeKey={scopeKey} enabled={enabled} reviewerMode={import.meta.env.VITE_FEEDBACK_DEMO_REVIEW_MODE === 'true'} api={api} /></>
}
