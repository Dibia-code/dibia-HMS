import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBaseRepo } from '@/data/RepositoryContext'
import { dataBus } from '@/data/repository'
import { Button, Field, Input, Icon } from '@/components'
import { apiBase } from '@/lib/apiBase'
import { activeDeviceHeaders, createDeviceCredential, rememberDevice } from '@/lib/deviceCredential'

const backendAuthEnabled = () => import.meta.env.PROD || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true'

export default function DeviceJoin() {
  const repo = useBaseRepo()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [device, setDevice] = useState(undefined)
  const [name, setName] = useState('')
  const [requestError, setRequestError] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      if (backendAuthEnabled()) {
        try {
          let response = await fetch(`${apiBase()}/devices/join?token=${encodeURIComponent(token || '')}`, { headers: activeDeviceHeaders() })
          let result = await response.json().catch(() => ({}))
          const credential = result.device?.id ? createDeviceCredential(result.device.id) : ''
          if (credential && !result.device?.registeredHere) {
            response = await fetch(`${apiBase()}/devices/join?token=${encodeURIComponent(token || '')}`, { headers: { 'X-Dibia-Device-Key': credential } })
            result = await response.json().catch(() => ({}))
          }
          if (!response.ok && response.status !== 404) throw new Error(result.message || 'Could not verify this device link')
          if (alive) {
            setLoadError('')
            setDevice(response.ok ? result.device : null)
          }
        } catch (error) {
          if (alive) setLoadError(error instanceof Error && error.message !== 'Failed to fetch' ? error.message : 'Could not reach the backend to verify this device link. Check the app address and backend connection.')
        }
        return
      }
      const found = token ? await repo.findByIndex('devices', 'by_token', token) : null
      if (alive) setDevice(found || null)
    }
    load()
    const timer = backendAuthEnabled() ? setInterval(load, 5000) : null
    if (!backendAuthEnabled()) dataBus.addEventListener('change', load)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
      dataBus.removeEventListener('change', load)
    }
  }, [repo, token])

  async function request() {
    if (backendAuthEnabled()) {
      setRequestError('')
      try {
        const credential = createDeviceCredential(device.id)
        rememberDevice(device.id, credential)
        const response = await fetch(`${apiBase()}/devices/join`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dibia-Device-Key': credential },
          body: JSON.stringify({ token, name: name.trim(), deviceKey: credential }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not request device access')
        setDevice(result.device)
      } catch (error) {
        setRequestError(error.message || 'Could not request device access')
      }
      return
    }
    await repo.update('devices', device.id, { status: 'pending', requestedName: name.trim() || device.name, requestedAt: new Date().toISOString() })
    localStorage.setItem('dibia.deviceId', device.id)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand"><span className="mark"><Icon name="activity" size={20} /></span><span className="name">Dibia</span></div>
        <h1>Set up this device</h1>
        {loadError && <div role="alert" style={{ color: 'var(--critical)', fontSize: 13 }}>{loadError}</div>}
        {device === undefined && <div className="sub">Checking the link...</div>}
        {device === null && <div className="sub">This access link is not valid. Ask your hospital admin for a new one.</div>}
        {device && device.status === 'invited' && (
          <>
            <div className="sub">This link is for {device.assignedStaffName || 'an assigned staff member'}{device.assignedStaffEmail ? ` (${device.assignedStaffEmail})` : ''}. Ask your hospital admin to approve this computer.</div>
            <Field label="Name for this device" htmlFor="dj-name"><Input id="dj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={device.name} /></Field>
            {requestError && <div role="alert" style={{ color: 'var(--critical)', fontSize: 13, marginBottom: 12 }}>{requestError}</div>}
            <Button variant="primary" size="lg" block onClick={request}>Ask for access</Button>
          </>
        )}
        {device && device.status === 'pending' && (device.registeredHere ? <div className="sub">This computer is waiting for approval for {device.assignedStaffName || 'the assigned staff account'}. Keep this page open.</div> : <div className="sub">This request belongs to another computer. Open the link on the computer that requested access.</div>)}
        {device && device.status === 'approved' && device.registeredHere && (
          <>
            <div className="sub">This computer is approved for {device.assignedStaffName || 'the assigned staff account'}.</div>
            <Link to="/login" className="btn btn-primary btn-lg btn-block">Sign in</Link>
          </>
        )}
        {device && device.status === 'approved' && !device.registeredHere && <div className="sub">This invitation is already approved for another computer. Ask your hospital admin to revoke access and issue a new link.</div>}
        {device && ['rejected', 'revoked'].includes(device.status) && <div className="sub">Access for this device was {device.status}. Speak to your hospital admin.</div>}
      </div>
    </div>
  )
}
