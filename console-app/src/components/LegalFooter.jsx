import { Link } from 'react-router-dom'
import { openCookiePreferences } from './cookiePreferences'

export default function LegalFooter({ className = '' }) {
  return <footer className={`legal-footer ${className}`}><span>© 2026 Dibia HMS</span><nav aria-label="Legal and privacy">
    <Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms and Conditions</Link>
    <button type="button" onClick={openCookiePreferences}>Cookie Preferences</button>
  </nav></footer>
}
