# Dibia HMS backend

The backend has development and production configuration paths. Production configuration fails closed on placeholder secrets, demo seed mode, SQLite as the hospital record store, non-HTTPS origins, and missing cloud configuration. Passing those checks is necessary, not sufficient for real patient data.

## Hospital registration and console approval

`POST /auth/register` creates a pending hospital, its main branch, and its first facility administrator. Pending hospitals cannot sign in or use protected APIs. A Dibia Super Admin reviews registrations in Console; approve/reject actions use `POST /platform/tenants/:tenantId/decision`. Approval activates the hospital and its free subscription; rejection keeps access disabled. Both actions are audited. The console admin account is bootstrapped from `CONSOLE_ADMIN_EMAIL` and `CONSOLE_ADMIN_PASSWORD` in the backend environment.

Authentication uses only essential session cookies: refresh cookies are `HttpOnly`, `Secure` and `SameSite=Strict` in production (`Lax` locally), with a seven day lifetime. Access tokens stay in memory. There are no analytics or advertising cookies, so the apps do not show a consent banner; users cannot opt out of the cookie required to keep an authenticated session active.

## Data and offline model

- **Firestore is the production record store** when the backend has been completed and deployed with least-privilege Google IAM credentials. Firestore is encrypted at rest by Google and uses TLS in transit.
- **SQLite is local development and single-server control-plane storage**, not a network-failure cache or automatic fallback. Production use of its control-plane tables requires a persistent encrypted volume and backups.
- **IndexedDB is the HMS device-side offline store/outbox.** It keeps work available while disconnected and syncs when online. The current browser database is not encrypted at the application layer. Do not store real patient data offline in this build until device encryption, device access/retention, and logout/wipe behavior are implemented and reviewed.

## Local development

`powershell
cd backend
Copy-Item .env.example .env
npm install
npm run dev
`

The local template uses SQLite. Set DEMO_MODE=true only for an isolated demo database. Keep local .env and database files out of Git.

## Production configuration

Use .env.production.example as a deployment checklist, not as a file to deploy unchanged. Set a random JWT_SECRET (at least 32 characters), unique console admin credentials (at least 16 characters), exact HTTPS origins, Firebase project/API configuration, Google Application Default Credentials with least-privilege IAM, and an absolute DB_FILE on persistent encrypted storage. Set NODE_ENV=production, DATA_STORE=firestore, and DEMO_MODE=false. The service binds to `0.0.0.0` in production for container/proxy access. Apply shared rate limits at the API gateway; the process-local limiter is only an additional guard.

Firestore server SDKs bypass Firestore Security Rules. Every authorization decision must therefore be enforced by this API and IAM. Several patient-data production requirements remain outside the registration/console flow: comprehensive schema validation and domain transactions, application encryption and device controls for offline IndexedDB, tested backups/restore, monitoring/alerting, shared rate limiting, deployment configuration, and an independent security review. Do not use real patient data until those are complete.
