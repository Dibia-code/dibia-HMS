import { Link } from 'react-router-dom'
import { Button } from '@/components'
import { Icon } from '@/components/Icon'

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div className="brand">
          <span className="mark">
            <Icon name="pill" size={20} />
          </span>
          <span className="name">Dibia</span>
        </div>
        <h1>Page not found</h1>
        <div className="sub">That screen doesn’t exist or you don’t have access to it.</div>
        <Link to="/login">
          <Button variant="primary" block>Back to sign in</Button>
        </Link>
      </div>
    </div>
  )
}
