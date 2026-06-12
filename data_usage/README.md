# data_usage Starlink Scripts

This folder is the Starlink portal extraction workspace.

Current important files:

| File | Purpose |
|---|---|
| `auth/state.json` | Manual Starlink browser session captured by `auth_generator.py`. Treat as secret. |
| `auth/fleet_map.json` | Account-to-service-line inventory discovered by `discover_fleet.py`. |
| `sync_starfleet.py` | CLI for ad hoc status, date-range usage, and ping sampling from Starlink cloud APIs. |

## Future Update Flow

When the Starlink session expires:

```bash
cd data_usage
python3 auth_generator.py
```

Log in in the opened browser, complete MFA, then press Enter in the terminal.
This refreshes `data_usage/auth/state.json`.

When accounts or terminals change:

```bash
cd data_usage
python3 discover_fleet.py
```

This refreshes `data_usage/auth/fleet_map.json`.

## Query Usage For Dates

All active Starlinks:

```bash
python3 data_usage/sync_starfleet.py --usage --from 2026-06-01 --to 2026-06-12
```

One Starlink:

```bash
python3 data_usage/sync_starfleet.py --usage --service-line SL-606903-86751-28 --from 2026-06-01 --to 2026-06-12
```

By nickname search:

```bash
python3 data_usage/sync_starfleet.py --usage --nickname "ES Gikonko" --from 2026-06-01 --to 2026-06-12
```

The default output is `data_usage/auth/latest_sync.json`.

## Ping Sampling

Ad hoc one-terminal ping loop:

```bash
python3 data_usage/sync_starfleet.py --ping-loop --service-line SL-606903-86751-28 --interval-seconds 300
```

This writes JSONL rows to `data_usage/auth/ping_samples.jsonl`.

For the production dashboard graph and 16-hour offline alert, run the backend
worker instead:

```bash
STARLINK_PORTAL_AUTH_STATE_FILE=data_usage/auth/state.json \
STARLINK_TERMINALS_FILE=data_usage/auth/fleet_map.json \
STARLINK_STATUS_INTERVAL_MINUTES=5 \
npm run starlink:portal:cloud-sync --workspace=packages/backend -- --daemon
```

That worker writes:

- `starlink_terminals` for current status
- `starlink_usage_history` for daily usage
- `starlink_ping_samples` every 5 minutes for the graph
- `alert_events` when a terminal is offline for more than 16 hours

## Backend Queries

Usage for all Starlinks:

```text
GET /api/starlink-usage?from=2026-06-01&to=2026-06-12
```

Usage for one Starlink:

```text
GET /api/starlink-usage?from=2026-06-01&to=2026-06-12&service_line_id=SL-606903-86751-28
```

Ping graph data for a site:

```text
GET /api/sites/:id/starlink-ping?hours=24
```

Ping graph data for a service line:

```text
GET /api/starlink-terminals/:serviceLineId/ping?hours=24
```
