import { createBrowserRouter } from 'react-router-dom'
import { PERM } from '@/auth/permissions'
import { RequireAuth, RequireTenant, RequirePerms, TenantIndexRedirect } from '@/auth/guards'
import { AppShell } from '@/components'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import NotFound from '@/pages/NotFound'
import LandingPage from '@/features/landing/LandingPage'
import DashboardPage from '@/features/dashboard/DashboardPage'
import StaffPage from '@/features/staff/StaffPage'
import PosPage from '@/features/pos/PosPage'
import InventoryPage from '@/features/inventory/InventoryPage'
import HomePage from '@/features/home/HomePage'
import SubmitReportPage from '@/features/report/SubmitReportPage'
import CustomersPage from '@/features/customers/CustomersPage'
import ExpensesPage from '@/features/expenses/ExpensesPage'
import PurchasingPage from '@/features/purchasing/PurchasingPage'
import ReportsPage from '@/features/reports/ReportsPage'
import CeoPage from '@/features/ceo/CeoPage'
import BranchesPage from '@/features/branches/BranchesPage'
import WarehousePage from '@/features/warehouse/WarehousePage'
import StocktakingPage from '@/features/stocktaking/StocktakingPage'
import SubscriptionPage from '@/features/subscription/SubscriptionPage'
import SettingsPage from '@/features/settings/SettingsPage'
import RefundPage from '@/features/refund/RefundPage'
import ReceptionPage from '@/features/reception/ReceptionPage'
import QueuePage from '@/features/queue/QueuePage'
import DispensingPage from '@/features/dispensing/DispensingPage'
import PrescriptionPage from '@/features/dispensing/PrescriptionPage'
import HmoPage from '@/features/hmo/HmoPage'
import AuditPage from '@/features/audit/AuditPage'
import DevicesPage from '@/features/devices/DevicesPage'
import DeviceJoin from '@/pages/DeviceJoin'
import CashierPage from '@/features/cashier/CashierPage'
import BillsPage from '@/features/cashier/BillsPage'

// A tenant route protected by a permission (any-of). Wraps the element in the
// RequirePerms gate so access is decided by the union of the user's roles (§2).
const guarded = (path, element, anyOf) => ({
  path,
  element: <RequirePerms anyOf={anyOf} />,
  children: [{ index: true, element }],
})

// Routing tree — tenant + auth routes follow FRONTEND_SPEC §2. `/` also serves
// the public marketing landing, whose CTAs route into /login and /register.
export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/device/join', element: <DeviceJoin /> },

  {
    element: <RequireAuth />, // gate 1: authentication
    children: [
      {
        path: '/:hospitalSlug',
        element: <RequireTenant />, // gate 2: tenant ownership
        children: [
          {
            element: <AppShell />, // sidebar + topbar layout
            children: [
              { index: true, element: <TenantIndexRedirect /> },

              // gate 3 (per route): permission union check
              guarded('dashboard', <DashboardPage />, PERM.DASHBOARD_VIEW),
              guarded('reception', <ReceptionPage />, PERM.PATIENTS_MANAGE),
              guarded('queue', <QueuePage />, PERM.QUEUE_VIEW),
              guarded('cashier', <CashierPage />, PERM.BILLING_COLLECT),
              guarded('bills', <BillsPage />, PERM.BILLING_VIEW),
              guarded('hmo', <HmoPage />, PERM.HMO_MANAGE),
              guarded('audit', <AuditPage />, PERM.AUDIT_VIEW),
              guarded('devices', <DevicesPage />, PERM.SETTINGS_MANAGE),
              guarded('dispensing', <DispensingPage />, PERM.DISPENSE),
              guarded('dispensing/:id', <PrescriptionPage />, PERM.DISPENSE),
              guarded('pos', <PosPage />, PERM.POS_SELL),
              guarded('inventory', <InventoryPage />, PERM.INVENTORY_VIEW),
              guarded('purchasing', <PurchasingPage />, PERM.PURCHASING_MANAGE),
              guarded('branches', <BranchesPage />, PERM.BRANCHES_MANAGE),
              guarded('warehouse', <WarehousePage />, PERM.WAREHOUSE_MANAGE),
              guarded('staff', <StaffPage />, PERM.STAFF_MANAGE),
              guarded('stocktaking', <StocktakingPage />, [PERM.STOCKTAKING_MANAGE, PERM.STOCKTAKING_APPROVE]),
              guarded('expenses', <ExpensesPage />, PERM.EXPENSES_MANAGE),
              guarded('customers', <CustomersPage />, PERM.CUSTOMERS_VIEW),
              guarded('reports', <ReportsPage />, PERM.REPORTS_VIEW),
              guarded('settings', <SettingsPage />, [PERM.SETTINGS_DEVICES, PERM.SETTINGS_MANAGE]),
              guarded('subscription', <SubscriptionPage />, PERM.SUBSCRIPTION_MANAGE),
              guarded('ceo', <CeoPage />, PERM.CEO_VIEW),
              guarded('refund', <RefundPage />, PERM.POS_REFUND),

              // staff routes
              guarded('home', <HomePage />, PERM.POS_SELL),
              guarded('report', <SubmitReportPage />, PERM.REPORT_SUBMIT),
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <NotFound /> },
])
