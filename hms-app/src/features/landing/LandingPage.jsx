import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { openCookiePreferences } from '@/components/cookiePreferences'
import './landing.css'

const WHATSAPP_NUMBER = '2349050793854'
const WHATSAPP_MESSAGE = 'Hello Dibia, I would like to know more about running my hospital on Dibia.'
const whatsappHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

function chipVisual(online, big) {
  if (online) {
    return {
      label: 'Online, synced',
      style: { background: big ? 'rgba(63,145,66,0.18)' : '#E8F3EC', color: big ? '#8FDB92' : '#2C7A2E' },
      pulse: '#3F9142',
    }
  }
  return {
    label: 'Offline, saving locally',
    style: { background: big ? 'rgba(232,163,61,0.2)' : '#FDF2E1', color: big ? '#E8A33D' : '#9C6A17' },
    pulse: '#E8A33D',
  }
}

function SyncChip({ online, big }) {
  const v = chipVisual(online, big)
  return (
    <div className={big ? 'big-sync-chip' : 'sync-chip'} style={v.style}>
      <span className="pulse" style={{ background: v.pulse }} />
      {v.label}
    </div>
  )
}

const PIPELINE = [
  { label: 'Registration', icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></> },
  { label: 'Queue', icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></> },
  { label: 'Triage', icon: <path d="M3 12h4l2-6 4 12 2-6h6" /> },
  { label: 'Consultation', icon: <><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M10 12h6M10 16h6" /></> },
  { label: 'Laboratory', icon: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /> },
  { label: 'Pharmacy', icon: <><rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" /><path d="M9.5 8.5l6 7" /></> },
  { label: 'Billing', icon: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></> },
  { label: 'Ward and discharge', icon: <><path d="M3 18V8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="1.6" /></> },
]

const FEATURES = [
  { d: '', title: 'Electronic medical records', body: 'Encounters, diagnoses and notes follow the patient across every visit, and every entry is tied to the clinician who made it.', icon: <><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M10 12h6M10 16h6" /></> },
  { d: 'd1', title: 'Laboratory requests and results', body: 'Doctors request tests from the consulting room, technicians record and verify results, and the answer lands back in the patient file.', icon: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /> },
  { d: 'd2', title: 'Pharmacy and dispensing', body: 'Prescriptions arrive at the pharmacy directly, with batch and expiry control so the earliest-expiring stock is dispensed first.', icon: <><rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" /><path d="M9.5 8.5l6 7" /></> },
  { d: '', title: 'Billing and receipts', body: 'Consultation, lab and drug charges roll into one bill per visit, with split payments and a receipt the patient can keep.', icon: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></> },
  { d: 'd1', title: 'Wards and inpatient care', body: 'Admit patients, assign beds, track ward occupancy and discharge with a complete record of what happened during the stay.', icon: <><path d="M3 18V8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="1.6" /></> },
  { d: 'd2', title: 'Appointments and follow-ups', body: "Book visits, see each clinician's day at a glance and remind patients about follow-ups so fewer of them slip away.", icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></> },
]

const ROLES = [
  { name: 'Receptionist', sub: 'Registers patients, books appointments and manages the queue', tag: 'Front desk', icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></> },
  { name: 'Doctor', sub: 'Patient history, consultation notes, lab requests and prescriptions', tag: 'Clinic', icon: <><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M10 12h6M10 16h6" /></> },
  { name: 'Nurse', sub: 'Vitals, ward rounds and care notes for patients in their care', tag: 'Wards', icon: <path d="M3 12h4l2-6 4 12 2-6h6" /> },
  { name: 'Laboratory technician', sub: 'Incoming test requests, sample tracking and result entry', tag: 'Laboratory', icon: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /> },
  { name: 'Pharmacist', sub: 'Prescriptions to dispense and medicine stock with expiry dates', tag: 'Pharmacy', icon: <><rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" /><path d="M9.5 8.5l6 7" /></> },
  { name: 'Cashier', sub: 'Open bills, payments and receipts for each visit', tag: 'Payments', icon: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></> },
]

const QUEUE = ['Patient registered, Reception', 'Consultation note saved, Doctor', 'Lab request sent, Laboratory', 'Payment received, Cashier']

const Check = () => (
  <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
)
const PipeArrow = () => (
  <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)

export default function LandingPage() {
  const rootRef = useRef(null)
  const [heroOnline, setHeroOnline] = useState(true)
  const [demoOnline, setDemoOnline] = useState(true)

  const { isAuthed, user, landingPath } = useAuth()
  const dashboardPath = isAuthed && user?.hospitalSlug ? `/${user.hospitalSlug}/${landingPath()}` : null

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = root.querySelectorAll('.reveal')
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.15 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setHeroOnline((v) => !v), 4200)
    return () => clearInterval(timer)
  }, [])

  const queueTag = demoOnline ? 'qtag saved' : 'qtag queued'
  const queueText = demoOnline ? 'Saved' : 'Queued'

  return (
    <div className="landing theme-light" ref={rootRef}>
      <nav>
        <div className="wrap">
          <div className="logo">
            <div className="logo-mark">
              <svg className="icon" viewBox="0 0 24 24"><path d="M12 2C8 6 5 9.5 5 13.5A7 7 0 0 0 19 13.5C19 9.5 16 6 12 2Z" /></svg>
            </div>
            Dibia
          </div>
          <div className="nav-links">
            <a href="#pipeline">Platform</a>
            <a href="#features">Modules</a>
            <a href="#roles">Staff roles</a>
            <a href="#offline">Offline mode</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="nav-cta">
            {dashboardPath ? (
              <Link className="btn btn-primary" to={dashboardPath}>Go to dashboard</Link>
            ) : (
              <>
                <Link className="btn btn-ghost" to="/login">Sign in</Link>
                <Link className="btn btn-primary" to="/register"><span className="nav-label-full">Register your hospital</span><span className="nav-label-short">Register</span></Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="wrap hero-grid">
          <div className="reveal in">
            <div className="eyebrow"><span className="dot" /> Hospital management system for Nigerian hospitals</div>
            <h1>Every department, one patient record,<br /><em>even offline.</em></h1>
            <p className="hero-sub">From the front desk to the ward, Dibia connects reception, doctors, nurses, the laboratory, the pharmacy and the cashier. Every action is saved on the device first and syncs on its own when the network returns.</p>
            <div className="hero-actions">
              <Link className="btn btn-amber" to="/register">Register your hospital</Link>
              <a className="btn btn-ghost" href="#pipeline">See how a visit flows</a>
            </div>
            <div className="trust-row">
              <div className="tstat"><b>10</b><span>Staff roles supported</span></div>
              <div className="tstat"><b>Offline</b><span>First by design</span></div>
              <div className="tstat"><b>&#8358;10,000</b><span>Per module, monthly</span></div>
            </div>
          </div>

          <div className="device-outer reveal d2 in">
            <div className="device">
              <div className="device-bar">
                <div className="device-brand"><span className="sq" /> Demo Hospital</div>
                <SyncChip online={heroOnline} />
              </div>
              <div className="device-body">
                <div className="stat-mini-row">
                  <div className="stat-mini"><div className="l">Patients today</div><div className="v">86</div></div>
                  <div className="stat-mini"><div className="l">In queue</div><div className="v">12</div></div>
                  <div className="stat-mini"><div className="l">Beds free</div><div className="v">9</div></div>
                </div>
                <div className="mini-row-line"><span className="p1"><span className="stock-dot" style={{ background: 'var(--pending)' }} />Visit 0412</span><span className="p2">Waiting for doctor</span></div>
                <div className="mini-row-line"><span className="p1"><span className="stock-dot" style={{ background: 'var(--confirmed)' }} />Visit 0409</span><span className="p2">Lab result ready</span></div>
                <div className="mini-row-line"><span className="p1"><span className="stock-dot" style={{ background: 'var(--pharm)' }} />Visit 0406</span><span className="p2">At the pharmacy</span></div>
                <div className="mini-row-line"><span className="p1"><span className="stock-dot" style={{ background: 'var(--critical)' }} />Visit 0401</span><span className="p2">Payment pending</span></div>
              </div>
            </div>
            <div className="float-note f1"><Check /> Lab result sent to doctor</div>
            <div className="float-note f2"><Check /> Receipt issued at cashier</div>
          </div>
        </div>
      </section>

      <section className="pipeline" id="pipeline">
        <div className="wrap" style={{ padding: '44px 24px' }}>
          <p className="reveal" style={{ fontSize: 12, fontWeight: 700, color: 'var(--pharm)', textTransform: 'uppercase', letterSpacing: '.4px', textAlign: 'center', marginBottom: 22 }}>One patient visit, start to finish</p>
          <div className="pipeline-track">
            {PIPELINE.map((n, i) => (
              <Fragment key={n.label}>
                {i > 0 && <div className="p-arrow"><PipeArrow /></div>}
                <div className="p-node">
                  <div className="pn-ic"><svg className="icon" viewBox="0 0 24 24">{n.icon}</svg></div>
                  <div className="pn-label">{n.label}</div>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      <section id="features">
        <div className="wrap">
          <div className="reveal">
            <p className="section-tag">Everything a hospital runs on</p>
            <h2 className="section-title">Not a cash register. A whole hospital.</h2>
            <p className="section-sub">Patient records, clinical notes, lab results, prescriptions, wards and payments all live in one system, so no department has to ask another for a piece of paper.</p>
          </div>
          <div className="feat-grid">
            {FEATURES.map((f) => (
              <div className={`feat-card reveal${f.d ? ` ${f.d}` : ''}`} key={f.title}>
                <div className="feat-ic"><svg className="icon" viewBox="0 0 24 24">{f.icon}</svg></div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="offline-section" id="offline">
        <div className="wrap offline-grid">
          <div className="reveal">
            <p className="section-tag">The thing most systems get wrong</p>
            <h2 className="section-title">Patient care does not stop when the network does.</h2>
            <p style={{ marginBottom: 22 }}>Every registration, note, lab entry and payment is written to the device first, using IndexedDB, so nothing is lost or blocked by a bad connection. When you are back online, everything reconciles automatically.</p>
            <ul className="offline-list">
              <li><Check /> A status indicator is always visible, so staff know if they are online or offline.</li>
              <li><Check /> Work done offline queues locally and syncs the moment connectivity returns.</li>
              <li><Check /> No duplicate records or payments, because sync is built to reconcile safely.</li>
            </ul>
          </div>
          <div className="status-demo reveal d2">
            <div className="status-demo-row">
              <SyncChip online={demoOnline} big />
              <button className="toggle-btn" type="button" onClick={() => setDemoOnline((v) => !v)}>
                {demoOnline ? 'Simulate connection drop' : 'Restore connection'}
              </button>
            </div>
            {QUEUE.map((label) => (
              <div className="queue-line" key={label}>
                <span>{label}</span>
                <span className={queueTag}>{queueText}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="split-section" id="roles">
        <div className="wrap">
          <div className="reveal">
            <p className="section-tag">For every person in the building</p>
            <h2 className="section-title">The right screen for every staff role.</h2>
            <p className="section-sub" style={{ marginBottom: 30 }}>Each person signs in and sees only what their job needs. The hospital owner keeps full visibility, and every sensitive action is recorded against the staff member who made it.</p>
          </div>
          <div className="reveal d1">
            {ROLES.map((r) => (
              <div className="branch-card" key={r.name}>
                <div className="bl">
                  <div className="bic"><svg className="icon" viewBox="0 0 24 24">{r.icon}</svg></div>
                  <div>
                    <div className="bname">{r.name}</div>
                    <div className="bsub">{r.sub}</div>
                  </div>
                </div>
                <div className="bfig">{r.tag}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pricing-section" id="pricing">
        <div className="wrap">
          <div className="reveal" style={{ textAlign: 'center' }}>
            <p className="section-tag">Simple, honest pricing</p>
            <h2 className="section-title" style={{ margin: '0 auto 16px' }}>Choose the hospital modules you need.</h2>
            <p className="section-sub" style={{ margin: '0 auto' }}>Every module costs &#8358;10,000 per month. Pick the ones your hospital needs and add more as you grow. Modules are enabled by Dibia after manual payment confirmation.</p>
          </div>
          <div className="price-card reveal d1">
            <div className="price-badge">Per module</div>
            <div className="price-plan">Hospital modules</div>
            <div className="price-amount"><span className="cur">&#8358;</span>10,000<span className="per">/ module / month</span></div>
            <div className="price-note">No online payment processing is enabled</div>
            <ul className="price-feats">
              <li><Check /> Select the modules your hospital needs</li>
              <li><Check /> Each module is &#8358;10,000 per month</li>
              <li><Check /> Dibia confirms manual payments</li>
              <li><Check /> Access is enabled from the admin console</li>
              <li><Check /> Special hospitals can receive Pro access</li>
              <li><Check /> Online payment gateway is currently unavailable</li>
            </ul>
            <Link className="btn btn-amber price-cta" to="/register">Register your hospital</Link>
            <a className="price-talk" href={whatsappHref} target="_blank" rel="noopener noreferrer">Contact us for module selection and payment instructions</a>
          </div>
        </div>
      </section>

      <section className="cta-section" id="cta">
        <div className="wrap">
          <div className="cta-card reveal">
            <h2>Bring your hospital onto Dibia</h2>
            <p>Set up your hospital, invite your staff and register your first patient in one afternoon, online or offline.</p>
            <div className="cta-actions">
              <Link className="btn btn-amber" to="/register">Register your hospital</Link>
              <a className="btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} href={whatsappHref} target="_blank" rel="noopener noreferrer">Talk to us</a>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div>2026 Dibia. Hospital management for hospitals across Nigeria.</div>
          <div>Reception, Clinic, Laboratory, Pharmacy, Cashier, Wards</div>
          <nav className="landing-legal-links" aria-label="Legal and privacy">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms and Conditions</Link>
            <button type="button" onClick={openCookiePreferences}>Cookie Preferences</button>
          </nav>
        </div>
      </footer>
    </div>
  )
}