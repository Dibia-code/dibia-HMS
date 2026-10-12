# Dibia HMS — Frontend and Backend Handoff

This is the current handoff for the Hospital Management System. The old Pharmacy Management System mockups are retained under `archive-pms-reference/` for historical reference only; they are not the HMS product spec or a source of current routes.

## Applications

| Application | Users | Purpose |
| --- | --- | --- |
| `hms-app` | Hospital staff | One hospital workspace for reception, care routing, cashier, pharmacy, inventory, staff, finance, and administration. |
| `console-app` | Dibia Super Admin | Hospital network registration, account status, subscription billing, and support. |

The pharmacy is a department within the hospital system. The old standalone pharmacy business and Dibia Pharmacy demo tenants have been removed from app startup seeding.

## Hospital app routes

Public routes: `/`, `/login`, `/register`, `/device/join`.

Authenticated routes are scoped by the signed-in hospital at `/:hospitalSlug`:

- `/dashboard` — personalized dashboard for the signed-in role set.
- `/reception`, `/queue` — patient registration and care routing.
- `/cashier`, `/bills`, `/hmo` — patient billing, receipts, and HMO claims.
- `/dispensing`, `/dispensing/:id` — hospital pharmacy prescriptions and dispensing.
- `/pos`, `/inventory`, `/purchasing`, `/warehouse`, `/stocktaking`, `/refund`, `/customers` — pharmacy department operations.
- `/staff`, `/branches`, `/expenses`, `/reports`, `/audit`, `/devices`, `/settings`, `/subscription`, `/ceo` — hospital administration and management.
- `/home`, `/report` — staff work home and shift closeout.

There is one login flow. After login, users enter their hospital workspace and land on `/dashboard`; there is no separate login per role. The dashboard presents a role-specific workspace (or combines the assigned workspaces for a multi-role account). Hospital Admin and CEO / Owner receive the Hospital Management dashboard; Branch Managers receive a branch operations dashboard; clinical, reception, cashier, pharmacy, and finance staff receive dashboards for their work. Hospital Management controls access by managing staff, role assignments, and permissions in the Staff screen. Multiple roles can be assigned to one staff account.

## Current roles

Super Admin, Hospital Admin, CEO / Owner, Branch Manager, Pharmacist, Superintendent Pharmacist, Receptionist, Cashier, Dispenser / Technician, Pharmacy Cashier, Inventory Officer, Sales Staff, Accountant, and Warehouse Officer.

The pharmacy and pharmacy-cashier roles refer to hospital departments. They do not define the product or tenant type.

## Console

The console is the Dibia HMS Super Admin workspace. Its routes are `/login`, `/overview`, `/hospitals`, `/billing`, and `/support`. It administers the hospital network. It is a separate app from the staff workspace; hospital role assignment and day-to-day staff permissions remain in the hospital app's Staff screen.

Production login must use the backend session endpoints:

- `POST /auth/console/login` — verify credentials server-side and set an HttpOnly, Secure, SameSite session cookie; return a display profile.
- `GET /auth/console/session` — return the active super-admin display profile for session restoration.
- `POST /auth/console/logout` — revoke the session and clear the cookie.

The browser must not contain the Super Admin password. Set `CONSOLE_ADMIN_EMAIL` and `CONSOLE_ADMIN_PASSWORD` in the backend deployment environment. `VITE_CONSOLE_DEMO_AUTH` is a local development-only mock switch; production builds must never enable it.

Only Super Admin, Hospital Admin, and CEO / Owner accounts may assign those elevated roles or grant admin-only permissions. Enforce the same rule in the backend; the staff screen's role and permission filters are presentation controls only.

## Tenant data and migration

The canonical API and current frontend contract use `hospitalId`, `hospitalSlug`, `hospitalName`, the `hospitals` entity, and `by_hospital` indexes. IndexedDB version 4 migrates prior `pharmacyId` records and the old `pharmacies` tenant store to the HMS names. It removes the two known seeded PMS tenants (`ph_johncool`, `ph_dibia`) from local demo data while preserving the Demo Hospital tenant and its HMS records.

All hospital and branch authorization must be enforced by the backend for every request and queued sync operation. Frontend route guards and IndexedDB scopes are UI protections only.

## Offline behavior

The hospital app uses IndexedDB as its local store and queues writes for sync. Sync operations must be idempotent, validate hospital, branch, actor, record, and permission on the server, and return durable acknowledgements. Patient data must not be placed in public service-worker caches.

SQLite is a local development/control-plane database, not an offline fallback for a disconnected hospital. Firestore (or another configured production database) is the authoritative server store. IndexedDB is the disconnected device store and outbox. The current IndexedDB implementation is not application-layer encrypted; production offline patient data requires an approved device-encryption and retention design.

## Current backend gaps

The backend now has server authentication, hospital sync push/pull, an initial snapshot endpoint, and basic console actions. This is an integration slice, not a production-ready patient-data service. Sync still needs complete role/action authorization, domain schema/state validation and transactional workflows. Console tenant, billing, modules, and support persistence need full production parity. The browser's IndexedDB data is not application-layer encrypted. Do not use real patient data until these gaps, backups/restore, access monitoring, deployment IAM, and a security review are complete.
