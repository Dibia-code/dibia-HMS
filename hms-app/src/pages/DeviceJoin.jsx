import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBaseRepo } from '@/data/RepositoryContext'
import { dataBus } from '@/data/repository'
import { Button, Field, Input, Icon } from '@/components'

export default function DeviceJoin() {
  const repo = useBaseRepo()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [device, setDevice] = useState(undefined)
  const [name, setName] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      const found = token ? await repo.findByIndex('devices', 'by_token', token) : null
      if (alive) setDevice(found || null)
    }
    load()
    dataBus.addEventListener('change', load)
    return () => {
      alive = false
      dataBus.removeEventListener('change', load)
    }
  }, [repo, token])

  async function request() {
    await repo.update('devices', device.id, { status: 'pending', requestedName: name.trim() || device.name, requestedAt: new Date().toISOString() })
    localStorage.setItem('dibia.deviceId', device.id)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand"><span className="mark"><Icon name="activity" size={20} /></span><span className="name">Dibia</span></div>
        <h1>Set up this device</h1>
        {device === undefined && <div className="sub">Checking the link...</div>}
        {device === null && <div className="sub">This access link is not valid. Ask your hospital admin for a new one.</div>}
        {device && device.status === 'invited' && (
          <>
            <div className="sub">Ask for access to {device.name}. Your hospital admin will approve it.</div>
            <Field label="Name for this device" htmlFor="dj-name"><Input id="dj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={device.name} /></Field>
            <Button variant="primary" size="lg" block onClick={request}>Ask for access</Button>
          </>
        )}
        {device && device.status === 'pending' && <div className="sub">Waiting for your hospital admin to approve this device. Keep this page open.</div>}
        {device && device.status === 'approved' && (
          <>
            <div className="sub">This device is approved.</div>
            <Link to="/login" className="btn btn-primary btn-lg btn-block">Sign in</Link>
          </>
        )}
        {device && ['rejected', 'revoked'].includes(device.status) && <div className="sub">Access for this device was {device.status}. Speak to your hospital admin.</div>}
      </div>
    </div>
  )
}
