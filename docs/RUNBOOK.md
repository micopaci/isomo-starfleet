# Starfleet Operations Runbook

Document date: April 30, 2026

## Platform health checks

Backend:

```bash
curl https://api.starfleet.icircles.rw/health
npm run intune:check --workspace=packages/backend
npm run weather:check --workspace=packages/backend
```

Desktop, web, and mobile clients all depend on the backend API and JWT auth. If
a client can log in but data does not refresh, check the API base URL, CORS
origin, and WebSocket connection first.

Expected production surfaces:

| Surface | Check |
|---|---|
| Backend | `/health` returns `status=ok` and `db=ok` |
| Web | Vercel route serves `packages/web/index.html` and backend CORS allows the domain |
| Desktop | API base points to the intended backend and WebSocket auth succeeds |
| Mobile | Settings API base points to the intended backend; token expiry is visible in Settings |
| Agent | `last_heartbeat.txt` is recent and queue depth is 0 |

## Intune agent rollout

Use the discovery remediation package for broad deployment. It installs the agent with `site_id=0`, lets the laptop read the Starlink dish identity and GPS, then exchanges the discovery token for a site-scoped token.

Check a laptop with:

```powershell
Get-Content C:\ProgramData\Starfleet\agent.log -Tail 80
powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\Starfleet\test.ps1
```

Healthy bootstrap lines look like:

```text
GPS resolved site 41 at 0.146 km.
Bootstrap resolved site 41 via starlink_identity; saving site-scoped agent token.
```

## Unauthorized ingest

Run `test.ps1` first. It reports token role, site, and expiry. The agent needs a token with `role=agent`; admin JWTs are refused for Intune packages and should only be used by the platform UI.

If `agent.config.json` is stale, rerun the remediation from Intune or manually run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\Starfleet\remediation.ps1
```

## Platform actions

The desktop buttons write `script_triggers` records immediately. Microsoft Graph launches the matching on-demand remediation only when the backend has a policy GUID configured for that action.

Required environment variables:

```text
REMEDIATION_POLICY_DIAGNOSTICS
REMEDIATION_POLICY_LOCATION_REFRESH
REMEDIATION_POLICY_DATA_PULL
REMEDIATION_POLICY_PING_DISH
REMEDIATION_POLICY_REBOOT_STARLINK
```

`REMEDIATION_POLICY_RESTART_STARLINK` is also accepted as a fallback for reboot.

After configuring the GUIDs, test one device before using a site-wide action:

```bash
curl -X POST "https://api.starfleet.icircles.rw/api/trigger" \
  -H "Authorization: Bearer <ADMIN_DASHBOARD_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"device_id":123,"type":"diagnostics"}'
```

For a site-wide action:

```bash
curl -X POST "https://api.starfleet.icircles.rw/api/trigger/site" \
  -H "Authorization: Bearer <ADMIN_DASHBOARD_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"site_id":41,"type":"diagnostics"}'
```

## Intune managed-device sync

If laptop model, OS, compliance, storage, Chromebook counts, or Intune sync time
look stale, run:

```bash
curl -X POST "https://api.starfleet.icircles.rw/api/intune/sync" \
  -H "Authorization: Bearer <ADMIN_DASHBOARD_JWT>"
```

The scheduled sync requires:

```text
GRAPH_TENANT_ID
GRAPH_CLIENT_ID
GRAPH_CLIENT_SECRET
```

Set `GRAPH_INTUNE_SYNC_ENABLED=false` to disable the scheduled sync without
removing credentials.

## Monthly Starlink data

On the Starlinks page, upload a CSV with:

```csv
site_id,gb_total
41,823.4
7,512.8
```

The importer also accepts `mb_total` or `bytes_total` instead of `gb_total`.

The dashboard reads monthly history from:

```text
GET /api/sites/:id/usage?months=6
```

Admin CSV exports are available for signal, latency, monthly usage totals, and
archived usage under `/api/export/*`.

## Daily Starlink portal usage worker

The always-on Windows Server 2019 / WSL2 worker is documented in
`docs/STARLINK_PORTAL_USAGE_WORKER.md`. It uses a persistent Playwright profile,
Gmail API domain-wide delegation for `support@icircles.rw` OTP email, and the
least-privilege `starlink_collector` JWT.

Quick checks:

```bash
npm run starlink:token --workspace=packages/backend -- 180d
npm run starlink:portal:usage --workspace=packages/backend -- --check-auth
curl "https://api.starfleet.icircles.rw/api/usage/portal-runs?limit=20" \
  -H "Authorization: Bearer <ADMIN_DASHBOARD_JWT>"
```

If Starlink asks for OTP during scheduled collection, the worker reads it via
Gmail API; do not scrape Gmail UI. If Starlink asks for a password, refresh the
persistent browser profile manually. Failed run statuses trigger best-effort
admin email alerts and appear in the Monday 17:00 Africa/Kigali weekly usage
report.
