import { Outlet } from 'react-router-dom'
import { useMemo } from 'react'
import { useAuth } from '../../../console-app/src/auth/AuthContext'
import { useRepo } from '../../../console-app/src/data/RepositoryContext'
import FeedbackNotebook from './FeedbackNotebook'

export default function FeedbackLayerConsole() {
  const { user } = useAuth()
  const repo = useRepo()
  const enabled = import.meta.env.VITE_FEEDBACK_ENABLED !== 'false' && Boolean(user)
  const api = useMemo(() => user ? {
    list: async () => ((await repo.request('/platform/feedback')).feedback || []).map((item) => ({ ...item, sent: true })),
    listHospitals: async () => (await repo.request('/platform/tenants')).tenants || [],
    sendMessage: async (hospitalId, body) => repo.request(`/platform/tenants/${encodeURIComponent(hospitalId)}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
    update: async (feedbackId, update) => (await repo.request(`/platform/feedback/${encodeURIComponent(feedbackId)}`, { method: 'PATCH', body: JSON.stringify(update) })).feedback,
  } : null, [user, repo])
  return <><Outlet /><FeedbackNotebook app="Console" user={user} workspace="Dibia Console" role="Platform administrator" scopeKey={user?.id || user?.email || 'console'} enabled={enabled} api={api} /></>
}
