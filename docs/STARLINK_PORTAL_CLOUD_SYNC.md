# Starlink Portal Cloud Sync

Document date: June 12, 2026

This worker polls Starlink's cloud backend directly for terminal status and
daily usage history. It is separate from the older browser-scraper usage worker:
the browser flow may still help refresh authentication, but the polling engine
does not perform visual login or MFA.

## Data Model

| Table | Purpose |
|---|---|
| `starlink_terminals` | One row per Starlink service line. Stores `service_line_id`, optional `site_id`, `nickname`, `account_id`, `current_status`, `last_seen_utc`, and `billing_cycle_start`. |
| `starlink_usage_history` | Daily usage time series keyed by `(log_date, service_line_id)` for idempotent UPSERTs. Stores clean `consumed_gb` values from Starlink telemetryagg. |
| `starlink_ping_samples` | 5-minute Starlink cloud status/ping samples for graphing and offline-duration alerting. |

The optional `starlink_terminals.site_id` is the bridge from Starlink's
service-line identity to Starfleet's site/dashboard identity.

## Auth Input

The worker accepts an externally refreshed auth payload. Use one of:

```text
STARLINK_PORTAL_AUTH_STATE_FILE=data_usage/auth/state.json
STARLINK_PORTAL_AUTH_HEADERS_FILE=/srv/starfleet/starlink-auth-headers.json
STARLINK_PORTAL_AUTH_HEADERS_JSON={"Cookie":"..."}
STARLINK_PORTAL_COOKIE=...
STARLINK_PORTAL_AUTHORIZATION=Bearer ...
```

`STARLINK_PORTAL_AUTH_STATE_FILE` may be a Playwright-style storage state JSON.
The worker extracts non-expired `starlink.com` cookies from it.

For the most faithful browser session payload, refresh login and capture headers:

```bash
cd data_usage
python3 auth_generator.py
python3 capture_api_headers.py
```

Then run the worker with:

```text
STARLINK_PORTAL_AUTH_HEADERS_FILE=data_usage/auth/api_headers.json
```

`data_usage/auth/api_headers.json` contains live cookies and must remain local.
It is ignored by git.

If Starlink returns HTTP 401 or 403, the worker writes/refreshes a critical
`alert_events` row with active key `starlink-portal-auth:expired` and logs the
failure. Refresh the external auth file or headers before the next run.

## Terminal Inventory

Seed or refresh terminal rows with:

```json
[
  {
    "service_line_id": "AST-...",
    "account_id": "ACC-...",
    "nickname": "GS Example",
    "site_id": 41,
    "billing_cycle_start": "2026-06-01"
  }
]
```

Provide the inventory through:

```text
STARLINK_TERMINALS_FILE=data_usage/auth/fleet_map.json
```

or:

```text
STARLINK_TERMINALS_JSON=[{"service_line_id":"AST-...","account_id":"ACC-...","site_id":41}]
```

`data_usage/auth/fleet_map.json` from `discover_fleet.py` is accepted directly.
Generated alternates such as `data_usage/auth/fleet_map_ast.json` are also
usable if they preserve the account/service-line/nickname shape; missing
terminal `status` is treated as active by the helper CLI.
After the first seed, the worker loads terminals from `starlink_terminals`.
If a terminal nickname matches a Starfleet site name after normalization
(including common `GS` / `ES` aliases), the worker fills `site_id`; otherwise
add `site_id` in the JSON or update the row in `starlink_terminals`.

## Commands

```bash
npm run migrate --workspace=packages/backend
npm run starlink:portal:cloud-sync --workspace=packages/backend -- --seed-only
npm run starlink:portal:cloud-sync --workspace=packages/backend -- --status-once
npm run starlink:portal:cloud-sync --workspace=packages/backend -- --usage-once
npm run starlink:portal:cloud-sync --workspace=packages/backend -- --daemon
```

Daemon mode runs terminal status immediately and then every
`STARLINK_STATUS_INTERVAL_MINUTES` minutes, defaulting to 5. Each status cycle
also inserts one `starlink_ping_samples` row per terminal and opens a critical
alert if Starlink cloud has kept a terminal offline for more than 16 hours.
Daily usage runs on `STARLINK_USAGE_CRON` (default `0 0 * * *`) in
`STARLINK_USAGE_TZ` (default `Africa/Kigali`), i.e. midnight Kigali time.

## Run It Unattended

Install the daemon as a systemd service on the always-on Windows Server 2019 /
WSL2 host (the host that already maintains the Starlink auth state):

```bash
sudo cp packages/backend/deploy/starlink-cloud-sync.service /etc/systemd/system/
# edit User= and WorkingDirectory= to match the host checkout
sudo systemctl daemon-reload
sudo systemctl enable --now starlink-cloud-sync
journalctl -u starlink-cloud-sync -f
```

WSL2 needs systemd enabled (`/etc/wsl.conf` → `[boot]\nsystemd=true`) and the
WSL distro kept alive. If systemd is not an option, register a Windows Task
Scheduler job that runs at startup:

```text
wsl.exe -d Ubuntu -- bash -lc "cd /srv/starfleet/starlink-fleet-monitor/packages/backend && node scripts/starlink_portal_cloud_sync_worker.js --daemon >> /srv/starfleet/starlink-cloud-sync.log 2>&1"
```

Both cadences live inside the daemon — one process covers the 5-minute online
check and the midnight usage pull.

## API Endpoints Used

Status loop:

```text
GET https://starlink.com/api/webagg/v2/accounts/service-line/{service_line_id}
```

The worker reads `content.userTerminals[0].isOffline` and `lastConnected`.

Usage loop:

```text
GET https://starlink.com/api/telemetryagg/v1/data-usage/account/{account_id}/service-line/{service_line_id}
```

The worker expands `billingCyclesAnnotated[].dailyData[]` into calendar dates
starting at each cycle's `startDate`, skips future placeholder days, and upserts
daily `consumed_gb` records.

## Dashboard Reads

`GET /api/sites` and `GET /api/sites/:id` include `starlink_terminal` when a
site is linked by `site_id` or can be matched to a Starlink portal nickname.

`GET /api/starlink-terminals?days=45` returns every stored portal terminal with
current cloud status, latest ping, latest usage, and `usage_trend` for the
Starlinks table.

`GET /api/sites/:id/starlink-usage` returns:

```json
{
  "terminal": { "service_line_id": "AST-...", "current_status": "Online" },
  "active_billing_cycle_start": "2026-06-01",
  "history": [
    { "log_date": "2026-06-10", "consumed_gb": 27.8 }
  ]
}
```

`GET /api/starlink-usage?from=2026-06-01&to=2026-06-12` returns all terminals'
stored usage in that date range. Add `&service_line_id=SL-...` for one
Starlink.

`GET /api/sites/:id/starlink-ping?hours=24` returns site-linked ping samples for
the dashboard graph. `GET /api/starlink-terminals/:serviceLineId/ping?hours=24`
does the same by service line.
