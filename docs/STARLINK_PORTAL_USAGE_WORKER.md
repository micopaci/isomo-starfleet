# Starlink Portal Usage Worker

Document date: June 10, 2026

This worker collects authoritative Starlink web-portal usage totals and imports
them into Starfleet daily. It should run only on the always-on Windows Server
2019 / WSL2 host, because it needs a persistent browser profile for
`support@icircles.rw` and Starlink MFA/OTP state.

The browser extension is not the source of truth for site totals. The extension
can later explain user/domain attribution; this worker imports the Starlink
portal total for each school dish.

## Backend Landing Zone

The worker writes to:

| Endpoint | Purpose |
|---|---|
| `POST /api/usage/portal-snapshots` | Preferred residential-account mode: import billing-cycle cumulative readings and derive daily deltas |
| `POST /api/usage/daily-import` | Direct mode when the portal exposes exact daily totals |
| `POST /api/usage/portal-runs` | Audit worker start, success, partial, or failure status |

Dashboard reads use `GET /api/sites` and `GET /api/sites/:id/usage/daily`.

## Server Setup

Run from the repo root on the always-on server:

```bash
npm install
npm install --workspace=packages/backend playwright
npx playwright install chromium
npm run migrate --workspace=packages/backend
```

Create `packages/backend/.env.portal` on the server:

```text
STARFLEET_API_URL=https://api.starfleet.icircles.rw
STARFLEET_ADMIN_EMAIL=<dashboard-admin-email>
STARFLEET_ADMIN_PASSWORD=<dashboard-admin-password>

STARLINK_PORTAL_EMAIL=support@icircles.rw
STARLINK_PORTAL_PROFILE_DIR=/srv/starfleet/starlink-browser-profile
STARLINK_PORTAL_HEADLESS=true
STARLINK_PORTAL_USAGE_MODE=snapshot
STARLINK_PORTAL_DAILY_DATE_BACKDAYS=1
STARLINK_PORTAL_ADAPTER=/srv/starfleet/starlink_portal_usage_adapter.js
STARLINK_SITE_MAP_FILE=/srv/starfleet/starlink-site-map.json
```

Use `STARFLEET_ADMIN_TOKEN` instead of email/password if you prefer issuing a
long-lived admin token for this job.

## First Login And MFA

Run this once while connected to the server desktop or WSL browser display:

```bash
npm run starlink:portal:usage --workspace=packages/backend -- --check-auth
```

Sign in as `support@icircles.rw`, complete Starlink OTP/MFA, then press Enter in
the terminal. The browser profile remains on disk and future headless runs reuse
that authenticated session.

If Starlink forces OTP again later, rerun `--check-auth`.

## Adapter Calibration

Copy the example adapter:

```bash
cp packages/backend/scripts/starlink_portal_usage_adapter.example.js /srv/starfleet/starlink_portal_usage_adapter.js
```

Then inspect the signed-in portal and replace the example with selectors or
network-response parsing that returns exact usage rows:

```js
[
  {
    site_id: 41,
    gb_used_cumulative: 433.7,
    service_line_id: "SL-123456",
    starlink_identifier: "KIT123456",
    billing_period_start: "2026-06-01",
    billing_period_end: "2026-06-30"
  }
]
```

Residential accounts usually show usage since the billing-cycle/payment date.
Keep `STARLINK_PORTAL_USAGE_MODE=snapshot` for that shape. Starfleet will derive
the daily delta once it has yesterday's snapshot. With the recommended
`STARLINK_PORTAL_DAILY_DATE_BACKDAYS=1`, a snapshot collected on June 11 is
stored as June 10 usage. If the portal exposes true daily totals, set
`STARLINK_PORTAL_USAGE_MODE=daily` and return `gb_total`, `mb_total`, or
`bytes_total`.

The adapter should fail rather than guess if a site cannot be mapped exactly.

## Site Map

Create `/srv/starfleet/starlink-site-map.json` with stable portal identifiers as
keys and Starfleet site IDs as values. The adapter receives this object as
`siteMap`.

```json
{
  "KIT123456": 41,
  "SL-123456": 41,
  "GS Example": 41
}
```

## Dry Run

Before importing real data:

```bash
npm run starlink:portal:usage --workspace=packages/backend -- --run --dry-run
```

You can also test backend import shape from a fixture:

```bash
npm run starlink:portal:usage --workspace=packages/backend -- --fixture ./usage.json --dry-run
```

## Daily Schedule

Schedule the import after the local day closes, for example 03:10 Africa/Kigali:

```bash
npm run starlink:portal:usage --workspace=packages/backend -- --run
```

On Windows Task Scheduler, run WSL with a command like:

```powershell
wsl.exe -d Ubuntu -- bash -lc "cd '/mnt/c/Path/To/starlink-fleet-monitor' && npm run starlink:portal:usage --workspace=packages/backend -- --run >> /srv/starfleet/starlink-portal-usage.log 2>&1"
```

The dashboard will show the latest imported `Portal usage` value per Starlink
site as soon as the job posts data.
