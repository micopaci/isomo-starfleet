# Starfleet Backend

Express/PostgreSQL backend for Starfleet Monitor. It owns authentication,
agent ingest, site resolution, live WebSocket events, Microsoft Graph/Intune
sync, scoring jobs, weather/orbital intelligence, usage imports, and CSV
exports.

## Run

From the repo root:

```bash
npm install
npm run backend:dev
```

Production start:

```bash
npm run start --workspace=packages/backend
```

That command runs `node migrate.js` before `node server.js`.

## Environment

Copy `.env.example` and set at least:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=...
PORT=3000
ALLOWED_ORIGINS=http://localhost:5173,https://starfleet.icircles.rw
```

Optional production integrations:

| Variable | Purpose |
|---|---|
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | RS256 token signing/verification |
| `AGENT_TOKEN_TTL` | Agent token lifetime, default `365d` |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | Microsoft Graph client credentials |
| `GRAPH_INTUNE_SYNC_ENABLED` | Set `false` to disable scheduled Intune sync |
| `GRAPH_INTUNE_SYNC_INTERVAL_MIN` | Scheduled Intune sync cadence |
| `REMEDIATION_POLICY_*` | Intune on-demand remediation policy IDs |
| `DEVICE_ONLINE_HOURS`, `DEVICE_STALE_HOURS` | Device status windows |
| `OPEN_METEO_ENABLED` | Weather correlation |
| `SMTP_*`, `DIGEST_*`, `DASHBOARD_URL` | Weekly digest/email notifications |

## Main Routes

| Route group | Purpose |
|---|---|
| `/health` | Public API/DB health check |
| `/auth/login` | Dashboard login |
| `/ingest/*` | Agent telemetry ingest |
| `/api/sites`, `/api/devices` | Dashboard/mobile read API |
| `/api/agent-tokens` | Admin agent-token generation |
| `/api/intune/sync` | Admin Graph managed-device sync |
| `/api/trigger`, `/api/trigger/site` | Admin Intune remediation trigger actions |
| `/api/intel/*` | Space-weather, local weather, and satellite coverage intelligence |
| `/api/usage/*` | Monthly/daily Starlink portal usage imports and scraper-run audit |
| `/api/export/*` | Admin CSV exports |

See `docs/API_REFERENCE.md` for endpoint-level details.

## Background Services

`server.js` schedules:

| Service | File | Purpose |
|---|---|---|
| Score cron | `services/scoreCron.js` | Daily site scoring |
| Space weather | `services/spaceWeather.js` | NOAA K-index collection |
| Orbital sync | `services/orbitalSync.js` | Starlink satellite coverage calculations |
| Weather correlation | `services/weatherCorrelation.js` | Open-Meteo rainfall/cloud readings |
| Watchdog | `services/watchdog.js` | Stale-device WebSocket broadcast |
| Weekly digest | `services/weeklyDigest.js` | Email summary |
| Starlink usage report | `services/weeklyStarlinkUsageReport.js` | Monday 17:00 Kigali portal-usage email |
| Ingest dedup prune | `services/ingestDedup.js` | Old payload-id cleanup |
| Usage archive | `services/usageArchive.js` | Older usage rollup/archive |
| Graph sync | `services/graph.js` | Microsoft Intune managed-device sync |

## Operational Checks

```bash
curl https://api.starfleet.icircles.rw/health
npm run migrate --workspace=packages/backend
npm run intune:check --workspace=packages/backend
npm run weather:check --workspace=packages/backend
npm run starlink:token --workspace=packages/backend -- 180d
npm run starlink:portal:usage --workspace=packages/backend -- --help
```

See `docs/STARLINK_PORTAL_USAGE_WORKER.md` for always-on server setup, Gmail
API OTP configuration, scheduling, and recovery.

Do not commit `.env`, generated JWTs, or token-bearing Intune artifacts.
