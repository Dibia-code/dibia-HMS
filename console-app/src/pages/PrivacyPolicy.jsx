import { Link } from 'react-router-dom'
import LegalFooter from '@/components/LegalFooter'

export default function PrivacyPolicy() {
  return <div className="legal-page-wrap"><main className="legal-page">
    <Link to="/login" className="legal-back">← Back to sign in</Link><h1>Privacy Policy</h1><p className="legal-updated">Effective date: 12 October 2026</p>
    <p>Dibia HMS Console is used by Dibia network administrators to manage hospital registrations, subscriptions, modules, and support requests.</p>
    <h2>Information handled</h2><p>The console processes administrator account details, hospital and branch details, subscription and module status, support conversations, and security logs needed to operate the service.</p>
    <h2>How information is used</h2><p>Information is used to review hospital registrations, administer access and subscriptions, respond to support requests, maintain security, and operate the Dibia HMS network. Hospital patient records are not intended to be entered into console messages or support tickets.</p>
    <h2>Access and sharing</h2><p>Console information is available to authorized Dibia administrators. Dibia may use infrastructure providers to host and operate the console. Information is not sold for advertising.</p>
    <h2>Security and retention</h2><p>Access controls and security measures are used to protect console information, but no online service can guarantee absolute security. Information is retained as needed for administration, support, security, and applicable obligations.</p>
    <h2>Cookies and requests</h2><p>Essential session cookies keep administrator sign-in secure. Optional analytics cookies are not active in this build. Change your choice using Cookie Preferences in the footer. For privacy requests, contact Dibia through its official support channel.</p>
    <h2>Updates</h2><p>This policy may be updated as the console changes. The current version is available on this page.</p>
  </main><LegalFooter /></div>
}
