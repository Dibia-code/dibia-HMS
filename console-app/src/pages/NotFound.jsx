import { Link } from 'react-router-dom'

// 404 — sits outside the shell (the router places it at '*').
export default function NotFound() {
  return (
    <div className="login-wrap">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, color: 'var(--teal-dark)' }}>404</div>
        <p style={{ color: 'var(--muted-2)', margin: '8px 0 18px' }}>That page isn&apos;t part of the console.</p>
        <Link className="btn btn-primary" to="/overview">Back to overview</Link>
      </div>
    </div>
  )
}
