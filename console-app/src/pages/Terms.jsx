import { Link } from 'react-router-dom'
import LegalFooter from '@/components/LegalFooter'

export default function Terms() {
  return <div className="legal-page-wrap"><main className="legal-page">
    <Link to="/login" className="legal-back">← Back to sign in</Link><h1>Terms and Conditions</h1><p className="legal-updated">Effective date: 12 October 2026</p>
    <p>These terms apply to authorized Dibia personnel using the Dibia HMS Super Admin Console.</p>
    <h2>Authorized access</h2><p>Use the console only with an assigned administrator account and only for Dibia network administration. Keep credentials confidential, use only approved devices, and sign out when access is no longer needed.</p>
    <h2>Responsible administration</h2><p>Review hospital registrations and payment information carefully before changing status or enabling modules. Do not place patient medical records, passwords, or payment card details in messages or support notes. Access hospital information only as needed for an assigned operational task.</p>
    <h2>Security and availability</h2><p>Do not attempt to bypass access controls, access records outside your duties, or disrupt the console. The service may be unavailable for maintenance or events outside Dibia’s control. Report suspected account misuse or data exposure promptly through the official security/support channel.</p>
    <h2>Changes and contact</h2><p>Console access may be changed or revoked by Dibia. These terms may be updated as the service changes; the current version is available on this page. For questions, contact Dibia through its official support channel.</p>
  </main><LegalFooter /></div>
}
