# Dibia HMS backend

The backend uses Firebase Authentication and Cloud Firestore for all persistent server data. Production configuration fails closed on placeholder secrets, demo seed mode, non-HTTPS origins, and missing Firebase configuration.

## Hospital registration and console approval

`POST /auth/register` creates a pending hospital, its main branch, and its first facility administrator. Pending hospitals cannot sign in or use protected APIs. A Dibia Super Admin reviews registrations in Console; approve/reject actions use `POST /platform/tenants/:tenantId/decision`. Approval activates the hospital and its free subscription; rejection keeps access disabled. Both actions are audited. The console admin is created from `CONSOLE_ADMIN_EMAIL` and `CONSOLE_ADMIN_PASSWORD` on first startup if it does not already exist. Rotate existing passwords through Firebase Authentication.

Authentication uses only essential session cookies: refresh cookies are `HttpOnly`, `Secure` and `SameSite=Strict` in production (`Lax` locally), with a seven day lifetime. Access tokens stay in memory. There are no analytics or advertising cookies, so the apps do not show a consent banner; users cannot opt out of the cookie required to keep an authenticated session active.

## Data and offline model

- **Cloud Firestore is the only server-side persistent store.** Firebase Authentication manages staff and platform sign-in. Configure Firebase Admin with `FIREBASE_SERVICE_ACCOUNT_JSON` or Application Default Credentials.
- **IndexedDB is the HMS device-side offline store/outbox.** It keeps work available while disconnected and syncs when online. The current browser database is not encrypted at the application layer. Do not store real patient data offline in this build until device encryption, device access/retention, and logout/wipe behavior are implemented and reviewed.

## Local development

```powershell
cd backend
npm install
npm run dev
```

Set local variables in `backend/.env` before starting the service. Keep `.env` and service account files out of Git.

## Production configuration

Set `NODE_ENV=production`, a random `JWT_SECRET` of at least 32 characters, `DEMO_MODE=false`, a console admin email and password of at least 16 characters, exact HTTPS `FRONTEND_ORIGINS`, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, and Firebase Admin credentials. The service binds to `0.0.0.0` in production. Authentication endpoints use a Firestore-backed limit shared across instances; add Vercel Firewall rules for edge-level abuse protection.

Use `/health` for liveness and `/health/ready` to check Firestore access and Firebase Authentication project configuration. A successful readiness check does not replace a registration and sign-in smoke test.

### Deploying the backend on Vercel

Create a separate Vercel project with the repository's `backend` directory as its root. Vercel detects the Express app in `src/server.js`. Add the production variables above to the Vercel project; use `FIREBASE_SERVICE_ACCOUNT_JSON` for the service account JSON rather than uploading the local credential file.

Assign the backend a custom domain such as `api.dibia.app`. Set `VITE_API_URL=https://api.dibia.app` on both frontend Vercel projects before building. Set `FRONTEND_ORIGINS` to the exact HTTPS origins of the HMS and Console sites, with no trailing slashes. Keeping the API and frontends under the same site allows the secure `SameSite=Strict` session cookies to work across their origins.

After deployment, require `/health/ready` to return HTTP 200, then test hospital registration, approval, sign-in, refresh, and sign-out against a non-production test account before using the service.

Firestore server SDKs bypass Firestore Security Rules. Every authorization decision must therefore be enforced by this API and IAM. Production use with real patient data still requires comprehensive schema validation and domain transactions, application encryption and device controls for offline IndexedDB, tested backups/restore, monitoring/alerting, deployment configuration, and an independent security review. Do not use real patient data until those are complete.
