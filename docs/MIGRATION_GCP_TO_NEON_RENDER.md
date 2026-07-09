# Migration: GCP (Cloud Run + Cloud SQL) → Render + Neon

**Why:** GCP billing was removed, taking down the `starfleet-backend` Cloud Run service (503 across all `/api/*`) and stopping the Cloud SQL instance. Rather than pay GCP's Cloud SQL floor (~$8–10/mo always-on), we move to a cheaper always-on stack:

- **Database:** Neon (free Postgres) — `db.js` already supports a plain `DATABASE_URL` + SSL when `INSTANCE_CONNECTION_NAME` is unset.
- **Backend:** Render Starter (~$7/mo always-on) running the existing `packages/backend/Dockerfile`. Always-on is required because the backend runs ~11 in-process `node-cron` jobs **and** a WebSocket server — a sleeping/serverless host breaks both.
- **Frontend:** stays on Vercel, unchanged. It calls `https://api.starfleet.icircles.rw`; we just repoint that DNS record to Render.

> **Cost note:** Re-enabling GCP billing in Phase 1 is a *one-time, few-dollars* cost to extract data + secrets. After cutover we tear GCP down so there is no recurring spend.

---

## Phase 0 — Prep (no GCP needed) ✅ done in-repo
- [x] `render.yaml` blueprint committed (Docker-based, env-var template).
- [x] Confirmed `db.js` uses `DATABASE_URL` path when `INSTANCE_CONNECTION_NAME` is unset.
- [x] Confirmed `Dockerfile` is self-contained (no workspace/`shared` runtime dep).

## Phase 1 — Re-enable GCP billing briefly & extract everything ⚠️ time-sensitive
Resources are retained ~30 days after billing loss; do this well inside that window.

1. **Re-enable billing** on project `isomobrain` (Console → Billing → link a billing account). Try **Reopen** on the closed account first (only path that could restore credits).
2. **Re-auth:** `gcloud auth login` (account `isomoadmin@bridge2rwanda.org`).
3. **Start Cloud SQL:**
   ```bash
   gcloud sql instances list --project=isomobrain
   gcloud sql instances patch <INSTANCE> --activation-policy=ALWAYS --project=isomobrain
   ```
4. **Export the secrets/env from the live Cloud Run config** (so we can replant them in Render):
   ```bash
   gcloud run services describe starfleet-backend --region=us-central1 --project=isomobrain \
     --format="value(spec.template.spec.containers[0].env)" > cloudrun-env.txt
   # For Secret Manager-backed values:
   gcloud secrets list --project=isomobrain
   gcloud secrets versions access latest --secret=<NAME> --project=isomobrain
   ```
   Capture at minimum: `JWT_SECRET` (or `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`), `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `SMTP_*`, `ALLOWED_ORIGINS`, all `REMEDIATION_POLICY_*`, and the Starlink portal creds if the sync worker will move too.
5. **Dump the database** (via Cloud SQL Auth Proxy):
   ```bash
   # reset the db password to a temp value you know (the URL secret is read-blocked):
   gcloud sql users set-password postgres --instance=<INSTANCE> --password=<TEMP> --project=isomobrain
   # in one terminal:
   cloud-sql-proxy isomobrain:us-central1:<INSTANCE> --port 5433
   # in another:
   pg_dump "postgresql://postgres:<TEMP>@127.0.0.1:5433/starfleet" \
     --no-owner --no-privileges -Fc -f starfleet.dump
   ```
   Verify: `pg_restore --list starfleet.dump | head` shows the expected tables.

## Phase 2 — Stand up Neon (you create the account)
1. Create a Neon project (region closest to users). Postgres 15+ is compatible.
2. Copy the **pooled** connection string (`...-pooler...?sslmode=require`).
3. **Restore the dump:**
   ```bash
   pg_restore --no-owner --no-privileges -d "<NEON_DATABASE_URL>" starfleet.dump
   ```
4. Verify row counts match (e.g. `sites`, `devices`, `signal_readings`, `device_lifecycle_logs`, `site_notes`).
   - The `schema_migrations` table comes across in the dump, so startup migrations will be marked applied and won't re-run destructively.

## Phase 3 — Deploy the backend to Render (you create the account)
1. Create a Render account, **New → Blueprint**, connect this GitHub repo → it reads `render.yaml`.
2. Fill in the `sync: false` env vars from `cloudrun-env.txt` (Phase 1.4). **`DATABASE_URL` = the Neon string.** Do **not** set `INSTANCE_CONNECTION_NAME`.
3. Deploy. Watch logs: migrations run, then `🚀 ... listening`, then cron schedules register.
4. Hit the Render URL `https://<svc>.onrender.com/health` → expect 200 JSON; `/api/alerts` → expect JSON.

## Phase 4 — Cut over DNS (zero frontend change)
1. In your DNS provider, repoint **`api.starfleet.icircles.rw`** from Cloud Run to Render:
   - Add `api.starfleet.icircles.rw` as a custom domain in Render → it gives a CNAME target → update the DNS record.
2. Wait for propagation, then verify `https://api.starfleet.icircles.rw/api/alerts` returns JSON.
3. Load `https://starfleet.icircles.rw` — dashboard data loads, WebSocket connects (same host, auto-upgraded).
   - If CORS errors appear, fix `ALLOWED_ORIGINS` to include `https://starfleet.icircles.rw`.

## Phase 5 — Migrate the Starlink portal sync workers
The status/usage scrapers ran as Cloud Run Jobs + Scheduler. Options:
- Run them on the **existing Windows daemon host** (already does seeding), pointed at the new backend via `STARFLEET_API_URL=https://api.starfleet.icircles.rw`, scheduled with Task Scheduler; **or**
- Re-create as **GitHub Actions** scheduled workflows; **or**
- Fold into backend `node-cron` if they don't need a browser/Playwright.

## Phase 6 — Tear down GCP (stop all charges)
After ≥24–48h stable on Render+Neon:
1. `gcloud run services delete starfleet-backend --region=us-central1 --project=isomobrain`
2. `gcloud sql instances delete <INSTANCE> --project=isomobrain`  *(take a final export first)*
3. Delete the Cloud Run Jobs + Scheduler jobs; optionally delete the project.
4. Disable billing again.

---

## Rollback
DNS still controls everything. If Render misbehaves, repoint `api.starfleet.icircles.rw` back to Cloud Run (keep Cloud SQL + Cloud Run alive until Phase 6). No frontend redeploy needed either way.

## Gotchas
- **JWT keys must match exactly** — a different secret invalidates every existing session and breaks agent ingest tokens.
- **Render free plan SLEEPS** (15-min idle) → kills cron + WebSocket. Use **Starter** (always-on).
- **Neon free autosuspends** the compute on idle but wakes in ~hundreds of ms on connect; the in-process cron keeps it warm anyway. Watch the 0.5 GB storage cap — if telemetry history is large, prune (`usageArchive`/`ingestDedup` retention) or use Neon's paid tier (~$19/mo).
- **`ALLOWED_ORIGINS`** must include the Vercel origin or the browser blocks the API.
- **Graph/Intune app registration** is unaffected (external Azure AD) — same client ID/secret work from Render.
