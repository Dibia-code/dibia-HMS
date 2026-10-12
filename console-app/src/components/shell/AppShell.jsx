import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { PageHeaderProvider, useHeaderState } from './pageHeaderContext'
import LegalFooter from '@/components/LegalFooter'

function PageHead() {
  const { header } = useHeaderState()
  if (!header.title) return null
  return (
    <div className="page-head">
      {header.actions && <div className="page-actions">{header.actions}</div>}
      <h1 className="page-title">{header.title}</h1>
      {header.subtitle && <div className="page-sub">{header.subtitle}</div>}
    </div>
  )
}

export function AppShell() {
  return (
    <PageHeaderProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="main">
          <Topbar />
          <main className="content">
            <PageHead />
            <Outlet />
          </main>
          <LegalFooter className="shell-legal-footer" />
        </div>
      </div>
    </PageHeaderProvider>
  )
}
