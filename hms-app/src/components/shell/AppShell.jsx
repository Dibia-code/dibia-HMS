import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { SyncBanner } from './SyncBanner'
import { BottomNav } from './BottomNav'
import { PageHeaderProvider, useHeaderState } from './pageHeaderContext'
import LegalFooter from '@/components/LegalFooter'

function PageHead() {
  const { header } = useHeaderState()
  if (!header.title) return null
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{header.title}</h1>
        {header.subtitle && <div className="page-sub">{header.subtitle}</div>}
      </div>
      {header.actions && <div className="page-actions">{header.actions}</div>}
    </div>
  )
}

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  return (
    <PageHeaderProvider>
      <div className="app-shell">
        <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} onClose={() => setNavOpen(false)} />
        <div className="main">
          <Topbar onMenu={() => setNavOpen((open) => !open)} menuOpen={navOpen} />
          <SyncBanner />
          <main className="content">
            <PageHead />
            <Outlet />
          </main>
          <LegalFooter className="shell-legal-footer" />
        </div>
      </div>
      <BottomNav />
    </PageHeaderProvider>
  )
}
