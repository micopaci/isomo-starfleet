# Location-Based Site Auto-Detection

_Replaces Intune-group-driven site assignment. April 18, 2026._

## Why we changed this

The original design injected `-SiteId 7` as an Intune script parameter, baked
into each laptop's agent config. That worked until laptops started moving
between schools: the ops team had to remember to move the device between
Intune groups every time, and until they did, heartbeats kept reporting the
old site. In practice ~1 in 8 laptops per week ended up with a stale site.

The new flow uses the Starlink dish's own GPS fix to decide which site a
laptop is at, on every heartbeat. No human in the loop.

## End-to-end flow

```
┌────────────────────────────────────────────────────────────────────┐
│ 1. StarfleetAgent.ps1 (on laptop, every 5 min)                     │
│    Starlink dish  ── HTTP /api/status  ─→  snr, latency, ...       │
│                  ── gRPC get_location  ─→  lat, lon                │
│                  ── gRPC dish_status   ─→  download/upload Mbps    │
│    POST /ingest/signal  with { lat, lon, download_mbps, ... }      │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ 2. siteResolver.nearestSite(lat, lon)                              │
│    • Haversine vs every sites row with GPS coords                  │
│    • Returns { site_id, name, distance_km } if within 2 km         │
│    • Otherwise returns null → ingest falls back to hinted site_id  │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ 3. devices.site_id = resolved.site_id                              │
│    IF the resolved site differs AND the laptop moved ≥ 300m:       │
│      • INSERT INTO site_change_events (...)                        │
│      • notifier.notifySiteChange(ev)                               │
│          ├── email via SMTP to admin + ops users                   │
│          └── FCM push to registered Android devices                │
│      • broadcast('site_change', ...) over WebSocket                │
└────────────────────────────────────────────────────────────────────┘
```

## Configuration

| Env var                  | Default | Purpose |
|--------------------------|---------|---------|
| `MAX_SITE_RADIUS_KM`     | `2.0`   | A laptop is assigned to the nearest site **only** if it's within this radius. Starlink GPS is ±10m, but dishes can be on roofs up to ~50m from the classroom. 2km covers the full school grounds without ever matching the wrong school. |
| `MIN_MOVE_KM`            | `0.3`   | Anti-jitter. If the laptop has a previous GPS fix, it must have moved at least this far before we reassign it. Prevents ping-pong when a device sits near the midpoint of two close sites. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | — | Email transport. If unset, email notifications are silently skipped. |
| `SMTP_FROM`              | `Starfleet <noreply@starfleet.icircles.rw>` | — |
| `NOTIFY_EMAIL_TO`        | —       | Comma-separated fallback recipients if no users have opted in via `notification_prefs`. |
| `FCM_SERVER_KEY`         | —       | Firebase Cloud Messaging legacy server key. If unset, push is skipped. |

## What the agent sends now

```json
POST /ingest/signal
{
  "device_sn":       "DZT73D3",
  "site_id":         7,                 // hint only — backend may override
  "timestamp_utc":   "2026-04-18T12:35:02Z",
  "pop_latency_ms":  42.1,
  "snr":             9.8,
  "obstruction_pct": 0.4,
  "ping_drop_pct":   0.1,
  "download_mbps":   183.4,
  "upload_mbps":      22.6,
  "lat":              -1.94487,
  "lon":              30.06167
}
```

If `get_location` fails (most commonly because "access locations" is turned off
in the school's Starlink app), `lat`/`lon` are `null` and the backend keeps the
hinted `site_id` unchanged. Ops can turn the toggle on once per dish.

## Notification UX

**Email** — subject line `[Starfleet] Site change: LAPTOP-NYAR-04`. Body
includes from-site, to-site, distance in km, GPS fix coords, and event ID.
Recipients are users where `role IN ('admin','ops')` unless they've opted out
via `notification_prefs.site_change_email`.

**Push** — Android companion app receives an FCM notification with
`click_action: OPEN_SITE_CHANGES`. Tapping the notification deep-links into a
new Site Changes screen where the admin can tap **Acknowledge** to dismiss.

**WebSocket** — open admin dashboards receive a `site_change` broadcast and
can surface an inline toast.

## API

```
GET  /api/site-changes            List recent events (default 50, max 200)
GET  /api/site-changes?unack=1    Only events with acknowledged_at IS NULL
POST /api/site-changes/:id/ack    Admin-only; stamps acknowledged_at + by
```

## Rollout plan

1. Run migrations 015 + 016 on staging, verify views populate.
2. Push the updated agent (adds GPS + throughput to signal payload).
3. Deploy backend with the resolver off via `MAX_SITE_RADIUS_KM=0`
   (disables auto-reassignment; events still logged as audit).
4. Watch `site_change_events` for a week. Verify false-positive rate < 1/wk.
5. Flip `MAX_SITE_RADIUS_KM=2.0`. Keep Intune `-SiteId` param as the fallback
   for dishes with GPS disabled.
6. After 30 days of clean ops, deprecate the Intune `-SiteId` parameter
   entirely — all sites resolved from GPS.

## Failure modes

| Scenario | Behaviour |
|---|---|
| Dish GPS disabled | `lat`/`lon` null → falls back to hinted site_id; no reassignment |
| Laptop moved to a non-configured location | No site within 2km → keeps previous `site_id`, logs warning |
| SMTP down | Email silently skipped; push and WS still fire; ingest unaffected |
| FCM key missing | Push silently skipped; email + WS still fire |
| Two schools < 4km apart | Handled — we pick the nearer one. If a laptop sits on the boundary, `MIN_MOVE_KM` prevents ping-pong |
