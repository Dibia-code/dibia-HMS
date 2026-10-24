# Dibia HMS backend

The API uses Supabase Auth for identity and PostgreSQL for hospital, staff, clinical, inventory, billing, support, and platform data. Database access uses `DATABASE_URL` on the server. Supabase Auth access tokens are verified by the backend before protected requests are handled.

## Local development

```powershell
cd backend
npm install
npm run dev
```

Copy `.env.example` to `.env`, then set the local values. Keep `.env`, service account files, and migration credentials out of Git.

## Production setup

Set `NODE_ENV=production`, a random `JWT_SECRET` of at least 32 characters, `DEMO_MODE=false`, a console admin email and password of at least 16 characters, exact HTTPS `FRONTEND_ORIGINS`, and the Supabase variables in the environment section below. `SUPABASE_SECRET_KEY` and `DATABASE_URL` are server-only. Use the Supabase Transaction pooler connection string on port 6543 in `DATABASE_URL`. The backend uses transaction-scoped locks and does not require a persistent database session.

Set `VITE_API_URL` on both frontend deployments to the backend URL. Add the frontend origins and password reset redirect URLs to Supabase Auth settings. Configure production SMTP in Supabase Auth before relying on password reset email. `/health/ready` checks the database, Auth API, and platform administrator profile.

## Database migration

Apply `backend/supabase/migrations/202610160001_initial_schema.sql` to the Supabase project before starting the backend. The migration creates relational tables, foreign keys, role permissions, row level security, and policies. The repository migration is not applied automatically.

## Data transfer from Firebase

The one-time transfer tool is under `scripts/migrate/`. It reads Supabase settings from `backend/.env` and source settings from `backend/scripts/migrate/.env.migration`. The source credential file is at `backend/scripts/migrate/dibia-service-account.json`; keep it local and ignored by Git. This script provisions Supabase Auth users with temporary random passwords and does not import existing password hashes, so migrated users must reset their passwords after transfer. Supabase documents a separate Firebase password-hash migration flow that requires the source hash parameters; this transfer script does not implement that flow. Review the count report and verify the new data before removing the source credential yourself.

From `backend/`, run:

```powershell
node scripts/migrate/transfer.js
```

The transfer requires the schema migration to be applied first. It is safe to re-run and reports imported counts. Source-only values belong only in `scripts/migrate/.env.migration`.

## Environment variables

Backend values:

```text
SUPABASE_URL=your-supabase-project-url
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-server-only-secret-key
DATABASE_URL=your-session-pooler-connection-string
```

The frontends use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` when a browser Supabase client is needed. Never put `SUPABASE_SECRET_KEY` or `DATABASE_URL` in a frontend environment.

## Operational limits

Offline HMS records remain in browser IndexedDB and sync to Postgres through the API. Browser IndexedDB is not encrypted at the application layer. Complete device access, retention, logout wipe, backup recovery, monitoring, and independent security review before storing real patient data.
