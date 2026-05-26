# Starfleet API Reference

Document date: April 30, 2026

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

## Intelligence API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/api/intel/space-weather` | User | Latest 24 NOAA K-index readings |
| `GET` | `/api/intel/weather` | User | Latest Open-Meteo rainfall/cloud reading per site |
| `GET` | `/api/intel/coverage/:site_id` | User | Live SGP4 visible-satellite count for site coordinates |

## CSV Export API

All export routes are admin-only and return `text/csv`.

| Method | Path | Required query | Purpose |
|---|---|---|---|
| `GET` | `/api/export/signal` | `site_id`, `from`, `to` | Signal readings for one site/date range |
| `GET` | `/api/export/latency` | `site_id`, `from`, `to` | Latency readings for one site/date range |
| `GET` | `/api/export/site-usage-monthly` | `from`, `to` | Imported monthly Starlink portal totals |
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
