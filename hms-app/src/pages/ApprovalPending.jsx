import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import LegalFooter from '@/components/LegalFooter'

export default function ApprovalPending() {
  const location = useLocation()
  const email = location.state?.email || ''
  const hospitalName = location.state?.hospitalName || ''

  return (
    <div className="auth-wrap">
      <div className="auth-card approval-card">
        <div className="brand"><span className="mark"><Icon name="activity" size={20} /></span><span className="name">Dibia</span></div>
        <div className="approval-mark" aria-hidden="true">…</div>
        <h1>Hospital approval pending</h1>
        <p className="sub">{hospitalName ? `${hospitalName} is waiting for approval.` : 'Your hospital registration is waiting for approval.'} Dibia Hospital Management will review the request. You can sign in after it is approved.</p>
        {email && <p className="approval-email">Account entered: <b>{email}</b></p>}
        <p className="approval-note">You can return here by trying to sign in again. While your registration is pending, hospital workspace access is not available.</p>
        <Link className="btn btn-primary btn-block" to="/login">Return to sign in</Link>
        <LegalFooter />
      </div>
    </div>
  )
}
