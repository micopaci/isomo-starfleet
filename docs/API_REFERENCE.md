# Starfleet API Reference

Document date: June 10, 2026

All `/api/*` and `/ingest/*` routes require a bearer token unless noted. Dashboard
users authenticate with `/auth/login`; laptop agents use site-scoped or
discovery-scoped agent JWTs.

## Authentication

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Returns a dashboard JWT for a user email/password |

Agent tokens must contain `role: "agent"` and a `site_id`. Site-scoped agent
tokens are rejected when the posted `site_id` does not match the token scope.
Discovery tokens use `site_id: 0` and are only accepted by bootstrap flows.

## Ingest Routes

| Method | Path | Token | Required fields | Purpose |
|---|---|---|---|---|
| `POST` | `/ingest/bootstrap-token` | Discovery agent | `device_sn` | Resolve a site from Starlink identity or GPS, then return a site/device-scoped token |
| `POST` | `/ingest/heartbeat` | Site agent | `device_sn`, `site_id` | Update device identity and `last_seen` |
| `POST` | `/ingest/signal` | Site agent | `device_sn`, `site_id` | Store Starlink signal, GPS/identity, throughput, and broadcast live signal |
| `POST` | `/ingest/latency` | Site agent | `device_sn`, `site_id`, `p50_ms`, `p95_ms` | Store laptop-side latency percentiles |
| `POST` | `/ingest/health` | Site agent | `device_sn`, `site_id` | Store battery, disk, SMART, and RAM health |
| `POST` | `/ingest/usage` | Site agent | `device_sn`, `site_id`, `date` | Add daily network byte deltas |
| `POST` | `/ingest/agent-health` | Site agent | `device_sn`, `site_id` | Store queue depth, run ID, version, last error, and last success |

If `payload_id` is present, duplicate ingest payloads return
`{ ok: true, duplicate: true }`.

Site resolution order:

1. Match Starlink identity (`starlink_id`, `starlink_uuid`, `starlink_sn`, `kit_id`) against site inventory.
2. Resolve nearest site from GPS coordinates.
3. Fall back to the configured or site-scoped `site_id`.

## Read API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/api/sites` | User | Site list with signal, laptop counts, Intune/Chromebook counts, weather predictor, score, usage, uptime |
| `GET` | `/api/sites/:id` | User | Site detail with latest signal, weather predictor, devices, and counts |
| `GET` | `/api/sites/:id/signal` | User | 14-day daily score history with data-quality and anomaly fields |
| `GET` | `/api/sites/:id/latency` | User | 14-day daily P50/P95 latency aggregates |
| `GET` | `/api/sites/:id/usage?months=N` | User | Monthly managed usage, imported Starlink portal totals, and estimated unmanaged usage |
| `GET` | `/api/sites/:id/usage/daily?days=N` | User | Daily managed usage, Starlink portal total, and unattributed usage for up to 366 days |
| `GET` | `/api/devices` | User | Device inventory with Intune-first status and health metadata |
| `GET` | `/api/devices?filter=stale` | User | Devices older than the online window and inside the stale window |
| `GET` | `/api/devices/:id` | User | Device detail with latest health, usage, and agent-health snapshot |
| `GET` | `/api/agent-health` | User | Latest agent-health snapshot per device |
| `GET` | `/api/site-changes` | User | Recent site-change events |
| `GET` | `/api/site-changes?unack=1&limit=N` | User | Unacknowledged site-change events |

Device status defaults:

| Status | Rule |
|---|---|
| `online` | `COALESCE(intune_last_sync_at, last_seen)` inside `DEVICE_ONLINE_HOURS`, default 72 hours |
| `stale` | Older than online window but inside `DEVICE_STALE_HOURS`, default 336 hours |
| `offline` | Older than stale window |
| `unknown` | No Intune sync or agent heartbeat timestamp |

## Admin API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/api/agent-tokens` | Admin | Generate site-scoped or discovery-scoped agent JWT |
| `POST` | `/api/intune/sync` | Admin | Force Microsoft Graph managed-device sync |
| `POST` | `/api/trigger` | Admin | Trigger one Intune remediation action for one managed device |
| `POST` | `/api/trigger/site` | Admin | Trigger one Intune remediation action for all Intune-managed devices at a site |
| `POST` | `/api/site-changes/:id/ack` | Admin | Acknowledge one site-change event |
| `POST` | `/api/usage/monthly-import` | Admin | Import monthly Starlink portal totals |
| `POST` | `/api/usage/daily-import` | Admin or `starlink_collector` | Import direct daily Starlink portal totals |
| `POST` | `/api/usage/portal-snapshots` | Admin or `starlink_collector` | Import cumulative portal readings and derive daily totals |
| `POST` | `/api/usage/portal-runs` | Admin or `starlink_collector` | Record Playwright portal scraper run status and alert admins on failures |
| `GET` | `/api/usage/portal-runs?limit=N` | Admin | Read recent Playwright portal scraper runs |

Supported trigger types are `location_refresh`, `data_pull`, `diagnostics`,
`ping_dish`, and `reboot_starlink`.

Monthly usage import body:

```json
{
  "month": "2026-04",
  "source": "starlink_portal_manual",
  "entries": [
    { "site_id": 41, "gb_total": 823.4 }
  ]
}
```

Each entry may provide `bytes_total`, `mb_total`, or `gb_total`.

Daily usage import body:

```json
{
  "date": "2026-06-09",
  "source": "starlink_portal_scraper",
  "entries": [
    {
      "site_id": 41,
      "gb_total": 27.8,
      "confidence": "portal_total",
      "service_line_id": "SL-123456",
      "starlink_identifier": "KIT123456",
      "billing_period_start": "2026-06-01",
      "billing_period_end": "2026-06-30",
      "scraped_at": "2026-06-10T03:15:00+02:00"
    }
  ]
}
```

Cumulative portal snapshot body:

```json
{
  "snapshot_date": "2026-06-10",
  "daily_date": "2026-06-09",
  "source": "starlink_portal_scraper",
  "entries": [
    {
      "site_id": 41,
      "gb_used_cumulative": 433.7,
      "service_line_id": "SL-123456",
      "starlink_identifier": "KIT123456",
      "billing_period_start": "2026-06-01",
      "billing_period_end": "2026-06-30"
    }
  ]
}
```

When a previous snapshot exists for the same site/source, the API writes the
daily delta to `site_usage_totals_daily` using `daily_date` when provided, or
`snapshot_date` otherwise. If the billing-cycle counter resets, the current
cumulative value is stored with `confidence: "cycle_reset_estimate"`.

## Intelligence API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/api/intel/space-weather` | User | Latest 24 NOAA K-index readings |
| `GET` | `/api/intel/weather` | User | Latest Open-Meteo rainfall/cloud reading per site |
| `GET` | `/api/intel/coverage/:site_id` | User | Live SGP4 visible-satellite count for site coordinates |

## Starlink Cloud API

`GET /api/sites` and `GET /api/sites/:id` include `starlink_terminal` when a
site is linked by `site_id` or can be matched to a Starlink portal nickname.

`GET /api/starlink-terminals?days=45` returns all stored Starlink portal
terminals with current cloud status, latest ping, latest usage, and a compact
`usage_trend` array for list/table sparklines.

`GET /api/sites/:id/starlink-usage` returns direct Starlink telemetryagg daily
usage for the linked service line:

```json
{
  "terminal": {
    "service_line_id": "AST-...",
    "current_status": "Online",
    "last_seen_utc": "2026-06-12T00:04:12.000Z"
  },
  "active_billing_cycle_start": "2026-06-01",
  "history": [
    { "log_date": "2026-06-10", "consumed_gb": 27.8 }
  ]
}
```

`GET /api/starlink-usage?from=YYYY-MM-DD&to=YYYY-MM-DD` returns direct cloud
usage for every stored Starlink terminal in the date range. Add
`service_line_id=SL-...` to limit it to one terminal.

`GET /api/sites/:id/starlink-ping?hours=24` returns Starlink cloud ping/status
samples for the linked terminal. `GET /api/starlink-terminals/:serviceLineId/ping`
returns the same shape for a single service line. The backend worker samples
every 5 minutes and opens a critical alert after 16 continuous offline hours.

## CSV Export API

All export routes are admin-only and return `text/csv`.

| Method | Path | Required query | Purpose |
|---|---|---|---|
| `GET` | `/api/export/signal` | `site_id`, `from`, `to` | Signal readings for one site/date range |
| `GET` | `/api/export/latency` | `site_id`, `from`, `to` | Latency readings for one site/date range |
| `GET` | `/api/export/site-usage-monthly` | `from`, `to` | Imported monthly Starlink portal totals |
| `GET` | `/api/export/site-usage-daily` | `from`, `to` | Imported daily Starlink portal totals |
| `GET` | `/api/export/usage-archive` | `from`, `to` | Archived daily usage rows |

## WebSocket

Connect to the backend origin over WebSocket, then authenticate as the first
message:

```json
{ "type": "auth", "token": "<dashboard-jwt>" }
```

Server responses/events:

| Event | Payload |
|---|---|
| `auth_ok` | Authentication succeeded |
| `auth_error` | Authentication failed; socket closes |
| `device_online` | `device_id`, `site_id` |
| `signal_update` | `site_id`, `signal` |
| `stale_devices` | `devices[]` with `device_id`, `site_id`, `hostname`, `stale_min` |

## Health Check

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Returns `{ status: "ok", db: "ok" }` when database connectivity works |
