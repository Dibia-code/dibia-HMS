import { Link } from 'react-router-dom'
import LegalFooter from '@/components/LegalFooter'

export default function PrivacyPolicy() {
  return (
    <div className="legal-page-wrap">
      <main className="legal-page">
        <Link to="/" className="legal-back">← Back to Dibia</Link>
        <h1>Privacy Policy</h1><p className="legal-updated">Effective date: 12 October 2026</p>
        <p>Dibia HMS provides hospital administration and care coordination tools. This policy describes how information is handled when hospitals and their staff use the service.</p>
        <h2>Information handled</h2>
        <p>Depending on how a hospital uses Dibia, the service may process account and staff details, hospital and branch information, patient identity and contact details, demographic information, visit and care records, billing records, and technical information needed to operate and secure the service.</p>
        <h2>How information is used</h2>
        <p>Information is used to provide the HMS, authenticate users, route work to the appropriate hospital roles, synchronize records, support hospitals, maintain security, and meet applicable obligations. Hospital administrators control staff access and are responsible for ensuring that their use and collection of patient information is authorized.</p>
        <h2>Access and sharing</h2>
        <p>Hospital records are made available to authorized users in the relevant hospital workspace. Dibia may use infrastructure and service providers to host and operate the service. Information is not sold for advertising. Access by Dibia support personnel should be limited to what is needed to provide support or protect the service.</p>
        <h2>Storage, security, and retention</h2>
        <p>Dibia uses access controls and security measures intended to protect information. No online service can guarantee absolute security. Hospitals should use strong credentials, assign only necessary permissions, and protect devices that access patient information. Records are retained as needed to provide the service and meet the hospital’s retention obligations. Ask your hospital administrator about retention and deletion requests.</p>
        <h2>Your choices and requests</h2>
        <p>Staff should contact their hospital administrator about access, correction, or deletion of hospital records. Hospital administrators can contact Dibia through their official support channel for account and service requests. Essential session cookies are used for secure sign-in; optional analytics cookies are not active in this build. Cookie choices can be changed using Cookie Preferences in the footer.</p>
        <h2>Updates and contact</h2>
        <p>This policy may be updated as Dibia HMS changes. The hospital using the service is the first point of contact for questions about its patient records. For service privacy requests, contact Dibia through the official support channel provided to your hospital.</p>
      </main>
      <LegalFooter />
    </div>
  )
}
