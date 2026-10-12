# Dibia HMS — Backend Integration Handoff

This document describes the current Hospital Management System frontend. The pharmacy is one hospital department; the app and hospital tenant are not a pharmacy business system.

## Frontend structure

- Hospital staff application: `hms-app/` (offline-first React app).
- Dibia network administration: `console-app/` (separate Super Admin app).
- Current route, role, dashboard, and data contract: `design-reference/FRONTEND_SPEC.md`.

The hospital app has one login flow. All authenticated staff enter the hospital workspace and see a dashboard assembled from their assigned role permissions. Hospital Admin, CEO / Owner, and Super Admin manage access through Staff; there is no dedicated cashier login application.

## Authentication contract

Hospital login currently resolves a local demo account. Replace it with a backend-issued session before production. Suggested endpoint:

- `POST /auth/login` accepts email or phone and password/PIN; response includes user profile, assigned roles, hospital, and branch.
- `POST /auth/refresh` rotates the session.
- `POST /auth/logout` revokes the session.
- `POST /auth/password/reset` starts the account recovery process.

The current frontend identity shape is `userId`, `name`, `email`, `roles`, `hospitalId`, `hospitalSlug`, `hospitalName`, `branchId`, `permGrants`, and `permDenies`. The server is authoritative for identity, permissions, hospital, branch, device approval, and account status. Client route guards are not an authorization boundary.

Only Super Admin, Hospital Admin, and CEO / Owner accounts may assign elevated admin roles or grant admin-only permissions. Enforce this policy in the server regardless of the role picker filters in the UI.

Console login is separate:

- `POST /auth/console/login`
- `GET /auth/console/session`
- `POST /auth/console/logout`

Verify the console password on the server. Set `CONSOLE_ADMIN_EMAIL` and `CONSOLE_ADMIN_PASSWORD` only in the backend deployment environment. Never use a `VITE_*` variable for a real secret, since Vite embeds those values into the browser bundle. The console includes fixed public preview credentials for Vite development only; real production sign-in must use backend session endpoints.

Until backend integration is ready, leave `VITE_CONSOLE_BACKEND_AUTH=false` and `VITE_ENABLE_SYNC=false`. The console preview login and hospital data workflows remain local to the frontend. Enable the corresponding backend flag only after the relevant server endpoints are deployed and ready.

## Hospital data and tenant scope

The canonical frontend/API names are `hospitals`, `hospitalId`, `hospitalSlug`, and `hospitalName`. Branches and all hospital records are scoped by `hospitalId`, and branch-level records also carry `branchId`. Verify both scopes on every API request and sync operation.

IndexedDB version 4 migrates existing local installations from the former `pharmacies` store and `pharmacyId` fields to the HMS names. It drops only the old seeded PMS demo tenants and keeps the Demo Hospital data. Department data such as pharmacy products, prescriptions, and dispensing remain part of the HMS.

Patient registration captures a name plus optional age (years), date of birth, state of origin, tribe, occupation, religion, marital status, address, phone, and next-of-kin details. Preserve these optional fields when syncing and returning patient records; older records may not contain them. When both age and date of birth are available, calculate current age from date of birth and retain entered age as a registration value.

## Offline sync

The local repository writes to IndexedDB and queues operations for `POST /sync`. Each operation has a unique operation ID, entity, action, record ID, and payload. The backend must:

- Enforce idempotency by `(hospitalId, opId)`.
- Validate hospital, branch, actor, permission, schema, and state transition from the authenticated session.
- Apply related writes atomically, including patient visits, payments, dispensing, refunds, stock movements, and audit records.
- Acknowledge only durable commits and return retryable/permanent errors per operation.
- Provide ordered pull changes with stable cursors and tombstones for deletes.

Do not trust browser-supplied `hospitalId`, `branchId`, `actorId`, balances, prices, or permissions as authoritative.

## Privacy and caching

Patient and visit records are sensitive health information. API responses must not enter the public service-worker precache. Use `Cache-Control: no-store` for authenticated patient data, and define device logout, retention, and local data protection before deployment.

## Current demo-only gaps

- Hospital app data still has a local seeded Demo Hospital for preview. Production startup must use server bootstrap data and disable demo seed writes.
- Hospital app auth still resolves locally seeded staff and stores a client-side profile.
- Console hospital registry, billing, and support repositories are seeded in memory until their APIs are connected.
- Sync push/pull and backend authorization are not implemented by this frontend.
