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
STARFLEET_COLLECTOR_TOKEN=<starlink_collector JWT>

STARLINK_PORTAL_EMAIL=support@icircles.rw
STARLINK_PORTAL_PROFILE_DIR=/srv/starfleet/starlink-browser-profile
STARLINK_PORTAL_HEADLESS=true
STARLINK_PORTAL_USAGE_MODE=snapshot
STARLINK_PORTAL_DAILY_DATE_BACKDAYS=1
STARLINK_PORTAL_ADAPTER=/srv/starfleet/starlink_portal_usage_adapter.js
STARLINK_SITE_MAP_FILE=/srv/starfleet/starlink-site-map.json
STARLINK_GMAIL_DWD_KEY_FILE=/etc/starfleet/starlink-gmail-dwd.json
STARLINK_GMAIL_OTP_QUERY=newer_than:15m (from:starlink.com OR from:noreply@starlink.com OR Starlink) (code OR verification OR login)
```

Generate the least-privilege collector token from the backend environment:

```bash
npm run starlink:token --workspace=packages/backend -- 180d
```

`STARFLEET_ADMIN_TOKEN` still works for manual admin testing, but production
schedulers should use `STARFLEET_COLLECTOR_TOKEN`. Do not put dashboard admin
passwords in `.env.portal`.

## Gmail API OTP Setup

Starlink sends OTP/MFA email to `support@icircles.rw`. The worker reads that OTP
through the Gmail API; it must not scrape Gmail UI.

1. Create a dedicated Google Cloud service account.
2. Enable Google Workspace domain-wide delegation for the service account.
3. In Google Workspace Admin, authorize only:

```text
https://www.googleapis.com/auth/gmail.readonly
```

4. Store the JSON key outside the repo, for example
   `/etc/starfleet/starlink-gmail-dwd.json`.
5. Keep `STARLINK_PORTAL_EMAIL=support@icircles.rw`. The worker rejects other
   impersonation targets.

Use Gmail readonly unless a future approved workflow needs to mark OTP messages
processed. Never store raw Starlink passwords or OTP secrets in code, `.env`,
logs, screenshots, or docs.

## First Login And MFA

Run this once while connected to the server desktop or WSL browser display:

```bash
npm run starlink:portal:usage --workspace=packages/backend -- --check-auth
```

Sign in as `support@icircles.rw`, complete Starlink OTP/MFA, then press Enter in
the terminal. If Gmail DWD is configured and Starlink shows an OTP field, the
worker will attempt to fill the code via Gmail API. The browser profile remains
on disk and future headless runs reuse that authenticated session.

If Starlink forces OTP again later, rerun `--check-auth`.

If Starlink asks for a password, stop and refresh the profile manually. The
worker intentionally does not accept or store raw Starlink passwords.

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

## Weekly Usage Report

Enable the Monday 17:00 Africa/Kigali weekly report:

```text
STARLINK_USAGE_REPORT_ENABLED=true
STARLINK_USAGE_REPORT_TO=ops@icircles.rw
STARLINK_USAGE_REPORT_FROM=starfleet@icircles.rw
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
```

The report summarizes previous-week usage by school/site, daily breakdown,
highest-usage sites, failed/missing collection days, counter resets, and
unattributed residual usage after subtracting Starfleet managed endpoint usage.
