import { Link } from 'react-router-dom'
import LegalFooter from '@/components/LegalFooter'

export default function Terms() {
  return (
    <div className="legal-page-wrap">
      <main className="legal-page">
        <Link to="/" className="legal-back">← Back to Dibia</Link>
        <h1>Terms and Conditions</h1><p className="legal-updated">Effective date: 12 October 2026</p>
        <p>These terms govern access to Dibia HMS by hospitals and their authorized users. A hospital that creates an account agrees to use the service on these terms.</p>
        <h2>Hospital accounts and approval</h2>
        <p>Hospital registrations are subject to review by Dibia. A registration marked pending cannot access the hospital workspace until approved. Hospital administrators must provide accurate registration details, protect account credentials, and promptly remove access for staff who no longer need it.</p>
        <h2>Permitted use</h2>
        <p>Use Dibia HMS for lawful hospital operations and only with appropriate authority. Do not attempt to access another hospital’s records, bypass role permissions, disrupt the service, upload malicious code, or use the HMS to make decisions that require a qualified professional without appropriate clinical review.</p>
        <h2>Hospital responsibilities and records</h2>
        <p>The hospital remains responsible for the accuracy and lawful handling of information it enters, its staff permissions, its patient notices and consents where required, and its record retention obligations. The hospital should maintain appropriate backups and protect devices used to access the HMS.</p>
        <h2>Availability and support</h2>
        <p>Dibia HMS is an operational information system and is not an emergency response service. The service may be unavailable for maintenance, connectivity problems, or events outside Dibia’s control. Use established clinical and emergency procedures when the system is unavailable. Support requests can be submitted through the channels provided to the hospital.</p>
        <h2>Modules, subscriptions, and termination</h2>
        <p>Access to modules may depend on the hospital’s plan, payment status, and Dibia administrator settings. Applicable fees and billing terms are those communicated to the hospital. Dibia may suspend access for security, non-payment, misuse, or legal requirements. The hospital should arrange export and retention of its records before ending service.</p>
        <h2>Changes and contact</h2>
        <p>These terms may be updated as the service changes. Continued use after an update means the hospital accepts the updated terms. For questions, contact Dibia through the official support channel provided to your hospital.</p>
      </main>
      <LegalFooter />
    </div>
  )
}
