import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import './landing.css'

// Public marketing landing — styles are scoped under .landing in ./landing.css.

// ┌──────────────────────────────────────────────────────────────────────────┐
// │  EDIT ME — the "Talk to us" button on the last card opens a WhatsApp   │
// Opens WhatsApp with the number and message below.
// │                                                                           │
// │  • WHATSAPP_NUMBER: full international format, DIGITS ONLY — no "+",       │
// │    spaces or dashes. A Nigerian line 0803 123 4567 → '2348031234567'.     │
// │  • WHATSAPP_MESSAGE: the text pre-filled in the chat box when they tap.    │
// └──────────────────────────────────────────────────────────────────────────┘
const WHATSAPP_NUMBER = '2349050793854' // Dibia WhatsApp (+234 905 079 3854)
const WHATSAPP_MESSAGE = "Hello Dibia, I would like to know more about running my hospital on Dibia."
const whatsappHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

function chipVisual(online, big) {
  if (online) {
    return {
      label: 'Online · synced',
      style: { background: big ? 'rgba(63,145,66,0.18)' : '#E8F3EC', color: big ? '#8FDB92' : '#2C7A2E' },
      pulse: '#3F9142',
    }
  }
  return {
    label: 'Offline · saving locally',
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
  { label: 'Stock', icon: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a4 4 0 0 1 8 0v2" /></> },
  { label: 'Purchase', icon: <><path d="M3 9l9-6 9 6-9 6-9-6Z" /><path d="M3 9v6l9 6 9-6V9" /></> },
  { label: 'Batch', icon: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 10h16" /></> },
  { label: 'Expiry', icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></> },
  { label: 'Sales', icon: <><path d="M6 6h15l-1.5 9h-12z" /><path d="M6 6L4 3H2" /><circle cx="9" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /></> },
  { label: 'Profit', icon: <path d="M3 3v18h18M7 15l4-6 4 3 5-8" /> },
  { label: 'Staff', icon: <><circle cx="9" cy="7" r="3" /><path d="M2 21v-1a7 7 0 0 1 14 0v1" /><circle cx="18" cy="8" r="2.4" /></> },
  { label: 'Cash', icon: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h.01M18 12h4" /></> },
  { label: 'Branches', icon: <><rect x="3" y="10" width="6" height="10" /><rect x="10" y="6" width="6" height="14" /><rect x="17" y="3" width="4" height="17" /></> },
  { label: 'Management', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></> },
]

const FEATURES = [
  { d: '', title: 'FEFO expiry control', body: 'Earliest-expiring batches sell first, automatically — with overrides logged to the audit trail, not silently allowed.', icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></> },
  { d: 'd1', title: 'Fast, offline-capable POS', body: "Barcode scanning, split payments, price overrides by permission — sales keep moving even when the internet doesn't.", icon: <><path d="M6 6h15l-1.5 9h-12z" /><path d="M6 6L4 3H2" /><circle cx="9" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /></> },
  { d: 'd2', title: 'Multi-branch, one head office', body: 'Every branch keeps its own stock and cashiers — while the CEO sees performance across all of them from one screen.', icon: <><rect x="3" y="10" width="6" height="10" /><rect x="10" y="6" width="6" height="14" /><rect x="17" y="3" width="4" height="17" /></> },
  { d: '', title: 'Staff accountability built in', body: 'Every discount, price change, void and adjustment is tied to the staff member who made it — nothing disappears quietly.', icon: <><circle cx="9" cy="7" r="3" /><path d="M2 21v-1a7 7 0 0 1 14 0v1" /><circle cx="18" cy="8" r="2.4" /></> },
  { d: 'd1', title: 'Batch-level accuracy', body: 'Multiple batches of the same drug tracked separately — cost, price, supplier and expiry never get merged or confused.', icon: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 10h16" /></> },
  { d: 'd2', title: 'Real profit, not just sales', body: 'Cost of goods, expenses and margin by product, staff, branch and period — so "busy" and "profitable" don\'t get confused.', icon: <path d="M3 3v18h18M7 15l4-6 4 3 5-8" /> },
]

const BRANCHES = [
  { name: 'Demo Hospital — Main Campus', sub: '24 staff · 8 patients in care', fig: '₦412,000' },
  { name: 'Demo Hospital — Outpatient', sub: '9 clinicians · 3 departments active', fig: '₦268,500' },
  { name: 'Demo Hospital — Maternity', sub: '11 staff · 3 patients in care', fig: '₦355,900' },
]

const QUEUE = ['Payment RCP-7K2M9Q, cash', 'Prescription dispensed, 4 drugs', 'Patient registered, Reception']

// The small check used in the offline bullet list + the f1 float-note.
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

  // Auth-aware nav: a signed-in owner shouldn't be sent back through /login —
  // give them a direct way into their tenant instead. Mirrors router.jsx.
  const { isAuthed, user, landingPath } = useAuth()
  const dashboardPath = isAuthed && user?.hospitalSlug ? `/${user.hospitalSlug}/${landingPath()}` : null

  // 1. scroll-reveal: reveal each .reveal as it scrolls into view, once.
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

  // 2. ambient hero chip: gently flip online/offline every few seconds.
  useEffect(() => {
    const id = setInterval(() => setHeroOnline((v) => !v), 4200)
    return () => clearInterval(id)
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
            <a href="#offline">Offline mode</a>
            <a href="#branches">Branches</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="nav-cta">
            {dashboardPath ? (
              <Link className="btn btn-primary" to={dashboardPath}>Go to dashboard</Link>
            ) : (
              <>
                <Link className="btn btn-ghost" to="/login">Sign in</Link>
                <Link className="btn btn-primary" to="/register">Create your hospital account</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ---------------- hero ---------------- */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="reveal in">
            <div className="eyebrow"><span className="dot" /> Built for Nigerian hospitals. It keeps working without internet</div>
            <h1>Run your whole hospital<br />from reception to pharmacy,<br /><em>even offline.</em></h1>
            <p className="hero-sub">Reception, cashier, pharmacy and admin on one platform. Every action is saved on the device first and syncs on its own when the network returns.</p>
            <div className="hero-actions">
              <Link className="btn btn-amber" to="/register">Create your hospital account</Link>
              <a className="btn btn-ghost" href="#offline">See offline mode →</a>
            </div>
            <div className="trust-row">
              <div className="tstat"><b>10</b><span>Staff roles supported</span></div>
              <div className="tstat"><b>FEFO</b><span>Batch &amp; expiry control</span></div>
              <div className="tstat"><b>0</b><span>Sales lost to downtime</span></div>
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
                   <div className="stat-mini"><div className="l">Today&apos;s sales</div><div className="v">₦184,500</div></div>
                  <div className="stat-mini"><div className="l">Gross profit</div><div className="v">₦52,300</div></div>
                  <div className="stat-mini"><div className="l">Low stock</div><div className="v">7</div></div>
                </div>
                <div className="mini-row-line"><span className="p1"><span className="stock-dot" style={{ background: 'var(--confirmed)' }} />Amoxicillin 250mg</span><span className="p2">Batch #A22 · exp Mar 2027</span></div>
                <div className="mini-row-line"><span className="p1"><span className="stock-dot" style={{ background: 'var(--pending)' }} />Paracetamol 500mg</span><span className="p2">Batch #P09 · exp Dec 2026</span></div>
                <div className="mini-row-line"><span className="p1"><span className="stock-dot" style={{ background: 'var(--critical)' }} />Ibuprofen 400mg</span><span className="p2">Out of stock</span></div>
              </div>
            </div>
            <div className="float-note f1"><Check /> Synced to the server</div>
            <div className="float-note f2"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 15l4-6 4 3 5-8" /></svg> +12% vs last week</div>
          </div>
        </div>
      </section>

      {/* ---------------- pipeline ---------------- */}
      <section className="pipeline" id="pipeline">
        <div className="wrap" style={{ padding: '44px 24px' }}>
          <p className="reveal" style={{ fontSize: 12, fontWeight: 700, color: 'var(--pharm)', textTransform: 'uppercase', letterSpacing: '.4px', textAlign: 'center', marginBottom: 22 }}>One system, start to finish</p>
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

      {/* ---------------- features ---------------- */}
      <section id="features">
        <div className="wrap">
          <div className="reveal">
            <p className="section-tag">Everything a hospital desk actually runs on</p>
            <h2 className="section-title">Not a cash register. A control room.</h2>
            <p className="section-sub">Register patients, collect payments, dispense drugs and watch the whole hospital from one place, with the right view for every staff role.</p>
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

      {/* ---------------- offline spotlight ---------------- */}
      <section className="offline-section" id="offline">
        <div className="wrap offline-grid">
          <div className="reveal">
            <p className="section-tag">The thing every other system gets wrong</p>
            <h2 className="section-title">Keeps selling when the network cuts out.</h2>
             <p style={{ marginBottom: 22 }}>Every sale is written to the device first, using IndexedDB — never lost, never blocked by a bad connection. The moment you&apos;re back online, everything reconciles automatically.</p>
            <ul className="offline-list">
               <li><Check /> A status indicator is always visible — you always know if you&apos;re online or offline.</li>
              <li><Check /> Sales made offline queue locally and sync the moment connectivity returns.</li>
              <li><Check /> No duplicate transactions — sync is built to reconcile safely, every time.</li>
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

      {/* ---------------- branches ---------------- */}
      <section className="split-section" id="branches">
        <div className="wrap">
          <div className="reveal">
            <p className="section-tag">For the owner, not just the cashier</p>
            <h2 className="section-title">See every branch, from your phone.</h2>
            <p className="section-sub" style={{ marginBottom: 30 }}>Remote monitoring for the CEO — sales, stock value, expiry risk and staff activity, across every location, without visiting any of them.</p>
          </div>
          <div className="reveal d1">
            {BRANCHES.map((b) => (
              <div className="branch-card" key={b.name}>
                <div className="bl">
                  <div className="bic"><svg className="icon" viewBox="0 0 24 24"><path d="M6 6h15l-1.5 9h-12z" /></svg></div>
                  <div>
                    <div className="bname">{b.name}</div>
                    <div className="bsub">{b.sub}</div>
                  </div>
                </div>
                <div className="bfig">{b.fig}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- pricing ---------------- */}
      <section className="pricing-section" id="pricing">
        <div className="wrap">
          <div className="reveal" style={{ textAlign: 'center' }}>
            <p className="section-tag">Simple, honest pricing</p>
            <h2 className="section-title" style={{ margin: '0 auto 16px' }}>One plan. Everything included.</h2>
            <p className="section-sub" style={{ margin: '0 auto' }}>No per-seat fees and no surprises — every feature, every branch and every staff role, for one flat monthly price.</p>
          </div>
          <div className="price-card reveal d1">
            <div className="price-badge">Most popular</div>
            <div className="price-plan">Growth Plan</div>
            <div className="price-amount"><span className="cur">₦</span>15,000<span className="per">/ month</span></div>
            <div className="price-note">Billed monthly · cancel anytime</div>
            <ul className="price-feats">
              <li><Check /> Unlimited staff &amp; all 10 roles</li>
              <li><Check /> Every branch under one head office</li>
              <li><Check /> Offline-capable POS with auto-sync</li>
              <li><Check /> FEFO batch &amp; expiry control</li>
              <li><Check /> Profit, cash &amp; staff reports</li>
              <li><Check /> Barcode scanning &amp; receipt printing</li>
            </ul>
            <Link className="btn btn-amber price-cta" to="/register">Create your hospital account</Link>
            <a className="price-talk" href={whatsappHref} target="_blank" rel="noopener noreferrer">or talk to us on WhatsApp →</a>
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="cta-section" id="cta">
        <div className="wrap">
          <div className="cta-card reveal">
            <h2>Create your hospital account on Dibia</h2>
            <p>Set up your business, invite your staff, and start selling — online or offline — in one afternoon.</p>
            <div className="cta-actions">
              <Link className="btn btn-amber" to="/register">Create your hospital account</Link>
              <a className="btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} href={whatsappHref} target="_blank" rel="noopener noreferrer">Talk to us</a>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div>2026 Dibia. Built for hospitals across Nigeria.</div>
          <div>Reception, Cashier, Pharmacy, Admin</div>
        </div>
      </footer>
    </div>
  )
}
