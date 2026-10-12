import { EmptyState, usePageHeader } from '@/components'

// Temporary placeholder for a feature screen. Sets the topbar title and shows a
// "scaffolded" card so routing, guards, and the sidebar are fully exercisable
// before each page's real UI is built. Every one of these will be replaced by a
// full implementation under its own features/<name>/ folder.
function ScreenScaffold({ title, subtitle, icon }) {
  usePageHeader({ title, subtitle }, [title, subtitle])
  return (
    <EmptyState
      icon={icon}
      title={`${title} — scaffolded`}
      hint="Layout, routing, role-guarding and the offline sync chip are live. This screen's full UI is built in the next phase."
    />
  )
}

// Small helper to declare a scaffold page component.
const screen = (title, subtitle, icon) => {
  const C = () => <ScreenScaffold title={title} subtitle={subtitle} icon={icon} />
  C.displayName = `Scaffold(${title})`
  return C
}

// --- management / shared routes ---
export const Dashboard = screen('Dashboard', 'Today at a glance', 'dashboard')
export const Pos = screen('New Sale', 'Point of sale', 'pos')
export const Inventory = screen('Inventory', 'Stock, batches & expiry', 'inventory')
export const Purchasing = screen('Purchasing', 'Purchase orders & suppliers', 'purchasing')
export const Branches = screen('Branches', 'Locations & transfers', 'branches')
export const Warehouse = screen('Warehouse', 'Central stock & transfers', 'warehouse')
export const Staff = screen('Staff', 'Team & roles', 'staff')
export const Stocktaking = screen('Stocktaking', 'Physical counts & variance', 'stocktaking')
export const Expenses = screen('Expenses', 'Operating costs', 'expenses')
export const Customers = screen('Customers', 'Credit accounts', 'customers')
export const Reports = screen('Reports', 'Sales & closing sessions', 'reports')
export const Settings = screen('Settings', 'Hardware, tax & templates', 'settings')
export const Subscription = screen('Subscription', 'Plan & billing', 'subscription')
export const Ceo = screen('CEO View', 'Cross-branch monitoring', 'ceo')
export const Refund = screen('Refund', 'Process a refund', 'refund')

// --- staff routes ---
export const Home = screen('Home', 'Start a sale', 'home')
export const SubmitReport = screen('Submit Report', 'End-of-shift reconciliation', 'report')
